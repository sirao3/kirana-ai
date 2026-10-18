import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BasketView, QuoteLineView, StoreQuoteError } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { Button, Countdown, EmptyState, Icon, IconButton, InlineMessage, QtyStepper, StatusLabel } from "../m3";
import { bap } from "./bap";
import { errorMessage } from "./errors";

export function quoteIsLive(b: BasketView): boolean {
  return b.status === "QUOTED" && !!b.quote && !b.quote.expired && new Date(b.quote.validUntil).getTime() > Date.now();
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex items-baseline justify-between pt-2 type-title-large text-on-surface" : "flex justify-between type-body-medium text-on-surface-variant"}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Basket grouped by store with quantity steppers. Once quoted, the same view shows verified prices,
 * per-store delivery, platform fee and the grand total with its validity countdown.
 */
export function BasketPanel({ basket, onCheckout, checkingOut, error, quoteErrors, confirmQty = false, confirmingQty = false, onConfirmQty, onEditQty }: {
  basket: BasketView;
  onCheckout: () => void;
  checkingOut: boolean;
  error: string | null;
  quoteErrors: StoreQuoteError[];
  /** Show the "Looks right / Edit" row because some quantities are still suggestions (UX-03). */
  confirmQty?: boolean;
  confirmingQty?: boolean;
  onConfirmQty?: () => void;
  onEditQty?: () => void;
}) {
  const qc = useQueryClient();
  const [expiredNow, setExpiredNow] = useState<string | null>(null);
  const live = quoteIsLive(basket) && expiredNow !== basket.quote?.id;
  const edit = useMutation({
    mutationFn: (op: { kind: "qty"; listingId: string; qty: number } | { kind: "remove"; listingId: string }) =>
      op.kind === "qty" ? bap.setQty(op.listingId, op.qty) : bap.remove(op.listingId),
    onSuccess: (b) => qc.setQueryData(["basket"], b),
  });
  const q = live ? basket.quote! : null;
  const quoteStore = (storeId: string) => q?.stores.find((s) => s.storeId === storeId);
  const quoteLine = (storeId: string, listingId: string): QuoteLineView | undefined => quoteStore(storeId)?.lines.find((l) => l.listingId === listingId);
  const subtotal = basket.stores.reduce((s, g) => s + g.itemsTotalPaise, 0);
  const suggested = basket.stores.reduce((n, g) => n + g.items.filter((i) => i.qtyInferred).length, 0);
  const confirmRef = useRef<HTMLDivElement>(null);
  const showConfirm = confirmQty && suggested > 0;
  useEffect(() => {
    if (showConfirm) confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showConfirm]);

  return (
    <section aria-labelledby="basket-title" className="flex flex-col">
      <header className="flex items-center justify-between gap-2 pb-3">
        <h2 id="basket-title" className="type-title-large text-on-surface">
          Basket{basket.itemCount > 0 && <span className="text-on-surface-variant"> · {basket.itemCount}</span>}
        </h2>
        {basket.itemCount > 0 &&
          (live ? (
            <StatusLabel tone="success" icon="verified">Verified prices</StatusLabel>
          ) : (
            <StatusLabel icon="sell">Catalogue prices</StatusLabel>
          ))}
      </header>

      {basket.stores.length === 0 ? (
        <EmptyState icon="shopping_basket" title="Your basket is empty">
          Ask the assistant for your weekly list, or search for products and add them here.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {quoteErrors.length > 0 && (
            <InlineMessage tone="error" title="Some stores could not confirm your items">
              <ul className="mt-1 space-y-0.5">
                {quoteErrors.map((e) => (
                  <li key={`${e.storeId}-${e.code}`}>
                    <b>{e.storeName}</b>: {e.message || e.code}
                  </li>
                ))}
              </ul>
              <p className="mt-1">Remove or change the affected items, then get the quote again.</p>
            </InlineMessage>
          )}

          {basket.stores.map((s) => {
            const qs = quoteStore(s.storeId);
            return (
              <div key={s.storeId} className="overflow-hidden rounded-md bg-surface-container-lowest">
                <div className="flex items-center gap-3 px-4 pb-1 pt-3">
                  <Icon name="storefront" size={20} className="text-primary" />
                  <span className="min-w-0 flex-1 truncate type-title-small text-on-surface">{s.storeName}</span>
                  <span className="type-body-small text-on-surface-variant">
                    {qs ? (qs.deliveryPaise ? `Delivery ${formatINR(qs.deliveryPaise)}` : "Free delivery") : "Delivery at quote"}
                  </span>
                </div>
                <ul>
                  {s.items.map((i) => {
                    const ql = quoteLine(s.storeId, i.listingId);
                    return (
                      <li key={i.listingId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                        <div className="min-w-0 basis-full">
                          <p className={ql && !ql.available ? "type-body-large text-error line-through" : "type-body-large text-on-surface"}>{i.name}</p>
                          <p className="type-body-small text-on-surface-variant">{formatINR(ql?.unitPricePaise ?? i.seenPricePaise)} each</p>
                          {i.reason && (
                            <p className="mt-0.5 flex items-start gap-1 type-body-small text-on-surface-variant">
                              <Icon name="lightbulb" size={16} className="mt-px shrink-0" />
                              <span>{i.reason}</span>
                            </p>
                          )}
                          {i.qtyInferred && (
                            <StatusLabel tone="info" icon="auto_awesome" className="mt-1">Suggested qty</StatusLabel>
                          )}
                          {ql?.priceChanged && (
                            <StatusLabel tone="warning" icon="trending_flat" className="mt-1">
                              Price changed {formatINR(ql.seenPricePaise)} → {formatINR(ql.unitPricePaise)}
                            </StatusLabel>
                          )}
                          {ql && !ql.available && <StatusLabel tone="error" icon="block" className="mt-1">Unavailable</StatusLabel>}
                        </div>
                        <QtyStepper label={`Quantity of ${i.name}`} value={i.qty} disabled={edit.isPending} onChange={(qty) => edit.mutate({ kind: "qty", listingId: i.listingId, qty })} />
                        <span className="ml-auto w-16 text-right type-label-large tabular-nums text-on-surface">{formatINR(ql?.lineTotalPaise ?? i.lineTotalPaise)}</span>
                        <IconButton icon="delete" label={`Remove ${i.name}`} size={32} disabled={edit.isPending} onClick={() => edit.mutate({ kind: "remove", listingId: i.listingId })} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {basket.planReasons && basket.planReasons.length > 0 && (
            <ul className="space-y-1 px-1" aria-label="Why these stores">
              {basket.planReasons.map((r) => (
                <li key={r} className="flex items-start gap-2 type-body-small text-on-surface-variant">
                  <Icon name="lightbulb" size={16} className="mt-px shrink-0 text-tertiary" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1 px-1">
            {q ? (
              <>
                <SummaryRow label="Items" value={formatINR(q.itemsTotalPaise)} />
                <SummaryRow label="Delivery" value={q.deliveryTotalPaise ? formatINR(q.deliveryTotalPaise) : "Free"} />
                <SummaryRow label="Platform fee" value={formatINR(q.platformFeePaise)} />
                <SummaryRow strong label="Total" value={formatINR(q.grandTotalPaise)} />
                <p className="flex items-center gap-1 type-body-small text-on-surface-variant">
                  <Icon name="schedule" size={16} /> Price held for <Countdown until={q.validUntil} onDone={() => setExpiredNow(q.id)} />
                </p>
              </>
            ) : (
              <>
                <SummaryRow strong label="Subtotal" value={formatINR(subtotal)} />
                <p className="type-body-small text-on-surface-variant">
                  Catalogue prices seen at search. Getting a quote asks every store to confirm price, stock and delivery.
                </p>
              </>
            )}
          </div>

          {(edit.error || error) && <InlineMessage tone="error">{error ?? errorMessage(edit.error)}</InlineMessage>}

          {showConfirm && (
            <div ref={confirmRef}>
            <InlineMessage
              tone="info"
              icon="auto_awesome"
              title={`We guessed ${suggested} quantit${suggested === 1 ? "y" : "ies"}`}
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="text" onClick={onEditQty} disabled={confirmingQty}>Edit</Button>
                  <Button size="sm" variant="tonal" icon="check" loading={confirmingQty} onClick={onConfirmQty}>Looks right</Button>
                </div>
              }
            >
              Check them above. Change a number or confirm to continue.
            </InlineMessage>
            </div>
          )}

          <Button className="w-full" icon={live ? "lock" : "verified"} loading={checkingOut} disabled={edit.isPending} onClick={onCheckout}>
            {checkingOut ? "Checking with stores…" : live ? `Review and pay ${formatINR(q!.grandTotalPaise)}` : "Get verified quote"}
          </Button>
        </div>
      )}
    </section>
  );
}
