import type pg from "pg";
import { deliveryChargePaise, newId, type SubOrderStatus } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { auditState } from "../beckn/audit.js";
import { BecknTimeoutError } from "../beckn/waiters.js";
import { becknCall } from "./beckn-client.js";
import type { AttemptStatus, QuoteLine } from "../db/schema/bap.js";
import { searchOffers, type SeenOffer } from "./offers.js";
import { confirmMessage, fetchStoreQuote, type StoreQuote, type StoreRef } from "./store-quote.js";
import { isUniqueViolation, loadBapConfig, loadCustomer, withTx } from "./util.js";

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

// ---------------------------------------------------------------------------------------------
// Sub-orders, next attempt, refunds (T08)
// ---------------------------------------------------------------------------------------------

export interface SubOrderRow {
  id: string;
  basket_id: string;
  approved_store_id: string;
  current_store_id: string | null;
  status: SubOrderStatus;
  locked_lines: QuoteLine[];
  approved_items_paise: number;
  approved_delivery_paise: number;
  approved_amount_paise: number;
  attempt_count: number;
  excluded_store_ids: string[];
}

const SUB_COLS =
  "id, basket_id, approved_store_id, current_store_id, status, locked_lines, approved_items_paise, approved_delivery_paise, approved_amount_paise, attempt_count, excluded_store_ids";

