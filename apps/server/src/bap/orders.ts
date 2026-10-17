import type pg from "pg";
import type { AttemptView, BasketStatus, OrderView, PaymentStatus, SubOrderStatus, SubOrderView } from "@kiranaai/shared";
import { refreshExpiry } from "./basket.js";
import { ATTEMPT_COLS, MAX_ATTEMPTS, type AttemptRow } from "./dispatch.js";
import { getLatestQuoteRow } from "./quote-view.js";
import type { QuoteLine } from "../db/schema/bap.js";
import { ApiError } from "./util.js";

interface BasketOrderRow {
  id: string;
  status: BasketStatus;
  transaction_id: string;
  created_at: Date;
}

const PAID_STATUSES: BasketStatus[] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "SETTLED"];

async function buildOrderView(pool: pg.Pool, b: BasketOrderRow): Promise<OrderView> {
  const [pay, subs, attempts, refunds] = await Promise.all([
    pool.query<{ status: "INITIATED" | "PAID" | "FAILED"; amount_paise: number }>(
      "SELECT status, amount_paise FROM bap.payment WHERE basket_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [b.id],
    ),
    pool.query<{
      id: string; status: SubOrderStatus; approved_store_id: string; current_store_id: string | null; locked_lines: QuoteLine[];
      approved_amount_paise: number; attempt_count: number;
    }>(
      `SELECT id, status, approved_store_id, current_store_id, locked_lines, approved_amount_paise, attempt_count
       FROM bap.sub_order WHERE basket_id = $1 ORDER BY approved_store_id`,
      [b.id],
    ),
    pool.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLS} FROM bap.attempt WHERE sub_order_id IN (SELECT id FROM bap.sub_order WHERE basket_id = $1) ORDER BY sub_order_id, attempt_no`,
      [b.id],
    ),
    pool.query<{ sub_order_id: string; amount_paise: number }>("SELECT sub_order_id, amount_paise FROM bap.refund WHERE basket_id = $1", [b.id]),
  ]);

  const paymentStatus: PaymentStatus = pay.rows[0]?.status ?? "NONE";
  let grandTotalPaise = pay.rows[0]?.amount_paise;
  if (grandTotalPaise === undefined) grandTotalPaise = (await getLatestQuoteRow(pool, b.id))?.grand_total_paise ?? 0;
  const refundBy = new Map(refunds.rows.map((r) => [r.sub_order_id, r.amount_paise]));

  const subOrders = subs.rows.map((s): SubOrderView => {
    const mine = attempts.rows.filter((a) => a.sub_order_id === s.id);
    const open = mine.find((a) => a.status === "PENDING" || a.status === "OFFERED" || a.status === "ACCEPTED");
    const views = mine.map(
      (a): AttemptView => ({
        id: a.id,
        attemptNo: a.attempt_no,
        storeId: a.store_id,
        storeName: a.store_name,
        status: a.status,
        expiresAt: a.status === "OFFERED" && a.expires_at ? a.expires_at.toISOString() : null,
        rejectReason: a.reject_reason,
        quotedTotalPaise: a.quoted_total_paise,
        createdAt: a.created_at.toISOString(),
        decidedAt: a.decided_at ? a.decided_at.toISOString() : null,
      }),
    );
    return {
      id: s.id,
      status: s.status,
      approvedStoreId: s.approved_store_id,
      approvedStoreName: mine[0]?.store_name ?? s.approved_store_id,
      currentStoreName: open?.store_name ?? null,
      lines: s.locked_lines,
      approvedAmountPaise: s.approved_amount_paise,
      attemptCount: s.attempt_count,
      maxAttempts: MAX_ATTEMPTS,
      attempts: views,
      refundPaise: refundBy.get(s.id) ?? null,
    };
  });

  return {
    basketId: b.id,
    transactionId: b.transaction_id,
    basketStatus: b.status,
    paymentStatus,
    grandTotalPaise,
    refundedPaise: refunds.rows.reduce((a, r) => a + r.amount_paise, 0),
    settled: b.status === "SETTLED",
    subOrders,
    createdAt: b.created_at.toISOString(),
  };
}

/** GET /bap/baskets/:id. Payment status and fulfilment status are separate fields (ORD-03). */
export async function getOrderView(pool: pg.Pool, customerId: string, basketId: string): Promise<OrderView> {
  await refreshExpiry(pool, basketId);
  const { rows } = await pool.query<BasketOrderRow>(
    "SELECT id, status, transaction_id, created_at FROM bap.basket WHERE id = $1 AND customer_id = $2",
    [basketId, customerId],
  );
  if (!rows[0]) throw new ApiError(404, "basket_not_found");
  return buildOrderView(pool, rows[0]);
}

/** GET /bap/orders: the customer's paid baskets, newest first. */
export async function listOrderViews(pool: pg.Pool, customerId: string): Promise<OrderView[]> {
  const { rows } = await pool.query<BasketOrderRow>(
    "SELECT id, status, transaction_id, created_at FROM bap.basket WHERE customer_id = $1 AND status = ANY($2) ORDER BY created_at DESC, id DESC LIMIT 50",
    [customerId, PAID_STATUSES],
  );
  return Promise.all(rows.map((r) => buildOrderView(pool, r)));
}
