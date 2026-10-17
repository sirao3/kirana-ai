import { useEffect, useState } from "react";
import { Button } from "../kit";
import { formatINR } from "../../lib/format";
import type { Offer } from "./types";

export const REJECT_REASONS = ["Out of stock", "Too busy right now", "Outside my delivery area", "Closing soon", "Other"];

/** Countdown ring: the arc drains from offeredAt to expiresAt; the number is whole seconds left. */
export function CountdownRing({ offeredAt, expiresAt, size = 48 }: { offeredAt: string; expiresAt: string; size?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(1, new Date(expiresAt).getTime() - new Date(offeredAt).getTime());
  const leftMs = Math.max(0, new Date(expiresAt).getTime() - now);
  const frac = Math.min(1, leftMs / total);
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const urgent = leftMs < 10_000;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`${Math.ceil(leftMs / 1000)} seconds left`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} className="stroke-stone-200" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
          className={urgent ? "stroke-rose-500" : "stroke-emerald-500"}
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums ${urgent ? "text-rose-600" : "text-stone-700"}`}>
        {Math.ceil(leftMs / 1000)}
      </span>
    </div>
  );
}

export function OfferCard({
  offer, hideActions, compact, tooLate, busy, onAccept, onReject,
}: {
  offer: Offer;
  /** `never_answer` fault: the store can't answer, so the offer will time out. */
  hideActions: boolean;
  compact: boolean;
  tooLate: boolean;
  busy: boolean;
  onAccept: () => void;
  onReject: (reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECT_REASONS[0]!);
  return (
    <article className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 shadow-sm" data-testid="offer-card">
      <div className="flex items-start gap-3">
        <CountdownRing offeredAt={offer.offeredAt} expiresAt={offer.expiresAt} size={compact ? 40 : 52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className="text-lg font-bold">{formatINR(offer.totalPaise)}</p>
            <p className="text-xs text-stone-600">{(offer.distanceM / 1000).toFixed(1)} km away</p>
          </div>
          <p className="text-xs text-stone-600">
            {offer.buyerName} · <span className="font-mono">{offer.buyerPhone}</span>
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {offer.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-2">
                <span className="truncate">{i.qty} × {i.name}</span>
                <span className="shrink-0 text-stone-600">{formatINR(i.unitPricePaise * i.qty)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-stone-500">
            Items {formatINR(offer.itemsTotalPaise)} + delivery {formatINR(offer.deliveryPaise)}
          </p>
        </div>
      </div>

      {tooLate ? (
        <p className="mt-2 rounded-md bg-stone-200 px-2 py-1.5 text-center text-sm font-medium text-stone-700">Too late — this offer is no longer available</p>
      ) : hideActions ? (
        <p className="mt-2 rounded-md bg-stone-100 px-2 py-1.5 text-center text-xs text-stone-600">Not answering (fault injection) — this offer will time out</p>
      ) : rejecting ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
            aria-label="Reject reason"
          >
            {REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <Button tone="danger" disabled={busy} onClick={() => onReject(reason)}>Reject</Button>
          <Button tone="ghost" disabled={busy} onClick={() => setRejecting(false)}>Back</Button>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={onAccept}>Accept</Button>
          <Button tone="secondary" className="flex-1" disabled={busy} onClick={() => setRejecting(true)}>Reject…</Button>
        </div>
      )}
    </article>
  );
}
