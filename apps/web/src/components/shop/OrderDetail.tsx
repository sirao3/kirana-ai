import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { OrderView, PaymentStatus, SubOrderView } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { Button, C, CheckDraw, IChevron, Money, Ring, Spinner, cardShadow, ease, shortName, soft, type Tone } from "../ui";
import { HandoffStrip } from "./HandoffStrip";
import { priceProtection } from "./handoff";
import { ReceiptCard } from "./ReceiptCard";
import { deriveTimeline } from "./timeline";
import { useAttemptAnnouncements } from "./useAttemptAnnouncements";
import { DANGER, LINK } from "./tokens";

const PAYMENT: Record<PaymentStatus, string> = { NONE: "Not paid", INITIATED: "Payment pending", PAID: "Paid", FAILED: "Payment failed" };

/** One-line overall status for an order (orders list, tracker header). */
export function orderSummary(o: OrderView): { tone: Tone; label: string } {
  if (o.paymentStatus !== "PAID") return { tone: o.paymentStatus === "FAILED" ? "bad" : "neutral", label: PAYMENT[o.paymentStatus] };
  if (o.settled) return { tone: "good", label: "Delivered and settled" };
  const subs = o.subOrders;
  if (subs.length && subs.every((s) => s.status === "DELIVERED")) return { tone: "good", label: "Delivered" };
  if (subs.some((s) => s.status === "DISPATCHING")) return { tone: "info", label: "Finding stores" };
  if (subs.some((s) => s.status === "FAILED_NO_FULFILMENT")) return { tone: "warn", label: "Partly refunded" };
  return { tone: "info", label: "On the way" };
}

/** Settled, or no store could fulfil anything (fully refunded): nothing left to watch on this order. */
export function orderFinished(o: OrderView): boolean {
  return o.settled || (o.subOrders.length > 0 && o.subOrders.every((s) => s.status === "FAILED_NO_FULFILMENT"));
}

export const isInFlight = (o: OrderView) => o.paymentStatus === "PAID" && !o.settled;

