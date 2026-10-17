import { randomBytes } from "node:crypto";
import type pg from "pg";
import { newId, type ApproveResponse, type PayResponse } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { auditState } from "../beckn/audit.js";
import { refreshExpiry } from "./basket.js";
import { dispatchAttempt } from "./dispatch.js";
import { getLatestQuoteRow, loadQuoteStores } from "./quote-view.js";
import { ApiError, isUniqueViolation, sleep, withTx } from "./util.js";

export const APPROVAL_TTL_MS = 5 * 60 * 1000;
/** Simulated payment duration (PRD CHK-05: ~1 s). Env override is for tests. */
const settleMs = () => Number(process.env.PAYMENT_SETTLE_MS ?? 1000);

interface BasketLock {
  id: string;
  customer_id: string;
  status: string;
  transaction_id: string;
}

async function lockBasket(c: pg.PoolClient, basketId: string, customerId: string): Promise<BasketLock> {
  const { rows } = await c.query<BasketLock>(
    "SELECT id, customer_id, status, transaction_id FROM bap.basket WHERE id = $1 AND customer_id = $2 FOR UPDATE",
    [basketId, customerId],
  );
  if (!rows[0]) throw new ApiError(404, "basket_not_found");
  return rows[0];
}

/** POST /bap/baskets/:id/approve: binds a single-use token (5 min) to the current quote_hash. UI button only. */
export async function approveBasket(ctx: AppContext, customerId: string, basketId: string, quoteHash: string): Promise<ApproveResponse> {
  const { pool } = ctx;
  await refreshExpiry(pool, basketId);
  return withTx(pool, async (c) => {
    const b = await lockBasket(c, basketId, customerId);
    if (b.status === "EXPIRED") throw new ApiError(409, "quote_expired", "The quote has expired; get a fresh one.");
    if (!["QUOTED", "APPROVED", "PAYMENT_FAILED"].includes(b.status)) {
      throw new ApiError(409, b.status === "DRAFT" ? "not_quoted" : "invalid_state", `Basket is ${b.status}.`);
    }
    const q = await getLatestQuoteRow(c, basketId);
    if (!q) throw new ApiError(409, "not_quoted");
    if (q.valid_until.getTime() <= Date.now()) throw new ApiError(409, "quote_expired", "The quote has expired; get a fresh one.");
    if (q.quote_hash !== quoteHash) throw new ApiError(409, "quote_changed", "The quote changed since you saw it; review the new total.");

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
    await c.query(
      "INSERT INTO bap.approval (id, basket_id, quote_id, quote_hash, token, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [newId("apv"), basketId, q.id, q.quote_hash, token, expiresAt],
    );
    await c.query("UPDATE bap.basket SET status = 'APPROVED', updated_at = now() WHERE id = $1", [basketId]);
    await auditState(c, "bap", "basket.APPROVED", { entityId: basketId, transactionId: b.transaction_id, payload: { quoteId: q.id, quoteHash, grandTotalPaise: q.grand_total_paise } });
    return { approvalToken: token, expiresAt: expiresAt.toISOString() };
  });
}

interface PaymentRow {
  id: string;
  basket_id: string;
  status: "INITIATED" | "PAID" | "FAILED";
}

async function paymentByKey(db: pg.Pool | pg.PoolClient, key: string): Promise<PaymentRow | undefined> {
  const { rows } = await db.query<PaymentRow>("SELECT id, basket_id, status FROM bap.payment WHERE idempotency_key = $1", [key]);
  return rows[0];
}

/**
 * POST /bap/baskets/:id/pay: needs a valid, unused approval token and an Idempotency-Key. The same key always maps
 * to the same payment. The ~1 s "bank" delay runs inside this request (CPU is only guaranteed while a request is
 * in flight on Cloud Run); a ticker job settles any payment whose request died.
 */
