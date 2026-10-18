import { useEffect, useState } from "react";
import { formatINR } from "../../lib/format";
import { Button, cx, FilterChip, Icon, StatusLabel } from "../m3";
import { CountdownRing } from "../m3/CountdownRing";
import type { Offer } from "./types";

export const REJECT_REASONS = ["Out of stock", "Too busy right now", "Outside my delivery area", "Closing soon", "Other"];

/** Incoming offer: the merchant's most urgent decision, so it is the one elevated, emphasised card on the board. */
export function OfferCard({
  offer, hideActions, compact, tooLate, busy, onAccept, onReject, rejectRequest,
}: {
  offer: Offer;
  /** `never_answer` fault: the store can't answer, so the offer will time out. */
  hideActions: boolean;
  compact: boolean;
  tooLate: boolean;
  busy: boolean;
  onAccept: () => void;
  onReject: (reason: string) => void;
  /** Bumped by the parent (keyboard shortcut R) to open the reject reasons. */
  rejectRequest?: number;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECT_REASONS[0]!);
  useEffect(() => {
    if (rejectRequest) setRejecting(true);
  }, [rejectRequest]);
  return (
    <article
      className={cx("animate-scale-in rounded-lg bg-surface-container-lowest shadow-2 ring-2 ring-primary", compact ? "p-3" : "p-4")}
      data-testid="offer-card"
      aria-label={`New order offer, ${formatINR(offer.totalPaise)}`}
    >
      <div className="flex items-start gap-3">
        <CountdownRing offeredAt={offer.offeredAt} expiresAt={offer.expiresAt} size={compact ? 44 : 64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className={cx("tabular-nums text-on-surface", compact ? "type-title-large" : "type-headline-small type-emphasized")}>{formatINR(offer.totalPaise)}</p>
            <p className="flex items-center gap-1 type-body-small text-on-surface-variant">
              <Icon name="near_me" size={14} />
              {(offer.distanceM / 1000).toFixed(1)} km
            </p>
          </div>
          <p className="type-body-small text-on-surface-variant">
            {offer.buyerName} · <span className="font-mono">{offer.buyerPhone}</span>
          </p>
        </div>
      </div>
      <ul className={cx("space-y-0.5 type-body-medium", compact ? "mt-2" : "mt-3")}>
        {offer.items.map((i, k) => (
          <li key={k} className="flex justify-between gap-2">
            <span className="truncate text-on-surface">{i.qty} × {i.name}</span>
            <span className="shrink-0 tabular-nums text-on-surface-variant">{formatINR(i.unitPricePaise * i.qty)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 type-body-small text-on-surface-variant">
        Items {formatINR(offer.itemsTotalPaise)} + delivery {formatINR(offer.deliveryPaise)}
      </p>

      <div className="mt-3">
        {tooLate ? (
          <StatusLabel icon="timer_off" className="h-auto min-h-7 w-full justify-center whitespace-normal! py-1">Too late: this offer is no longer available</StatusLabel>
        ) : hideActions ? (
          <StatusLabel tone="warning" icon="phone_disabled" className="h-auto w-full justify-center whitespace-normal! py-1 text-left">Not answering (fault injection): this offer will time out</StatusLabel>
        ) : rejecting ? (
          <fieldset className="space-y-3">
            <legend className="mb-2 type-label-large text-on-surface">Why are you declining?</legend>
            <div className="flex flex-wrap gap-2">
              {REJECT_REASONS.map((r) => (
                <FilterChip key={r} selected={reason === r} onClick={() => setReason(r)}>{r}</FilterChip>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="text" disabled={busy} onClick={() => setRejecting(false)}>Back</Button>
              <Button variant="danger" icon="close" loading={busy} onClick={() => onReject(reason)}>Reject offer</Button>
            </div>
          </fieldset>
        ) : (
          <div className="flex gap-2">
            <Button variant="outlined" className="flex-1" disabled={busy} onClick={() => setRejecting(true)}>Reject…</Button>
            <Button className="flex-[2]" icon="check" size={compact ? "md" : "lg"} expressive loading={busy} onClick={onAccept}>Accept</Button>
          </div>
        )}
      </div>
    </article>
  );
}
