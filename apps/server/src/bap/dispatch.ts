import type pg from "pg";
import type { AppContext } from "../app.js";
import { auditState } from "../beckn/audit.js";
import { BecknTimeoutError } from "../beckn/waiters.js";
import { becknCall } from "./beckn-client.js";
import type { AttemptStatus, QuoteLine } from "../db/schema/bap.js";
import { confirmMessage } from "./store-quote.js";
import { loadBapConfig, loadCustomer } from "./util.js";

export const MAX_ATTEMPTS = 3;

export interface AttemptRow {
  id: string;
  sub_order_id: string;
  store_id: string;
  store_name: string;
  bpp_id: string;
  bpp_uri: string;
  attempt_no: number;
  status: AttemptStatus;
  quoted_items_paise: number;
  quoted_delivery_paise: number;
  quoted_total_paise: number;
  lines: QuoteLine[];
  expires_at: Date | null;
  reject_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export const ATTEMPT_COLS =
  "id, sub_order_id, store_id, store_name, bpp_id, bpp_uri, attempt_no, status, quoted_items_paise, quoted_delivery_paise, quoted_total_paise, lines, expires_at, reject_reason, created_at, decided_at";

/** An attempt is "open" while it can still lead to an accepted order. */
export const OPEN_ATTEMPT = ["PENDING", "OFFERED", "ACCEPTED"] as const;

export async function loadAttempt(db: pg.Pool | pg.PoolClient, attemptId: string): Promise<AttemptRow | null> {
  const { rows } = await db.query<AttemptRow>(`SELECT ${ATTEMPT_COLS} FROM bap.attempt WHERE id = $1`, [attemptId]);
  return rows[0] ?? null;
}

/**
 * Marks an open (PENDING/OFFERED) attempt REJECTED or EXPIRED, excludes its store for the sub-order, and
 * returns the sub-order id; null when it was not open (idempotent: repeats and stale callbacks are no-ops).
 */
export async function closeAttempt(
  ctx: AppContext,
  attemptId: string,
  status: "REJECTED" | "EXPIRED",
  reason: string,
): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ sub_order_id: string; store_id: string }>(
    `UPDATE bap.attempt SET status = $2, reject_reason = $3, decided_at = now()
     WHERE id = $1 AND status IN ('PENDING', 'OFFERED') RETURNING sub_order_id, store_id`,
    [attemptId, status, reason],
  );
  const r = rows[0];
  if (!r) return null;
  const { rows: so } = await ctx.pool.query<{ basket_id: string; transaction_id: string }>(
    `UPDATE bap.sub_order s SET excluded_store_ids = CASE WHEN $2 = ANY(excluded_store_ids) THEN excluded_store_ids ELSE array_append(excluded_store_ids, $2) END,
            updated_at = now()
     FROM bap.basket b WHERE s.id = $1 AND b.id = s.basket_id RETURNING s.basket_id, b.transaction_id`,
    [r.sub_order_id, r.store_id],
  );
  await auditState(ctx.pool, "bap", `attempt.${status}`, {
    entityId: attemptId, storeId: r.store_id, transactionId: so[0]?.transaction_id, payload: { subOrderId: r.sub_order_id, reason },
  });
  return r.sub_order_id;
}

/**
 * Sends `confirm` for a PENDING attempt (idempotent on order.id at the BPP). The BPP's on_confirm moves the
 * attempt to OFFERED via the callback handler. Returns "failed" when the attempt ended REJECTED here
 * (NACK, network failure, or an on_confirm error) so the caller can start the next attempt;
 * a timeout leaves it PENDING for the reconciler to resend.
 */
export async function confirmAttempt(ctx: AppContext, attemptId: string): Promise<"sent" | "failed"> {
  const { pool } = ctx;
  const { rows } = await pool.query<{ customer_id: string; transaction_id: string }>(
    `SELECT b.customer_id, b.transaction_id FROM bap.attempt a JOIN bap.sub_order s ON s.id = a.sub_order_id
     JOIN bap.basket b ON b.id = s.basket_id WHERE a.id = $1`,
    [attemptId],
  );
  const attempt = await loadAttempt(pool, attemptId);
  if (!rows[0] || !attempt || attempt.status !== "PENDING") return "sent";
  const customer = await loadCustomer(pool, rows[0].customer_id);
  const config = await loadBapConfig(pool);
  try {
    const env = await becknCall(ctx, {
      action: "confirm",
      bppId: attempt.bpp_id,
      bppUri: attempt.bpp_uri,
      transactionId: rows[0].transaction_id,
      storeId: attempt.store_id,
      message: confirmMessage({
        attemptId,
        store: { storeId: attempt.store_id, storeName: attempt.store_name, bppId: attempt.bpp_id, bppUri: attempt.bpp_uri },
        lines: attempt.lines,
        deliveryPaise: attempt.quoted_delivery_paise,
        totalPaise: attempt.quoted_total_paise,
        customer,
        offerWindowSeconds: config.offerWindowSeconds,
      }),
    });
    if (env.error) {
      await closeAttempt(ctx, attemptId, "REJECTED", env.error.message ?? `error ${env.error.code}`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    if (err instanceof BecknTimeoutError) return "sent";
    await closeAttempt(ctx, attemptId, "REJECTED", `confirm failed: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}

/** Confirm an attempt; if it fails outright, move the sub-order on (T08 extends this with the next attempt). */
export async function dispatchAttempt(ctx: AppContext, attemptId: string): Promise<void> {
  await confirmAttempt(ctx, attemptId);
}
