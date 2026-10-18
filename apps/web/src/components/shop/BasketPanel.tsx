import { useId } from "react";
import { motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BasketView, StoreQuoteError } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { C, IMinus, IPlus, ISpark, ITrash, Money, Spinner, cardShadow, soft } from "../ui";
import { bap } from "./bap";
import { errorMessage } from "./errors";
import { OptimiseNudge } from "./OptimiseNudge";
import { hasSuggested, type Checkout } from "./useCheckout";
import { DANGER } from "./tokens";

export function quoteIsLive(b: BasketView): boolean {
  return b.status === "QUOTED" && !!b.quote && !b.quote.expired && new Date(b.quote.validUntil).getTime() > Date.now();
}

/** What the customer would pay now: the live quote, else the catalogue subtotal. */
export const basketTotal = (b: BasketView) => (b.quote && quoteIsLive(b) ? b.quote.grandTotalPaise : b.stores.reduce((t, s) => t + s.itemsTotalPaise, 0));

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The basket as one white card: total first, then each store with its lines. Lines carry the optimiser's reason and a
 * "suggested" marker until the customer confirms; steppers change packs (− at one pack removes the line).
 * After a quote the same card shows verified per-store totals, delivery, unavailable lines and price changes.
 */
export function BasketPanel({ basket, now, quoteErrors, editable = true, bare = false }: {
  basket: BasketView; now: number; quoteErrors: StoreQuoteError[]; editable?: boolean;
  /** Inside a sheet: no card of its own. */
  bare?: boolean;
}) {
  const qc = useQueryClient();
  const titleId = useId();
  const live = quoteIsLive(basket);
  const q = live ? basket.quote : null;
  const suggested = basket.stores.reduce((n, g) => n + g.items.filter((i) => i.qtyInferred).length, 0);
  const edit = useMutation({
    mutationFn: (op: { listingId: string; qty: number }) => (op.qty < 1 ? bap.remove(op.listingId) : bap.setQty(op.listingId, op.qty)),
    onSuccess: (b) => qc.setQueryData(["basket"], b),
  });

  return (
    <motion.section layout aria-labelledby={titleId} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={soft}
      className="bg-white" style={bare ? undefined : { borderRadius: 22, padding: 18, boxShadow: cardShadow }}>
      <div role="status" aria-live="polite" className="sr-only">{q ? `Verified total ${formatINR(q.grandTotalPaise)}.` : ""}</div>
      <h2 id={titleId} className="text-[13px] font-medium" style={{ color: C.secondary }}>
        {live ? "Verified with every store" : `Your basket · ${basket.itemCount} item${basket.itemCount === 1 ? "" : "s"} from ${basket.stores.length} store${basket.stores.length === 1 ? "" : "s"}`}
      </h2>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <Money value={basketTotal(basket)} className="text-[34px] font-bold leading-none tracking-[-0.03em]" style={{ color: C.label }} />
        {q ? (
          <span className="text-[12px]" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>Price held {mmss(new Date(q.validUntil).getTime() - now)}</span>
        ) : <span className="text-[12px]" style={{ color: C.secondary }}>+ delivery, confirmed at quote</span>}
      </div>
      {q && (
        <p className="mt-1 text-[12px]" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>
          Items {formatINR(q.itemsTotalPaise)} · delivery {q.deliveryTotalPaise ? formatINR(q.deliveryTotalPaise) : "free"} · platform fee {formatINR(q.platformFeePaise)}
        </p>
      )}

      <motion.div initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } }} className="mt-4">
        {basket.stores.map((g, i) => {
          const qs = q?.stores.find((s) => s.storeId === g.storeId);
          const err = quoteErrors.find((e) => e.storeId === g.storeId);
          return (
            <motion.div key={g.storeId} layout="position" variants={{ h: { opacity: 0, y: 10 }, s: { opacity: 1, y: 0 } }} transition={soft} className="py-3"
              style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined, paddingTop: i ? undefined : 0 }}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-[15px] font-semibold" style={{ color: C.label }}>{g.storeName}</h3>
                <span className="text-[15px] font-semibold" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{formatINR(qs ? qs.totalPaise : g.itemsTotalPaise)}</span>
              </div>
              {qs && <p className="text-[12px]" style={{ color: C.secondary }}>{qs.deliveryPaise ? `includes ${formatINR(qs.deliveryPaise)} delivery` : "Free delivery"}</p>}
              {err && <p role="alert" className="mt-0.5 text-[13px]" style={{ color: DANGER }}>{err.message || err.code.replace(/_/g, " ").toLowerCase()}. Change or remove these items, then get the total again.</p>}
              <ul className="mt-1">
                {g.items.map((it) => {
                  const ql = qs?.lines.find((l) => l.listingId === it.listingId);
                  const gone = ql && !ql.available;
                  return (
                    <li key={it.listingId} className="flex items-center gap-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] leading-[1.35]" style={{ color: gone ? DANGER : C.label, textDecoration: gone ? "line-through" : undefined }}>
                          {it.name}
                          {it.qtyInferred && <span className="ml-1.5 text-[12px] font-semibold" style={{ color: "#B25E00" }}>suggested</span>}
                        </p>
                        {it.reason && <p className="mt-0.5 flex items-start gap-1 text-[12px] leading-[1.35]" style={{ color: C.secondary }}><span className="mt-px shrink-0" style={{ color: C.tertiary }}><ISpark size={12} /></span>{it.reason}</p>}
                        {gone && <p className="text-[12px]" style={{ color: DANGER }}>Unavailable at this store</p>}
                        {ql?.priceChanged && <p className="text-[12px]" style={{ color: "#B25E00" }}>Price changed {formatINR(ql.seenPricePaise)} → {formatINR(ql.unitPricePaise)}</p>}
                      </div>
                      {editable ? (
                        <Qty name={it.name} value={it.qty} disabled={edit.isPending} onChange={(qty) => edit.mutate({ listingId: it.listingId, qty })} />
                      ) : <span className="text-[14px]" style={{ color: C.secondary }}>{it.qty}×</span>}
                      <span className="w-[58px] text-right text-[14px]" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{formatINR(ql?.lineTotalPaise ?? it.lineTotalPaise)}</span>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          );
        })}
      </motion.div>

      {basket.planReasons && basket.planReasons.length > 0 && (
        <ul aria-label="Why these stores" className="mt-1 space-y-1">
          {basket.planReasons.map((r) => (
            <li key={r} className="flex items-start gap-1.5 text-[12px] leading-[1.4]" style={{ color: C.secondary }}><span className="mt-px shrink-0" style={{ color: C.tertiary }}><ISpark size={12} /></span>{r}</li>
          ))}
        </ul>
      )}
      {editable && !live && <OptimiseNudge basket={basket} />}
      {edit.error && <p role="alert" className="mt-2 text-[13px]" style={{ color: DANGER }}>{errorMessage(edit.error)}</p>}
      {suggested > 0 && (
        <p className="mt-3 text-[13px] leading-[1.4]" style={{ color: C.secondary }}>
          We guessed {suggested} quantit{suggested === 1 ? "y" : "ies"}. Check {suggested === 1 ? "it" : "them"}, then confirm below.
        </p>
      )}
    </motion.section>
  );
}

