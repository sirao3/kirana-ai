import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BasketView } from "@kiranaai/shared";
import { Badge, Button, Card } from "../kit";
import { formatINR } from "../../lib/format";
import { bap } from "./bap";
import { errorMessage } from "./errors";

export function quoteIsLive(b: BasketView): boolean {
  return b.status === "QUOTED" && !!b.quote && !b.quote.expired && new Date(b.quote.validUntil).getTime() > Date.now();
}

/** Basket grouped by store: qty steppers, remove, delivery per store, catalogue/verified badges. */
export function BasketPanel({ basket, onCheckout, checkingOut, error }: {
  basket: BasketView;
  onCheckout: () => void;
  checkingOut: boolean;
  error: string | null;
}) {
  const qc = useQueryClient();
  const live = quoteIsLive(basket);
  const edit = useMutation({
    mutationFn: (op: { kind: "qty"; listingId: string; qty: number } | { kind: "remove"; listingId: string }) =>
      op.kind === "qty" ? bap.setQty(op.listingId, op.qty) : bap.remove(op.listingId),
    onSuccess: (b) => qc.setQueryData(["basket"], b),
  });
  const quoteStore = (storeId: string) => (live ? basket.quote?.stores.find((s) => s.storeId === storeId) : undefined);

  return (
    <Card
      title={`Basket${basket.itemCount ? ` (${basket.itemCount})` : ""}`}
      actions={<Badge tone={live ? "good" : "neutral"}>{live ? "verified" : "catalogue"}</Badge>}
    >
      {basket.stores.length === 0 ? (
        <p className="text-sm text-stone-500">Your basket is empty. Ask the assistant, or search in the Manual tab.</p>
      ) : (
        <div className="space-y-4">
          {basket.stores.map((s) => {
            const q = quoteStore(s.storeId);
            return (
              <div key={s.storeId} className="rounded-lg border border-stone-200">
                <div className="flex items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2">
                  <span className="font-medium">{s.storeName}</span>
                  <span className="text-xs text-stone-600">
                    {q ? `Delivery ${q.deliveryPaise ? formatINR(q.deliveryPaise) : "free"}` : "Delivery shown at quote"}
                  </span>
                </div>
                <ul className="divide-y divide-stone-100">
                  {s.items.map((i) => (
                    <li key={i.listingId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{i.name}</div>
                        <div className="text-xs text-stone-500">{formatINR(i.seenPricePaise)} each</div>
                      </div>
                      <div className="flex items-center gap-1" aria-label={`Quantity of ${i.name}`}>
                        <button
                          className="h-7 w-7 rounded border border-stone-300 text-lg leading-none disabled:opacity-40"
                          disabled={i.qty <= 1 || edit.isPending}
                          onClick={() => edit.mutate({ kind: "qty", listingId: i.listingId, qty: i.qty - 1 })}
                          aria-label="Decrease"
                        >
                          −
                        </button>
                        <span className="w-6 text-center tabular-nums">{i.qty}</span>
                        <button
                          className="h-7 w-7 rounded border border-stone-300 text-lg leading-none disabled:opacity-40"
                          disabled={edit.isPending}
                          onClick={() => edit.mutate({ kind: "qty", listingId: i.listingId, qty: i.qty + 1 })}
                          aria-label="Increase"
                        >
                          +
                        </button>
                      </div>
                      <div className="w-16 text-right text-sm tabular-nums">{formatINR(i.lineTotalPaise)}</div>
                      <button
                        className="text-stone-400 hover:text-rose-600"
                        onClick={() => edit.mutate({ kind: "remove", listingId: i.listingId })}
                        aria-label={`Remove ${i.name}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between px-3 py-2 text-sm text-stone-600">
                  <span>Items</span>
                  <span className="tabular-nums">{formatINR(s.itemsTotalPaise)}</span>
                </div>
              </div>
            );
          })}
          {(edit.error || error) && <p role="alert" className="text-sm text-rose-700">{error ?? errorMessage(edit.error)}</p>}
          <Button className="w-full" disabled={checkingOut || edit.isPending} onClick={onCheckout}>
            {checkingOut ? "Getting verified prices…" : live ? "Checkout" : "Get verified quote"}
          </Button>
          <p className="text-xs text-stone-500">
            Prices here are catalogue prices seen at search. The quote re-checks every store and gives the final total.
          </p>
        </div>
      )}
    </Card>
  );
}
