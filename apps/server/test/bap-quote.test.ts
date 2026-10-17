import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BasketView, QuoteResponse, SearchResponse } from "@kiranaai/shared";
import { buildDemoBasket, L, startHarness, type BapHarness } from "./fixtures/harness.js";

describe("discovery, basket and quote (T06)", () => {
  let h: BapHarness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  it("requires a customer token", async () => {
    expect((await h.call("GET", "/bap/search?q=atta", undefined, { token: "nope" })).status).toBe(401);
    const admin = await fetch(`${h.t.url}/auth/persona`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "admin", passcode: "demo" }) });
    const { token } = (await admin.json()) as { token: string };
    expect((await h.call("GET", "/bap/basket", undefined, { token })).status).toBe(403);
  });

  it("search groups by canonical product, cheapest first, and persists seen offers", async () => {
    const r = await h.call<SearchResponse>("GET", "/bap/search?q=atta");
    expect(r.status).toBe(200);
    const g = r.body.groups.find((x) => x.canonicalProductId === "cp_atta_aashirvaad_10kg")!;
    expect(g.offers.length).toBeGreaterThanOrEqual(3);
    expect(g.offers[0]).toMatchObject({ storeId: "store_sharma", pricePaise: 45000, badge: "catalogue", packLabel: "10 kg" });
    expect(g.offers.map((o) => o.pricePaise)).toEqual([...g.offers.map((o) => o.pricePaise)].sort((a, b) => a - b));
    expect(g.offers[0]!.deliveryChargePaise).toBe(2000);
    const { rows } = await h.t.pool.query("SELECT 1 FROM bap.seen_offer WHERE listing_id = $1", [L.atta]);
    expect(rows).toHaveLength(1);
    // Hinglish goes through the same path
    const hi = await h.call<SearchResponse>("GET", "/bap/search?q=" + encodeURIComponent("gehun ka aata"));
    expect(hi.body.groups.length).toBeGreaterThan(0);
  });

  it("passes through loose_declined with the packaged alternative", async () => {
    const r = await h.call<SearchResponse>("GET", "/bap/search?q=" + encodeURIComponent("250 g jeera"));
    expect(r.body.looseDeclined).toHaveLength(1);
    expect(r.body.looseDeclined[0]!.alternative).toMatchObject({ canonicalProductId: "cp_jeera_everest_100g", packLabel: "100 g" });
    expect(r.body.groups[0]!.canonicalProductId).toBe("cp_jeera_everest_100g");
  });

  it("basket only accepts listings seen in a search; edits and removal work", async () => {
    const unknown = await h.call("PUT", "/bap/basket/items", { listingId: L.atta, qty: 1 });
    expect(unknown.status).toBe(404);
    await h.call("GET", "/bap/search?q=atta");
    const added = await h.call<BasketView>("PUT", "/bap/basket/items", { listingId: L.atta, qty: 2 });
    expect(added.body.stores).toHaveLength(1);
    expect(added.body.stores[0]).toMatchObject({ storeId: "store_sharma", itemsTotalPaise: 90000 });
    expect((await h.call("PUT", "/bap/basket/items", { listingId: L.atta, qty: 1.5 })).status).toBe(400);
    expect((await h.call("PUT", "/bap/basket/items", { listingId: L.atta, qty: 0 })).status).toBe(400);
    const patched = await h.call<BasketView>("PATCH", `/bap/basket/items/${L.atta}`, { qty: 3 });
    expect(patched.body.stores[0]!.items[0]!.qty).toBe(3);
    const removed = await h.call<BasketView>("DELETE", `/bap/basket/items/${L.atta}`);
    expect(removed.body.itemCount).toBe(0);
    expect((await h.call("DELETE", `/bap/basket/items/${L.atta}`)).status).toBe(404);
  });

  it("quotes the 3-store demo basket built by hand: ₹1,400.00", async () => {
    const built = await buildDemoBasket(h);
    expect(built.body.stores.map((s: { storeId: string }) => s.storeId).sort()).toEqual(["store_gupta", "store_lakshmi", "store_sharma"]);

    const r = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    expect(r.status).toBe(200);
    expect(r.body.errors).toEqual([]);
    const q = r.body.quote!;
    expect(r.body.basket.status).toBe("QUOTED");
    expect(q.grandTotalPaise).toBe(140000);
    expect(q.itemsTotalPaise).toBe(45000 + 2 * 15000 + 8000 + 8 * 6500);
    expect(q.deliveryTotalPaise).toBe(2000 + 0 + 3000);
    expect(q.platformFeePaise).toBe(0);
    const by = Object.fromEntries(q.stores.map((s) => [s.storeId, s.totalPaise]));
    expect(by).toEqual({ store_sharma: 47000, store_gupta: 38000, store_lakshmi: 55000 });
    expect(q.quoteHash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(q.validUntil).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(q.expired).toBe(false);
    expect(q.stores.flatMap((s) => s.lines).every((l) => !l.priceChanged && l.available)).toBe(true);
    // same basket re-quoted → same hash
    const again = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    expect(again.body.quote!.quoteHash).toBe(q.quoteHash);
    // select + init per store reached the BPP
    expect(h.fake.received.select).toBe(6);
    expect(h.fake.received.init).toBe(6);
  });

  it("adds the platform fee from bap.config", async () => {
    await buildDemoBasket(h);
    await h.t.pool.query("UPDATE bap.config SET platform_fee_paise = 500");
    const r = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    expect(r.body.quote).toMatchObject({ platformFeePaise: 500, grandTotalPaise: 140500 });
  });

  it("a merchant price change shows in the next quote with priceChanged", async () => {
    await buildDemoBasket(h);
    h.fake.setPrice("store_gupta", "cp_toor_tata_1kg", 15500);
    const r = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    const toor = r.body.quote!.stores.flatMap((s) => s.lines).find((l) => l.listingId === L.toor)!;
    expect(toor).toMatchObject({ unitPricePaise: 15500, seenPricePaise: 15000, priceChanged: true, lineTotalPaise: 31000 });
    expect(r.body.quote!.grandTotalPaise).toBe(141000);
    expect(r.body.quote!.stores.flatMap((s) => s.lines).filter((l) => l.priceChanged)).toHaveLength(1);
  });

  it("an edit after a quote moves the basket back to DRAFT", async () => {
    await buildDemoBasket(h);
    await h.call("POST", "/bap/basket/quote");
    const edited = await h.call<BasketView>("PATCH", `/bap/basket/items/${L.milk}`, { qty: 4 });
    expect(edited.body.status).toBe("DRAFT");
    expect(edited.body.quote).toBeNull();
    const q2 = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    expect(q2.body.basket.status).toBe("QUOTED");
    expect(q2.body.quote!.grandTotalPaise).toBe(140000 - 4 * 6500 + 0 /* Lakshmi delivery unchanged */);
  });

  it("expiry is checked on read", async () => {
    await buildDemoBasket(h);
    await h.call("POST", "/bap/basket/quote");
    await h.t.pool.query("UPDATE bap.quote SET valid_until = now() - interval '1 second'");
    const b = await h.call<BasketView>("GET", "/bap/basket");
    expect(b.body.status).toBe("EXPIRED");
    expect(b.body.quote!.expired).toBe(true);
    const re = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    expect(re.body.basket.status).toBe("QUOTED");
    expect(re.body.quote!.expired).toBe(false);
  });

  it("returns per-store errors and no quote when a store fails", async () => {
    await buildDemoBasket(h);
    h.fake.setStock("store_lakshmi", "cp_milk_amul_taaza_1l", 3);
    h.fake.setOnline("store_gupta", false);
    const r = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    expect(r.status).toBe(200);
    expect(r.body.quote).toBeNull();
    expect(r.body.basket.status).toBe("DRAFT");
    const byStore = Object.fromEntries(r.body.errors.map((e) => [e.storeId, e]));
    expect(byStore.store_lakshmi).toMatchObject({ code: "OUT_OF_STOCK", listingIds: [L.milk] });
    expect(byStore.store_gupta).toMatchObject({ code: "STORE_OFFLINE" });
    expect(byStore.store_sharma).toBeUndefined();
  });

  it("rejects an empty basket", async () => {
    expect((await h.call("POST", "/bap/basket/quote")).status).toBe(400);
  });
});
