import { formatINR, type LooseDeclined, type PlanChoice, type PlanResult, type SearchOffer } from "@kiranaai/shared";

/**
 * plan_basket (PRD §12): deterministic exact search over store subsets. Pure: no I/O.
 *
 * Cost of a subset = Σ cheapest candidate price per need within the subset + Σ delivery of the stores actually used.
 * Winner = cheapest; ties go to fewer stores, then to the smaller total store distance (then store ids, for determinism).
 */

export interface PlanStoreInfo {
  storeId: string;
  storeName: string;
  distanceM: number;
  /** Delivery charge for this store's items subtotal, or null when it cannot serve this customer. */
  deliveryFor(itemsSubtotalPaise: number): number | null;
}

export interface PlanNeedInput {
  query: string;
  /** Integer packs. */
  qty: number;
  /** Candidate offers: only the best-matching canonical products' offers (see bestMatchingOffers). */
  offers: SearchOffer[];
}

export interface PlanInput {
  needs: PlanNeedInput[];
  stores: PlanStoreInfo[];
  budgetPaise?: number | null;
  looseDeclined?: LooseDeclined[];
}

/** More stores than this are pruned to the ones covering the most needs (2^n subsets are enumerated). */
const MAX_STORES = 14;

interface Eval {
  totalPaise: number;
  /** Per planned need: chosen offer. */
  picks: SearchOffer[];
  used: string[];
  distanceM: number;
  perStore: Map<string, { items: number; delivery: number }>;
}

function pickCheapest(offers: SearchOffer[]): SearchOffer | undefined {
  return [...offers].sort((a, b) => a.pricePaise - b.pricePaise || a.distanceM - b.distanceM || a.storeId.localeCompare(b.storeId) || a.listingId.localeCompare(b.listingId))[0];
}

