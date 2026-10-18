import { useEffect, useState } from "react";
import { formatINR } from "../../lib/format";
import { Button, Dialog, FilterChip, Icon, StatusLabel } from "../m3";
import { CountdownRing, REJECT_REASONS } from "./OfferCard";
import type { StoreState } from "./useStore";

/**
 * Compact-window offer takeover (UX-09): when an offer arrives the merchant gets a full-screen request, like a
 * ride-hailing app, wherever they are in the app. Closing it ("Later") leaves the offer on the Live board.
 * Rendered only below 600 px (the parent decides); wider windows use the cards on the board.
 */
export function OfferTakeover({ s }: { s: StoreState }) {
  const d = s.d;
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECT_REASONS[0]!);

  const offers = (d?.offers ?? []).filter((o) => !dismissed.has(o.id));
  const offer = offers[0];
  const silent = !!d?.store.faults.neverAnswer; // fault injection: the store can't answer, so no takeover either
  const open = !!offer && !silent;

  useEffect(() => {
    setRejecting(false);
  }, [offer?.id]);

  const close = () => offer && setDismissed((x) => new Set(x).add(offer.id));
  const busy = !!offer && s.busy === offer.id;
  const lateNow = !!offer && s.tooLate.has(offer.id);

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New order offer"
      fullScreenOnCompact
      actions={
        offer &&
        (lateNow ? (
          <Button variant="tonal" className="w-full" onClick={close}>Close</Button>
        ) : rejecting ? (
          <>
            <Button variant="text" disabled={busy} onClick={() => setRejecting(false)}>Back</Button>
            <Button variant="danger" icon="close" loading={busy} onClick={() => void s.reject(offer.id, reason)}>Reject offer</Button>
          </>
        ) : (
          <div className="flex w-full flex-col gap-2">
            <Button size="lg" icon="check" expressive className="w-full" loading={busy} onClick={() => void s.accept(offer.id)}>
              Accept
            </Button>
            <div className="flex gap-2">
              <Button variant="outlined" className="flex-1" disabled={busy} onClick={() => setRejecting(true)}>Reject…</Button>
              <Button variant="text" className="flex-1" disabled={busy} onClick={close}>Later</Button>
            </div>
          </div>
        ))
      }
    >
      {offer && (
        <div className="flex flex-col items-center gap-4 pb-2 text-center" data-testid="offer-takeover">
          <CountdownRing offeredAt={offer.offeredAt} expiresAt={offer.expiresAt} size={120} />
          <div>
            <p className="tabular-nums type-display-small type-emphasized text-on-surface">{formatINR(offer.totalPaise)}</p>
            <p className="mt-1 flex items-center justify-center gap-1 type-body-medium text-on-surface-variant">
              <Icon name="near_me" size={16} /> {(offer.distanceM / 1000).toFixed(1)} km · {offer.buyerName}
            </p>
          </div>
          <ul className="w-full space-y-1 rounded-lg bg-surface-container-low p-4 text-left type-body-medium">
            {offer.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-on-surface">{i.qty} × {i.name}</span>
                <span className="shrink-0 tabular-nums text-on-surface-variant">{formatINR(i.unitPricePaise * i.qty)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-outline-variant pt-2 text-on-surface-variant">
              <span>Delivery</span>
              <span className="tabular-nums">{formatINR(offer.deliveryPaise)}</span>
            </li>
          </ul>
          {lateNow && <StatusLabel icon="timer_off">Too late: this offer is no longer available</StatusLabel>}
          {rejecting && !lateNow && (
            <fieldset className="w-full text-left">
              <legend className="mb-2 type-label-large text-on-surface">Why are you declining?</legend>
              <div className="flex flex-wrap gap-2">
                {REJECT_REASONS.map((r) => (
                  <FilterChip key={r} selected={reason === r} onClick={() => setReason(r)}>{r}</FilterChip>
                ))}
              </div>
            </fieldset>
          )}
          {offers.length > 1 && <p className="type-label-large text-on-surface-variant">{offers.length - 1} more waiting</p>}
        </div>
      )}
    </Dialog>
  );
}