export async function payBasket(
  ctx: AppContext,
  customerId: string,
  basketId: string,
  body: { approvalToken: string; simulateFailure?: boolean },
  idempotencyKey: string,
): Promise<PayResponse> {
  const { pool } = ctx;
  const replay = async (p: PaymentRow): Promise<PayResponse> => {
    if (p.basket_id !== basketId) throw new ApiError(409, "idempotency_key_reuse", "This Idempotency-Key was used for another basket.");
    const own = await pool.query("SELECT 1 FROM bap.basket WHERE id = $1 AND customer_id = $2", [basketId, customerId]);
    if (!own.rowCount) throw new ApiError(404, "basket_not_found");
    return { paymentId: p.id, status: p.status };
  };

  const prior = await paymentByKey(pool, idempotencyKey);
  if (prior) return replay(prior);

  let created: { paymentId: string } | { replay: PaymentRow };
  try {
    created = await withTx(pool, async (c) => {
      const b = await lockBasket(c, basketId, customerId);
      const again = await paymentByKey(c, idempotencyKey); // a concurrent request with the same key may have won the lock
      if (again) return { replay: again };

      const { rows } = await c.query<{ id: string; quote_id: string; quote_hash: string; expires_at: Date; used_at: Date | null }>(
        "SELECT id, quote_id, quote_hash, expires_at, used_at FROM bap.approval WHERE token = $1 AND basket_id = $2 FOR UPDATE",
        [body.approvalToken, basketId],
      );
      const apv = rows[0];
      if (!apv || apv.used_at || apv.expires_at.getTime() <= Date.now()) {
        throw new ApiError(403, "approval_required", "Payment needs a valid, unused approval from the customer.");
      }
      if (["PAYMENT_INITIATED", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "SETTLED"].includes(b.status)) {
        throw new ApiError(409, "invalid_state", `Basket is ${b.status}.`);
      }
      if (b.status !== "APPROVED") throw new ApiError(403, "approval_required", "The basket changed after approval; approve again.");

      const q = await getLatestQuoteRow(c, basketId);
      if (!q || q.quote_hash !== apv.quote_hash) throw new ApiError(409, "quote_changed", "The quote changed after approval.");
      if (q.valid_until.getTime() <= Date.now()) throw new ApiError(409, "quote_expired", "The quote has expired; get a fresh one.");

      await c.query("UPDATE bap.approval SET used_at = now() WHERE id = $1", [apv.id]);
      const paymentId = newId("pay");
      await c.query(
        "INSERT INTO bap.payment (id, basket_id, idempotency_key, amount_paise, status, simulate_failure) VALUES ($1, $2, $3, $4, 'INITIATED', $5)",
        [paymentId, basketId, idempotencyKey, q.grand_total_paise, body.simulateFailure === true],
      );
      await c.query("UPDATE bap.basket SET status = 'PAYMENT_INITIATED', updated_at = now() WHERE id = $1", [basketId]);
      await auditState(c, "bap", "payment.INITIATED", { entityId: paymentId, transactionId: b.transaction_id, payload: { basketId, amountPaise: q.grand_total_paise } });
      return { paymentId };
    });
  } catch (err) {
    if (isUniqueViolation(err, "payment_idempotency_key_unique")) {
      const p = await paymentByKey(pool, idempotencyKey);
      if (p) return replay(p);
    }
    if (isUniqueViolation(err, "payment_one_live_per_basket")) throw new ApiError(409, "payment_in_progress");
    throw err;
  }
  if ("replay" in created) return replay(created.replay);

  await sleep(settleMs());
  const status = await settlePayment(ctx, created.paymentId);
  return { paymentId: created.paymentId, status };
}

/**
 * INITIATED -> PAID | FAILED, once (the loser of a race sees the final status). Failure comes from the payment's
 * simulate flag or bap.config.fail_next_payment (cleared when it is what caused the failure).
 * On PAID the sub-orders and their first attempts are created in the same transaction; the `confirm` calls
 * are sent after commit.
 */
