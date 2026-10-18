import type { AttemptView, OrderView, SubOrderView } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";

const byNo = (a: AttemptView, b: AttemptView) => a.attemptNo - b.attemptNo;

export interface PriceProtection {
  storeName: string;
  chargedPaise: number;
  approvedPaise: number;
  /** Platform-covered difference; equals the ledger's platform_subsidy_paise once delivered. */
  coveredPaise: number;
}

/** Set when the store that accepted charges more than the customer approved (PRD §9; quotedTotalPaise includes delivery). */
export function priceProtection(sub: SubOrderView): PriceProtection | null {
  const acc = sub.attempts.find((a) => a.status === "ACCEPTED");
  if (!acc || acc.quotedTotalPaise <= sub.approvedAmountPaise) return null;
  return { storeName: acc.storeName, chargedPaise: acc.quotedTotalPaise, approvedPaise: sub.approvedAmountPaise, coveredPaise: acc.quotedTotalPaise - sub.approvedAmountPaise };
}

export function priceProtectionMessage(p: PriceProtection): string {
  return `${p.storeName} charges ${formatINR(p.chargedPaise)}. You still pay ${formatINR(p.approvedPaise)}. KiranaAI covers the ${formatINR(p.coveredPaise)} difference.`;
}

export const orderPriceProtected = (o: OrderView) => o.subOrders.some((s) => priceProtection(s) !== null);

export interface Announcement {
  text: string;
  /** True when a store let go of the order (declined / timed out): worth a snackbar. */
  handoff: boolean;
}

/**
 * Diff two snapshots of one sub-order into spoken updates, e.g.
 * "Lakshmi Stores declined (Out of stock). Offered to Annapurna Provisions, attempt 2 of 3."
 * No previous snapshot (first load) announces nothing.
 */
export function diffAttempts(prev: SubOrderView | undefined, next: SubOrderView): Announcement[] {
  if (!prev) return [];
  const before = new Map(prev.attempts.map((a) => [a.id, a.status]));
  const parts: string[] = [];
  let handoff = false;
  for (const a of [...next.attempts].sort(byNo)) {
    const was = before.get(a.id);
    if (a.status === "REJECTED" && was !== "REJECTED") {
      parts.push(`${a.storeName} declined${a.rejectReason ? ` (${a.rejectReason})` : ""}`);
      handoff = true;
    } else if (a.status === "EXPIRED" && was !== "EXPIRED") {
      parts.push(`${a.storeName} did not respond in time`);
      handoff = true;
    } else if (a.status === "ACCEPTED" && was !== "ACCEPTED") {
      parts.push(`${a.storeName} accepted`);
    } else if (was === undefined && (a.status === "PENDING" || a.status === "OFFERED")) {
      parts.push(`Offered to ${a.storeName}, attempt ${a.attemptNo} of ${next.maxAttempts}`);
    }
  }
  if (next.status === "FAILED_NO_FULFILMENT" && prev.status !== "FAILED_NO_FULFILMENT") {
    parts.push("No store could take this order, a refund is on the way");
    handoff = true;
  }
  return parts.length ? [{ text: `${parts.join(". ")}.`, handoff }] : [];
}

/** Diff a whole order: one announcement per changed sub-order. Nothing on first load or when the order changes. */
export function diffOrder(prev: OrderView | undefined, next: OrderView): Announcement[] {
  if (!prev || prev.basketId !== next.basketId) return [];
  const old = new Map(prev.subOrders.map((s) => [s.id, s]));
  return next.subOrders.flatMap((s) => diffAttempts(old.get(s.id), s));
}
