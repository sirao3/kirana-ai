import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PlanResult, SearchResponse } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { Badge, Button, Card } from "../kit";
import { bap } from "./bap";
import { errorMessage } from "./errors";

interface Need {
  query: string;
  qty: number;
}

/** Manual mode (works without the assistant): search → grouped results → Add; shopping list → Optimise. */
export function ManualPanel({ basketItemIds }: { basketItemIds: Set<string> }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [needQty, setNeedQty] = useState(1);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [budget, setBudget] = useState("");

  const search = useMutation({ mutationFn: (text: string) => bap.search(text), onSuccess: setResults });
  const add = useMutation({
    mutationFn: (listingId: string) => bap.addItem(listingId, 1),
    onSuccess: (b) => qc.setQueryData(["basket"], b),
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
    const query = q.trim();
    if (!query) return;
    setNeeds((n) => [...n, { query, qty: needQty }]);
  }

  return (
    <div className="space-y-4">
      <Card title="Search stores">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) search.mutate(q.trim());
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
            placeholder="atta, gehun ka aata, toor dal, milk…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search products"
          />
          <Button type="submit" disabled={search.isPending || !q.trim()}>{search.isPending ? "Searching…" : "Search"}</Button>
        </form>
        {search.error && <p role="alert" className="mt-2 text-sm text-rose-700">{errorMessage(search.error)}</p>}
        {results && (
          <div className="mt-3 space-y-3">
            {results.looseDeclined.map((l) => (
              <div key={l.query} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <b>{l.query}</b>: {l.reason}
                {l.alternative && (
                  <>
                    {" "}Packaged option: <b>{l.alternative.name}</b>.
                    {l.alternative.listingId && (
                      <Button tone="secondary" className="ml-2 !py-1" disabled={add.isPending} onClick={() => add.mutate(l.alternative!.listingId!)}>
                        Add
                      </Button>
                    )}
                  </>
                )}
              </div>
            ))}
            {results.groups.length === 0 && results.looseDeclined.length === 0 && <p className="text-sm text-stone-500">No stores near you have “{results.query}”.</p>}
            {results.groups.map((g) => (
              <div key={g.canonicalProductId} className="rounded-lg border border-stone-200">
                <div className="border-b border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium">
                  {g.name} <span className="font-normal text-stone-500">· {g.packLabel}</span>
                </div>
                <ul className="divide-y divide-stone-100">
                  {g.offers.map((o) => (
                    <li key={o.listingId} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{o.storeName}</div>
                        <div className="text-xs text-stone-500">
                          {(o.distanceM / 1000).toFixed(1)} km · delivery {o.deliveryChargePaise === null ? "?" : o.deliveryChargePaise ? formatINR(o.deliveryChargePaise) : "free"}
                        </div>
                      </div>
                      <Badge>{o.badge}</Badge>
                      <span className="w-16 text-right tabular-nums">{formatINR(o.pricePaise)}</span>
                      <Button tone="secondary" className="!py-1" disabled={add.isPending} onClick={() => add.mutate(o.listingId)}>
                        {basketItemIds.has(o.listingId) ? "Add 1 more" : "Add"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {add.error && <p role="alert" className="mt-2 text-sm text-rose-700">{errorMessage(add.error)}</p>}
      </Card>

      <Card title="Optimise across stores">
        <p className="mb-2 text-sm text-stone-600">
          Build a shopping list (uses the search box text and quantity), then let the optimiser pick stores and weigh delivery charges.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            Qty{" "}
            <input type="number" min={1} step={1} className="w-16 rounded border border-stone-300 px-2 py-1" value={needQty} onChange={(e) => setNeedQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          </label>
          <Button tone="secondary" disabled={!q.trim()} onClick={addNeed}>Add “{q.trim() || "…"}” to list</Button>
        </div>
        {needs.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {needs.map((n, i) => (
              <li key={i} className="flex items-center justify-between rounded bg-stone-50 px-2 py-1">
                <span>{n.qty} × {n.query}</span>
                <button className="text-stone-400 hover:text-rose-600" onClick={() => setNeeds((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${n.query}`}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm">
            Budget ₹{" "}
            <input type="number" min={0} className="w-24 rounded border border-stone-300 px-2 py-1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="optional" />
          </label>
          <Button disabled={!needs.length || optimise.isPending} onClick={() => optimise.mutate()}>
            {optimise.isPending ? "Optimising…" : "Optimise"}
          </Button>
        </div>
        {optimise.error && <p role="alert" className="mt-2 text-sm text-rose-700">{errorMessage(optimise.error)}</p>}
        {plan && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="font-medium">Basket updated · estimate {formatINR(plan.estimatedTotalPaise)} (get a quote for the exact total)</p>
            {plan.withinBudget === false && <p className="text-amber-800">Over your budget.</p>}
            <ul className="list-disc space-y-0.5 pl-5 text-stone-700">
              {plan.choices.map((c) => <li key={`${c.query}-${c.offer.listingId}`}>{c.qty} × {c.offer.name} at {c.offer.storeName}: {c.reason}</li>)}
              {plan.reasons.map((r) => <li key={r}>{r}</li>)}
              {plan.unmatched.map((u) => <li key={u.query} className="text-rose-700">{u.query}: {u.reason}</li>)}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
