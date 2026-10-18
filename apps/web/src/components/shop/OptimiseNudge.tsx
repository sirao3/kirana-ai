import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BasketView, PlanResult } from "@kiranaai/shared";
import { AssistChip, Button, CircularProgress, InlineMessage } from "../m3";
import { bap } from "./bap";
import { errorMessage } from "./errors";
import { basketToNeeds, nudgeFrom, type Nudge } from "./pricing";

/** Signature of the lines a plan was computed for: any edit invalidates a stale suggestion. */
const signature = (b: BasketView) => b.stores.flatMap((s) => s.items.map((i) => `${i.listingId}:${i.qty}`)).sort().join("|");

/**
 * Assist chip for a basket that spans several stores. Runs the optimiser on the current lines and shows the saving
 * the plan API reports (never an estimate made here), with Apply / Dismiss.
 */
export function OptimiseNudge({ basket }: { basket: BasketView }) {
  const qc = useQueryClient();
  const [done, setDone] = useState<{ sig: string; plan: PlanResult } | null>(null);
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);
  const sig = signature(basket);

  const run = useMutation({
    mutationFn: () =>
      bap.plan(basketToNeeds(basket), undefined, basket.stores.flatMap((s) => s.items.map((i) => ({ listingId: i.listingId, qty: i.qty })))),
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

  if (run.isPending) {
    return (
      <p role="status" className="flex min-h-12 items-center gap-2 type-body-medium text-on-surface-variant">
        <CircularProgress size={20} label="Checking" /> Comparing store combinations…
      </p>
    );
  }
  if (current && nudge) {
    return (
      <InlineMessage
        tone="info"
        icon="savings"
        title={nudge.text}
      >
        <p>Based on catalogue prices and each store&rsquo;s delivery charge. The verified quote has the exact total.</p>
        {apply.error && <p className="mt-1 text-error">{errorMessage(apply.error)}</p>}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="text" disabled={apply.isPending} onClick={() => setDismissedSig(sig)}>Dismiss</Button>
          <Button size="sm" variant="tonal" icon="check" loading={apply.isPending} onClick={() => apply.mutate(nudge)}>Apply</Button>
        </div>
      </InlineMessage>
    );
  }
  return (
    <div className="space-y-2">
      <AssistChip icon="auto_fix_high" onClick={() => run.mutate()} className="min-h-12">Optimise this basket</AssistChip>
      {current && !nudge && <p role="status" className="type-body-small text-on-surface-variant">This is already the cheapest mix of stores.</p>}
      {run.error && <InlineMessage tone="error">{errorMessage(run.error)}</InlineMessage>}
    </div>
  );
}
