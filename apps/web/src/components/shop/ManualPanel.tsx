import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BasketView, PlanResult, SearchResponse } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { Button, C, IArrowUpRight, IClose, IPlus, ISearch, SearchField, Spinner, TextField, cx, ease, soft } from "../ui";
import { useSnackbar } from "../m3";
import { bap } from "./bap";
import { errorMessage } from "./errors";
import { useAddress } from "./useAddress";
import { addNeed as addToList, cheapestListingId, choicesToBasketItems, effectiveLabel, loadRecent, parseNeeds, pushRecent, rankOffers, type ListNeed } from "./pricing";
import { LINK } from "./tokens";

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

interface Option { key: string; text: string; hint?: string; recent?: boolean }

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const H2 = "px-1 text-[12px] font-semibold uppercase tracking-[0.04em]";

/**
 * Search & plan, without the assistant: search with suggestions → each product with its stores (effective price,
 * cheapest said in words) → Add / Add to list; and a whole list through the optimiser. Hairline rows, price strongest.
 */
export function ManualPanel({ basketItemIds }: { basketItemIds: Set<string> }) {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [needText, setNeedText] = useState("");
  const [needs, setNeeds] = useState<ListNeed[]>([]);
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      runSearch(open && active >= 0 && options[active] ? options[active]!.text : q);
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
      snack(`Added ${v.label}`);
    },
  });
  const optimise = useMutation({
    mutationFn: async () => {
      const b = budget.trim() ? Math.round(Number(budget) * 100) : undefined;
      const p = await bap.plan(needs, b && b > 0 ? b : undefined);
      const items = choicesToBasketItems(p);
      if (items.length) qc.setQueryData(["basket"], await bap.replace(items, p.reasons));
      return p;
    },
    onSuccess: setPlan,
  });

  /** "atta, toor dal x2, milk x8" adds three needs. */
  function submitNeeds() {
    const parsed = parseNeeds(needText);
    if (!parsed.length) return;
    setNeeds((list) => parsed.reduce(addToList, list));
    setNeedText("");
  }
  function addProductToList(canonicalProductId: string, name: string) {
    setNeeds((list) => addToList(list, { query: name, qty: 1, canonicalProductId }));
    snack(`${name} added to your list`);
  }
  const setNeedQty = (i: number, qty: number) => setNeeds((x) => (qty < 1 ? x.filter((_, j) => j !== i) : x.map((n, j) => (j === i ? { ...n, qty } : n))));
  const budgetInvalid = budget.trim() !== "" && !(Number(budget) > 0);

  return (
    <div className="space-y-8 pb-6 pt-3">
      <section aria-labelledby="find-title">
        <h2 id="find-title" className="sr-only">Find a product</h2>
        <div className="relative">
          <SearchField label="Search products" placeholder="atta, gehun ka aata, toor dal…" value={q} busy={search.isPending}
            onValueChange={(v) => { setQ(v); setDismissed(false); setActive(-1); }}
            role="combobox" aria-expanded={open} aria-controls={listboxId} aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `${listboxId}-${active}` : undefined} autoComplete="off" enterKeyHint="search"
            onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)} onKeyDown={onSearchKey}
            className="focus-within:ring-2 focus-within:ring-[#007AFF]/40"
          />
              <motion.div id={listboxId} role="listbox" aria-label={typed.length < 2 ? "Recent searches" : "Suggestions"} hidden={!open}
                initial={false} animate={open ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: -4, scale: 0.98 }} transition={soft}
                className="absolute inset-x-0 top-full z-20 mt-1.5 origin-top overflow-hidden rounded-[14px] bg-white py-1" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.16)" }}>
                {options.map((o, i) => (
                  <div key={o.key} id={`${listboxId}-${i}`} role="option" aria-selected={i === active}
                    // mouseDown (not click) so the input keeps focus until the choice is made
                    onMouseDown={(e) => { e.preventDefault(); runSearch(o.text); }} onMouseMove={() => setActive(i)}
                    className={cx("flex min-h-11 cursor-pointer items-center gap-3 px-4 py-1.5", i === active && "bg-black/[0.04]")}>
                    <span className="shrink-0" style={{ color: C.tertiary }}>{o.recent ? <IArrowUpRight size={15} /> : <ISearch size={15} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]" style={{ color: C.label }}>{o.text}</span>
                      {o.hint && <span className="block truncate text-[12px]" style={{ color: C.secondary }}>{o.hint}</span>}
                    </span>
                  </div>
                ))}
                {options.length === 0 && waiting && <p role="status" className="flex min-h-11 items-center gap-2.5 px-4 text-[14px]" style={{ color: C.secondary }}><Spinner size={14} /> Finding products…</p>}
                {options.length === 0 && !waiting && suggestQ.isError && <p role="status" className="flex min-h-11 items-center px-4 text-[14px]" style={{ color: C.secondary }}>No suggestions right now. Press Enter to search for “{typed}”.</p>}
              </motion.div>
        </div>
        {!results && !search.isPending && <p className="mt-2 px-1 text-[13px]" style={{ color: C.secondary }}>Compare the same pack across the stores on the map, delivery included.</p>}
        {search.error && <p role="alert" className="mt-3 px-1 text-[14px]" style={{ color: C.red }}>{errorMessage(search.error)}</p>}
        {add.error && <p role="alert" className="mt-3 px-1 text-[14px]" style={{ color: C.red }}>{errorMessage(add.error)}</p>}

        {results && (
          <motion.div key={results.query} initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.05 } } }} className="mt-4 space-y-5" aria-live="polite">
            {results.looseDeclined.map((l) => (
              <motion.div key={l.query} variants={rise} transition={soft} className="rounded-[14px] px-4 py-3" style={{ background: "#FFF4E0" }}>
                <p className="text-[14px] font-semibold" style={{ color: C.label }}>“{l.query}” isn't sold loose</p>
                <p className="mt-0.5 text-[13px] leading-[1.45]" style={{ color: C.secondary }}>{l.reason}{l.alternative && <> Packaged option: <b style={{ color: C.label }}>{l.alternative.name}</b>.</>}</p>
                {l.alternative?.listingId && (
                  <Button size="sm" variant="secondary" className="mt-2 bg-white" icon={<IPlus size={14} />} busy={add.isPending && add.variables?.listingId === l.alternative.listingId}
                    onClick={() => add.mutate({ listingId: l.alternative!.listingId!, label: l.alternative!.name })}>Add packaged</Button>
                )}
              </motion.div>
            ))}
            {results.groups.length === 0 && results.looseDeclined.length === 0 && (
              <div className="px-1 py-6 text-center">
                <p className="text-[17px] font-semibold" style={{ color: C.label }}>No nearby store has “{results.query}”</p>
                <p className="mt-1 text-[14px]" style={{ color: C.secondary }}>
                  {tooFar.length > 0 ? `${tooFar.length === address?.stores.length ? "No store delivers to your address." : `${tooFar.length} store${tooFar.length === 1 ? "" : "s"} can't deliver to your address.`} Try another name, or change the address.` : "Try another name, like “aata” or “dal”, or a brand."}
                </p>
              </div>
            )}
            {results.groups.map((g) => {
              const cheapestId = cheapestListingId(g.offers);
              const onList = needs.some((n) => n.canonicalProductId === g.canonicalProductId);
              return (
                <motion.section key={g.canonicalProductId} variants={rise} transition={soft} aria-label={`${g.name} ${g.packLabel}`}>
                  <div className="flex items-end justify-between gap-3 px-1 pb-1.5">
                    <h3 className="min-w-0 text-[15px] font-semibold leading-tight" style={{ color: C.label }}>
                      {g.name} <span className="font-normal" style={{ color: C.secondary }}>{g.packLabel}</span>
                    </h3>
                    <button type="button" onClick={() => addProductToList(g.canonicalProductId, g.name)} aria-label={`${onList ? "Add one more" : "Add"} ${g.name} to list`}
                      className="-my-2 min-h-11 shrink-0 cursor-pointer px-1 text-[13px] font-semibold" style={{ color: LINK }}>{onList ? "On list · add 1" : "Add to list"}</button>
                  </div>
                  <ul className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.03)" }}>
                    {rankOffers(g.offers).map((o, i) => {
                      const inBasket = basketItemIds.has(o.listingId);
                      return (
                        <li key={o.listingId} className="flex items-center gap-3 py-2.5 pl-4 pr-2.5" style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined }}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px]" style={{ color: C.label }}>{o.storeName}</p>
                            <p className="text-[12px] leading-[1.35]" style={{ color: C.secondary }}>{km(o.distanceM)} · {effectiveLabel(o)}</p>
                            {o.listingId === cheapestId && <p className="text-[12px] font-semibold" style={{ color: "#1A7536" }}>Cheapest with delivery</p>}
                          </div>
                          <span className="text-right">
                            <span className="block text-[17px] font-semibold tracking-[-0.01em]" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{formatINR(o.pricePaise)}</span>
                            {o.mrpPaise > o.pricePaise && <span className="block text-[12px] line-through" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>{formatINR(o.mrpPaise)}</span>}
                          </span>
                          <Button size="sm" variant="secondary" className="h-9 min-w-[64px]" busy={add.isPending && add.variables?.listingId === o.listingId} disabled={add.isPending}
                            onClick={() => add.mutate({ listingId: o.listingId, label: `${o.name} from ${o.storeName}` })} aria-label={`${inBasket ? "Add one more" : "Add"} ${o.name} from ${o.storeName}`}>
                            {inBasket ? "+1" : "Add"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </motion.section>
              );
            })}
            {tooFar.length > 0 && (results.groups.length > 0 || results.looseDeclined.length > 0) && (
              <motion.section variants={rise} transition={soft} aria-label="Stores that don't deliver to you">
                <h3 className={H2} style={{ color: C.secondary }}>Doesn't deliver to you</h3>
                <ul className="mt-1 px-1 text-[13px]" style={{ color: C.secondary }}>
                  {tooFar.map((s) => <li key={s.storeId}>{s.name} · {km(s.distanceM)} away, delivers within {km(s.radiusM)}</li>)}
                </ul>
              </motion.section>
            )}
            {results.groups.length > 0 && (
              <motion.p variants={rise} transition={soft} className="px-1 text-[12px] leading-[1.45]" style={{ color: C.secondary }}>
                Catalogue prices. Delivery is per store, not per item, so several items from one store share it. Stores confirm price and stock when you get the verified total.
              </motion.p>
            )}
          </motion.div>
        )}
      </section>

      <section id="shopping-list" aria-labelledby="plan-title" className="scroll-mt-4">
        <h2 id="plan-title" className="text-[20px] font-bold tracking-[-0.02em]" style={{ color: C.label }}>Plan a whole list</h2>
        <p className="mt-0.5 text-[13px] leading-[1.45]" style={{ color: C.secondary }}>Add items, then the optimiser picks stores and weighs delivery charges. It replaces your basket.</p>
        <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submitNeeds(); }}>
          <TextField className="flex-1" label="Item" value={needText} onValueChange={setNeedText} placeholder="atta, toor dal x2, milk x8" help="One item, or a list with quantities" />
          <Button type="submit" variant="secondary" className="mb-[22px]" disabled={!needText.trim()}>Add</Button>
        </form>
        {needs.length > 0 ? (
          <ul aria-label="Shopping list" className="mt-3 overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06)" }}>
            <AnimatePresence initial={false}>
              {needs.map((n, i) => (
                <motion.li key={n.query} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={soft}
                  className="flex items-center gap-2 pl-4 pr-1.5" style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined }}>
                  <span className="min-w-0 flex-1 truncate py-2.5 text-[15px]" style={{ color: C.label }}>{n.query}</span>
                  <span className="flex items-center rounded-[10px]" style={{ background: C.fill }}>
                    <button type="button" aria-label={`Fewer: ${n.query}`} onClick={() => setNeedQty(i, n.qty - 1)} className="h-9 w-9 cursor-pointer text-[18px]" style={{ color: C.label }}>−</button>
                    <span className="min-w-5 text-center text-[14px] font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{n.qty}</span>
                    <button type="button" aria-label={`More: ${n.query}`} onClick={() => setNeedQty(i, n.qty + 1)} className="h-9 w-9 cursor-pointer text-[18px]" style={{ color: C.label }}>+</button>
                  </span>
                  <button type="button" aria-label={`Remove ${n.query}`} onClick={() => setNeedQty(i, 0)} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full hover:bg-black/[0.04]" style={{ color: C.tertiary }}><IClose size={15} /></button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        ) : <p className="mt-3 px-1 text-[13px]" style={{ color: C.secondary }}>Your list is empty.</p>}
        <div className="mt-4 flex items-start gap-2">
          <TextField className="w-40" label="Budget (optional)" prefix="₹" inputMode="decimal" value={budget} onValueChange={setBudget} error={budgetInvalid ? "Enter an amount like 1500" : undefined} />
          <Button className="mt-[22px] flex-1" busy={optimise.isPending} disabled={!needs.length || budgetInvalid} onClick={() => optimise.mutate()}>Optimise basket</Button>
        </div>
        {optimise.error && <p role="alert" className="mt-3 px-1 text-[14px]" style={{ color: C.red }}>{errorMessage(optimise.error)}</p>}
        <AnimatePresence>
          {plan && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={ease} role="status" className="mt-4 px-1">
              <p className="text-[15px] font-semibold" style={{ color: C.label }}>
                Basket updated · about {formatINR(plan.estimatedTotalPaise)}
                {plan.withinBudget === false && <span style={{ color: C.red }}> · over budget</span>}
                {plan.withinBudget === true && <span style={{ color: C.green }}> · within budget</span>}
              </p>
              <ul className="mt-1.5 space-y-1 text-[13px] leading-[1.45]" style={{ color: C.secondary }}>
                {plan.choices.map((c) => <li key={`${c.query}-${c.offer.listingId}`}><span style={{ color: C.label }}>{c.qty}× {c.offer.name}</span> at {c.offer.storeName} · {c.reason}</li>)}
                {plan.reasons.map((r) => <li key={r}>{r}</li>)}
                {plan.unmatched.map((u) => <li key={u.query} style={{ color: C.red }}>{u.query}: {u.reason}</li>)}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

const rise = { h: { opacity: 0, y: 8 }, s: { opacity: 1, y: 0 } };
