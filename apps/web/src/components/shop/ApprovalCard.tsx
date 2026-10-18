import { useEffect, useRef, useState } from "react";
import type { BasketView } from "@kiranaai/shared";
import { ApiError } from "../../lib/api";
import { formatINR, itemsLabel } from "../../lib/format";
import { useLive } from "../../lib/live";
import { Button, Checkbox, Countdown, cx, Dialog, Icon, InlineMessage, LinearProgress, StatusLabel } from "../m3";
import { bap, newIdempotencyKey } from "./bap";
import { errorMessage } from "./errors";

type Stage = "review" | "approving" | "approved" | "paying" | "failed";

function Step({ n, done, active, title, children }: { n: number; done: boolean; active: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full type-label-large",
          done ? "animate-pop bg-primary text-on-primary" : active ? "bg-secondary-container text-on-secondary-container" : "border border-outline-variant text-on-surface-variant",
        )}
      >
        {done ? <Icon name="check" size={18} label="Done" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className={cx("type-title-small", active || done ? "text-on-surface" : "text-on-surface-variant")}>{title}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * Approve → Pay dialog. The total is always the API quote, never agent text.
 * Only these buttons call approve/pay; the agent has no route to them.
 */
export function ApprovalDialog({ open, basket, onClose, onPaid, onRequote, requoting }: {
  open: boolean;
  basket: BasketView;
  onClose: () => void;
  onPaid: (basketId: string) => void;
  onRequote: () => void;
  requoting: boolean;
}) {
  const quote = basket.quote;
  const [stage, setStage] = useState<Stage>("review");
  const [token, setToken] = useState<string | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiredNow, setExpiredNow] = useState(false);
  const done = useRef(false);

  // A fresh quote resets the flow.
  useEffect(() => {
    setStage("review");
    setToken(null);
    setError(null);
    setExpiredNow(false);
  }, [quote?.id]);

  const expired = !quote || quote.expired || expiredNow || basket.status === "EXPIRED";

  // After pay, poll the order until payment settles (PAID → tracker, FAILED → retry).
  const order = useLive(["pay-order", basket.id], () => bap.order(basket.id), { enabled: open && stage === "paying" });
  useEffect(() => {
    const p = order.data?.paymentStatus;
    if (stage !== "paying" || !p || done.current) return;
    if (p === "PAID") {
      done.current = true;
      onPaid(basket.id);
    } else if (p === "FAILED") {
      setStage("failed");
      setToken(null);
      setSimulateFailure(false);
      setError("Payment failed. You were not charged. Try again.");
    }
  }, [order.data?.paymentStatus, stage, basket.id, onPaid]);

  if (!quote) return null;

  async function approve(): Promise<string> {
    const r = await bap.approve(basket.id, quote!.quoteHash);
    setToken(r.approvalToken);
    return r.approvalToken;
  }

  async function approveOnly() {
    setError(null);
    setStage("approving");
    try {
      await approve();
      setStage("approved");
    } catch (e) {
      setStage("review");
      setError(e instanceof ApiError && (e.status === 403 || e.status === 409) ? "The quote changed or expired. Please get a fresh quote." : errorMessage(e));
    }
  }

  async function pay() {
    setError(null);
    setStage("paying");
    try {
      let t = token ?? (await approve());
      let r;
      try {
        r = await bap.pay(basket.id, t, simulateFailure, newIdempotencyKey());
      } catch (e) {
        // A used or expired approval token (e.g. retry after a failed payment): approve again once.
        if (!(e instanceof ApiError) || (e.status !== 403 && e.status !== 409)) throw e;
        t = await approve();
        r = await bap.pay(basket.id, t, simulateFailure, newIdempotencyKey());
      }
      if (r.status === "PAID" && !done.current) {
        done.current = true;
        onPaid(basket.id);
      } else if (r.status === "FAILED") {
        setStage("failed");
        setToken(null);
        setSimulateFailure(false);
        setError("Payment failed. You were not charged. Try again.");
      }
    } catch (e) {
      setStage("failed");
      setError(errorMessage(e));
    }
  }

  const busy = stage === "approving" || stage === "paying";
  const approved = !!token || stage === "paying";
  const total = formatINR(quote.grandTotalPaise);

  let actions: React.ReactNode;
  if (expired) {
    actions = (
      <>
        <Button variant="text" onClick={onClose}>Close</Button>
        <Button icon="refresh" loading={requoting} onClick={onRequote}>Get fresh quote</Button>
      </>
    );
  } else if (!approved && stage !== "failed") {
    actions = (
      <>
        <Button variant="text" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button icon="task_alt" loading={stage === "approving"} onClick={approveOnly}>Approve {total}</Button>
      </>
    );
  } else {
    actions = (
      <>
        <Button variant="text" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button icon="payments" loading={stage === "paying"} onClick={pay}>
          {stage === "paying" ? "Paying…" : stage === "failed" ? "Retry payment" : `Pay ${total}`}
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Approve and pay" fullScreenOnCompact dismissible={!busy} actions={actions}>
      <div className="space-y-5">
        {/* Expressive moment: the exact amount is the hero of this dialog. */}
        <div className="rounded-lg bg-primary-container px-5 py-4 text-on-primary-container">
          <p className="type-label-large">Exact total from your verified quote</p>
          <p className="type-display-small type-emphasized tabular-nums">{total}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusLabel tone={expired ? "error" : "neutral"} icon={expired ? "timer_off" : "schedule"} className="bg-surface/70">
              {expired ? "Quote expired" : <>Valid for <Countdown until={quote.validUntil} onDone={() => setExpiredNow(true)} /></>}
            </StatusLabel>
            <span className="type-body-small">
              {quote.stores.length} store{quote.stores.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <dl className="space-y-1 type-body-medium">
          {quote.stores.map((s) => (
            <div key={s.storeId} className="flex justify-between gap-3">
              <dt className="min-w-0 truncate">
                {s.storeName} <span className="text-on-surface-variant">· {itemsLabel(s.lines.reduce((n, l) => n + l.qty, 0))}{s.deliveryPaise ? ` + ${formatINR(s.deliveryPaise)} delivery` : ", free delivery"}</span>
              </dt>
              <dd className="tabular-nums text-on-surface">{formatINR(s.totalPaise)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3">
            <dt>Platform fee</dt>
            <dd className="tabular-nums text-on-surface">{formatINR(quote.platformFeePaise)}</dd>
          </div>
        </dl>

        {expired ? (
          <InlineMessage tone="warning">This quote has expired. Get a fresh one; stores will re-check prices and stock.</InlineMessage>
        ) : (
          <ol className="space-y-4" aria-label="Checkout steps">
            <Step n={1} done={approved} active={!approved} title={approved ? "Total approved" : "Approve this total"}>
              <p className="type-body-small text-on-surface-variant">Only you can approve. The assistant can never pay or confirm on your behalf.</p>
            </Step>
            <Step n={2} done={false} active={approved} title="Pay">
              <p className="type-body-small text-on-surface-variant">Payment is simulated. Stores get your order only after payment succeeds.</p>
              {stage === "paying" && <LinearProgress label="Waiting for payment confirmation" className="mt-2" />}
            </Step>
          </ol>
        )}

        {!expired && (
          <Checkbox checked={simulateFailure} disabled={busy} onChange={setSimulateFailure} label={<span className="type-body-medium">Simulate payment failure (demo)</span>} />
        )}
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
      </div>
    </Dialog>
  );
}
