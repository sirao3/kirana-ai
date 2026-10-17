import { deliveryChargePaise, type LooseDeclined, type PlanNeed, type PlanResult } from "@kiranaai/shared";
import type { AppContext } from "../../app.js";
import { searchOffers, type SeenOffer } from "../offers.js";
import type { CustomerRow } from "../util.js";
import { bestMatchingOffers, planBasket, type PlanStoreInfo } from "./optimiser.js";

/** Store pricing/serviceability as the BAP can see it from on_search (the BAP never reads bpp.*). */
export function storeInfoFromOffers(offers: SeenOffer[]): PlanStoreInfo[] {
  const byStore = new Map<string, SeenOffer>();
  for (const o of offers) if (!byStore.has(o.storeId)) byStore.set(o.storeId, o);
  return [...byStore.values()].map((o) => ({
    storeId: o.storeId,
    storeName: o.storeName,
    distanceM: o.distanceM,
    // Full rule when the BPP sends it (KTAG.deliveryRule); otherwise the flat charge it quoted for an empty basket
    // (an over-estimate for "free above" stores; the real quote has the exact figure).
    deliveryFor: (subtotal) => (o.deliveryRule ? deliveryChargePaise(o.deliveryRule, o.distanceM, subtotal) : (o.deliveryChargePaise ?? 0)),
  }));
}

/** POST /bap/plan: gateway search per need, restrict to best-matching products, run the optimiser. */
export async function planForCustomer(
  ctx: AppContext,
  customer: CustomerRow,
  body: { needs: PlanNeed[]; budgetPaise?: number | null },
): Promise<PlanResult> {
  const searched = await Promise.all(body.needs.map((n) => searchOffers(ctx, customer, { query: n.query })));
  const loose: LooseDeclined[] = [];
  for (const s of searched) loose.push(...s.looseDeclined);

  const result = planBasket({
    needs: body.needs.map((n, i) => ({ query: n.query, qty: n.qty, offers: bestMatchingOffers(n.query, searched[i]!.offers) })),
    stores: storeInfoFromOffers(searched.flatMap((s) => s.offers)),
    budgetPaise: body.budgetPaise ?? null,
    looseDeclined: loose,
  });

  // A need whose request was declined as loose gets the decline as its reason.
  const declined = new Map(loose.map((l) => [l.query, l]));
  result.unmatched = result.unmatched.map((u) => (declined.has(u.query) ? { ...u, reason: declined.get(u.query)!.reason } : u));
  // Strip internal fields before returning.
  for (const c of result.choices) {
    const { deliveryRule: _rule, ...offer } = c.offer as SeenOffer;
    c.offer = offer;
  }
  return result;
}
