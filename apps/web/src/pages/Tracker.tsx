import { Link, useParams } from "react-router-dom";
import type { PaymentStatus, SubOrderView } from "@kiranaai/shared";
import { formatINR } from "../lib/format";
import { useLive } from "../lib/live";
import { useRequireSession } from "../lib/useSession";
import { Badge, Card, Countdown } from "../components/kit";
import { bap } from "../components/shop/bap";
import { errorMessage } from "../components/shop/errors";
import { deriveTimeline, type StepState } from "../components/shop/timeline";

const PAYMENT_TONE: Record<PaymentStatus, "neutral" | "info" | "good" | "bad"> = { NONE: "neutral", INITIATED: "info", PAID: "good", FAILED: "bad" };

const DOT: Record<StepState, string> = {
  done: "bg-emerald-600 text-white",
  active: "bg-sky-500 text-white animate-pulse",
  pending: "bg-stone-200 text-stone-400",
  failed: "bg-rose-600 text-white",
};
const MARK: Record<StepState, string> = { done: "✓", active: "•", pending: "", failed: "✕" };

function SubOrderCard({ sub }: { sub: SubOrderView }) {
  const steps = deriveTimeline(sub);
  const store = sub.currentStoreName ?? sub.approvedStoreName;
  return (
    <Card
      title={store}
      actions={<Badge tone={sub.status === "DELIVERED" ? "good" : sub.status === "FAILED_NO_FULFILMENT" ? "bad" : "info"}>{sub.status.replace(/_/g, " ").toLowerCase()}</Badge>}
    >
      <ul className="mb-3 text-sm text-stone-600">
        {sub.lines.map((l) => (
          <li key={l.listingId}>{l.qty} × {l.name}</li>
        ))}
        <li className="mt-1 font-medium text-stone-800">{formatINR(sub.approvedAmountPaise)}</li>
      </ul>
      <ol className="space-y-0">
        {steps.map((s, i) => (
          <li key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${DOT[s.state]}`}>{MARK[s.state]}</span>
              {i < steps.length - 1 && <span className="h-5 w-px bg-stone-200" />}
            </div>
            <div className={`pb-2 text-sm ${s.state === "pending" ? "text-stone-400" : s.state === "failed" ? "text-rose-700" : "text-stone-900"}`}>
              {s.label}
              {s.state === "active" && s.expiresAt && (
                <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">
                  <Countdown until={s.expiresAt} /> left to accept
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Customer order tracker: payment badge (separate) + one timeline card per sub-order. Polls every second. */
export function Tracker() {
  const session = useRequireSession("customer");
  const { id = "" } = useParams();
  const q = useLive(["order", id], () => bap.order(id), { enabled: !!session && !!id });
  if (!session) return null;
  const o = q.data;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-3 sm:p-6">
      <Link to="/shop" className="text-sm text-emerald-700 underline">← Back to shop</Link>
      {!o ? (
        <Card>{q.isError ? <p className="text-rose-700">Could not load this order: {errorMessage(q.error)}</p> : <p className="text-stone-500">Loading order…</p>}</Card>
      ) : (
        <>
          {o.settled && (
            <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 font-medium text-emerald-900">
              Order settled. All stores are done and payouts are complete.
            </div>
          )}
          <Card
            title="Your order"
            actions={
              <span className="flex items-center gap-2 text-sm">
                Payment <Badge tone={PAYMENT_TONE[o.paymentStatus]}>{o.paymentStatus.toLowerCase()}</Badge>
              </span>
            }
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-2xl font-bold tabular-nums">{formatINR(o.grandTotalPaise)}</div>
              <div className="text-xs text-stone-500">Order {o.basketId}</div>
            </div>
            {o.refundedPaise > 0 && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                {formatINR(o.refundedPaise)} refunded for items no store could deliver.
              </p>
            )}
            {o.paymentStatus === "FAILED" && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-800">Payment failed. You were not charged.</p>}
          </Card>
          <div className="space-y-4">
            {o.subOrders.length === 0 && <Card><p className="text-sm text-stone-500">No stores yet. Waiting for payment.</p></Card>}
            {o.subOrders.map((s) => <SubOrderCard key={s.id} sub={s} />)}
          </div>
        </>
      )}
    </main>
  );
}