export function planBasket(input: PlanInput): PlanResult {
  const storeById = new Map(input.stores.map((s) => [s.storeId, s]));
  const unmatched: PlanResult["unmatched"] = [];

  // Usable candidates per need: known store, enough stock for the quantity, integer qty.
  const planned: { need: PlanNeedInput; usable: SearchOffer[] }[] = [];
  for (const need of input.needs) {
    if (!Number.isInteger(need.qty) || need.qty < 1) {
      unmatched.push({ query: need.query, reason: "Quantity must be a whole number of packs (1 or more)." });
      continue;
    }
    const usable = need.offers.filter((o) => storeById.has(o.storeId) && o.stockQty >= need.qty);
    if (!usable.length) {
      unmatched.push({
        query: need.query,
        reason: need.offers.length ? `No nearby store has ${need.qty} in stock.` : "No nearby store sells this.",
      });
      continue;
    }
    planned.push({ need, usable });
  }

  const empty = (): PlanResult => ({
    choices: [], stores: [], estimatedTotalPaise: 0, budgetPaise: input.budgetPaise ?? null,
    withinBudget: input.budgetPaise == null ? null : true, reasons: [], unmatched, looseDeclined: input.looseDeclined ?? [],
  });
  if (!planned.length) return empty();

  // Candidate stores, pruned to MAX_STORES by coverage.
  const coverage = new Map<string, number>();
  for (const p of planned) for (const sid of new Set(p.usable.map((o) => o.storeId))) coverage.set(sid, (coverage.get(sid) ?? 0) + 1);
  const storeIds = [...coverage.keys()]
    .sort((a, b) => coverage.get(b)! - coverage.get(a)! || a.localeCompare(b))
    .slice(0, MAX_STORES)
    .sort();

  /** Cost of an explicit assignment of an offer to every planned need; null if a store cannot serve its subtotal. */
  const evaluate = (picks: SearchOffer[]): Eval | null => {
    const perStore = new Map<string, { items: number; delivery: number }>();
    picks.forEach((o, i) => {
      const cur = perStore.get(o.storeId) ?? { items: 0, delivery: 0 };
      cur.items += o.pricePaise * planned[i]!.need.qty;
      perStore.set(o.storeId, cur);
    });
    let total = 0;
    let distanceM = 0;
    for (const [sid, v] of perStore) {
      const s = storeById.get(sid)!;
      const d = s.deliveryFor(v.items);
      if (d === null) return null;
      v.delivery = d;
      total += v.items + d;
      distanceM += s.distanceM;
    }
    return { totalPaise: total, picks, used: [...perStore.keys()].sort(), distanceM, perStore };
  };

  const better = (a: Eval, b: Eval | null): boolean =>
    !b ||
    a.totalPaise < b.totalPaise ||
    (a.totalPaise === b.totalPaise &&
      (a.used.length < b.used.length ||
        (a.used.length === b.used.length &&
          (a.distanceM < b.distanceM || (a.distanceM === b.distanceM && a.used.join(",") < b.used.join(","))))));

  /** Best plan using only stores in `allowed`. */
  const solve = (allowed: string[]): Eval | null => {
    let best: Eval | null = null;
    for (let mask = 1; mask < 1 << allowed.length; mask++) {
      const subset = new Set(allowed.filter((_, i) => mask & (1 << i)));
      const picks: SearchOffer[] = [];
      let ok = true;
      for (const p of planned) {
        const o = pickCheapest(p.usable.filter((x) => subset.has(x.storeId)));
        if (!o) {
          ok = false;
          break;
        }
        picks.push(o);
      }
      if (!ok) continue;
      const ev = evaluate(picks);
      if (ev && better(ev, best)) best = ev;
    }
    return best;
  };

  const best = solve(storeIds);
  if (!best) {
    for (const p of planned) unmatched.push({ query: p.need.query, reason: "No combination of nearby stores can deliver this basket." });
    return empty();
  }

  // ----- reasons, built from the numbers -----
  const nameOf = (sid: string) => storeById.get(sid)!.storeName;
  const choices: PlanChoice[] = best.picks.map((offer, i) => {
    const { need, usable } = planned[i]!;
    const line = offer.pricePaise * need.qty;
    const cheapestAny = pickCheapest(usable)!;
    const others = usable.filter((o) => o.storeId !== offer.storeId);
    let reason: string;
    if (cheapestAny.listingId === offer.listingId || cheapestAny.pricePaise === offer.pricePaise) {
      const alt = pickCheapest(others);
      if (!alt) reason = `Only ${offer.storeName} has this in stock`;
      else if (alt.pricePaise * need.qty > line) reason = `${formatINR(alt.pricePaise * need.qty - line)} cheaper than ${alt.storeName}`;
      else reason = `Same price as ${alt.storeName}; ${offer.storeName} fits the basket better`;
    } else {
      const extra = line - cheapestAny.pricePaise * need.qty;
      const forced = evaluate(best.picks.map((p, j) => (j === i ? cheapestAny : p)));
      const saves = forced ? forced.totalPaise - best.totalPaise : 0;
      reason =
        saves > 0
          ? `${formatINR(extra)} more than ${cheapestAny.storeName}, but ordering with your other items from ${offer.storeName} saves ${formatINR(saves)} overall`
          : `${formatINR(extra)} more than ${cheapestAny.storeName}, but ${offer.storeName} is already in your basket`;
    }
    return { query: need.query, qty: need.qty, offer, reason };
  });

  const reasons: string[] = [];
  if (best.used.length > 1) {
    for (const sid of best.used) {
      const without = solve(storeIds.filter((s) => s !== sid));
      if (!without || without.totalPaise <= best.totalPaise) continue;
      const saving = without.totalPaise - best.totalPaise;
      const delivery = best.perStore.get(sid)!.delivery;
      reasons.push(
        delivery > 0
          ? `Adding ${nameOf(sid)} saves ${formatINR(saving)} even after ${formatINR(delivery)} delivery`
          : `Adding ${nameOf(sid)} saves ${formatINR(saving)} (free delivery)`,
      );
    }
  }
  // Consolidation: versus buying each item at its lowest price wherever that is.
  const naive = evaluate(planned.map((p) => pickCheapest(p.usable)!));
  if (naive && naive.totalPaise > best.totalPaise) {
    const n = best.used.length;
    reasons.push(
      `Buying from ${n === 1 ? "one store" : `${n} stores`} saves ${formatINR(naive.totalPaise - best.totalPaise)} compared with taking the lowest price for every item (delivery adds up)`,
    );
  }

  const budget = input.budgetPaise ?? null;
  let withinBudget: boolean | null = null;
  if (budget !== null) {
    withinBudget = best.totalPaise <= budget;
    reasons.push(
      withinBudget
        ? `Estimated ${formatINR(best.totalPaise)} is ${formatINR(budget - best.totalPaise)} under your ${formatINR(budget)} budget`
        : `Estimated ${formatINR(best.totalPaise)} is ${formatINR(best.totalPaise - budget)} over your ${formatINR(budget)} budget`,
    );
  }

  return {
    choices,
    stores: best.used.map((sid) => ({
      storeId: sid, storeName: nameOf(sid), itemsTotalPaise: best.perStore.get(sid)!.items, deliveryPaise: best.perStore.get(sid)!.delivery,
    })),
    estimatedTotalPaise: best.totalPaise,
    budgetPaise: budget,
    withinBudget,
    reasons,
    unmatched,
    looseDeclined: input.looseDeclined ?? [],
  };
}

// ---------- candidate restriction ----------

const STOPWORDS = new Set(["a", "an", "of", "the", "and", "ka", "ki", "ke", "ek", "packet", "pack", "packs", "for"]);

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter(Boolean);

/**
 * "A need's candidates are the offers of its best-matching canonical products only": score each canonical
 * product by the share of query words found as whole words in its name/brand/pack, keep the top-scoring
 * products. When nothing matches textually (e.g. Hinglish "gehun ka aata", which the BPP resolved through
 * synonyms) every returned product is kept.
 */
export function bestMatchingOffers<T extends SearchOffer>(query: string, offers: T[]): T[] {
  const q = words(query).filter((w) => !STOPWORDS.has(w));
  if (!q.length) return offers;
  const score = new Map<string, number>();
  const byProduct = new Map<string, T>();
  for (const o of offers) if (!byProduct.has(o.canonicalProductId)) byProduct.set(o.canonicalProductId, o);
  for (const [id, o] of byProduct) {
    const have = new Set(words(`${o.name} ${o.brand} ${o.packLabel}`));
    score.set(id, q.filter((w) => have.has(w)).length / q.length);
  }
  const top = Math.max(...score.values());
  if (top === 0) return offers;
  return offers.filter((o) => score.get(o.canonicalProductId) === top);
}
