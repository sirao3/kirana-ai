import type pg from "pg";
import type { QuoteStoreView, QuoteView } from "@kiranaai/shared";
import type { QuoteLine } from "../db/schema/bap.js";

interface QuoteRow {
  id: string;
  basket_id: string;
  quote_hash: string;
  items_total_paise: number;
  delivery_total_paise: number;
  platform_fee_paise: number;
  grand_total_paise: number;
  valid_until: Date;
}

interface QuoteStoreRow {
  store_id: string;
  store_name: string;
  bpp_id: string;
  bpp_uri: string;
  lines: QuoteLine[];
  items_total_paise: number;
  delivery_paise: number;
  total_paise: number;
}

export const QUOTE_COLS = "id, basket_id, quote_hash, items_total_paise, delivery_total_paise, platform_fee_paise, grand_total_paise, valid_until";

export async function loadQuoteStores(db: pg.Pool | pg.PoolClient, quoteId: string): Promise<QuoteStoreRow[]> {
  const { rows } = await db.query<QuoteStoreRow>(
    `SELECT store_id, store_name, bpp_id, bpp_uri, lines, items_total_paise, delivery_paise, total_paise
     FROM bap.quote_store WHERE quote_id = $1 ORDER BY store_id`,
    [quoteId],
  );
  return rows;
}

export function toQuoteView(q: QuoteRow, stores: QuoteStoreRow[]): QuoteView {
  return {
    id: q.id,
    quoteHash: q.quote_hash,
    validUntil: q.valid_until.toISOString(),
    expired: q.valid_until.getTime() <= Date.now(),
    itemsTotalPaise: q.items_total_paise,
    deliveryTotalPaise: q.delivery_total_paise,
    platformFeePaise: q.platform_fee_paise,
    grandTotalPaise: q.grand_total_paise,
    stores: stores.map(
      (s): QuoteStoreView => ({
        storeId: s.store_id,
        storeName: s.store_name,
        lines: s.lines,
        itemsTotalPaise: s.items_total_paise,
        deliveryPaise: s.delivery_paise,
        totalPaise: s.total_paise,
      }),
    ),
  };
}

export async function getLatestQuoteRow(db: pg.Pool | pg.PoolClient, basketId: string): Promise<QuoteRow | null> {
  const { rows } = await db.query<QuoteRow>(
    `SELECT ${QUOTE_COLS} FROM bap.quote WHERE basket_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [basketId],
  );
  return rows[0] ?? null;
}

export async function getLatestQuoteView(db: pg.Pool | pg.PoolClient, basketId: string): Promise<QuoteView | null> {
  const q = await getLatestQuoteRow(db, basketId);
  return q ? toQuoteView(q, await loadQuoteStores(db, q.id)) : null;
}
