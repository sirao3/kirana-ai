import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliveryChargePaise, DeliveryRule, haversineM, type PlanResult, type QuoteResponse, type SearchOffer } from "@kiranaai/shared";
import { SEED, listingId, storeIdForKey } from "../src/db/seed/seed.js";
import { bestMatchingOffers, planBasket, type PlanStoreInfo } from "../src/bap/plan/optimiser.js";
import { startHarness, type BapHarness } from "./fixtures/harness.js";

const NAMES: Record<string, string> = { X: "X Mart", Y: "Y Mart", L: "Lakshmi Stores", G: "Gupta Kirana" };
const offer = (storeId: string, canonical: string, pricePaise: number, extra: Partial<SearchOffer> = {}): SearchOffer => ({
  listingId: `lst_${storeId}_${canonical}`, storeId, storeName: NAMES[storeId] ?? storeId, bppId: "b", bppUri: "http://b",
  canonicalProductId: canonical, name: canonical, brand: "", packLabel: "1 kg", pricePaise, mrpPaise: pricePaise, stockQty: 10,
  distanceM: 1000, deliveryChargePaise: null, badge: "catalogue", ...extra,
});
const store = (storeId: string, name: string, flat: number | null, distanceM = 1000): PlanStoreInfo => ({
  storeId, storeName: name, distanceM, deliveryFor: () => flat,
});

