import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BasketView, StoreQuoteError } from "@kiranaai/shared";
import { bap } from "./bap";
import { quoteIsLive } from "./BasketPanel";

export const hasSuggested = (b: BasketView | undefined) => !!b?.stores.some((s) => s.items.some((i) => i.qtyInferred));

/**
 * The one checkout path shared by the assistant and search: confirm suggested quantities → verified quote → pay sheet.
 * Opening the sheet is the furthest anything but the Pay button can go; approve and pay live in the sheet.
 */
export function useCheckout() {
  const qc = useQueryClient();
  const [quoteErrors, setQuoteErrors] = useState<StoreQuoteError[]>([]);
  const [payOpen, setPayOpen] = useState(false);

  const quote = useMutation({
    mutationFn: bap.quote,
    onSuccess: (r) => {
      qc.setQueryData(["basket"], r.basket);
      setQuoteErrors(r.errors);
      if (r.quote) setPayOpen(true);
    },
  });

  function proceed(b: BasketView | undefined) {
    if (b && quoteIsLive(b)) setPayOpen(true);
    else quote.mutate();
  }

  const confirm = useMutation({
    mutationFn: bap.confirmQty,
    onSuccess: (b) => {
      qc.setQueryData(["basket"], b);
      proceed(b);
    },
  });

  return {
    quoteErrors,
    clearErrors: () => setQuoteErrors([]),
    payOpen,
    closePay: () => setPayOpen(false),
    busy: quote.isPending || confirm.isPending,
    error: quote.error ?? confirm.error,
    requote: () => quote.mutate(),
    requoting: quote.isPending,
    /** The primary button: confirm suggested quantities first, then quote (or open the sheet on a live quote). */
    primary(b: BasketView | undefined) {
      if (hasSuggested(b)) confirm.mutate();
      else proceed(b);
    },
    /** An agent `approval_requested` event: open the sheet only once no quantity is still a suggestion. */
    async agentAskedForApproval() {
      await qc.invalidateQueries({ queryKey: ["basket"] });
      const b = qc.getQueryData<BasketView>(["basket"]);
      if (!hasSuggested(b)) proceed(b);
    },
  };
}

export type Checkout = ReturnType<typeof useCheckout>;
