import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { formatINR } from "../../lib/format";
import { Button, C, Money, Ring, cx, ease, soft, useNow } from "../ui";
import type { Offer } from "./types";
import type { StoreState } from "./useStore";

export const REJECT_REASONS = ["Out of stock", "Too busy right now", "Outside my delivery area", "Closing soon", "Other"];

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

/** The A / R shortcuts: A accepts the most urgent offer, R opens its decline reasons. Ignored while typing. */
export function offerShortcut(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null; preventDefault: () => void },
  s: StoreState,
  openReasons: () => void,
): void {
  const offer = s.d?.offers[0];
  if (e.ctrlKey || e.metaKey || e.altKey || !offer || s.d?.store.faults.neverAnswer) return;
  if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [role=dialog]")) return;
  if (s.busy === offer.id || s.tooLate.has(offer.id)) return;
  const k = e.key.toLowerCase();
  if (k === "a") {
    e.preventDefault();
    void s.accept(offer.id);
  } else if (k === "r") {
    e.preventDefault();
    openReasons();
  }
}

/** Single-choice reason chips. Declining needs an explicit reason, so nothing is preselected. */
export function ReasonPicker({ value, onChange, compact }: { value: string | null; onChange: (r: string) => void; compact?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold" style={{ color: C.label }}>Why are you declining?</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Reason">
        {REJECT_REASONS.map((r) => {
          const sel = value === r;
          return (
            <button key={r} type="button" role="radio" aria-checked={sel} onClick={() => onChange(r)}
              className={cx("cursor-pointer rounded-full px-3 font-medium transition-colors", compact ? "min-h-9 text-[13px]" : "min-h-11 text-[14px]")}
              style={sel ? { background: C.label, color: "#fff" } : { background: C.fill, color: C.label }}>
              {r}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Decline → reason → confirm, or Accept. Shared by the offer card and the phone takeover. */
export function OfferActions({ offer, s, reasonsOpen, setReasonsOpen, compact, stacked }: {
  offer: Offer; s: StoreState; reasonsOpen: boolean; setReasonsOpen: (o: boolean) => void; compact?: boolean; stacked?: boolean;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const busy = s.busy === offer.id;
  const size = compact ? "md" : "lg";
  useEffect(() => {
    if (!reasonsOpen) setReason(null);
  }, [reasonsOpen]);

  if (s.tooLate.has(offer.id)) {
    return <p className="text-[14px]" style={{ color: C.secondary }} role="status">Too late — this order went to another store.</p>;
  }
  if (s.d?.store.faults.neverAnswer) {
    return (
      <p className="text-[13px] leading-[1.45]" style={{ color: C.secondary }}>
        This store is set to never answer (demo fault), so the order will time out and move on.
      </p>
    );
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      {reasonsOpen ? (
        <motion.div key="reasons" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={ease} className="space-y-3">
          <ReasonPicker value={reason} onChange={setReason} compact={compact} />
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="secondary" size={size} disabled={busy} onClick={() => setReasonsOpen(false)}>Back</Button>
            <Button variant="danger" size={size} busy={busy} disabled={!reason} onClick={() => reason && void s.reject(offer.id, reason)}>Decline order</Button>
          </div>
        </motion.div>
      ) : (
        <motion.div key="answer" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={ease}
          className={stacked ? "flex flex-col-reverse gap-2" : "grid grid-cols-[1fr_2fr] gap-2"}>
          <Button variant="destructive" size={size} disabled={busy} onClick={() => setReasonsOpen(true)} aria-keyshortcuts="R">Decline</Button>
          <Button size={size} busy={busy} onClick={() => void s.accept(offer.id)} style={{ background: C.green }} aria-keyshortcuts="A">Accept</Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * An incoming order: the store's most urgent decision. Payout first, then what to pack and for whom, a countdown ring,
 * and one primary action. `compact` is the wall version.
 */
export function OfferCard({ offer, s, compact, rejectRequest }: {
  offer: Offer; s: StoreState; compact?: boolean;
  /** Bumped by the parent (shortcut R) to open the reasons. */
  rejectRequest?: number;
}) {
  const now = useNow(250);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  useEffect(() => {
    if (rejectRequest) setReasonsOpen(true);
  }, [rejectRequest]);
  const items = offer.items.map((i) => `${i.qty} × ${i.name}`).join(", ");

  return (
    <motion.article layout initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }} transition={soft}
      data-testid="offer-card" aria-label={`New order, you get ${formatINR(offer.totalPaise)}`}
      className={cx("bg-white", compact ? "rounded-[18px] p-3.5" : "rounded-[22px] p-5 sm:p-6")}
      style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.05), 0 14px 36px rgba(0,0,0,0.10)" }}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: "#C76A00" }}>New order · {km(offer.distanceM)}</p>
          <Money value={offer.totalPaise} className={cx("mt-1 block font-bold leading-none tracking-[-0.03em]", compact ? "text-[24px]" : "text-[34px]")} style={{ color: C.label }} />
          <p className={cx("mt-1.5 text-[13px]", !compact && "truncate")} style={{ color: C.secondary }}>
            {offer.buyerName} · <span style={{ fontVariantNumeric: "tabular-nums" }}>{offer.buyerPhone}</span>{!compact && " · paid upfront"}
          </p>
        </div>
        <Ring from={offer.offeredAt} until={offer.expiresAt} now={now} size={compact ? 36 : 52} />
      </div>

      {compact ? (
        <p className="mt-2.5 line-clamp-2 text-[13px] leading-[1.4]" style={{ color: C.label }}>{items}</p>
      ) : (
        <ul className="mt-4 text-[15px]" aria-label="Items">
          {offer.items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3 py-2" style={{ borderTop: `0.5px solid ${C.sep}` }}>
              <span className="min-w-0 truncate" style={{ color: C.label }}>{i.qty} × {i.name}</span>
              <span className="shrink-0" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>{formatINR(i.unitPricePaise * i.qty)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 py-2 text-[13px]" style={{ borderTop: `0.5px solid ${C.sep}`, color: C.secondary }}>
            <span>Delivery</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(offer.deliveryPaise)}</span>
          </li>
        </ul>
      )}

      <div className={compact ? "mt-3" : "mt-4"}>
        <OfferActions offer={offer} s={s} reasonsOpen={reasonsOpen} setReasonsOpen={setReasonsOpen} compact={compact} />
      </div>
    </motion.article>
  );
}
