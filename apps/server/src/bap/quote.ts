import { createHash } from "node:crypto";
import { newId, type QuoteResponse, type StoreQuoteError } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { auditState } from "../beckn/audit.js";
import type { QuoteLine } from "../db/schema/bap.js";
import { basketView, getOpenBasket, loadBasketItems, OPEN_STATUSES, type BasketItemRow } from "./basket.js";
import { fetchStoreQuote, type StoreQuote, type StoreRef } from "./store-quote.js";
import { ApiError, loadBapConfig, loadCustomer, withTx } from "./util.js";

export const QUOTE_VALID_MS = 10 * 60 * 1000;

interface HashInput {
  stores: { storeId: string; quote: StoreQuote }[];
  itemsTotalPaise: number;
  deliveryTotalPaise: number;
  platformFeePaise: number;
  grandTotalPaise: number;
}

/** sha256 over a canonical JSON (sorted stores and lines, fixed key order) of store lines + totals. */
export function computeQuoteHash(h: HashInput): string {
  const canonical = {
    stores: [...h.stores]
      .sort((a, b) => a.storeId.localeCompare(b.storeId))
      .map((s) => ({
        storeId: s.storeId,
        lines: [...s.quote.lines]
          .sort((a, b) => a.listingId.localeCompare(b.listingId))
          .map((l) => ({ listingId: l.listingId, qty: l.qty, unitPricePaise: l.unitPricePaise, lineTotalPaise: l.lineTotalPaise })),
        itemsTotalPaise: s.quote.itemsTotalPaise,
        deliveryPaise: s.quote.deliveryPaise,
        totalPaise: s.quote.totalPaise,
      })),
    itemsTotalPaise: h.itemsTotalPaise,
    deliveryTotalPaise: h.deliveryTotalPaise,
    platformFeePaise: h.platformFeePaise,
    grandTotalPaise: h.grandTotalPaise,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

const signature = (items: BasketItemRow[]) => JSON.stringify(items.map((i) => [i.listing_id, i.qty, i.seen_price_paise]).sort());

/** POST /bap/basket/quote: parallel select -> init per store, then snapshot (T06). */
export async function createQuote(ctx: AppContext, customerId: string): Promise<QuoteResponse> {
  const { pool } = ctx;
  const customer = await loadCustomer(pool, customerId);
  const basket = await getOpenBasket(pool, customerId);
  if (basket.status === "PAYMENT_INITIATED") throw new ApiError(409, "payment_in_progress");
  const items = await loadBasketItems(pool, basket.id);
  if (!items.length) throw new ApiError(400, "empty_basket", "Add items before asking for a quote.");
  const sig = signature(items);

  const byStore = new Map<string, { store: StoreRef; items: BasketItemRow[] }>();
  for (const it of items) {
    let g = byStore.get(it.store_id);
    if (!g) {
      g = { store: { storeId: it.store_id, storeName: it.store_name, bppId: it.bpp_id, bppUri: it.bpp_uri }, items: [] };
      byStore.set(it.store_id, g);
    }
    g.items.push(it);
  }

  const results = await Promise.all(
    [...byStore.values()].map(async (g) => ({
      store: g.store,
      res: await fetchStoreQuote(ctx, {
        transactionId: basket.transaction_id,
        customer,
        store: g.store,
        lines: g.items.map((i) => ({
          listingId: i.listing_id, canonicalProductId: i.canonical_product_id, name: i.name, qty: i.qty, seenPricePaise: i.seen_price_paise,
        })),
      }),
    })),
  );

  const errors: StoreQuoteError[] = [];
  const ok: { store: StoreRef; quote: StoreQuote }[] = [];
  for (const r of results) {
    if (r.res.ok) {
      ok.push({ store: r.store, quote: r.res.quote });
      if (r.res.mismatch) await auditState(pool, "bap", "quote.store_total_mismatch", { entityId: basket.id, transactionId: basket.transaction_id, storeId: r.store.storeId });
    } else {
      errors.push(r.res.error);
    }
  }
  if (errors.length) return { basket: await basketView(pool, basket.id), quote: null, errors };

  const config = await loadBapConfig(pool);
  const itemsTotalPaise = ok.reduce((a, s) => a + s.quote.itemsTotalPaise, 0);
  const deliveryTotalPaise = ok.reduce((a, s) => a + s.quote.deliveryPaise, 0);
  const platformFeePaise = config.platformFeePaise;
  const grandTotalPaise = itemsTotalPaise + deliveryTotalPaise + platformFeePaise;
  const quoteHash = computeQuoteHash({
    stores: ok.map((s) => ({ storeId: s.store.storeId, quote: s.quote })),
    itemsTotalPaise, deliveryTotalPaise, platformFeePaise, grandTotalPaise,
  });

  await withTx(pool, async (c) => {
    const { rows } = await c.query<{ status: string }>("SELECT status FROM bap.basket WHERE id = $1 FOR UPDATE", [basket.id]);
    if (!rows[0] || !OPEN_STATUSES.includes(rows[0].status as never) || rows[0].status === "PAYMENT_INITIATED") {
      throw new ApiError(409, "basket_changed", "The basket changed while quoting; try again.");
    }
    if (signature(await loadBasketItems(c, basket.id)) !== sig) {
      throw new ApiError(409, "basket_changed", "The basket changed while quoting; try again.");
    }
    const quoteId = newId("qte");
    await c.query(
      `INSERT INTO bap.quote (id, basket_id, quote_hash, items_total_paise, delivery_total_paise, platform_fee_paise, grand_total_paise, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [quoteId, basket.id, quoteHash, itemsTotalPaise, deliveryTotalPaise, platformFeePaise, grandTotalPaise, new Date(Date.now() + QUOTE_VALID_MS)],
    );
    for (const s of ok) {
      await c.query(
        `INSERT INTO bap.quote_store (quote_id, store_id, store_name, bpp_id, bpp_uri, lines, items_total_paise, delivery_paise, total_paise)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [quoteId, s.store.storeId, s.store.storeName, s.store.bppId, s.store.bppUri, JSON.stringify(s.quote.lines satisfies QuoteLine[]),
          s.quote.itemsTotalPaise, s.quote.deliveryPaise, s.quote.totalPaise],
      );
    }
    await c.query("UPDATE bap.basket SET status = 'QUOTED', updated_at = now() WHERE id = $1", [basket.id]);
    await auditState(c, "bap", "basket.QUOTED", {
      entityId: basket.id, transactionId: basket.transaction_id, payload: { quoteId, quoteHash, grandTotalPaise },
    });
  });

  const view = await basketView(pool, basket.id);
  return { basket: view, quote: view.quote, errors: [] };
}