export async function settlePayment(ctx: AppContext, paymentId: string): Promise<"PAID" | "FAILED" | "INITIATED"> {
  const { pool } = ctx;
  const outcome = await withTx(pool, async (c) => {
    const { rows } = await c.query<PaymentRow & { simulate_failure: boolean; amount_paise: number }>(
      "SELECT id, basket_id, status, simulate_failure, amount_paise FROM bap.payment WHERE id = $1 FOR UPDATE",
      [paymentId],
    );
    const p = rows[0];
    if (!p) throw new ApiError(404, "payment_not_found");
    if (p.status !== "INITIATED") return { status: p.status, attemptIds: [] as string[] };
    const { rows: br } = await c.query<{ transaction_id: string }>("SELECT transaction_id FROM bap.basket WHERE id = $1 FOR UPDATE", [p.basket_id]);
    const txn = br[0]!.transaction_id;

    let fail = p.simulate_failure;
    if (!fail) {
      const cleared = await c.query("UPDATE bap.config SET fail_next_payment = false WHERE id = 1 AND fail_next_payment RETURNING id");
      fail = (cleared.rowCount ?? 0) > 0;
    }
    if (fail) {
      await c.query("UPDATE bap.payment SET status = 'FAILED', completed_at = now() WHERE id = $1", [paymentId]);
      await c.query("UPDATE bap.basket SET status = 'PAYMENT_FAILED', updated_at = now() WHERE id = $1", [p.basket_id]);
      await auditState(c, "bap", "payment.FAILED", { entityId: paymentId, transactionId: txn, payload: { basketId: p.basket_id } });
      return { status: "FAILED" as const, attemptIds: [] as string[] };
    }

    await c.query("UPDATE bap.payment SET status = 'PAID', completed_at = now() WHERE id = $1", [paymentId]);
    await c.query("UPDATE bap.basket SET status = 'PAID', updated_at = now() WHERE id = $1", [p.basket_id]);
    await auditState(c, "bap", "payment.PAID", { entityId: paymentId, transactionId: txn, payload: { basketId: p.basket_id, amountPaise: p.amount_paise } });

    const q = await getLatestQuoteRow(c, p.basket_id);
    if (!q) throw new Error(`paid basket ${p.basket_id} has no quote`);
    const attemptIds: string[] = [];
    for (const s of await loadQuoteStores(c, q.id)) {
      const subId = newId("sub");
      const attId = newId("att");
      await c.query(
        `INSERT INTO bap.sub_order (id, basket_id, approved_store_id, current_store_id, status, locked_lines, approved_items_paise,
           approved_delivery_paise, approved_amount_paise, attempt_count)
         VALUES ($1, $2, $3, $3, 'DISPATCHING', $4, $5, $6, $7, 1)`,
        [subId, p.basket_id, s.store_id, JSON.stringify(s.lines), s.items_total_paise, s.delivery_paise, s.total_paise],
      );
      await c.query(
        `INSERT INTO bap.attempt (id, sub_order_id, store_id, store_name, bpp_id, bpp_uri, attempt_no, status, quoted_items_paise,
           quoted_delivery_paise, quoted_total_paise, lines)
         VALUES ($1, $2, $3, $4, $5, $6, 1, 'PENDING', $7, $8, $9, $10)`,
        [attId, subId, s.store_id, s.store_name, s.bpp_id, s.bpp_uri, s.items_total_paise, s.delivery_paise, s.total_paise, JSON.stringify(s.lines)],
      );
      await auditState(c, "bap", "sub_order.DISPATCHING", { entityId: subId, storeId: s.store_id, transactionId: txn, payload: { attemptId: attId } });
      attemptIds.push(attId);
    }
    return { status: "PAID" as const, attemptIds };
  });

  // CHK-06: confirm only after PAID. No transaction is open while we call the BPPs.
  await Promise.all(
    outcome.attemptIds.map((id) =>
      dispatchAttempt(ctx, id).catch((err) => auditState(pool, "bap", "dispatch.error", { entityId: id, payload: { error: String(err) } })),
    ),
  );
  return outcome.status;
}

/** Ticker job: settle payments whose request died mid-wait (they stay INITIATED forever otherwise). */
export async function settleStalePayments(ctx: AppContext): Promise<void> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM bap.payment WHERE status = 'INITIATED' AND created_at < now() - ($1 || ' milliseconds')::interval ORDER BY created_at LIMIT 20`,
    [String(settleMs() + 2000)],
  );
  for (const r of rows) await settlePayment(ctx, r.id);
}
