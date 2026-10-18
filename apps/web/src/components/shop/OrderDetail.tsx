import type { OrderView, PaymentStatus, SubOrderStatus, SubOrderView } from "@kiranaai/shared";
import { formatINR, itemsLabel } from "../../lib/format";
import { Card, Countdown, cx, Icon, InlineMessage, LinearProgress, StatusLabel, type Tone } from "../m3";
import { deriveTimeline, type StepState } from "./timeline";

export const PAYMENT: Record<PaymentStatus, { tone: Tone; icon: string; label: string }> = {
  NONE: { tone: "neutral", icon: "hourglass_empty", label: "Not paid" },
  INITIATED: { tone: "info", icon: "sync", label: "Payment pending" },
  PAID: { tone: "success", icon: "check_circle", label: "Paid" },
  FAILED: { tone: "error", icon: "error", label: "Payment failed" },
};

const SUB: Record<SubOrderStatus, { tone: Tone; icon: string; label: string; progress?: number }> = {
  DISPATCHING: { tone: "info", icon: "travel_explore", label: "Finding store", progress: 0.1 },
  ACCEPTED: { tone: "primary", icon: "thumb_up", label: "Accepted", progress: 0.3 },
  PREPARING: { tone: "primary", icon: "inventory_2", label: "Preparing", progress: 0.5 },
  READY: { tone: "primary", icon: "shopping_bag", label: "Ready", progress: 0.65 },
  OUT_FOR_DELIVERY: { tone: "primary", icon: "two_wheeler", label: "Out for delivery", progress: 0.85 },
  DELIVERED: { tone: "success", icon: "check_circle", label: "Delivered", progress: 1 },
  FAILED_NO_FULFILMENT: { tone: "error", icon: "cancel", label: "No store available" },
};

/** One-line overall status for an order (used by the orders list). */
export function orderSummary(o: OrderView): { tone: Tone; icon: string; label: string } {
  if (o.paymentStatus !== "PAID") return PAYMENT[o.paymentStatus];
  if (o.settled) return { tone: "success", icon: "verified", label: "Settled" };
  const subs = o.subOrders;
  if (subs.length && subs.every((s) => s.status === "DELIVERED")) return { tone: "success", icon: "check_circle", label: "Delivered" };
  if (subs.some((s) => s.status === "DISPATCHING")) return { tone: "info", icon: "travel_explore", label: "Finding stores" };
  if (subs.some((s) => s.status === "FAILED_NO_FULFILMENT")) return { tone: "warning", icon: "currency_exchange", label: "Partly refunded" };
  return { tone: "primary", icon: "local_shipping", label: "On the way" };
}

const DOT: Record<StepState, string> = {
  done: "bg-primary text-on-primary",
  active: "bg-tertiary-container text-on-tertiary-container",
  pending: "border-2 border-outline-variant",
  failed: "bg-error-container text-on-error-container",
};
const DOT_ICON: Partial<Record<StepState, string>> = { done: "check", failed: "close" };
const STATE_TEXT: Record<StepState, string> = { done: "done", active: "in progress", pending: "not started", failed: "failed" };

function SubOrderCard({ sub }: { sub: SubOrderView }) {
  const steps = deriveTimeline(sub);
  const store = sub.currentStoreName ?? sub.approvedStoreName;
  const st = SUB[sub.status];
  return (
    <Card variant="outlined" className="overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-4 pb-2 pt-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <Icon name="storefront" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate type-title-medium text-on-surface">{store}</h3>
          <p className="type-body-medium text-on-surface-variant">{formatINR(sub.approvedAmountPaise)} · {itemsLabel(sub.lines.reduce((n, l) => n + l.qty, 0))}</p>
        </div>
        <StatusLabel tone={st.tone} icon={st.icon}>{st.label}</StatusLabel>
      </header>
      {st.progress !== undefined && <LinearProgress value={st.progress} label={`${store}: ${st.label}`} className="mx-4 w-auto!" />}

      <div className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-[1fr_1.3fr]">
        <ul className="space-y-1 type-body-medium text-on-surface-variant" aria-label="Items">
          {sub.lines.map((l) => (
            <li key={l.listingId} className="flex justify-between gap-3">
              <span>{l.qty} × {l.name}</span>
              <span className="tabular-nums">{formatINR(l.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>

        <ol aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", DOT[s.state])}>
                  {DOT_ICON[s.state] ? <Icon name={DOT_ICON[s.state]!} size={16} /> : s.state === "active" && <span className="h-2 w-2 animate-breathe rounded-full bg-tertiary" />}
                </span>
                {i < steps.length - 1 && <span className={cx("min-h-4 w-0.5 flex-1", s.state === "done" ? "bg-primary" : "bg-outline-variant")} />}
              </div>
              <div className={cx("pb-3 type-body-medium", s.state === "pending" ? "text-on-surface-variant" : s.state === "failed" ? "text-error" : "text-on-surface", s.state === "active" && "type-title-small")}>
                {s.label}
                <span className="sr-only"> ({STATE_TEXT[s.state]})</span>
                {s.state === "active" && s.expiresAt && (
                  <StatusLabel tone="info" icon="timer" className="ml-2">
                    <Countdown until={s.expiresAt} /> to accept
                  </StatusLabel>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/** Customer order detail: payment status (separate from fulfilment) + one live timeline per store. */
export function OrderDetail({ order: o }: { order: OrderView }) {
  const pay = PAYMENT[o.paymentStatus];
  return (
    <div className="space-y-4">
      {o.settled && (
        // Expressive moment: the end of the journey.
        <section role="status" className="flex items-center gap-4 rounded-xl bg-primary-container p-5 text-on-primary-container">
          <span className="flex h-14 w-14 shrink-0 animate-pop items-center justify-center rounded-lg bg-primary text-on-primary">
            <Icon name="verified" size={32} filled />
          </span>
          <div>
            <p className="type-headline-small type-emphasized">Order settled</p>
            <p className="type-body-medium">All stores are done and payouts are complete.</p>
          </div>
        </section>
      )}

      <Card variant="filled" className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="type-label-large text-on-surface-variant">Order total</p>
            <p className="type-headline-large tabular-nums text-on-surface">{formatINR(o.grandTotalPaise)}</p>
          </div>
          <StatusLabel tone={pay.tone} icon={pay.icon}>{pay.label}</StatusLabel>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-body-small text-on-surface-variant">
          <dt>Placed</dt>
          <dd>{new Date(o.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
          <dt>Stores</dt>
          <dd>{o.subOrders.length || "—"}</dd>
          <dt>Order ID</dt>
          <dd className="break-all font-mono">{o.basketId}</dd>
        </dl>
      </Card>

      {o.refundedPaise > 0 && (
        <InlineMessage tone="warning" icon="currency_exchange">{formatINR(o.refundedPaise)} refunded for items no store could deliver.</InlineMessage>
      )}
      {o.paymentStatus === "FAILED" && <InlineMessage tone="error">Payment failed. You were not charged.</InlineMessage>}

      {o.subOrders.length === 0 ? (
        <InlineMessage tone="info" icon="hourglass_top">No stores yet. Waiting for payment.</InlineMessage>
      ) : (
        <div className="space-y-4">
          {o.subOrders.map((s) => <SubOrderCard key={s.id} sub={s} />)}
        </div>
      )}
    </div>
  );
}
