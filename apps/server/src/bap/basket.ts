import type pg from "pg";
import { newId, type BasketItemView, type BasketStatus, type BasketStoreGroup, type BasketView, type QuoteView } from "@kiranaai/shared";
import { auditState } from "../beckn/audit.js";
import { getSeenOffers } from "./offers.js";
import { getLatestQuoteView } from "./quote-view.js";
import { ApiError, withTx } from "./util.js";

/** Statuses of a basket that is still being assembled / paid (not yet an order). */
export const OPEN_STATUSES: BasketStatus[] = ["DRAFT", "QUOTED", "EXPIRED", "APPROVED", "PAYMENT_INITIATED", "PAYMENT_FAILED"];
/** Editing these moves the basket back to DRAFT (approval, if any, is invalidated by the status change). */
const EDIT_TO_DRAFT: BasketStatus[] = ["QUOTED", "EXPIRED", "APPROVED", "PAYMENT_FAILED"];

export interface BasketRow {
  id: string;
  customer_id: string;
  status: BasketStatus;
  transaction_id: string;
  updated_at: Date;
}

export interface BasketItemRow {
  listing_id: string;
  store_id: string;
  store_name: string;
  bpp_id: string;
  bpp_uri: string;
  canonical_product_id: string;
  name: string;
  qty: number;
  seen_price_paise: number;
}

/** The customer's open basket, created as DRAFT if none. */
export async function getOpenBasket(pool: pg.Pool, customerId: string): Promise<BasketRow> {
  const find = async (db: pg.Pool | pg.PoolClient) =>
    (
      await db.query<BasketRow>(
        `SELECT id, customer_id, status, transaction_id, updated_at FROM bap.basket
         WHERE customer_id = $1 AND status = ANY($2) ORDER BY created_at DESC, id DESC LIMIT 1`,
        [customerId, OPEN_STATUSES],
      )
    ).rows[0];
  const existing = await find(pool);
  if (existing) return existing;
  return withTx(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`basket:${customerId}`]);
    const again = await find(c);
    if (again) return again;
    const id = newId("bsk");
    const { rows } = await c.query<BasketRow>(
      `INSERT INTO bap.basket (id, customer_id, status, transaction_id) VALUES ($1, $2, 'DRAFT', $3)
       RETURNING id, customer_id, status, transaction_id, updated_at`,
      [id, customerId, newId("txn")],
    );
    return rows[0]!;
  });
}

export async function loadBasketItems(db: pg.Pool | pg.PoolClient, basketId: string): Promise<BasketItemRow[]> {
  const { rows } = await db.query<BasketItemRow>(
    `SELECT listing_id, store_id, store_name, bpp_id, bpp_uri, canonical_product_id, name, qty, seen_price_paise
     FROM bap.basket_item WHERE basket_id = $1 ORDER BY added_at, id`,
    [basketId],
  );
  return rows;
}

/** Marks a QUOTED/APPROVED basket EXPIRED when its latest quote is past valid_until (checked on read). */
export async function refreshExpiry(pool: pg.Pool | pg.PoolClient, basketId: string): Promise<void> {
  await pool.query(
    `UPDATE bap.basket b SET status = 'EXPIRED', updated_at = now()
     WHERE b.id = $1 AND b.status IN ('QUOTED', 'APPROVED')
       AND (SELECT q.valid_until FROM bap.quote q WHERE q.basket_id = b.id ORDER BY q.created_at DESC, q.id DESC LIMIT 1) < now()`,
    [basketId],
  );
}

export async function basketView(pool: pg.Pool, basketId: string): Promise<BasketView> {
  await refreshExpiry(pool, basketId);
  const { rows } = await pool.query<BasketRow>("SELECT id, customer_id, status, transaction_id, updated_at FROM bap.basket WHERE id = $1", [basketId]);
  const b = rows[0];
  if (!b) throw new ApiError(404, "basket_not_found");
  const items = await loadBasketItems(pool, basketId);
  const groups = new Map<string, BasketStoreGroup>();
  for (const it of items) {
    let g = groups.get(it.store_id);
    if (!g) {
      g = { storeId: it.store_id, storeName: it.store_name, items: [], itemsTotalPaise: 0 };
      groups.set(it.store_id, g);
    }
    const view: BasketItemView = {
      listingId: it.listing_id,
      storeId: it.store_id,
      storeName: it.store_name,
      canonicalProductId: it.canonical_product_id,
      name: it.name,
      qty: it.qty,
      seenPricePaise: it.seen_price_paise,
      lineTotalPaise: it.seen_price_paise * it.qty,
    };
    g.items.push(view);
    g.itemsTotalPaise += view.lineTotalPaise;
  }
  // A DRAFT basket has been edited since any quote: do not show the stale one.
  const quote: QuoteView | null = b.status === "DRAFT" ? null : await getLatestQuoteView(pool, basketId);
  return {
    id: b.id,
    status: b.status,
    transactionId: b.transaction_id,
    stores: [...groups.values()],
    itemCount: items.length,
    quote,
  };
}

