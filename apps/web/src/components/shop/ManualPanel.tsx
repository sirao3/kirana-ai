import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BasketView, PlanResult, SearchResponse } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import {
  Button, Card, CircularProgress, cx, EmptyState, Icon, IconButton, InlineMessage, InputChip, QtyStepper, SearchBar, StatusLabel, TextField, useSnackbar,
} from "../m3";
import { bap } from "./bap";
import { errorMessage } from "./errors";
import { useAddress } from "./useAddress";
import { addNeed as addToList, cheapestListingId, choicesToBasketItems, effectiveLabel, loadRecent, parseNeeds, pushRecent, rankOffers, type ListNeed } from "./pricing";

type Need = ListNeed;

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

interface Option {
  key: string;
  text: string;
  hint?: string;
  recent?: boolean;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

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
  const address = useAddress().data;
  const tooFar = address?.stores.filter((s) => !s.delivers) ?? [];

  // A new delivery address changes which stores can serve you: refresh shown results, drop the stale plan summary.
  const addressKey = address ? `${address.lat},${address.lng}` : null;
  const lastKey = useRef(addressKey);
  useEffect(() => {
    if (!addressKey || addressKey === lastKey.current) return;
    lastKey.current = addressKey;
    setPlan(null);
    if (results) search.mutate(results.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey]);

  // ---- Suggestions (combobox) ----
  const listboxId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const debounced = useDebounced(q.trim(), 250);
  const suggestQ = useQuery({
    queryKey: ["suggest", debounced.toLowerCase()],
    queryFn: () => bap.suggest(debounced),
    enabled: focused && debounced.length >= 2,
    staleTime: 60_000,
    retry: false,
  });
  const typed = q.trim();
  const waiting = typed.length >= 2 && (typed !== debounced || suggestQ.isFetching);
  const options: Option[] =
    typed.length < 2
      ? recent.map((r) => ({ key: `r:${r}`, text: r, recent: true }))
      : (suggestQ.data?.query.toLowerCase() === typed.toLowerCase() ? suggestQ.data.suggestions : []).map((s) => ({
          key: s.canonicalProductId, text: s.name, hint: `${s.packLabel} · from ${formatINR(s.fromPricePaise)}`,
        }));
  const open = focused && !dismissed && (options.length > 0 || waiting || (typed.length >= 2 && suggestQ.isError));

  function runSearch(text: string) {
    const t = text.trim();
    if (!t) return;
    setQ(t);
    setDismissed(true);
    setActive(-1);
    setRecent(pushRecent(t));
    search.mutate(t);
  }
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      setDismissed(false);
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % options.length : (a <= 0 ? options.length : a) - 1));
    } else if (e.key === "Enter" && open && active >= 0 && options[active]) {
      e.preventDefault();
      runSearch(options[active]!.text);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setDismissed(true);
      setActive(-1);
    }
  }
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
      // Merge needs that resolved to the same listing; carry the optimiser's own reasons onto the lines.
      const items = choicesToBasketItems(p);
      if (items.length) {
        const basket = await bap.replace(items, p.reasons);
        qc.setQueryData(["basket"], basket);
      }
      return p;
    },
    onSuccess: setPlan,
  });

  /** "atta, toor dal x2, milk x8" adds three needs; the stepper applies to a single item without its own quantity. */
  function submitNeeds() {
    const parsed = parseNeeds(needText);
    if (!parsed.length) return;
    if (parsed.length === 1 && parsed[0]!.qty === 1) parsed[0]!.qty = needQty;
    setNeeds((list) => parsed.reduce(addToList, list));
    setNeedText("");
    setNeedQty(1);
  }
  function addProductToList(canonicalProductId: string, name: string) {
    setNeeds((list) => addToList(list, { query: name, qty: 1, canonicalProductId }));
    snack(`${name} added to your list`, { label: "View list", onClick: () => document.getElementById("shopping-list")?.scrollIntoView({ behavior: "smooth", block: "start" }) });
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
        <div className="relative">
          <SearchBar
            label="Search products"
            placeholder="atta, gehun ka aata, toor dal, milk…"
            value={q}
            onValueChange={(v) => {
              setQ(v);
              setDismissed(false);
              setActive(-1);
            }}
            busy={search.isPending}
            onSubmit={() => runSearch(q)}
            inputProps={{
              role: "combobox",
              "aria-expanded": open,
              "aria-controls": listboxId,
              "aria-autocomplete": "list",
              "aria-activedescendant": open && active >= 0 ? `${listboxId}-${active}` : undefined,
              autoComplete: "off",
              onFocus: () => setFocused(true),
              onBlur: () => setFocused(false),
              onKeyDown: onSearchKey,
            }}
            trailing={
              search.isPending ? (
                <span className="flex h-12 w-12 items-center justify-center text-primary"><CircularProgress size={24} label="Searching" /></span>
              ) : (
                <IconButton icon="arrow_forward" label="Search" variant="filled" type="submit" disabled={!q.trim()} size={48} />
              )
            }
          />
          <div
            id={listboxId}
            role="listbox"
            aria-label={typed.length < 2 ? "Recent searches" : "Suggestions"}
            hidden={!open}
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg bg-surface-container shadow-2"
          >
            {options.map((o, i) => (
              <div
                key={o.key}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mouseDown (not click) so the input keeps focus until the choice is made
                onMouseDown={(e) => {
                  e.preventDefault();
                  runSearch(o.text);
                }}
                onMouseMove={() => setActive(i)}
                className={cx("flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2", i === active ? "bg-surface-container-highest" : "hover:bg-surface-container-high")}
              >
                <Icon name={o.recent ? "history" : "search"} size={20} className="shrink-0 text-on-surface-variant" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate type-body-large text-on-surface">{o.text}</span>
                  {o.hint && <span className="block truncate type-body-small text-on-surface-variant">{o.hint}</span>}
                </span>
              </div>
            ))}
            {options.length === 0 && waiting && (
              <p role="status" className="flex min-h-12 items-center gap-3 px-4 type-body-medium text-on-surface-variant">
                <CircularProgress size={18} label="Finding suggestions" /> Finding products…
              </p>
            )}
            {options.length === 0 && !waiting && suggestQ.isError && (
              <p role="status" className="flex min-h-12 items-center px-4 type-body-medium text-on-surface-variant">
                No suggestions right now. Press Enter to search for “{typed}”.
              </p>
            )}
          </div>
        </div>
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
              <EmptyState icon="search_off" title={`No nearby store has “${results.query}”`}>
                {tooFar.length > 0
                  ? <>{tooFar.length === address?.stores.length ? "No store delivers to your address." : `${tooFar.length} store${tooFar.length === 1 ? "" : "s"} can't deliver to your address.`} Try another name, or change the delivery address.</>
                  : "Try another name, like “aata” or “dal”, or a brand."}
              </EmptyState>
            )}
            {results.groups.map((g) => {
              const cheapestId = cheapestListingId(g.offers);
              const onList = needs.some((n) => n.canonicalProductId === g.canonicalProductId);
              return (
              <Card key={g.canonicalProductId} variant="outlined" className="overflow-hidden">
                <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 pb-1 pt-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <h3 className="type-title-small text-on-surface">
                      {g.name} <span className="font-normal text-on-surface-variant">· {g.packLabel}</span>
                    </h3>
                    <p className="type-body-small text-on-surface-variant">{g.offers.length} store{g.offers.length === 1 ? "" : "s"}</p>
                  </div>
                  <Button
                    variant="text"
                    size="sm"
                    icon={onList ? "check" : "playlist_add"}
                    onClick={() => addProductToList(g.canonicalProductId, g.name)}
                    aria-label={`${onList ? "Add one more" : "Add"} ${g.name} to list`}
                  >
                    {onList ? "On list" : "Add to list"}
                  </Button>
                </header>
                <ul>
                  {rankOffers(g.offers).map((o) => {
                    const inBasket = basketItemIds.has(o.listingId);
                    return (
                      <li key={o.listingId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                        <Icon name="storefront" className="text-on-surface-variant" />
                        <div className="min-w-0 flex-1 basis-36">
                          <p className="truncate type-body-large text-on-surface">{o.storeName}</p>
                          <p className="type-body-small text-on-surface-variant">{km(o.distanceM)} · {effectiveLabel(o)}</p>
                          {o.listingId === cheapestId && <StatusLabel tone="success" icon="savings" className="mt-1 h-6">Cheapest with delivery</StatusLabel>}
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
              );
            })}
            {tooFar.length > 0 && (results.groups.length > 0 || results.looseDeclined.length > 0) && (
              <section aria-label="Stores that don't deliver to you" className="rounded-md border border-dashed border-outline-variant p-3">
                <p className="mb-1 flex items-center gap-2 type-title-small text-on-surface-variant"><Icon name="block" size={20} /> Doesn't deliver to you</p>
                <ul className="space-y-1">
                  {tooFar.map((s) => (
                    <li key={s.storeId} className="flex flex-wrap items-baseline gap-x-2 type-body-medium text-on-surface-variant">
                      <span>{s.name}</span>
                      <span className="type-body-small">{km(s.distanceM)} away, delivers within {km(s.radiusM)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {results.groups.length > 0 && (
              <p className="type-body-small text-on-surface-variant">
                Catalogue prices. Delivery is charged per store, not per item, so buying several items from one store shares it. Each store confirms price and stock when you get a quote.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---- Plan a list (optimiser) ---- */}
      <Card id="shopping-list" variant="filled" className="scroll-mt-4 space-y-4 p-4 sm:p-6" aria-labelledby="plan-title">
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
            submitNeeds();
          }}
        >
          <TextField className="min-w-48 flex-1" label="Item" value={needText} onValueChange={setNeedText} supportingText="One item, or a list: atta, toor dal x2, milk x8" />
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
