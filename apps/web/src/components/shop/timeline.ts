import type { AttemptView, SubOrderStatus, SubOrderView } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";

export type StepState = "done" | "active" | "pending" | "failed";

export interface TimelineStep {
  key: string;
  label: string;
  state: StepState;
  /** ISO time to count down to (set on a live offer). */
  expiresAt?: string | null;
}

/** Fulfilment statuses after acceptance, in order; index in this list = step position. */
const FULFILMENT: { status: SubOrderStatus; label: string }[] = [
  { status: "PREPARING", label: "Preparing" },
  { status: "READY", label: "Ready" },
  { status: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { status: "DELIVERED", label: "Delivered" },
];
const AFTER_ACCEPT: SubOrderStatus[] = ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];

/**
 * OrderView sub-order → timeline steps:
 * Finding store → Offered to X (n/3, countdown) → declined / timed out → Offered to Y → Accepted →
 * Preparing → Ready → Out for delivery → Delivered; failure ends with the refund line.
 */
export function deriveTimeline(sub: SubOrderView): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const attempts: AttemptView[] = [...sub.attempts].sort((a, b) => a.attemptNo - b.attemptNo);
  const accepted = attempts.some((a) => a.status === "ACCEPTED") || AFTER_ACCEPT.includes(sub.status);

  steps.push({ key: "finding", label: "Finding store", state: attempts.length === 0 && sub.status === "DISPATCHING" ? "active" : "done" });

  for (const a of attempts) {
    const base = `Offered to ${a.storeName} (attempt ${a.attemptNo}/${sub.maxAttempts})`;
    const k = `attempt-${a.id}`;
    switch (a.status) {
      case "PENDING":
        steps.push({ key: k, label: `Contacting ${a.storeName} (attempt ${a.attemptNo}/${sub.maxAttempts})`, state: "active" });
        break;
      case "OFFERED":
        steps.push({ key: k, label: base, state: "active", expiresAt: a.expiresAt });
        break;
      case "REJECTED":
        steps.push({ key: k, label: base, state: "done" });
        steps.push({ key: `${k}-out`, label: `${a.storeName} declined${a.rejectReason ? `: ${a.rejectReason}` : ""}`, state: "failed" });
        break;
      case "EXPIRED":
        steps.push({ key: k, label: base, state: "done" });
        steps.push({ key: `${k}-out`, label: `${a.storeName} did not respond in time`, state: "failed" });
        break;
      case "ACCEPTED":
        steps.push({ key: k, label: base, state: "done" });
        steps.push({ key: `${k}-out`, label: `Accepted by ${a.storeName}`, state: "done" });
        break;
    }
  }

  if (sub.status === "FAILED_NO_FULFILMENT") {
    steps.push({ key: "failed", label: "No store could take this order", state: "failed" });
    if (sub.refundPaise != null) steps.push({ key: "refund", label: `Refund of ${formatINR(sub.refundPaise)} issued`, state: "done" });
    else steps.push({ key: "refund", label: "Refund pending", state: "active" });
    return steps;
  }

  if (!accepted) {
    const last = attempts[attempts.length - 1];
    const open = last && (last.status === "PENDING" || last.status === "OFFERED");
    if (attempts.length > 0 && !open && attempts.length < sub.maxAttempts) {
      steps.push({ key: "next", label: "Finding next store…", state: "active" });
    }
    steps.push({ key: "accepted", label: "Accepted", state: "pending" });
  }

  const rank = Math.max(0, AFTER_ACCEPT.indexOf(sub.status)); // ACCEPTED = 0 → nothing started yet
  FULFILMENT.forEach((f, i) => {
    const pos = i + 1;
    let state: StepState = "pending";
    if (accepted) {
      if (pos < rank || (pos === rank && sub.status === "DELIVERED")) state = "done";
      else if (pos === rank) state = "active";
    }
    steps.push({ key: f.status, label: f.label, state });
  });
  return steps;
}