const STAGES = ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
const STAGE_LABEL: Record<string, string> = { ACCEPTED: "Accepted", PREPARING: "Packing", READY: "Ready", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered" };

/** Polite text for payment / overall status changes after first load (store handoffs come from useAttemptAnnouncements). */
function useStatusAnnouncement(o: OrderView): string {
  const prev = useRef<{ pay: PaymentStatus; label: string } | undefined>(undefined);
  const [said, setSaid] = useState("");
  const label = orderSummary(o).label;
  useEffect(() => {
    const before = prev.current;
    prev.current = { pay: o.paymentStatus, label };
    if (!before) return;
    if (before.pay !== o.paymentStatus) setSaid(`Payment status: ${PAYMENT[o.paymentStatus]}.`);
    else if (before.label !== label) setSaid(`Order status: ${label}.`);
  }, [o.paymentStatus, label]);
  return said;
}

/**
 * The order as one card: total, then each store with a five-step progress line. A reassignment slides the store name
 * and explains itself ("Lakshmi declined (out of stock) · moved to Annapurna · your price stays ₹550 · KiranaAI covers ₹40").
 * `full` adds items, every step, the handoff sequence, order facts and (once settled) the receipt.
 */
/** `onNewOrder` adds "Start a new order" once the order is finished, so the customer is never left on a dead end. */
export function OrderDetail({ order: o, now, full = false, onOpen, onNewOrder }: { order: OrderView; now: number; full?: boolean; onOpen?: () => void; onNewOrder?: () => void }) {
  const said = useAttemptAnnouncements(o);
  const statusSaid = useStatusAnnouncement(o);
  const sum = orderSummary(o);
  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" className="sr-only">{said}</div>
      <div role="status" aria-live="polite" className="sr-only">{statusSaid}</div>
      <motion.section layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={soft} aria-label="Order status"
        className="bg-white" style={{ borderRadius: 22, padding: 18, boxShadow: cardShadow }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium" style={{ color: sum.tone === "bad" ? DANGER : C.secondary }}>
              {o.paymentStatus === "PAID" ? (o.settled ? "Delivered and settled" : `${sum.label} · paid by UPI`) : sum.label}
            </p>
            <Money value={o.grandTotalPaise} className="mt-1 block text-[34px] font-bold leading-none tracking-[-0.03em]" style={{ color: C.label }} />
          </div>
          {o.paymentStatus === "PAID" && <CheckDraw size={30} />}
        </div>
        {o.subOrders.length === 0 ? (
          <p className="mt-3 text-[14px]" style={{ color: C.secondary }}>{o.paymentStatus === "FAILED" ? "Payment failed. You were not charged." : "No stores yet. Waiting for payment."}</p>
        ) : (
          <div className="mt-4">
            {o.subOrders.map((s, i) => <SubRow key={s.id} sub={s} now={now} first={i === 0} full={full} />)}
          </div>
        )}
        <AnimatePresence initial={false}>
          {o.refundedPaise > 0 && (
            <motion.p key="refund" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={soft} className="overflow-hidden text-[13px]" style={{ color: "#B25E00" }}>
              <span className="block pt-3">{formatINR(o.refundedPaise)} refunded for items no store could deliver.</span>
            </motion.p>
          )}
          {o.settled && (
            <motion.p key="settled" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={soft} className="overflow-hidden text-[13px]" style={{ color: C.green }}>
              <span className="block pt-3">Everything arrived. Stores have been paid out.</span>
            </motion.p>
          )}
        </AnimatePresence>
        {onOpen && (
          <button type="button" onClick={onOpen} className="-mx-1 mt-2 flex min-h-11 cursor-pointer items-center gap-1 px-1 text-[14px] font-semibold" style={{ color: LINK }}>
            {o.settled ? "Receipt and details" : "Order details"} <IChevron size={13} />
          </button>
        )}
        {onNewOrder && orderFinished(o) && (
          <Button full size="lg" className="mt-3" onClick={onNewOrder}>Start a new order</Button>
        )}
      </motion.section>

      {full && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-1 text-[13px]" style={{ color: C.secondary }}>
          <dt>Placed</dt>
          <dd style={{ color: C.label }}>{new Date(o.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
          <dt>Payment</dt>
          <dd style={{ color: C.label }}>{PAYMENT[o.paymentStatus]}</dd>
          <dt>Order ID</dt>
          <dd className="break-all font-mono text-[12px]" style={{ color: C.label }}>{o.basketId}</dd>
        </dl>
      )}
      {full && o.settled && <ReceiptCard order={o} />}
    </div>
  );
}

function SubRow({ sub, now, first, full }: { sub: SubOrderView; now: number; first: boolean; full: boolean }) {
  const cur = sub.attempts.at(-1);
  const name = sub.currentStoreName ?? cur?.storeName ?? sub.approvedStoreName;
  const failed = sub.attempts.filter((a) => a.status === "REJECTED" || a.status === "EXPIRED");
  const n = STAGES.indexOf(sub.status as (typeof STAGES)[number]) + 1;
  const covered = priceProtection(sub)?.coveredPaise ?? 0;
  const lost = sub.status === "FAILED_NO_FULFILMENT";
  const [open, setOpen] = useState(false);
  const statusText = lost
    ? `No store could take it · refunded ${formatINR(sub.refundPaise ?? sub.approvedAmountPaise)}`
    : sub.status === "DISPATCHING"
      ? cur ? `Waiting for ${shortName(cur.storeName)} · try ${sub.attemptCount} of ${sub.maxAttempts}` : "Finding a store"
      : STAGE_LABEL[sub.status];
  return (
    <div className="py-3" style={{ borderTop: first ? undefined : `0.5px solid ${C.sep}`, paddingTop: first ? 0 : undefined }}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="relative min-w-0 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h3 key={name} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={soft} className="truncate text-[15px] font-semibold" style={{ color: C.label }}>{name}</motion.h3>
          </AnimatePresence>
        </div>
        <span className="text-[15px] font-semibold" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{formatINR(sub.approvedAmountPaise)}</span>
      </div>
      <div className="relative mt-1.5 flex min-h-[22px] items-center gap-2 text-[13px] font-medium">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={sub.status + (cur?.id ?? "")} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={ease} className="flex items-center gap-1.5"
            style={{ color: lost ? DANGER : sub.status === "DELIVERED" ? C.green : sub.status === "DISPATCHING" ? C.secondary : C.label }}>
            {sub.status === "DELIVERED" ? <CheckDraw size={15} /> : sub.status === "DISPATCHING" ? <Spinner size={13} /> : null}
            {statusText}
          </motion.span>
        </AnimatePresence>
        {sub.status === "DISPATCHING" && cur?.status === "OFFERED" && cur.expiresAt && <span className="ml-auto"><Ring from={cur.createdAt} until={cur.expiresAt} now={now} size={22} label={false} /></span>}
      </div>
      {!lost && (
        <div className="mt-2 flex gap-1" role="img" aria-label={`${name}: step ${Math.max(0, n)} of ${STAGES.length}`}>
          {STAGES.map((s, i) => (
            <span key={s} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: C.fill }}>
              <motion.span className="block h-full rounded-full" style={{ background: C.green, originX: 0 }} initial={false} animate={{ scaleX: n > i ? 1 : 0 }} transition={soft} />
            </span>
          ))}
        </div>
      )}
      <AnimatePresence initial={false}>
        {failed.length > 0 && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={soft} className="overflow-hidden text-[12px] leading-[1.45]" style={{ color: C.secondary }}>
            <span className="block pt-2">
              {failed.map((a) => `${shortName(a.storeName)} ${a.status === "EXPIRED" ? "didn't answer in time" : `declined${a.rejectReason ? ` (${a.rejectReason.toLowerCase()})` : ""}`}`).join(" · ")}
              {cur && cur.status !== "REJECTED" && cur.status !== "EXPIRED" && ` · moved to ${shortName(cur.storeName)} · your price stays ${formatINR(sub.approvedAmountPaise)}`}
              {covered > 0 && ` · KiranaAI covers ${formatINR(covered)}`}
            </span>
          </motion.p>
        )}
      </AnimatePresence>
      {full && (
        <>
          <ul className="mt-2.5 space-y-0.5 text-[13px]" aria-label={`Items from ${name}`} style={{ color: C.secondary }}>
            {sub.lines.map((l) => (
              <li key={l.listingId} className="flex justify-between gap-3"><span>{l.qty}× {l.name}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(l.lineTotalPaise)}</span></li>
            ))}
          </ul>
          <HandoffStrip sub={sub} />
          <button type="button" aria-expanded={open} aria-controls={`steps-${sub.id}`} onClick={() => setOpen((v) => !v)}
            className="-mx-1 mt-1 flex min-h-11 cursor-pointer items-center gap-1 px-1 text-[13px] font-semibold" style={{ color: LINK }}>
            {open ? "Hide steps" : "Show all steps"}
            <motion.span animate={{ rotate: open ? 90 : 0 }} transition={soft} className="inline-flex"><IChevron size={12} /></motion.span>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ol id={`steps-${sub.id}`} aria-label="Progress" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={soft} className="overflow-hidden">
                {deriveTimeline(sub).map((s) => (
                  <li key={s.key} className="flex items-center gap-2.5 py-1 text-[13px]" style={{ color: s.state === "pending" ? C.tertiary : s.state === "failed" ? DANGER : C.label, fontWeight: s.state === "active" ? 600 : 400 }}>
                    <span className="h-[7px] w-[7px] shrink-0 rounded-full" aria-hidden style={{ background: s.state === "done" ? C.green : s.state === "failed" ? DANGER : s.state === "active" ? C.orange : "#D1D1D6" }} />
                    {s.label}
                    <span className="sr-only"> ({s.state === "pending" ? "not started" : s.state === "active" ? "in progress" : s.state})</span>
                  </li>
                ))}
              </motion.ol>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
