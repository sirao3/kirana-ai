import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { formatINR, secondsUntil } from "../../lib/format";
import { Button, C, FONT, Money, Ring, sheet, useNow } from "../ui";
import { OfferActions } from "./OfferCard";
import type { StoreState } from "./useStore";

/**
 * Phones: an incoming order takes over the screen the way an incoming call does — a big countdown ring, the payout,
 * Accept and Decline. "Later" (or Esc) leaves it on the Live list. Not shown for a store set to never answer.
 * Local full-screen dialog rather than the kit Sheet: the kit Sheet tops out at 92 % height with a title bar.
 */
export function OfferTakeover({ s }: { s: StoreState }) {
  const d = s.d;
  const now = useNow(250);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);

  const offers = (d?.offers ?? []).filter((o) => !dismissed.has(o.id));
  const offer = offers[0];
  const open = !!offer && !d?.store.faults.neverAnswer;
  const later = () => offer && setDismissed((x) => new Set(x).add(offer.id));
  const laterRef = useRef(later);
  laterRef.current = later;

  useEffect(() => setReasonsOpen(false), [offer?.id]);

  // Focus moves in on open (to Accept), Tab stays inside, Esc means Later, focus returns on close.
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement;
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>("[aria-keyshortcuts='A']")?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") laterRef.current();
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href]")];
        if (!f.length) return;
        const [a, z] = [f[0]!, f[f.length - 1]!];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); (back.current as HTMLElement | null)?.focus?.(); };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && offer && (
        <motion.div ref={panel} key="takeover" role="dialog" aria-modal="true" aria-label="New order" data-testid="offer-takeover"
          initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={sheet}
          className="fixed inset-0 z-[70] flex flex-col bg-white" style={{ fontFamily: FONT, color: C.label, paddingBottom: "env(safe-area-inset-bottom)" }}>
          <header className="flex h-14 shrink-0 items-center justify-between pl-5 pr-2">
            <p className="text-[13px] font-semibold uppercase tracking-[0.04em]" style={{ color: "#C76A00" }}>
              New order{offers.length > 1 ? ` · ${offers.length - 1} more waiting` : ""}
            </p>
            <Button variant="plain" onClick={later}>Later</Button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-2 text-center">
            <span className="relative inline-flex">
              <Ring from={offer.offeredAt} until={offer.expiresAt} now={now} size={136} label={false} />
              <span className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
                <span className="text-[40px] font-semibold leading-none tracking-[-0.02em]" style={{ fontVariantNumeric: "tabular-nums" }}>{secondsUntil(offer.expiresAt, now)}</span>
                <span className="mt-1 text-[12px]" style={{ color: C.secondary }}>seconds</span>
              </span>
            </span>
            <p className="mt-6 text-[15px]" style={{ color: C.secondary }}>You get</p>
            <Money value={offer.totalPaise} className="block text-[48px] font-bold leading-[1.05] tracking-[-0.035em]" />
            <p className="mt-2 text-[15px]" style={{ color: C.secondary }}>
              {offer.buyerName} · <span style={{ fontVariantNumeric: "tabular-nums" }}>{offer.buyerPhone}</span> · {(offer.distanceM / 1000).toFixed(1)} km
            </p>
            <ul className="mt-6 w-full max-w-sm text-left text-[15px]" aria-label="Items">
              {offer.items.map((i, k) => (
                <li key={k} className="flex justify-between gap-3 py-2.5" style={{ borderTop: `0.5px solid ${C.sep}` }}>
                  <span className="min-w-0 truncate">{i.qty} × {i.name}</span>
                  <span className="shrink-0" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>{formatINR(i.unitPricePaise * i.qty)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 py-2.5 text-[13px]" style={{ borderTop: `0.5px solid ${C.sep}`, color: C.secondary }}>
                <span>Delivery · paid upfront</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(offer.deliveryPaise)}</span>
              </li>
            </ul>
          </div>

          <div className="shrink-0 px-5 pb-5 pt-3">
            <OfferActions offer={offer} s={s} reasonsOpen={reasonsOpen} setReasonsOpen={setReasonsOpen} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
