import { useEffect, useRef, useState } from "react";
import type { BasketView } from "@kiranaai/shared";
import { ApiError } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { useLive } from "../../lib/live";
import { Badge, Button, Card, Countdown } from "../kit";
import { bap, newIdempotencyKey } from "./bap";
import { errorMessage } from "./errors";

type Stage = "review" | "approving" | "approved" | "paying" | "failed";

/**
 * Exact total → Approve → Pay. The total is always the API quote, never agent text.
 * Only these buttons call approve/pay; the agent has no route to them.
 */
export function ApprovalCard({ basket, onClose, onPaid, onRequote }: {
  basket: BasketView;
  onClose: () => void;
  onPaid: (basketId: string) => void;
  onRequote: () => void;
}) {
  const quote = basket.quote;
  const [stage, setStage] = useState<Stage>("review");
  const [token, setToken] = useState<string | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiredNow, setExpiredNow] = useState(false);
  const done = useRef(false);

  const expired = !quote || quote.expired || expiredNow || basket.status === "EXPIRED";

  // After pay, poll the order until payment settles (PAID → tracker, FAILED → retry).
  const order = useLive(["pay-order", basket.id], () => bap.order(basket.id), { enabled: stage === "paying" });
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

  return (
    <Card
      title="Approve and pay"
      className="border-emerald-300 ring-2 ring-emerald-200"
      actions={
        <button className="text-sm text-stone-500 hover:text-stone-800" onClick={onClose} disabled={busy}>
          Close
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-sm text-stone-600">Exact total from your verified quote</div>
          <div className="text-3xl font-bold tabular-nums">{formatINR(quote.grandTotalPaise)}</div>
          <div className="text-xs text-stone-500">
            {quote.stores.length} store{quote.stores.length === 1 ? "" : "s"} · items {formatINR(quote.itemsTotalPaise)} · delivery{" "}
            {formatINR(quote.deliveryTotalPaise)} · fee {formatINR(quote.platformFeePaise)}
          </div>
          {!expired && (
            <div className="mt-1 text-xs text-stone-500">
              Quote valid for <Countdown until={quote.validUntil} onDone={() => setExpiredNow(true)} />
            </div>
          )}
        </div>

        {expired ? (
          <div className="space-y-2">
            <p className="text-sm text-amber-800">This quote has expired. Get a fresh one to continue.</p>
            <Button className="w-full" onClick={onRequote}>Get fresh quote</Button>
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={simulateFailure} disabled={busy} onChange={(e) => setSimulateFailure(e.target.checked)} />
              Simulate payment failure (demo)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button tone={token ? "secondary" : "primary"} disabled={busy || !!token} onClick={approveOnly}>
                {stage === "approving" ? "Approving…" : token ? "Approved" : "Approve"}
              </Button>
              <Button disabled={busy || (!token && stage !== "failed")} onClick={pay}>
                {stage === "paying" ? "Paying…" : stage === "failed" ? "Retry payment" : `Pay ${formatINR(quote.grandTotalPaise)}`}
              </Button>
              {token && <Badge tone="info">approved</Badge>}
            </div>
            <p className="text-xs text-stone-500">Payment is simulated. Stores only get your order after payment succeeds.</p>
          </>
        )}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
      </div>
    </Card>
  );
}