describe("planBasket (T09, pure)", () => {
  it("consolidation trade-off: a slightly dearer item from the store you are already using wins", () => {
    // A is ₹12 cheaper at X, but Y also sells B; X + Y costs two deliveries.
    const stores = [store("X", "X Mart", 3000), store("Y", "Y Mart", 3000)];
    const needs = [
      { query: "a", qty: 1, offers: [offer("X", "a", 10000), offer("Y", "a", 11200)] },
      { query: "b", qty: 1, offers: [offer("Y", "b", 5000)] },
    ];
    const r = planBasket({ needs, stores });
    expect(r.stores.map((s) => s.storeId)).toEqual(["Y"]);
    expect(r.estimatedTotalPaise).toBe(11200 + 5000 + 3000); // vs 10000 + 5000 + 6000 = 21000
    expect(r.choices[0]!.reason).toBe("₹12 more than X Mart, but ordering with your other items from Y Mart saves ₹18 overall");
    expect(r.choices[1]!.reason).toBe("Only Y Mart has this in stock");
    expect(r.reasons).toContain("Buying from one store saves ₹18 compared with taking the lowest price for every item (delivery adds up)");
  });

  it("splits across stores when the saving beats the extra delivery, and says so", () => {
    const stores = [store("X", "X Mart", 2000), store("L", "Lakshmi Stores", 3000)];
    const needs = [
      { query: "atta", qty: 1, offers: [offer("X", "atta", 45000)] },
      { query: "milk", qty: 8, offers: [offer("X", "milk", 7200), offer("L", "milk", 6500)] },
    ];
    // milk at X: 57600; at L: 52000 + 3000 = 55000 → adding L saves ₹26 even after ₹30 delivery
    const r = planBasket({ needs, stores });
    expect(r.stores.map((s) => s.storeId).sort()).toEqual(["L", "X"]);
    expect(r.estimatedTotalPaise).toBe(45000 + 2000 + 52000 + 3000);
    expect(r.reasons).toContain("Adding Lakshmi Stores saves ₹26 even after ₹30 delivery");
    expect(r.choices[1]!.reason).toBe("₹56 cheaper than X Mart"); // line difference 8 x ₹7
    expect(r.choices[1]!.reason).not.toContain("NaN");
  });

  it("a free-delivery store is reported as such", () => {
    const stores = [store("X", "X Mart", 2000), { ...store("G", "Gupta Kirana", 0), deliveryFor: (s: number) => (s >= 30000 ? 0 : 3000) }];
    const needs = [
      { query: "atta", qty: 1, offers: [offer("X", "atta", 45000)] },
      { query: "dal", qty: 2, offers: [offer("X", "dal", 16500), offer("G", "dal", 15000)] },
      { query: "tea", qty: 1, offers: [offer("X", "tea", 9000), offer("G", "tea", 8000)] },
    ];
    const r = planBasket({ needs, stores });
    expect(r.stores.map((s) => [s.storeId, s.deliveryPaise])).toEqual([["G", 0], ["X", 2000]]);
    expect(r.reasons.some((x) => x.startsWith("Adding Gupta Kirana saves") && x.endsWith("(free delivery)"))).toBe(true);
  });

  it("budget check: over and under, with the overrun in the reasons", () => {
    const stores = [store("X", "X Mart", 2000)];
    const needs = [{ query: "a", qty: 2, offers: [offer("X", "a", 50000)] }];
    const over = planBasket({ needs, stores, budgetPaise: 100000 });
    expect(over.estimatedTotalPaise).toBe(102000);
    expect(over).toMatchObject({ budgetPaise: 100000, withinBudget: false });
    expect(over.reasons).toContain("Estimated ₹1,020 is ₹20 over your ₹1,000 budget");
    const under = planBasket({ needs, stores, budgetPaise: 150000 });
    expect(under.withinBudget).toBe(true);
    expect(under.reasons).toContain("Estimated ₹1,020 is ₹480 under your ₹1,500 budget");
    expect(planBasket({ needs, stores }).withinBudget).toBeNull();
  });

  it("ties: cheapest, then fewer stores, then smaller total distance", () => {
    // Same ₹1,400 total three ways (PRD §12): S+G+L, S+G+A, and also a 4-store variant.
    const stores = [store("S", "S", 0, 500), store("L", "L", 0, 900), store("A", "A", 0, 2300)];
    const needs = [
      { query: "milk", qty: 1, offers: [offer("L", "milk", 10000), offer("A", "milk", 10000)] },
      { query: "x", qty: 1, offers: [offer("S", "x", 5000)] },
    ];
    const r = planBasket({ needs, stores });
    expect(r.stores.map((s) => s.storeId)).toEqual(["L", "S"]); // L is nearer than A
    // fewer stores beats distance
    const one = planBasket({
      needs: [{ query: "m", qty: 1, offers: [offer("L", "m", 10000), offer("A", "m", 10000)] }, { query: "n", qty: 1, offers: [offer("A", "n", 5000), offer("S", "n", 5000)] }],
      stores,
    });
    expect(one.stores.map((s) => s.storeId)).toEqual(["A"]);
  });

  it("insufficient stock, unserviceable stores and unknown products are reported, not planned", () => {
    const stores = [store("X", "X Mart", 1000), store("FAR", "Far Mart", null)];
    const r = planBasket({
      needs: [
        { query: "milk", qty: 8, offers: [offer("X", "milk", 7000, { stockQty: 3 })] },
        { query: "nothing", qty: 1, offers: [] },
        { query: "tea", qty: 1, offers: [offer("FAR", "tea", 100), offer("X", "tea", 9000)] },
        { query: "salt", qty: 0, offers: [offer("X", "salt", 100)] },
      ],
      stores,
    });
    expect(r.choices.map((c) => c.query)).toEqual(["tea"]);
    expect(r.choices[0]!.offer.storeId).toBe("X"); // FAR cannot deliver
    expect(r.unmatched).toEqual([
      { query: "milk", reason: "No nearby store has 8 in stock." },
      { query: "nothing", reason: "No nearby store sells this." },
      { query: "salt", reason: "Quantity must be a whole number of packs (1 or more)." },
    ]);
    expect(Number.isInteger(r.estimatedTotalPaise)).toBe(true);
    expect(r.estimatedTotalPaise).toBe(10000);
  });

  it("restricts candidates to the best-matching canonical products", () => {
    const offers = [
      offer("X", "toor", 15000, { name: "Tata Sampann Unpolished Toor Dal", brand: "Tata" }),
      offer("X", "moong", 14000, { name: "Tata Sampann Moong Dal", brand: "Tata" }),
      offer("Y", "moong", 13000, { name: "Tata Sampann Moong Dal", brand: "Tata" }),
    ];
    expect(bestMatchingOffers("toor dal", offers).map((o) => o.canonicalProductId)).toEqual(["toor"]);
    expect(bestMatchingOffers("dal", offers)).toHaveLength(3); // tie → all products that match equally
    expect(bestMatchingOffers("gehun ka aata", offers)).toHaveLength(3); // nothing matches textually → keep what the BPP returned
  });
});