async function loadSubOrder(db: pg.Pool | pg.PoolClient, id: string, lock = false): Promise<SubOrderRow | null> {
  const { rows } = await db.query<SubOrderRow>(`SELECT ${SUB_COLS} FROM bap.sub_order WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ?? null;
}

/** Fulfilment order of sub-order states; mirroring only ever moves forward. */
const RANK: Record<SubOrderStatus, number> = {
  DISPATCHING: 0, ACCEPTED: 1, PREPARING: 2, READY: 3, OUT_FOR_DELIVERY: 4, DELIVERED: 5, FAILED_NO_FULFILMENT: -1,
};

/** Reassignment search window; the customer-facing search uses 1.5 s but a reassignment must be live < 2 s. */
const reassignWindowMs = () => Number(process.env.BAP_REASSIGN_WINDOW_MS ?? 800);

interface Candidate {
  store: StoreRef;
  quote: StoreQuote;
}

/**
 * PRD §8.2-3: search with the sub-order's canonical ids, rank eligible stores (full coverage required, then
 * store total incl. delivery, then distance) and verify with select + init, falling through to the next
 * candidate on any mismatch without using up an attempt.
 */
async function findCandidate(ctx: AppContext, so: SubOrderRow, customerId: string, transactionId: string): Promise<Candidate | null> {
  const customer = await loadCustomer(ctx.pool, customerId);
  const need = new Map<string, number>();
  for (const l of so.locked_lines) need.set(l.canonicalProductId, (need.get(l.canonicalProductId) ?? 0) + l.qty);
  const { offers } = await searchOffers(ctx, customer, {
    query: "", canonicalIds: [...need.keys()], transactionId, windowMs: reassignWindowMs(),
  });
  const { rows: prior } = await ctx.pool.query<{ store_id: string }>("SELECT store_id FROM bap.attempt WHERE sub_order_id = $1", [so.id]);
  const excluded = new Set([...so.excluded_store_ids, ...prior.map((r) => r.store_id)]);

  const byStore = new Map<string, SeenOffer[]>();
  for (const o of offers) if (!excluded.has(o.storeId)) byStore.set(o.storeId, [...(byStore.get(o.storeId) ?? []), o]);

  const ranked: { cand: { store: StoreRef; lines: SeenOffer[]; qtys: number[] }; total: number; distanceM: number }[] = [];
  for (const [storeId, list] of byStore) {
    const picks: SeenOffer[] = [];
    const qtys: number[] = [];
    for (const [canonical, qty] of need) {
      const best = list.filter((o) => o.canonicalProductId === canonical && o.stockQty >= qty).sort((a, b) => a.pricePaise - b.pricePaise)[0];
      if (!best) break;
      picks.push(best);
      qtys.push(qty);
    }
    if (picks.length !== need.size) continue; // must cover every item (all-or-nothing)
    const first = picks[0]!;
    const items = picks.reduce((a, p, i) => a + p.pricePaise * qtys[i]!, 0);
    const delivery = first.deliveryRule ? deliveryChargePaise(first.deliveryRule, first.distanceM, items) : (first.deliveryChargePaise ?? 0);
    if (delivery === null) continue;
    ranked.push({
      cand: { store: { storeId, storeName: first.storeName, bppId: first.bppId, bppUri: first.bppUri }, lines: picks, qtys },
      total: items + delivery,
      distanceM: first.distanceM,
    });
  }
  ranked.sort((a, b) => a.total - b.total || a.distanceM - b.distanceM || a.cand.store.storeId.localeCompare(b.cand.store.storeId));

  for (const r of ranked) {
    const res = await fetchStoreQuote(ctx, {
      transactionId, customer, store: r.cand.store,
      lines: r.cand.lines.map((o, i) => ({
        listingId: o.listingId, canonicalProductId: o.canonicalProductId, name: o.name, qty: r.cand.qtys[i]!, seenPricePaise: o.pricePaise,
      })),
    });
    if (res.ok) return { store: r.cand.store, quote: res.quote };
    await auditState(ctx.pool, "bap", "dispatch.candidate_skipped", {
      entityId: so.id, storeId: r.cand.store.storeId, transactionId, payload: { code: res.error.code, message: res.error.message },
    });
  }
  return null;
}

/**
 * Claims the next attempt row in a short transaction (sub-order row lock + the unique (sub_order_id, attempt_no)
 * index). No HTTP happens while the lock is held (LANES rule 7). Returns null if someone else got there first.
 */
async function claimAttempt(ctx: AppContext, so: SubOrderRow, cand: Candidate): Promise<string | null> {
  try {
    return await withTx(ctx.pool, async (c) => {
      const cur = await loadSubOrder(c, so.id, true);
      if (!cur || cur.status !== "DISPATCHING" || cur.attempt_count !== so.attempt_count) return null;
      const open = await c.query("SELECT 1 FROM bap.attempt WHERE sub_order_id = $1 AND status = ANY($2)", [so.id, [...OPEN_ATTEMPT]]);
      if (open.rowCount) return null;
      const id = newId("att");
      await c.query(
        `INSERT INTO bap.attempt (id, sub_order_id, store_id, store_name, bpp_id, bpp_uri, attempt_no, status, quoted_items_paise,
           quoted_delivery_paise, quoted_total_paise, lines)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10, $11)`,
        [id, so.id, cand.store.storeId, cand.store.storeName, cand.store.bppId, cand.store.bppUri, cur.attempt_count + 1,
          cand.quote.itemsTotalPaise, cand.quote.deliveryPaise, cand.quote.totalPaise, JSON.stringify(cand.quote.lines)],
      );
      await c.query("UPDATE bap.sub_order SET attempt_count = attempt_count + 1, current_store_id = $2, updated_at = now() WHERE id = $1", [so.id, cand.store.storeId]);
      await auditState(c, "bap", "attempt.PENDING", { entityId: id, storeId: cand.store.storeId, payload: { subOrderId: so.id, attemptNo: cur.attempt_count + 1 } });
      return id;
    });
  } catch (err) {
    if (isUniqueViolation(err, "attempt_sub_no")) return null;
    throw err;
  }
}

/**
 * Moves a DISPATCHING sub-order with no open attempt on: next ranked store, or FAILED_NO_FULFILMENT + refund
 * once 3 attempts are used or nobody can cover it. Safe to call from handlers, the reconciler or both at once.
 */
export async function startNextAttempt(ctx: AppContext, subOrderId: string): Promise<void> {
  for (let i = 0; i <= MAX_ATTEMPTS; i++) {
    const so = await loadSubOrder(ctx.pool, subOrderId);
    if (!so || so.status !== "DISPATCHING") return;
    const open = await ctx.pool.query("SELECT 1 FROM bap.attempt WHERE sub_order_id = $1 AND status = ANY($2)", [subOrderId, [...OPEN_ATTEMPT]]);
    if (open.rowCount) return;
    if (so.attempt_count >= MAX_ATTEMPTS) {
      await failSubOrder(ctx, subOrderId, "attempt cap reached");
      return;
    }
    const { rows } = await ctx.pool.query<{ customer_id: string; transaction_id: string }>("SELECT customer_id, transaction_id FROM bap.basket WHERE id = $1", [so.basket_id]);
    const b = rows[0]!;
    const cand = await findCandidate(ctx, so, b.customer_id, b.transaction_id);
    if (!cand) {
      await failSubOrder(ctx, subOrderId, "no eligible store");
      return;
    }
    const attemptId = await claimAttempt(ctx, so, cand);
    if (!attemptId) return;
    if ((await confirmAttempt(ctx, attemptId)) === "sent") return;
  }
}

/** Confirm an attempt; if it fails outright, move the sub-order on. */
export async function dispatchAttempt(ctx: AppContext, attemptId: string): Promise<void> {
  if ((await confirmAttempt(ctx, attemptId)) === "failed") {
    const a = await loadAttempt(ctx.pool, attemptId);
    if (a) await startNextAttempt(ctx, a.sub_order_id);
  }
}

/** Refund for one failed sub-order: its items + delivery + its share of the platform fee (PRD §9). */
async function refundFor(c: pg.PoolClient, basketId: string, subOrderId: string): Promise<number> {
  const { rows: subs } = await c.query<{ id: string; approved_items_paise: number; approved_amount_paise: number }>(
    "SELECT id, approved_items_paise, approved_amount_paise FROM bap.sub_order WHERE basket_id = $1 ORDER BY approved_store_id",
    [basketId],
  );
  const { rows: pay } = await c.query<{ amount_paise: number }>("SELECT amount_paise FROM bap.payment WHERE basket_id = $1 AND status = 'PAID'", [basketId]);
  const fee = Math.max(0, (pay[0]?.amount_paise ?? 0) - subs.reduce((a, s) => a + s.approved_amount_paise, 0));
  const itemsTotal = subs.reduce((a, s) => a + s.approved_items_paise, 0);
  // Fee refunded in proportion to the sub-order's share of the items total; the last sub-order takes the rounding remainder.
  const shares = subs.map((s) => (itemsTotal > 0 ? Math.floor((fee * s.approved_items_paise) / itemsTotal) : 0));
  if (subs.length) shares[subs.length - 1]! += fee - shares.reduce((a, b) => a + b, 0);
  const i = subs.findIndex((s) => s.id === subOrderId);
  return subs[i]!.approved_amount_paise + shares[i]!;
}

/** Basket status from its sub-orders (PRD §7.1, §9). Call inside a transaction that already changed a sub-order. */
async function recomputeBasket(c: pg.PoolClient, basketId: string): Promise<void> {
  const { rows: b } = await c.query<{ status: string; transaction_id: string }>("SELECT status, transaction_id FROM bap.basket WHERE id = $1 FOR UPDATE", [basketId]);
  if (!b[0] || !["PAID", "PARTIALLY_REFUNDED"].includes(b[0].status)) return;
  const { rows } = await c.query<{ status: SubOrderStatus }>("SELECT status FROM bap.sub_order WHERE basket_id = $1", [basketId]);
  const failed = rows.filter((r) => r.status === "FAILED_NO_FULFILMENT").length;
  const delivered = rows.filter((r) => r.status === "DELIVERED").length;
  const next =
    rows.length > 0 && failed + delivered === rows.length ? (failed === rows.length ? "REFUNDED" : "SETTLED") : failed > 0 ? "PARTIALLY_REFUNDED" : "PAID";
  if (next !== b[0].status) {
    await c.query("UPDATE bap.basket SET status = $2, updated_at = now() WHERE id = $1", [basketId, next]);
    await auditState(c, "bap", `basket.${next}`, { entityId: basketId, transactionId: b[0].transaction_id, payload: { failed, delivered, total: rows.length } });
  }
}

/** DSP-06: no store left → FAILED_NO_FULFILMENT and refund this sub-order's share. */
export async function failSubOrder(ctx: AppContext, subOrderId: string, reason: string): Promise<void> {
  await withTx(ctx.pool, async (c) => {
    const so = await loadSubOrder(c, subOrderId, true);
    if (!so || so.status !== "DISPATCHING") return;
    const open = await c.query("SELECT 1 FROM bap.attempt WHERE sub_order_id = $1 AND status = ANY($2)", [subOrderId, [...OPEN_ATTEMPT]]);
    if (open.rowCount) return;
    const amount = await refundFor(c, so.basket_id, subOrderId);
    await c.query("INSERT INTO bap.refund (id, basket_id, sub_order_id, amount_paise) VALUES ($1, $2, $3, $4) ON CONFLICT (sub_order_id) DO NOTHING", [newId("rfd"), so.basket_id, subOrderId, amount]);
    await c.query("UPDATE bap.sub_order SET status = 'FAILED_NO_FULFILMENT', current_store_id = NULL, updated_at = now() WHERE id = $1", [subOrderId]);
    const { rows } = await c.query<{ transaction_id: string }>("SELECT transaction_id FROM bap.basket WHERE id = $1", [so.basket_id]);
    await auditState(c, "bap", "sub_order.FAILED_NO_FULFILMENT", { entityId: subOrderId, transactionId: rows[0]?.transaction_id, payload: { reason, refundPaise: amount } });
    await recomputeBasket(c, so.basket_id);
  });
}

// ---------------------------------------------------------------------------------------------
// Callback-driven transitions
// ---------------------------------------------------------------------------------------------

/** on_confirm without error: PENDING -> OFFERED with the BPP's expires_at. Also logs reject -> next-offer latency. */
export async function markOffered(ctx: AppContext, attemptId: string, expiresAt: Date | null): Promise<void> {
  const config = await loadBapConfig(ctx.pool);
  const exp = expiresAt ?? new Date(Date.now() + config.offerWindowSeconds * 1000);
  const { rows } = await ctx.pool.query<{ sub_order_id: string; attempt_no: number; store_id: string }>(
    "UPDATE bap.attempt SET status = 'OFFERED', expires_at = $2 WHERE id = $1 AND status = 'PENDING' RETURNING sub_order_id, attempt_no, store_id",
    [attemptId, exp],
  );
  const a = rows[0];
  if (!a) return;
  await auditState(ctx.pool, "bap", "attempt.OFFERED", { entityId: attemptId, storeId: a.store_id, payload: { subOrderId: a.sub_order_id, attemptNo: a.attempt_no, expiresAt: exp.toISOString() } });
  if (a.attempt_no > 1) {
    const prev = await ctx.pool.query<{ ms: number }>(
      "SELECT (extract(epoch FROM (now() - decided_at)) * 1000)::int AS ms FROM bap.attempt WHERE sub_order_id = $1 AND attempt_no = $2 AND decided_at IS NOT NULL",
      [a.sub_order_id, a.attempt_no - 1],
    );
    if (prev.rows[0]) {
      await auditState(ctx.pool, "bap", "dispatch.next_offer_latency", { entityId: a.sub_order_id, payload: { ms: prev.rows[0].ms, attemptId, attemptNo: a.attempt_no } });
    }
  }
}

/**
 * on_status: attempt ACCEPTED, then mirror fulfilment states forward (never backwards). DELIVERED writes the ledger entry (PRD §9)
 * and may settle the basket.
 */
export async function applyFulfilment(ctx: AppContext, attemptId: string, target: Exclude<SubOrderStatus, "DISPATCHING" | "FAILED_NO_FULFILMENT">): Promise<void> {
  await withTx(ctx.pool, async (c) => {
    const { rows } = await c.query<{ sub_order_id: string; status: AttemptStatus; store_id: string; quoted_total_paise: number }>(
      "SELECT sub_order_id, status, store_id, quoted_total_paise FROM bap.attempt WHERE id = $1 FOR UPDATE",
      [attemptId],
    );
    const att = rows[0];
    if (!att) return;
    const so = await loadSubOrder(c, att.sub_order_id, true);
    if (!so) return;
    const { rows: br } = await c.query<{ transaction_id: string }>("SELECT transaction_id FROM bap.basket WHERE id = $1", [so.basket_id]);
    const txn = br[0]?.transaction_id;
    if (att.status === "REJECTED" || att.status === "EXPIRED" || so.status === "FAILED_NO_FULFILMENT") {
      await auditState(c, "bap", "callback.ignored_stale_status", { entityId: attemptId, transactionId: txn, payload: { attemptStatus: att.status, target } });
      return;
    }
    if (att.status === "PENDING" || att.status === "OFFERED") {
      await c.query("UPDATE bap.attempt SET status = 'ACCEPTED', decided_at = now() WHERE id = $1", [attemptId]);
      await auditState(c, "bap", "attempt.ACCEPTED", { entityId: attemptId, storeId: att.store_id, transactionId: txn, payload: { subOrderId: so.id } });
    }
    if (RANK[target] > RANK[so.status]) {
      await c.query("UPDATE bap.sub_order SET status = $2, current_store_id = $3, updated_at = now() WHERE id = $1", [so.id, target, att.store_id]);
      await auditState(c, "bap", `sub_order.${target}`, { entityId: so.id, storeId: att.store_id, transactionId: txn });
    }
    if (target === "DELIVERED") {
      const config = await loadBapConfig(c);
      const gross = att.quoted_total_paise;
      const commission = Math.floor((gross * config.commissionBps) / 10000);
      const ins = await c.query(
        `INSERT INTO bap.ledger_entry (id, sub_order_id, basket_id, store_id, gross_paise, commission_paise, net_payable_paise, platform_subsidy_paise)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (sub_order_id) DO NOTHING`,
        [newId("led"), so.id, so.basket_id, att.store_id, gross, commission, gross - commission, gross - so.approved_amount_paise],
      );
      if (ins.rowCount) {
        await auditState(c, "bap", "ledger.entry", {
          entityId: so.id, storeId: att.store_id, transactionId: txn,
          payload: { grossPaise: gross, commissionPaise: commission, netPayablePaise: gross - commission, platformSubsidyPaise: gross - so.approved_amount_paise },
        });
      }
      await recomputeBasket(c, so.basket_id);
    }
  });
}

/** on_cancel (or on_status Cancelled): close the open attempt and move the sub-order on. */
export async function attemptCancelled(ctx: AppContext, attemptId: string, reasonId: string | undefined, reasonText: string | undefined): Promise<void> {
  const status = reasonId === "OFFER_EXPIRED" ? "EXPIRED" : "REJECTED";
  const subOrderId = await closeAttempt(ctx, attemptId, status, reasonText ?? reasonId ?? "cancelled by store");
  if (subOrderId) await startNextAttempt(ctx, subOrderId);
}

// ---------------------------------------------------------------------------------------------
// Reconciler (boot + every 5 s): restart safety and lost callbacks (PRD §8.9)
// ---------------------------------------------------------------------------------------------

export async function reconcileDispatch(ctx: AppContext): Promise<void> {
  const { pool } = ctx;

  // 1. DISPATCHING sub-orders with no open attempt (a callback or process died between decision and next attempt).
  const stuck = await pool.query<{ id: string }>(
    `SELECT s.id FROM bap.sub_order s
     WHERE s.status = 'DISPATCHING'
       AND NOT EXISTS (SELECT 1 FROM bap.attempt a WHERE a.sub_order_id = s.id AND a.status = ANY($1))
       AND COALESCE((SELECT max(a.decided_at) FROM bap.attempt a WHERE a.sub_order_id = s.id), s.created_at) < now() - interval '3 seconds'
     ORDER BY s.created_at LIMIT 20`,
    [[...OPEN_ATTEMPT]],
  );
  for (const r of stuck.rows) await startNextAttempt(ctx, r.id);

  // 2. confirm sent but no on_confirm seen: resend (idempotent on order.id); give up after 30 s.
  const pending = await pool.query<{ id: string; sub_order_id: string; age_s: number }>(
    `SELECT id, sub_order_id, extract(epoch FROM (now() - created_at))::int AS age_s FROM bap.attempt
     WHERE status = 'PENDING' AND created_at < now() - interval '10 seconds' ORDER BY created_at LIMIT 20`,
  );
  for (const a of pending.rows) {
    if (a.age_s > 30) {
      if (await closeAttempt(ctx, a.id, "REJECTED", "no response to confirm")) await startNextAttempt(ctx, a.sub_order_id);
    } else {
      await dispatchAttempt(ctx, a.id);
    }
  }

  // 3. OFFERED past its expiry but no on_cancel: ask the BPP for the order status; after 60 s treat it as expired.
  const overdue = await pool.query<{ id: string; sub_order_id: string; bpp_id: string; bpp_uri: string; store_id: string; txn: string; late_s: number }>(
    `SELECT a.id, a.sub_order_id, a.bpp_id, a.bpp_uri, a.store_id, b.transaction_id AS txn, extract(epoch FROM (now() - a.expires_at))::int AS late_s
     FROM bap.attempt a JOIN bap.sub_order s ON s.id = a.sub_order_id JOIN bap.basket b ON b.id = s.basket_id
     WHERE a.status = 'OFFERED' AND a.expires_at < now() - interval '5 seconds' ORDER BY a.expires_at LIMIT 20`,
  );
  for (const a of overdue.rows) {
    if (a.late_s > 60) {
      if (await closeAttempt(ctx, a.id, "EXPIRED", "offer expired (no callback from store)")) await startNextAttempt(ctx, a.sub_order_id);
      continue;
    }
    await becknCall(ctx, { action: "status", bppId: a.bpp_id, bppUri: a.bpp_uri, transactionId: a.txn, storeId: a.store_id, message: { order_id: a.id } }).catch(() => {});
  }
}
