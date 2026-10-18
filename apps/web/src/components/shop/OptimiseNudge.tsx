import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BasketView, PlanResult } from "@kiranaai/shared";
import { C, ISliders, Spinner, ease } from "../ui";
import { Button } from "../ui";
import { bap } from "./bap";
import { errorMessage } from "./errors";
import { basketToNeeds, nudgeFrom, type Nudge } from "./pricing";
import { LINK } from "./tokens";

/** Signature of the lines a plan was computed for: any edit invalidates a stale suggestion. */
const signature = (b: BasketView) => b.stores.flatMap((s) => s.items.map((i) => `${i.listingId}:${i.qty}`)).sort().join("|");

/**
 * For a basket that spans several stores: runs the optimiser on the current lines and shows the saving the plan API
 * reports (never an estimate made here), with Apply / Not now.
 */
export function OptimiseNudge({ basket }: { basket: BasketView }) {
  const qc = useQueryClient();
  const [done, setDone] = useState<{ sig: string; plan: PlanResult } | null>(null);
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);
  const sig = signature(basket);

  const run = useMutation({
    mutationFn: () => bap.plan(basketToNeeds(basket), undefined, basket.stores.flatMap((s) => s.items.map((i) => ({ listingId: i.listingId, qty: i.qty })))),
    onSuccess: (plan) => setDone({ sig, plan }),
  });
  const apply = useMutation({
    mutationFn: (n: Nudge) => bap.replace(n.items, done?.plan.reasons),
    onSuccess: (b) => {
      qc.setQueryData(["basket"], b);
      setDone(null);
    },
  });

  if (basket.stores.length < 2 || dismissedSig === sig) return null;
  const current = done && done.sig === sig ? done.plan : null;
  const nudge = current ? nudgeFrom(basket, current) : null;

  return (
    <div className="mt-3 border-t-[0.5px] pt-3" style={{ borderColor: C.sep }} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {nudge ? (
          <motion.div key="nudge" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={ease}>
            <p className="text-[14px] font-semibold" style={{ color: C.green }}>{nudge.text}</p>
            <p className="mt-0.5 text-[12px]" style={{ color: C.secondary }}>From catalogue prices and each store's delivery charge. The verified total is exact.</p>
            {apply.error && <p role="alert" className="mt-1 text-[13px]" style={{ color: C.red }}>{errorMessage(apply.error)}</p>}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" busy={apply.isPending} onClick={() => apply.mutate(nudge)}>Apply</Button>
              <Button size="sm" variant="secondary" disabled={apply.isPending} onClick={() => setDismissedSig(sig)}>Not now</Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={ease}>
            <button type="button" onClick={() => run.mutate()} disabled={run.isPending}
              className="-mx-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-1 text-[14px] font-semibold disabled:cursor-default" style={{ color: LINK }}>
              {run.isPending ? <Spinner size={15} color={LINK} /> : <ISliders size={17} />}
              {run.isPending ? "Comparing store combinations…" : "Optimise this basket"}
            </button>
            {current && !nudge && <p className="text-[12px]" style={{ color: C.secondary }}>This is already the cheapest mix of stores.</p>}
            {run.error && <p role="alert" className="text-[13px]" style={{ color: C.red }}>{errorMessage(run.error)}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
