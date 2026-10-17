import type pg from "pg";
import { KTAG, makeContext, tag, type Order, type OrderState } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { auditState } from "../beckn/audit.js";
import { BecknSendError, becknSend } from "../beckn/send.js";
import { bppIdentity } from "./identity.js";
import { toBecknQuote, type QuotedItem } from "./quote.js";

export type AttemptStatus = "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
export type FulfilmentStatus = "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED";

export interface AttemptRow {
  id: string;
  transaction_id: string;
  bap_id: string;
  bap_uri: string;
  store_id: string;
  status: AttemptStatus;
  fulfilment_status: FulfilmentStatus | null;
  items_total_paise: number;
  delivery_paise: number;
  total_paise: number;
  buyer_name: string;
  buyer_phone: string;
  buyer_address: string;
  buyer_lat: number;
  buyer_lng: number;
  distance_m: number;
  offered_at: Date;
  expires_at: Date;
  decided_at: Date | null;
  reject_reason: string | null;
}

export interface AttemptItemRow {
  listing_id: string;
  canonical_product_id: string;
  name: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
}

export const ATTEMPT_COLS =
  "id, transaction_id, bap_id, bap_uri, store_id, status, fulfilment_status, items_total_paise, delivery_paise, total_paise, buyer_name, buyer_phone, buyer_address, buyer_lat, buyer_lng, distance_m, offered_at, expires_at, decided_at, reject_reason";

export async function loadItems(db: pg.Pool | pg.PoolClient, attemptId: string): Promise<AttemptItemRow[]> {
  const { rows } = await db.query<AttemptItemRow>(
    `SELECT listing_id, canonical_product_id, name, qty, unit_price_paise, line_total_paise
       FROM bpp.attempt_order_item WHERE attempt_order_id = $1 ORDER BY id`,
    [attemptId],
  );
  return rows;
}

