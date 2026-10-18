import { describe, expect, it } from "vitest";
import type { BasketView, PlanResult, SearchOffer } from "@kiranaai/shared";
import { addNeed, cheapestListingId, effectiveLabel, effectivePaise, nudgeFrom, parseNeeds, rankOffers } from "./pricing";

const offer = (listingId: string, pricePaise: number, deliveryChargePaise: number | null, extra: Partial<SearchOffer> = {}): SearchOffer => ({
  listingId, storeId: `s_${listingId}`, storeName: listingId, bppId: "b", bppUri: "u", canonicalProductId: "cp", name: "Tea", brand: "", packLabel: "250 g",
  pricePaise, mrpPaise: pricePaise, stockQty: 9, distanceM: 1000, deliveryChargePaise, badge: "catalogue", ...extra,
});

describe("effective price", () => {
  it("adds delivery and words it", () => {
    expect(effectivePaise(offer("a", 45000, 2000))).toBe(47000);
    expect(effectiveLabel(offer("a", 45000, 2000))).toBe("₹450 + ₹20 delivery = ₹470 if bought alone");
    expect(effectiveLabel(offer("a", 45000, 0))).toBe("₹450 with free delivery");
    expect(effectiveLabel(offer("a", 45000, null))).toBe("₹450 + delivery at quote");
  });

  it("Cheapest follows effective price, not sticker price", () => {
    const cheapSticker = offer("far", 44000, 5000); // 490
    const dearSticker = offer("near", 45000, 0); // 450
    expect(rankOffers([cheapSticker, dearSticker]).map((o) => o.listingId)).toEqual(["near", "far"]);
    expect(cheapestListingId([cheapSticker, dearSticker])).toBe("near");
    expect(cheapestListingId([cheapSticker])).toBeNull();
  });
});

describe("shopping list text", () => {
  it("parses the demo list with explicit quantities only", () => {
    expect(parseNeeds("atta, toor dal x2, tea, milk x8")).toEqual([
      { query: "atta", qty: 1 }, { query: "toor dal", qty: 2 }, { query: "tea", qty: 1 }, { query: "milk", qty: 8 },
    ]);
    expect(parseNeeds("2 x milk\ntoor dal 1 kg; oil 3 packs")).toEqual([
      { query: "milk", qty: 2 }, { query: "toor dal 1 kg", qty: 1 }, { query: "oil", qty: 3 },
    ]);
  });
  it("merges repeats", () => {
    expect(addNeed([{ query: "tea", qty: 1 }], { query: "Tea", qty: 2 })).toEqual([{ query: "tea", qty: 3 }]);
    expect(addNeed([], { query: "tea", qty: 1 })).toHaveLength(1);
  });
});

const basket = (items: { listingId: string; name: string; canonicalProductId: string; storeId: string }[]): BasketView =>
  ({
    id: "b", status: "DRAFT", transactionId: "t", itemCount: items.length, quote: null,
    stores: items.map((i) => ({ storeId: i.storeId, storeName: i.storeId, itemsTotalPaise: 0, items: [{ ...i, storeName: i.storeId, qty: 1, seenPricePaise: 0, lineTotalPaise: 0 }] })),
  }) as BasketView;

describe("basket nudge", () => {
  const plan = (baseline: number | undefined, total: number, listing = "tea_sharma"): PlanResult => ({
    choices: [{ query: "Tea", qty: 1, reason: "r", offer: offer(listing, 9000, 0, { canonicalProductId: "cp_tea", storeName: "Sharma Kirana" }) }],
    stores: [], estimatedTotalPaise: total, budgetPaise: null, withinBudget: null, reasons: [], unmatched: [], looseDeclined: [],
    ...(baseline === undefined ? {} : { baseline: { estimatedTotalPaise: baseline, stores: [] } }),
  });
  const b = basket([{ listingId: "tea_gupta", name: "Tata Tea", canonicalProductId: "cp_tea", storeId: "gupta" }]);

  it("states the saving from the plan numbers", () => {
    const n = nudgeFrom(b, plan(143000, 140000))!;
    expect(n.savingPaise).toBe(3000);
    expect(n.text).toBe("Save ₹30 by moving Tata Tea to Sharma Kirana");
    expect(n.items).toEqual([{ listingId: "tea_sharma", qty: 1, reason: "r" }]);
  });
  it("no nudge when there is no saving, no baseline or no move", () => {
    expect(nudgeFrom(b, plan(140000, 140000))).toBeNull();
    expect(nudgeFrom(b, plan(undefined, 140000))).toBeNull();
    expect(nudgeFrom(b, plan(143000, 140000, "tea_gupta"))).toBeNull();
  });
});
