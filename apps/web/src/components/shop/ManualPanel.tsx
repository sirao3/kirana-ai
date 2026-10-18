import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BasketView, PlanResult, SearchResponse } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import {
  Button, Card, CircularProgress, EmptyState, Icon, IconButton, InlineMessage, InputChip, QtyStepper, SearchBar, StatusLabel, TextField, useSnackbar,
} from "../m3";
import { bap } from "./bap";
import { errorMessage } from "./errors";

interface Need {
  query: string;
  qty: number;
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

/** Manual mode (works without the assistant): search → offers per product → Add; shopping list → optimiser. */
export function ManualPanel({ basketItemIds, onOpenBasket }: { basketItemIds: Set<string>; onOpenBasket: () => void }) {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [needText, setNeedText] = useState("");
  const [needQty, setNeedQty] = useState(1);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [budget, setBudget] = useState("");

  const search = useMutation({ mutationFn: (text: string) => bap.search(text), onSuccess: setResults });
  const add = useMutation({
    mutationFn: (v: { listingId: string; label: string }) => bap.addItem(v.listingId, 1),
    onSuccess: (b: BasketView, v) => {
      qc.setQueryData(["basket"], b);
      snack(`Added ${v.label}`, { label: "View basket", onClick: onOpenBasket });
    },
  });
  const optimise = useMutation({
    mutationFn: async () => {
      const b = budget.trim() ? Math.round(Number(budget) * 100) : undefined;
      const p = await bap.plan(needs, b && b > 0 ? b : undefined);
      const merged = new Map<string, number>();
      for (const c of p.choices) merged.set(c.offer.listingId, (merged.get(c.offer.listingId) ?? 0) + c.qty);
      if (merged.size) {
        const basket = await bap.replace([...merged].map(([listingId, qty]) => ({ listingId, qty })));
        qc.setQueryData(["basket"], basket);
      }
      return p;
    },
    onSuccess: setPlan,
  });

  function addNeed() {
    const query = needText.trim();
    if (!query) return;
    setNeeds((n) => [...n, { query, qty: needQty }]);
    setNeedText("");
    setNeedQty(1);
  }

  const budgetInvalid = budget.trim() !== "" && !(Number(budget) > 0);

  return (
    <div className="space-y-8 py-4">
      {/* ---- Find a product ---- */}
      <section aria-labelledby="find-title" className="space-y-4">
        <div>
          <h2 id="find-title" className="type-title-medium text-on-surface">Find a product</h2>
          <p className="type-body-medium text-on-surface-variant">Compare the same pack across nearby stores. Cheapest first.</p>
        </div>
        <SearchBar
          label="Search products"
          placeholder="atta, gehun ka aata, toor dal, milk…"
          value={q}
          onValueChange={setQ}
          busy={search.isPending}
          onSubmit={() => q.trim() && search.mutate(q.trim())}
          trailing={
            search.isPending ? (
              <span className="flex h-12 w-12 items-center justify-center text-primary"><CircularProgress size={24} label="Searching" /></span>
            ) : (
              <IconButton icon="arrow_forward" label="Search" variant="filled" type="submit" disabled={!q.trim()} size={48} />
            )
          }
        />
        {search.error && <InlineMessage tone="error">{errorMessage(search.error)}</InlineMessage>}
        {add.error && <InlineMessage tone="error">{errorMessage(add.error)}</InlineMessage>}

        {results && (
          <div className="space-y-4">
            {results.looseDeclined.map((l) => (
              <InlineMessage
                key={l.query}
                tone="warning"
                icon="scale"
                title={`“${l.query}” is not sold loose`}
                action={
                  l.alternative?.listingId ? (
                    <Button variant="tonal" icon="add" size="sm" loading={add.isPending && add.variables?.listingId === l.alternative.listingId} onClick={() => add.mutate({ listingId: l.alternative!.listingId!, label: l.alternative!.name })}>
                      Add packaged
                    </Button>
                  ) : undefined
                }
              >
                {l.reason}
                {l.alternative && <> Packaged option: <b>{l.alternative.name}</b>.</>}
              </InlineMessage>
            ))}
            {results.groups.length === 0 && results.looseDeclined.length === 0 && (
              <EmptyState icon="search_off" title={`No nearby store has “${results.query}”`}>Try another name, like “aata” or “dal”, or a brand.</EmptyState>
            )}
            {results.groups.map((g) => (
              <Card key={g.canonicalProductId} variant="outlined" className="overflow-hidden">
                <header className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
                  <h3 className="min-w-0 type-title-small text-on-surface">
                    {g.name} <span className="font-normal text-on-surface-variant">· {g.packLabel}</span>
                  </h3>
                  <span className="shrink-0 type-body-small text-on-surface-variant">{g.offers.length} store{g.offers.length === 1 ? "" : "s"}</span>
                </header>
                <ul>
                  {g.offers.map((o, i) => {
                    const inBasket = basketItemIds.has(o.listingId);
                    return (
                      <li key={o.listingId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                        <Icon name="storefront" className="text-on-surface-variant" />
                        <div className="min-w-0 flex-1 basis-36">
                          <p className="truncate type-body-large text-on-surface">{o.storeName}</p>
                          <p className="type-body-small text-on-surface-variant">
                            {km(o.distanceM)} · {o.deliveryChargePaise === null ? "delivery at quote" : o.deliveryChargePaise ? `${formatINR(o.deliveryChargePaise)} delivery` : "free delivery"}
                          </p>
                          {i === 0 && g.offers.length > 1 && <StatusLabel tone="success" icon="savings" className="mt-1 h-6">Cheapest</StatusLabel>}
                        </div>
                        <span className="text-right">
                          <span className="block type-title-medium tabular-nums text-on-surface">{formatINR(o.pricePaise)}</span>
                          {o.mrpPaise > o.pricePaise && <span className="block type-body-small text-on-surface-variant line-through">{formatINR(o.mrpPaise)}</span>}
                        </span>
                        <Button
                          variant={inBasket ? "outlined" : "tonal"}
                          size="sm"
                          icon="add"
                          loading={add.isPending && add.variables?.listingId === o.listingId}
                          disabled={add.isPending}
                          onClick={() => add.mutate({ listingId: o.listingId, label: `${o.name} from ${o.storeName}` })}
                          aria-label={`${inBasket ? "Add one more" : "Add"} ${o.name} from ${o.storeName}`}
                        >
                          {inBasket ? "1 more" : "Add"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
            {results.groups.length > 0 && <p className="type-body-small text-on-surface-variant">Catalogue prices. Each store confirms price and stock when you get a quote.</p>}
          </div>
        )}
      </section>

      {/* ---- Plan a list (optimiser) ---- */}
      <Card variant="filled" className="space-y-4 p-4 sm:p-6" aria-labelledby="plan-title">
        <div className="flex items-start gap-3">
          <Icon name="route" className="mt-0.5 text-primary" />
          <div>
            <h2 id="plan-title" className="type-title-medium text-on-surface">Plan a whole list</h2>
            <p className="type-body-medium text-on-surface-variant">Add items, then let the optimiser pick stores and weigh delivery charges. It replaces your basket.</p>
          </div>
        </div>

        <form
          className="flex flex-wrap items-start gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            addNeed();
          }}
        >
          <TextField className="min-w-48 flex-1" label="Item" value={needText} onValueChange={setNeedText} supportingText="e.g. toor dal 1 kg" />
          <div className="flex h-14 items-center gap-3">
            <QtyStepper label="Packs" value={needQty} onChange={setNeedQty} />
            <Button type="submit" variant="tonal" icon="playlist_add" disabled={!needText.trim()}>Add</Button>
          </div>
        </form>

        {needs.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Shopping list">
            {needs.map((n, i) => (
              <li key={`${n.query}-${i}`}>
                <InputChip removeLabel={`Remove ${n.query}`} onRemove={() => setNeeds((x) => x.filter((_, j) => j !== i))}>
                  {n.qty} × {n.query}
                </InputChip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body-medium text-on-surface-variant">Your list is empty.</p>
        )}

        <div className="flex flex-wrap items-start gap-3">
          <TextField
            className="w-48"
            label="Budget (optional)"
            prefix="₹"
            inputMode="decimal"
            value={budget}
            onValueChange={setBudget}
            error={budgetInvalid ? "Enter an amount like 1500" : null}
          />
          <Button className="mt-2" icon="auto_fix_high" loading={optimise.isPending} disabled={!needs.length || budgetInvalid} onClick={() => optimise.mutate()}>
            Optimise basket
          </Button>
        </div>
        {optimise.error && <InlineMessage tone="error">{errorMessage(optimise.error)}</InlineMessage>}

        {plan && (
          <div className="space-y-3 rounded-md bg-surface p-4">
            <p className="flex flex-wrap items-center gap-2 type-title-small text-on-surface">
              <Icon name="check_circle" className="text-primary" />
              Basket updated · estimate {formatINR(plan.estimatedTotalPaise)}
              {plan.withinBudget === false && <StatusLabel tone="warning" icon="warning">Over budget</StatusLabel>}
              {plan.withinBudget === true && <StatusLabel tone="success" icon="savings">Within budget</StatusLabel>}
            </p>
            <ul className="space-y-2 type-body-medium">
              {plan.choices.map((c) => (
                <li key={`${c.query}-${c.offer.listingId}`} className="flex gap-2">
                  <Icon name="check" size={20} className="text-primary" />
                  <span>
                    <span className="text-on-surface">{c.qty} × {c.offer.name}</span> <span className="text-on-surface-variant">at {c.offer.storeName} — {c.reason}</span>
                  </span>
                </li>
              ))}
              {plan.reasons.map((r) => (
                <li key={r} className="flex gap-2 text-on-surface-variant">
                  <Icon name="lightbulb" size={20} className="text-tertiary" />
                  {r}
                </li>
              ))}
              {plan.unmatched.map((u) => (
                <li key={u.query} className="flex gap-2 text-error">
                  <Icon name="error" size={20} />
                  {u.query}: {u.reason}
                </li>
              ))}
            </ul>
            <p className="type-body-small text-on-surface-variant">Get a verified quote from your basket for the exact total.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