export async function loadAttempt(db: pg.Pool | pg.PoolClient, id: string): Promise<AttemptRow | null> {
  const { rows } = await db.query<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM bpp.attempt_order WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Fulfilment steps a merchant advances through after accepting (PRD §7.2). */
export const NEXT_FULFILMENT: Record<string, FulfilmentStatus> = {
  ACCEPTED: "PREPARING",
  PREPARING: "READY",
  READY: "OUT_FOR_DELIVERY",
  OUT_FOR_DELIVERY: "DELIVERED",
};

const FULFILMENT_CODE: Record<FulfilmentStatus, string> = {
  PREPARING: "Pending",
  READY: "Packed",
  OUT_FOR_DELIVERY: "Out-for-delivery",
  DELIVERED: "Order-delivered",
};

/** PRD §7.3 Beckn mapping. */
export function becknStateOf(a: Pick<AttemptRow, "status" | "fulfilment_status">): { state: OrderState; code?: string } {
  switch (a.status) {
    case "OFFERED": return { state: "Created" };
    case "REJECTED":
    case "EXPIRED": return { state: "Cancelled" };
    case "ACCEPTED":
      if (!a.fulfilment_status) return { state: "Accepted", code: "Pending" };
      return { state: a.fulfilment_status === "DELIVERED" ? "Completed" : "In-progress", code: FULFILMENT_CODE[a.fulfilment_status] };
  }
}

const CANCEL_REASONS = {
  REJECTED: { id: "MERCHANT_REJECTED", fallback: "Store declined the order" },
  EXPIRED: { id: "OFFER_EXPIRED", fallback: "Store did not respond in time" },
} as const;

/** The order object the BPP reports for an attempt (confirm, status and unsolicited callbacks). */
export function orderOf(a: AttemptRow, items: AttemptItemRow[]): Order {
  const { state, code } = becknStateOf(a);
  const quoted: QuotedItem[] = items.map((i) => ({
    listingId: i.listing_id,
    canonicalProductId: i.canonical_product_id,
    name: i.name,
    qty: i.qty,
    unitPricePaise: i.unit_price_paise,
    lineTotalPaise: i.line_total_paise,
  }));
  const reason = a.status === "REJECTED" || a.status === "EXPIRED" ? CANCEL_REASONS[a.status] : null;
  return {
    id: a.id,
    state,
    provider: { id: a.store_id, locations: [{ id: `${a.store_id}_loc` }] },
    items: items.map((i) => ({ id: i.listing_id, quantity: { count: i.qty } })),
    fulfillments: [{ id: "f1", type: "Delivery", ...(code ? { state: { descriptor: { code } } } : {}) }],
    quote: toBecknQuote({ items: quoted, deliveryPaise: a.delivery_paise, totalPaise: a.total_paise }),
    ...(reason
      ? {
          cancellation: {
            cancelled_by: "kiranaai-bpp",
            reason: {
              id: reason.id,
              descriptor: { name: a.status === "REJECTED" && a.reject_reason ? a.reject_reason : reason.fallback },
            },
          },
        }
      : {}),
    ...(a.status === "OFFERED" ? { tags: [tag(KTAG.group, { expires_at: a.expires_at.toISOString() })] } : {}),
    created_at: a.offered_at.toISOString(),
    updated_at: (a.decided_at ?? a.offered_at).toISOString(),
  };
}

const RETRY_DELAYS_MS = [200, 600, 1500];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Unsolicited BPP → BAP callback for an attempt snapshot (the row as the transition left it):
 * on_cancel for REJECTED/EXPIRED, on_status otherwise. New message_id, the attempt's transaction_id;
 * retried 3× with backoff on network/HTTP failure, re-using the same message_id so the BAP
 * dedupes. A NACK is final. Never call this inside a transaction.
 */
export async function notifyBap(ctx: AppContext, a: AttemptRow): Promise<boolean> {
  const items = await loadItems(ctx.pool, a.id);
  const action = a.status === "REJECTED" || a.status === "EXPIRED" ? "on_cancel" : "on_status";
  const context = {
    ...makeContext({
      action,
      transactionId: a.transaction_id,
      bapId: a.bap_id,
      bapUri: a.bap_uri,
      ...bppIdentity(ctx.config.selfBaseUrl),
    }),
  };
  const message = { order: orderOf(a, items) };
  for (let attempt = 0; ; attempt++) {
    try {
      await becknSend(ctx, { url: a.bap_uri, action, context, message, actor: "bpp", storeId: a.store_id });
      return true;
    } catch (err) {
      const final = (err instanceof BecknSendError && err.error) || attempt >= RETRY_DELAYS_MS.length;
      if (final) {
        await auditState(ctx.pool, "bpp", "callback.failed", {
          transactionId: a.transaction_id, entityId: a.id, storeId: a.store_id, payload: { action, error: String(err) },
        });
        return false;
      }
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
}

/** Audits a state transition. */
const auditTransition = (ctx: AppContext, a: AttemptRow, action: string, payload?: unknown) =>
  auditState(ctx.pool, "bpp", action, { transactionId: a.transaction_id, entityId: a.id, storeId: a.store_id, payload });

// --- transitions: each is one atomic statement; callers notify the BAP afterwards ---

export class StockError extends Error {
  constructor(readonly listingId: string) {
    super(`insufficient stock for ${listingId}`);
  }
}

/**
 * Atomic claim (PRD §8.5): exactly one concurrent caller gets the row. Stock is decremented in
 * the same transaction; if any item can't be covered the whole accept rolls back (StockError).
 * Returns null when the offer is no longer available.
 */
export async function acceptOffer(ctx: AppContext, storeId: string, id: string): Promise<AttemptRow | null> {
  const client = await ctx.pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<AttemptRow>(
      `UPDATE bpp.attempt_order SET status = 'ACCEPTED', decided_at = now(), updated_at = now()
        WHERE id = $1 AND store_id = $2 AND status = 'OFFERED' AND expires_at > now()
        RETURNING ${ATTEMPT_COLS}`,
      [id, storeId],
    );
    const a = rows[0];
    if (!a) {
      await client.query("ROLLBACK");
      return null;
    }
    for (const it of await loadItems(client, id)) {
      const r = await client.query(
        "UPDATE bpp.listing SET stock_qty = stock_qty - $2, updated_at = now() WHERE id = $1 AND stock_qty >= $2",
        [it.listing_id, it.qty],
      );
      if (r.rowCount === 0) throw new StockError(it.listing_id);
    }
    await client.query("COMMIT");
    await auditTransition(ctx, a, "attempt.ACCEPTED");
    return a;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectOffer(ctx: AppContext, storeId: string, id: string, reason: string): Promise<AttemptRow | null> {
  const { rows } = await ctx.pool.query<AttemptRow>(
    `UPDATE bpp.attempt_order SET status = 'REJECTED', reject_reason = $3, decided_at = now(), updated_at = now()
      WHERE id = $1 AND store_id = $2 AND status = 'OFFERED' AND expires_at > now()
      RETURNING ${ATTEMPT_COLS}`,
    [id, storeId, reason],
  );
  if (rows[0]) await auditTransition(ctx, rows[0], "attempt.REJECTED", { reason });
  return rows[0] ?? null;
}

/** PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED. Null: not found or not an accepted order; "invalid": wrong next step. */
export async function advanceOrder(ctx: AppContext, storeId: string, id: string): Promise<AttemptRow | null | "invalid"> {
  const { rows: cur } = await ctx.pool.query<Pick<AttemptRow, "status" | "fulfilment_status">>(
    "SELECT status, fulfilment_status FROM bpp.attempt_order WHERE id = $1 AND store_id = $2",
    [id, storeId],
  );
  if (!cur[0]) return null;
  const from = cur[0].status === "ACCEPTED" ? (cur[0].fulfilment_status ?? "ACCEPTED") : null;
  const next = from ? NEXT_FULFILMENT[from] : undefined;
  if (!next) return "invalid";
  const { rows } = await ctx.pool.query<AttemptRow>(
    `UPDATE bpp.attempt_order SET fulfilment_status = $3, updated_at = now()
      WHERE id = $1 AND store_id = $2 AND status = 'ACCEPTED' AND fulfilment_status IS NOT DISTINCT FROM $4
      RETURNING ${ATTEMPT_COLS}`,
    [id, storeId, next, from === "ACCEPTED" ? null : from],
  );
  if (!rows[0]) return "invalid"; // lost a race with another advance
  await auditTransition(ctx, rows[0], `attempt.${next}`);
  return rows[0];
}

/** Marks overdue offers EXPIRED (once each, thanks to RETURNING) and tells each BAP. */
export async function sweepExpired(ctx: AppContext): Promise<number> {
  const { rows } = await ctx.pool.query<AttemptRow>(
    `UPDATE bpp.attempt_order SET status = 'EXPIRED', decided_at = now(), updated_at = now()
      WHERE status = 'OFFERED' AND expires_at <= now()
      RETURNING ${ATTEMPT_COLS}`,
  );
  await Promise.all(rows.map((a) => auditTransition(ctx, a, "attempt.EXPIRED")));
  await Promise.allSettled(rows.map((a) => notifyBap(ctx, a)));
  return rows.length;
}

/** Failure injection: stores with `auto_reject` decline offers `afterMs` (~3 s) after they were made. */
export async function autoReject(ctx: AppContext, afterMs = 3000): Promise<number> {
  const { rows } = await ctx.pool.query<AttemptRow>(
    `UPDATE bpp.attempt_order a SET status = 'REJECTED', reject_reason = 'Store is unavailable (auto-reject)', decided_at = now(), updated_at = now()
       FROM bpp.fault f
      WHERE f.store_id = a.store_id AND f.auto_reject AND a.status = 'OFFERED' AND a.expires_at > now()
        AND a.offered_at <= now() - make_interval(secs => $1::float / 1000)
      RETURNING ${ATTEMPT_COLS.split(", ").map((c) => `a.${c}`).join(", ")}`,
    [afterMs],
  );
  await Promise.all(rows.map((a) => auditTransition(ctx, a, "attempt.REJECTED", { reason: "auto_reject" })));
  await Promise.allSettled(rows.map((a) => notifyBap(ctx, a)));
  return rows.length;
}