// ---------- seed constraint C1 with the real optimiser ----------

describe("seed constraint C1 (PRD §14) with plan_basket", () => {
  const priya = SEED.customers.find((c) => c.id === "cust_priya")!;
  const stores: PlanStoreInfo[] = SEED.stores.map((s) => {
    const rule = DeliveryRule.parse(s.delivery_rule);
    const distanceM = haversineM(priya, s);
    return { storeId: s.id, storeName: s.name, distanceM, deliveryFor: (sub) => deliveryChargePaise(rule, distanceM, sub) };
  });
  const offersFor = (prefix: string): SearchOffer[] =>
    SEED.products.filter((p) => p.id.startsWith(prefix)).flatMap((p) =>
      Object.entries(p.listings).map(([key, [price, stock]]) =>
        offer(storeIdForKey(key), p.id, price as number, {
          listingId: listingId(key, p.id), storeName: SEED.stores.find((s) => s.key === key)!.name, stockQty: stock as number,
          distanceM: stores.find((s) => s.storeId === storeIdForKey(key))!.distanceM, name: p.name, brand: p.brand,
        }),
      ),
    );

  it("picks exactly Sharma, Gupta, Lakshmi for ₹1,400 under ₹1,500", () => {
    const r = planBasket({
      needs: SEED.demo.needs.map((n) => ({ query: n.query, qty: n.qty, offers: offersFor(n.category_prefix) })),
      stores,
      budgetPaise: 150000,
    });
    expect(r.stores.map((s) => s.storeId).sort()).toEqual([...SEED.demo.expected_stores].sort());
    expect(r.estimatedTotalPaise).toBe(SEED.demo.expected_total_paise);
    expect(r.withinBudget).toBe(true);
    const by = Object.fromEntries(r.choices.map((c) => [c.query, c.offer.storeId]));
    expect(by).toEqual({ atta: "store_sharma", "toor dal": "store_gupta", tea: "store_gupta", milk: "store_lakshmi" });
    expect(r.stores.find((s) => s.storeId === "store_gupta")).toMatchObject({ itemsTotalPaise: 38000, deliveryPaise: 0 });
    expect(r.choices.every((c) => c.reason.length > 0)).toBe(true);
    // reasons are built from the numbers (Annapurna ties Lakshmi's ₹550 total, so only the line-level reason applies)
    expect(r.choices.find((c) => c.query === "milk")!.reason).toBe("₹20 cheaper than Annapurna Provisions");
    expect(r.reasons).toEqual([
      "Adding Gupta Kirana saves ₹28 (free delivery)",
      "Adding Sharma General Store saves ₹5 even after ₹20 delivery",
      "Estimated ₹1,400 is ₹100 under your ₹1,500 budget",
    ]);
  });
});

// ---------- POST /bap/plan through the gateway ----------

