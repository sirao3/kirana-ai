import type { BasketPutItem, BasketView, PlanResult, SearchOffer } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";

/** Price plus the store's delivery charge as the search response carries it (unknown delivery counts as 0 and is flagged by the caller). */
export function effectivePaise(o: Pick<SearchOffer, "pricePaise" | "deliveryChargePaise">): number {
  return o.pricePaise + (o.deliveryChargePaise ?? 0);
}

/** Cheapest effective price first; nearer store, then store id, break ties. */
export function rankOffers<T extends SearchOffer>(offers: T[]): T[] {
  return [...offers].sort((a, b) => effectivePaise(a) - effectivePaise(b) || a.distanceM - b.distanceM || a.storeId.localeCompare(b.storeId));
}

/** Listing id to badge "Cheapest" (only when there is a choice to make). */
export function cheapestListingId(offers: SearchOffer[]): string | null {
  return offers.length > 1 ? rankOffers(offers)[0]!.listingId : null;
}

/** "₹450 + ₹20 delivery = ₹470 if bought alone" (free / unknown delivery have their own wording). */
export function effectiveLabel(o: Pick<SearchOffer, "pricePaise" | "deliveryChargePaise">): string {
  if (o.deliveryChargePaise === null) return `${formatINR(o.pricePaise)} + delivery at quote`;
  if (o.deliveryChargePaise === 0) return `${formatINR(o.pricePaise)} with free delivery`;
  return `${formatINR(o.pricePaise)} + ${formatINR(o.deliveryChargePaise)} delivery = ${formatINR(effectivePaise(o))} if bought alone`;
}

// ---------- Shopping-list text ----------

export interface ListNeed {
  query: string;
  qty: number;
  canonicalProductId?: string;
}

/**
 * Splits "atta, toor dal x2, tea, milk x8" (commas, semicolons or new lines) into needs.
 * Quantity is an explicit "x2" / "2 x" / "2 packs" so that "toor dal 1 kg" keeps its size words.
 */
export function parseNeeds(text: string): ListNeed[] {
  const out: ListNeed[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    let m = part.match(/^(\d{1,3})\s*[x×]\s*(.+)$/i);
    if (m) {
      out.push({ query: m[2]!.trim(), qty: Number(m[1]) });
      continue;
    }
    m = part.match(/^(.+?)\s*[x×]\s*(\d{1,3})$/i) ?? part.match(/^(.+?)\s+(\d{1,3})\s*(?:packs?|pcs?|pieces?)$/i);
    if (m) {
      out.push({ query: m[1]!.trim(), qty: Number(m[2]) });
      continue;
    }
    out.push({ query: part, qty: 1 });
  }
  return out.filter((n) => n.qty >= 1);
}

/** Adds a need, or bumps the quantity of one with the same product / words. */
export function addNeed(list: ListNeed[], n: ListNeed): ListNeed[] {
  const same = (x: ListNeed) => (!!n.canonicalProductId && x.canonicalProductId === n.canonicalProductId) || x.query.toLowerCase() === n.query.toLowerCase();
  if (list.some(same)) return list.map((x) => (same(x) ? { ...x, qty: x.qty + n.qty } : x));
  return [...list, n];
}

// ---------- Plan -> basket ----------

/** Merges plan choices that resolved to the same listing, carrying the optimiser's own reasons onto the lines. */
export function choicesToBasketItems(p: PlanResult): BasketPutItem[] {
  const merged = new Map<string, { qty: number; reasons: string[] }>();
  for (const c of p.choices) {
    const m = merged.get(c.offer.listingId) ?? { qty: 0, reasons: [] };
    m.qty += c.qty;
    if (c.reason && !m.reasons.includes(c.reason)) m.reasons.push(c.reason);
    merged.set(c.offer.listingId, m);
  }
  return [...merged].map(([listingId, m]) => ({ listingId, qty: m.qty, reason: m.reasons.join("; ") || null }));
}

/** One needs entry per basket line, pinned to its canonical product. */
export function basketToNeeds(b: BasketView): ListNeed[] {
  return b.stores.flatMap((s) => s.items.map((i) => ({ query: i.name, qty: i.qty, canonicalProductId: i.canonicalProductId })));
}

export interface Nudge {
  savingPaise: number;
  text: string;
  items: BasketPutItem[];
}

/** "Save ₹30 by moving tea to Sharma": only from the plan's own baseline and total, never estimated here. */
export function nudgeFrom(basket: BasketView, plan: PlanResult): Nudge | null {
  if (!plan.baseline) return null;
  const savingPaise = plan.baseline.estimatedTotalPaise - plan.estimatedTotalPaise;
  if (savingPaise <= 0) return null;
  const have = new Set(basket.stores.flatMap((s) => s.items.map((i) => i.listingId)));
  const byCanonical = new Map(basket.stores.flatMap((s) => s.items.map((i) => [i.canonicalProductId, i] as const)));
  const moves = plan.choices
    .filter((c) => !have.has(c.offer.listingId))
    .map((c) => `${byCanonical.get(c.offer.canonicalProductId)?.name ?? c.offer.name} to ${c.offer.storeName}`);
  if (!moves.length) return null;
  const shown = moves.slice(0, 2).join(" and ");
  const more = moves.length > 2 ? ` and ${moves.length - 2} more` : "";
  return { savingPaise, text: `Save ${formatINR(savingPaise)} by moving ${shown}${more}`, items: choicesToBasketItems(plan) };
}

// ---------- Recent searches (per-viewer convenience; storage may be unavailable) ----------

const RECENT_KEY = "kiranaai.recentSearches";

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function pushRecent(q: string): string[] {
  const next = [q, ...loadRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore: private window or blocked storage
  }
  return next;
}