/** − n + for pack counts; at one pack the minus becomes a remove. Kept local: the kit Stepper has no remove state. */
function Qty({ name, value, onChange, disabled }: { name: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const btn = "flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] transition-colors hover:bg-black/[0.05] disabled:cursor-default disabled:opacity-35";
  return (
    <span role="group" aria-label={`Quantity of ${name}`} className="inline-flex shrink-0 items-center rounded-[11px]" style={{ background: C.fill }}>
      <button type="button" className={btn} aria-label={value <= 1 ? `Remove ${name}` : `Fewer: ${name}`} disabled={disabled} onClick={() => onChange(value - 1)} style={{ color: value <= 1 ? DANGER : C.label }}>
        {value <= 1 ? <ITrash size={15} /> : <IMinus size={15} />}
      </button>
      <span className="min-w-5 text-center text-[14px] font-semibold" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <button type="button" className={btn} aria-label={`More: ${name}`} disabled={disabled || value >= 99} onClick={() => onChange(value + 1)} style={{ color: C.label }}><IPlus size={15} /></button>
    </span>
  );
}

/** The one primary action under the basket: Quantities look right → Get verified total → Pay ₹X. */
export function CheckoutButton({ basket, checkout }: { basket: BasketView; checkout: Checkout }) {
  const suggested = hasSuggested(basket);
  const label = suggested ? "Quantities look right" : quoteIsLive(basket) ? `Pay ${formatINR(basket.quote!.grandTotalPaise)}` : "Get verified total";
  return (
    <div>
      {checkout.error && <p role="alert" className="mb-2 text-[13px]" style={{ color: DANGER }}>{errorMessage(checkout.error)}</p>}
      <motion.button type="button" onClick={() => checkout.primary(basket)} disabled={checkout.busy} aria-busy={checkout.busy || undefined} whileTap={checkout.busy ? undefined : { scale: 0.97 }} transition={soft}
        className="flex h-[54px] w-full cursor-pointer items-center justify-center gap-2 text-[17px] font-semibold text-white disabled:cursor-default" style={{ background: C.label, borderRadius: 16 }}>
        {checkout.busy ? <><Spinner size={20} color="#fff" /><span className="sr-only">Checking with stores</span></> : label}
      </motion.button>
    </div>
  );
}