describe("POST /bap/plan", () => {
  let h: BapHarness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  it("plans the demo prompt from live search results: 3 stores, ₹1,400, and the plan matches the quote", async () => {
    const r = await h.call<PlanResult>("POST", "/bap/plan", { needs: SEED.demo.needs.map((n) => ({ query: n.query, qty: n.qty })), budgetPaise: 150000 });
    expect(r.status).toBe(200);
    expect(r.body.stores.map((s) => s.storeId).sort()).toEqual(["store_gupta", "store_lakshmi", "store_sharma"]);
    expect(r.body.estimatedTotalPaise).toBe(140000);
    expect(r.body).toMatchObject({ withinBudget: true, unmatched: [] });
    expect(r.body.choices.map((c) => c.offer.listingId)).toEqual([
      listingId("sharma", "cp_atta_aashirvaad_10kg"), listingId("gupta", "cp_toor_tata_1kg"), listingId("gupta", "cp_tea_tata_premium_250g"), listingId("lakshmi", "cp_milk_amul_taaza_1l"),
    ]);
    expect(JSON.stringify(r.body)).not.toContain("deliveryRule");

    // the plan's choices go straight into the basket and quote to the same total
    await h.call("PUT", "/bap/basket", { items: r.body.choices.map((c) => ({ listingId: c.offer.listingId, qty: c.qty })) });
    const q = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    expect(q.body.quote!.grandTotalPaise).toBe(r.body.estimatedTotalPaise);
  });

  it("flags a budget overrun, unmatched needs and loose requests", async () => {
    const r = await h.call<PlanResult>("POST", "/bap/plan", {
      needs: [{ query: "atta", qty: 1 }, { query: "250 g jeera", qty: 1 }, { query: "unobtainium", qty: 1 }],
      budgetPaise: 10000,
    });
    expect(r.body.withinBudget).toBe(false);
    expect(r.body.reasons.some((x) => x.includes("over your ₹100 budget"))).toBe(true);
    expect(r.body.looseDeclined).toHaveLength(1);
    expect(r.body.looseDeclined[0]!.alternative?.canonicalProductId).toBe("cp_jeera_everest_100g");
    expect(r.body.unmatched.map((u) => u.query)).toEqual(expect.arrayContaining(["unobtainium"]));
  });

  it("prices the current basket as a baseline, and canonicalProductId restricts candidates", async () => {
    const needs = SEED.demo.needs.map((n) => ({ query: n.query, qty: n.qty }));
    const plan = await h.call<PlanResult>("POST", "/bap/plan", { needs });
    expect(plan.body.baseline).toBeUndefined();
    const current = plan.body.choices.map((c) => ({ listingId: c.offer.listingId, qty: c.qty }));
    const same = await h.call<PlanResult>("POST", "/bap/plan", { needs, current });
    expect(same.body.baseline!.estimatedTotalPaise).toBe(same.body.estimatedTotalPaise);
    // a basket that is not the plan's (all four from one store's offers) is priced above the plan
    const sharmaOnly = [{ listingId: listingId("sharma", "cp_atta_aashirvaad_10kg"), qty: 1 }, { listingId: listingId("sharma", "cp_milk_amul_taaza_1l"), qty: 8 }];
    const worse = await h.call<PlanResult>("POST", "/bap/plan", { needs: [needs[0]!, needs[3]!], current: sharmaOnly });
    expect(worse.body.baseline!.estimatedTotalPaise).toBeGreaterThanOrEqual(worse.body.estimatedTotalPaise);
    const pinned = await h.call<PlanResult>("POST", "/bap/plan", {
      needs: [{ query: "milk", qty: 8, canonicalProductId: "cp_milk_amul_taaza_1l" }],
    });
    expect(new Set(pinned.body.choices.map((c) => c.offer.canonicalProductId))).toEqual(new Set(["cp_milk_amul_taaza_1l"]));
  });

  it("GET /bap/suggest returns distinct products for a partial or synonym query", async () => {
    const r = await h.call<{ query: string; suggestions: { canonicalProductId: string; name: string; fromPricePaise: number }[] }>("GET", "/bap/suggest?q=gehun");
    expect(r.status).toBe(200);
    const ids = r.body.suggestions.map((x) => x.canonicalProductId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("cp_atta_aashirvaad_10kg");
    expect(r.body.suggestions[0]!.fromPricePaise).toBeGreaterThan(0);
    expect((await h.call("GET", "/bap/suggest?q=")).status).toBe(400);
  });

  it("validates the body", async () => {
    expect((await h.call("POST", "/bap/plan", { needs: [{ query: "atta", qty: 1.5 }] })).status).toBe(400);
    expect((await h.call("POST", "/bap/plan", { needs: [] })).status).toBe(400);
  });
});
