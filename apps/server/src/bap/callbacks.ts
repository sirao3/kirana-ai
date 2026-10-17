import { getTag, KTAG, type CallbackAction, type Envelope, type Order, type SubOrderStatus } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { auditState } from "../beckn/audit.js";
import type { BecknHandlers } from "../beckn/receiver.js";
import { applyFulfilment, attemptCancelled, closeAttempt, markOffered } from "./dispatch.js";

/**
 * Extra BAP handling for callbacks, run AFTER the envelope is delivered to any waiter.
 * Solicited replies (on_search/on_select/on_init) are consumed by the waiter alone; these drive dispatch (T08):
 *  - on_confirm: attempt PENDING -> OFFERED with expires_at (an `error` rejects the attempt; the sender of the confirm moves on)
 *  - on_status:  Accepted -> attempt/sub-order ACCEPTED, then mirror In-progress / Completed states
 *  - on_cancel:  rejected / expired offer -> close the attempt, exclude the store, start the next attempt
 *
 * All transitions are conditional on the current state, so duplicates, retries and stale messages are no-ops.
 * The next attempt is started inline (before the ACK): a reassignment takes ~1 s on loopback, well inside the
 * BPP's 5 s ACK timeout, and keeps the work inside a request (Cloud Run CPU). The reconciler is the safety net.
 */
export const bapCallbackHandlers: BecknHandlers<CallbackAction> = {
  on_confirm: async (env, ctx) => {
    const order = env.message?.order;
    if (!order?.id) return; // error-only reply: the confirm sender (confirmAttempt) handles it
    if (env.error) {
      await closeAttempt(ctx, order.id, "REJECTED", env.error.message ?? `error ${env.error.code}`);
      return;
    }
    const exp = getTag(order.tags, KTAG.group, "expires_at");
    const parsed = exp ? new Date(exp) : null;
    await markOffered(ctx, order.id, parsed && !Number.isNaN(parsed.getTime()) ? parsed : null);
  },

  on_status: async (env, ctx) => {
    const order = env.message?.order;
    if (!order?.id) return;
    const target = mapStatus(order);
    if (target === "CANCELLED") return cancelled(ctx, env, order);
    if (target) await applyFulfilment(ctx, order.id, target);
  },

  on_cancel: async (env, ctx) => {
    const order = env.message?.order;
    if (!order?.id) return;
    await cancelled(ctx, env, order);
  },
};

type Target = Exclude<SubOrderStatus, "DISPATCHING" | "FAILED_NO_FULFILMENT">;

/** Beckn order/fulfilment state -> sub-order state (PRD §7 mapping). `null` = nothing to do (e.g. Created). */
export function mapStatus(order: Order): Target | "CANCELLED" | null {
  const code = order.fulfillments?.[0]?.state?.descriptor.code;
  switch (order.state) {
    case "Accepted":
      return "ACCEPTED";
    case "In-progress":
      return code === "Packed" ? "READY" : code === "Out-for-delivery" || code === "Order-picked-up" ? "OUT_FOR_DELIVERY" : "PREPARING";
    case "Completed":
      return "DELIVERED";
    case "Cancelled":
      return "CANCELLED";
    default:
      return null;
  }
}

async function cancelled(ctx: AppContext, env: Envelope<"on_status" | "on_cancel">, order: Order): Promise<void> {
  const reason = order.cancellation?.reason;
  await auditState(ctx.pool, "bap", "callback.cancelled", {
    entityId: order.id, transactionId: env.context.transaction_id, payload: { reasonId: reason?.id, by: order.cancellation?.cancelled_by },
  });
  await attemptCancelled(ctx, order.id!, reason?.id, reason?.descriptor?.name);
}