export type ItemEdit = { listingId: string; qty: number };

/**
 * Applies a basket edit in one short transaction. `edit` receives the locked basket and returns the final
 * item set (listing -> qty). Resolves store/price from offers the customer has seen in on_search.
 */
async function editBasket(
  pool: pg.Pool,
  customerId: string,
  compute: (current: Map<string, number>) => Map<string, number>,
): Promise<BasketView> {
  const basket = await getOpenBasket(pool, customerId);
  const id = await withTx(pool, async (c) => {
    const { rows } = await c.query<BasketRow>(
      "SELECT id, customer_id, status, transaction_id, updated_at FROM bap.basket WHERE id = $1 FOR UPDATE",
      [basket.id],
    );
    const b = rows[0]!;
    if (b.status === "PAYMENT_INITIATED") throw new ApiError(409, "payment_in_progress", "The basket is being paid; it cannot be edited now.");
    if (!OPEN_STATUSES.includes(b.status)) throw new ApiError(409, "basket_closed", "This basket is already an order.");

    const current = new Map((await loadBasketItems(c, b.id)).map((i) => [i.listing_id, i.qty]));
    const next = compute(current);
    const seen = await getSeenOffers(c, customerId, [...next.keys()]);
    const unknown = [...next.keys()].filter((l) => !seen.has(l));
    if (unknown.length) {
      throw new ApiError(404, "unknown_listing", "Search for these items first; the basket can only hold listings you have seen in a search.", { listingIds: unknown });
    }
    await c.query("DELETE FROM bap.basket_item WHERE basket_id = $1 AND NOT (listing_id = ANY($2))", [b.id, [...next.keys()]]);
    for (const [listingId, qty] of next) {
      const o = seen.get(listingId)!;
      if (current.has(listingId)) {
        await c.query(
          "UPDATE bap.basket_item SET qty = $3, seen_price_paise = $4 WHERE basket_id = $1 AND listing_id = $2",
          [b.id, listingId, qty, o.pricePaise],
        );
      } else {
        await c.query(
          `INSERT INTO bap.basket_item (basket_id, listing_id, store_id, store_name, bpp_id, bpp_uri, canonical_product_id, name, qty, seen_price_paise)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [b.id, listingId, o.storeId, o.storeName, o.bppId, o.bppUri, o.canonicalProductId, o.name, qty, o.pricePaise],
        );
      }
    }
    const status: BasketStatus = EDIT_TO_DRAFT.includes(b.status) ? "DRAFT" : b.status;
    await c.query("UPDATE bap.basket SET status = $2, updated_at = clock_timestamp() WHERE id = $1", [b.id, status]);
    if (status !== b.status) {
      await auditState(c, "bap", `basket.${status}`, { entityId: b.id, transactionId: b.transaction_id, payload: { from: b.status, reason: "edited" } });
    }
    return b.id;
  });
  return basketView(pool, id);
}

export const replaceBasket = (pool: pg.Pool, customerId: string, items: ItemEdit[]) =>
  editBasket(pool, customerId, () => new Map(items.map((i) => [i.listingId, i.qty])));

export const setBasketItem = (pool: pg.Pool, customerId: string, item: ItemEdit) =>
  editBasket(pool, customerId, (cur) => new Map(cur).set(item.listingId, item.qty));

export function patchBasketItem(pool: pg.Pool, customerId: string, item: ItemEdit): Promise<BasketView> {
  return editBasket(pool, customerId, (cur) => {
    if (!cur.has(item.listingId)) throw new ApiError(404, "item_not_in_basket");
    return new Map(cur).set(item.listingId, item.qty);
  });
}

export function removeBasketItem(pool: pg.Pool, customerId: string, listingId: string): Promise<BasketView> {
  return editBasket(pool, customerId, (cur) => {
    if (!cur.has(listingId)) throw new ApiError(404, "item_not_in_basket");
    const next = new Map(cur);
    next.delete(listingId);
    return next;
  });
}
