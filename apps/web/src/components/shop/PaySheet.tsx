import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { BasketView } from "@kiranaai/shared";
import { ApiError } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { C, CheckDraw, Checkbox, Money, Sheet, Spinner, soft, spring } from "../ui";
import { bap, newIdempotencyKey } from "./bap";
import { mmss, quoteIsLive } from "./BasketPanel";
import { errorMessage } from "./errors";
import { DANGER, LINK } from "./tokens";

type Stage = "idle" | "paying" | "done";
const packs = (n: number) => `${n} pack${n === 1 ? "" : "s"}`;

/**
 * Approve and pay, in one sheet with one button. The amount is the API quote, never agent text, and only this button
 * calls approve + pay (a used or expired approval is re-approved once). The button contracts into a spinner, then a check.
 */
export function PaySheet({ open, basket: polled, now, onClose, onRequote, requoting, onPaid }: {
  open: boolean;
  basket: BasketView | undefined;
  now: number;
  onClose: () => void;
  onRequote: () => void;
  requoting: boolean;
  onPaid: (basketId: string) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [failNext, setFailNext] = useState(false);
  // Once paying starts the polled basket moves on (a fresh draft); keep showing the one being paid.
  const held = useRef(polled);
  if (stage === "idle" && polled?.quote) held.current = polled;
  const basket = held.current;
  const quote = basket?.quote ?? null;

  // A fresh quote (or reopening) starts over.
  useEffect(() => {
    if (!open) return;
    setStage("idle");
    setError(null);
  }, [quote?.id, open]);

  const expired = !basket || !quote || !quoteIsLive(basket) || new Date(quote.validUntil).getTime() <= now;

  async function settle(basketId: string): Promise<"PAID" | "FAILED"> {
    // The simulated provider may answer INITIATED first; the order view says when it settles.
    for (let i = 0; i < 30; i++) {
      const o = await bap.order(basketId);
      if (o.paymentStatus === "PAID" || o.paymentStatus === "FAILED") return o.paymentStatus;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Payment is taking longer than usual. Check Orders in a moment.");
  }

  async function pay() {
    if (!basket || !quote) return;
    setError(null);
    setStage("paying");
    try {
      let token = (await bap.approve(basket.id, quote.quoteHash)).approvalToken;
      let r;
      try {
        r = await bap.pay(basket.id, token, failNext, newIdempotencyKey());
      } catch (e) {
        if (!(e instanceof ApiError) || (e.status !== 403 && e.status !== 409)) throw e;
        token = (await bap.approve(basket.id, quote.quoteHash)).approvalToken;
        r = await bap.pay(basket.id, token, failNext, newIdempotencyKey());
      }
      const status = r.status === "INITIATED" ? await settle(basket.id) : r.status;
      if (status === "FAILED") {
        setStage("idle");
        setFailNext(false);
        setError("Payment failed. You were not charged. Try again.");
        return;
      }
      setStage("done");
      setTimeout(() => onPaid(basket.id), 900);
    } catch (e) {
      setStage("idle");
      setError(e instanceof ApiError && (e.status === 403 || e.status === 409) ? "The quote changed or expired. Get a fresh total." : errorMessage(e));
    }
  }

  const done = stage === "done";
  return (
    <Sheet open={open && !!quote} onClose={onClose} title="Approve and pay" dismissible={stage === "idle"} width={460}>
      {quote && (
        <div>
          <div role="status" aria-live="polite" className="sr-only">{done ? `Paid ${formatINR(quote.grandTotalPaise)}.` : stage === "paying" ? "Paying." : ""}</div>
          <p className="text-center text-[13px] font-medium" style={{ color: C.secondary }}>{done ? "Paid by UPI" : "Exact total"}</p>
          <Money value={quote.grandTotalPaise} className="mt-1 block text-center text-[46px] font-bold leading-[1.1] tracking-[-0.03em]" style={{ color: C.label }} />
          <p className="mt-1 text-center text-[13px]" style={{ color: expired && !done ? DANGER : C.secondary, fontVariantNumeric: "tabular-nums" }}>
            {done ? "Sending your order to the stores" : expired ? "This quote has expired" : `Verified with each store · held for ${mmss(new Date(quote.validUntil).getTime() - now)}`}
          </p>
          <ul className="mt-5" style={{ borderTop: `0.5px solid ${C.sep}` }}>
            {quote.stores.map((s) => (
              <li key={s.storeId} className="flex justify-between gap-3 py-2.5 text-[15px]" style={{ borderBottom: `0.5px solid ${C.sep}`, color: C.label }}>
                <span className="min-w-0">
                  {s.storeName}
                  <span className="block text-[12px]" style={{ color: C.secondary }}>{packs(s.lines.reduce((n, l) => n + l.qty, 0))} · {s.deliveryPaise ? `${formatINR(s.deliveryPaise)} delivery` : "free delivery"}</span>
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(s.totalPaise)}</span>
              </li>
            ))}
            <li className="flex justify-between py-2.5 text-[15px]" style={{ borderBottom: `0.5px solid ${C.sep}`, color: C.secondary }}>
              <span>Platform fee</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(quote.platformFeePaise)}</span>
            </li>
          </ul>
          <p className="mt-3 text-[13px] leading-[1.45]" style={{ color: C.secondary }}>Only you can approve. The assistant can't pay or confirm on your behalf. Payment is simulated; stores get the order once it succeeds.</p>
          {error && <p role="alert" className="mt-2 text-[14px]" style={{ color: DANGER }}>{error}</p>}

          <div className="mt-5 flex justify-center">
            {expired && !done ? (
              <motion.button type="button" onClick={onRequote} disabled={requoting} aria-busy={requoting || undefined} whileTap={{ scale: 0.97 }} transition={soft}
                className="flex h-[54px] w-full cursor-pointer items-center justify-center text-[17px] font-semibold text-white" style={{ background: C.label, borderRadius: 27 }}>
                {requoting ? <Spinner size={20} color="#fff" /> : "Get a fresh total"}
              </motion.button>
            ) : (
              <motion.button type="button" layout onClick={stage === "idle" ? () => void pay() : undefined} whileTap={stage === "idle" ? { scale: 0.97 } : undefined} transition={soft}
                aria-busy={stage === "paying" || undefined} aria-label={stage === "idle" ? undefined : done ? "Paid" : "Paying"}
                className="flex h-[54px] cursor-pointer items-center justify-center overflow-hidden text-[17px] font-semibold text-white"
                style={{ background: done ? C.green : C.label, borderRadius: 27, width: stage === "idle" ? "100%" : 54 }}>
                <AnimatePresence mode="popLayout" initial={false}>
                  {done ? <motion.span key="ok" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring}><CheckDraw size={26} ring={false} color="#fff" /></motion.span>
                    : stage === "paying" ? <motion.span key="spin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Spinner size={22} color="#fff" /></motion.span>
                    : <motion.span key="txt" exit={{ opacity: 0 }} className="whitespace-nowrap">Approve and pay {formatINR(quote.grandTotalPaise)}</motion.span>}
                </AnimatePresence>
              </motion.button>
            )}
          </div>
          {stage === "idle" && !expired && (
            <div className="mt-1 flex items-center justify-between gap-3">
              <Checkbox checked={failNext} onChange={setFailNext} label={<span className="text-[13px]" style={{ color: C.secondary }}>Simulate a failed payment</span>} />
              <button type="button" onClick={onClose} className="min-h-11 cursor-pointer px-1 text-[15px]" style={{ color: LINK }}>Not now</button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
