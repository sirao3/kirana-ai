import type { BasketView, OrderView, SubOrderStatus } from "@kiranaai/shared";

/** The PRD §14 script as a stepper. Every step ticks itself from live state; nothing is clicked to advance. */
export type StepKey = "reset" | "ask" | "pay" | "answer" | "deliver" | "settle" | "ledger";
export type StepStatus = "done" | "current" | "todo";

export interface StepView {
  key: StepKey;
  label: string;
  status: StepStatus;
  /** One line telling the presenter what to do (or what just happened) at this step. */
  hint: string;
  /** Live progress, e.g. "2/3 accepted · 1 rejected". */
  detail?: string;
}

export interface DemoState {
  /** Customer's current basket, if loaded. */
  basket?: Pick<BasketView, "itemCount" | "status"> | null;
  /** The order created during this cockpit session (stale orders from earlier runs are filtered out by the caller). */
  order?: OrderView | null;
  /** Orders from before this session exist, so Reset is still advisable. */
  staleOrders: boolean;
  /** The presenter reset the demo from the cockpit. */
  resetDone: boolean;
  /** The presenter opened the admin ledger from the cockpit. */
  ledgerOpened: boolean;
}

export const DEMO_PROMPT = "Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea.";

const ACCEPTED_OR_LATER: SubOrderStatus[] = ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];

/** Counts of attempts that did not stick, across all sub-orders: what the reassignment step is about. */
export function reassignmentCounts(order: OrderView): { rejected: number; expired: number } {
  let rejected = 0;
  let expired = 0;
  for (const s of order.subOrders)
    for (const a of s.attempts) {
      if (a.status === "REJECTED") rejected++;
      if (a.status === "EXPIRED") expired++;
    }
  return { rejected, expired };
}

export function deriveSteps(st: DemoState): StepView[] {
  const order = st.order ?? null;
  const paid = order?.paymentStatus === "PAID";
  const subs = order?.subOrders ?? [];
  const answered = paid && subs.length > 0 && subs.every((s) => ACCEPTED_OR_LATER.includes(s.status));
  const delivered = paid && subs.length > 0 && subs.every((s) => s.status === "DELIVERED");
  const settled = !!order?.settled;
  const hasBasket = (st.basket?.itemCount ?? 0) > 0;

  const done: Record<StepKey, boolean> = {
    reset: st.resetDone || !st.staleOrders,
    ask: hasBasket || !!order,
    pay: paid,
    answer: answered,
    deliver: delivered,
    settle: settled,
    ledger: st.ledgerOpened,
  };
  // A later step proves the earlier ones happened, even if the presenter skipped one (e.g. never pressed Reset).
  const sequence: StepKey[] = ["reset", "ask", "pay", "answer", "deliver", "settle", "ledger"];
  let seenLater = false;
  for (const k of [...sequence].reverse()) {
    if (seenLater) done[k] = true;
    if (done[k]) seenLater = true;
  }

  const { rejected, expired } = order ? reassignmentCounts(order) : { rejected: 0, expired: 0 };
  const accepted = subs.filter((s) => ACCEPTED_OR_LATER.includes(s.status)).length;
  const deliveredCount = subs.filter((s) => s.status === "DELIVERED").length;
  const bits: string[] = [];
  if (paid) bits.push(`${accepted}/${subs.length} accepted`);
  if (rejected) bits.push(`${rejected} rejected`);
  if (expired) bits.push(`${expired} timed out`);
  if (rejected + expired > 0 && answered) bits.push("reassigned");

  const quoted = st.basket?.status === "QUOTED";
  const hint: Record<StepKey, string> = {
    reset: st.staleOrders ? "Orders from an earlier run exist. Open the menu and choose Reset demo data." : "Fresh start.",
    ask: `Ask the assistant: “${DEMO_PROMPT}”`,
    pay: quoted ? "Verified quote ready. Review it, approve, then pay." : "Review the verified total, approve and pay once.",
    answer: "Accept Sharma. Reject Lakshmi (“Out of stock”). Leave Gupta to time out.",
    deliver: "Advance each store's order to Delivered on its tile.",
    settle: "Settlement runs on its own once every store has delivered.",
    ledger: "Open the admin ledger: per-merchant net and the subsidy for the reassigned store.",
  };
  const detail: Partial<Record<StepKey, string>> = {
    answer: bits.length ? bits.join(" · ") : undefined,
    deliver: paid && subs.length ? `${deliveredCount}/${subs.length} delivered` : undefined,
  };

  const labels: Record<StepKey, string> = {
    reset: "Reset",
    ask: "Ask",
    pay: "Approve & pay",
    answer: "Stores answer",
    deliver: "Delivered",
    settle: "Settled",
    ledger: "Ledger",
  };
  let currentTaken = false;
  return sequence.map((key) => {
    let status: StepStatus = "todo";
    if (done[key]) status = "done";
    else if (!currentTaken) {
      status = "current";
      currentTaken = true;
    }
    return { key, label: labels[key], status, hint: hint[key], detail: detail[key] };
  });
}
