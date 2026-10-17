import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deliveryChargePaise, DeliveryRule, haversineM } from "@kiranaai/shared";
import { SEED, resetAndSeed, storeIdForKey } from "../src/db/seed/seed.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { TEST_DATABASE_URL } from "./helpers.js";

const priya = SEED.customers.find((c) => c.id === "cust_priya")!;
const rahul = SEED.customers.find((c) => c.id === "cust_rahul")!;
const stores = SEED.stores.map((s) => ({ ...s, rule: DeliveryRule.parse(s.delivery_rule), distM: haversineM(priya, s) }));

interface Offer { storeId: string; productId: string; pricePaise: number; stock: number }
const offers: Offer[] = SEED.products.flatMap((p) =>
  Object.entries(p.listings).map(([key, [price, stock]]) => ({ storeId: storeIdForKey(key), productId: p.id, pricePaise: price as number, stock: stock as number })),
);

/** Reference brute-force optimiser (PRD §12): cheapest per need within each subset + delivery of stores used. */
function referencePlan(needs: { category_prefix: string; qty: number }[], storeIds: string[]) {
  let best: { total: number; used: string[]; dist: number; picks: Offer[] } | null = null;
  for (let mask = 1; mask < 1 << storeIds.length; mask++) {
    const subset = storeIds.filter((_, i) => mask & (1 << i));
    const picks: Offer[] = [];
    let ok = true;
    for (const n of needs) {
      const cands = offers.filter((o) => subset.includes(o.storeId) && o.productId.startsWith(n.category_prefix) && o.stock >= n.qty);
      if (!cands.length) { ok = false; break; }
      picks.push(cands.reduce((a, b) => (b.pricePaise < a.pricePaise ? b : a)));
    }
    if (!ok) continue;
    const used = [...new Set(picks.map((p) => p.storeId))];
    let total = 0;
    for (const sid of used) {
      const s = stores.find((x) => x.id === sid)!;
      const subtotal = picks.reduce((acc, p, i) => acc + (p.storeId === sid ? p.pricePaise * needs[i]!.qty : 0), 0);
      const d = deliveryChargePaise(s.rule, s.distM, subtotal);
      if (d === null) { ok = false; break; }
      total += subtotal + d;
    }
    if (!ok) continue;
    const dist = used.reduce((a, sid) => a + stores.find((x) => x.id === sid)!.distM, 0);
    const better = !best || total < best.total || (total === best.total && (used.length < best.used.length || (used.length === best.used.length && dist < best.dist)));
    if (better) best = { total, used, dist, picks };
  }
  return best!;
}

/** Cost for one store to take over a sub-order's exact canonical items (PRD §8.2). */
function takeoverCost(storeId: string, items: { productId: string; qty: number }[]): number | null {
  const s = stores.find((x) => x.id === storeId)!;
  let subtotal = 0;
  for (const it of items) {
    const o = offers.find((x) => x.storeId === storeId && x.productId === it.productId && x.stock >= it.qty);
    if (!o) return null;
    subtotal += o.pricePaise * it.qty;
  }
  const d = deliveryChargePaise(s.rule, s.distM, subtotal);
  return d === null ? null : subtotal + d;
}

describe("seed data constraints (PRD §14)", () => {
  it("has 5 stores within 3 km and radius of the demo customer; second customer outside most", () => {
    expect(stores).toHaveLength(5);
    for (const s of stores) {
      expect(s.distM).toBeLessThanOrEqual(3000);
      expect(s.distM).toBeLessThanOrEqual(s.delivery_radius_m);
    }
    const outside = SEED.stores.filter((s) => haversineM(rahul, s) > s.delivery_radius_m);
    expect(outside.length).toBeGreaterThanOrEqual(3);
  });

  it("has ~30 products, ~100 valid listings", () => {
    expect(SEED.products.length).toBeGreaterThanOrEqual(30);
    expect(offers.length).toBeGreaterThanOrEqual(100);
    for (const p of SEED.products) for (const [price] of Object.values(p.listings)) expect(price).toBeLessThanOrEqual(p.mrp_paise);
    expect(new Set(SEED.products.map((p) => p.id)).size).toBe(SEED.products.length);
  });

  it("C1: demo needs pick exactly Sharma, Gupta, Lakshmi for ₹1,400 (worked example §9)", () => {
    const plan = referencePlan(SEED.demo.needs, stores.map((s) => s.id));
    expect(plan.used.sort()).toEqual([...SEED.demo.expected_stores].sort());
    expect(plan.total).toBe(SEED.demo.expected_total_paise);
    expect(plan.total).toBeLessThan(150000);
    const byStore = (sid: string) => plan.picks.filter((p) => p.storeId === sid).map((p) => p.productId);
    expect(byStore("store_sharma")).toEqual(["cp_atta_aashirvaad_10kg"]);
    expect(byStore("store_gupta")).toEqual(["cp_toor_tata_1kg", "cp_tea_tata_premium_250g"]);
    expect(byStore("store_lakshmi")).toEqual(["cp_milk_amul_taaza_1l"]);
  });

  it("C2: Balaji is the best backup for Gupta's items, Annapurna for Lakshmi's", () => {
    const gupta = [{ productId: "cp_toor_tata_1kg", qty: 2 }, { productId: "cp_tea_tata_premium_250g", qty: 1 }];
    const lakshmi = [{ productId: "cp_milk_amul_taaza_1l", qty: 8 }];
    const rank = (items: typeof gupta, exclude: string) =>
      stores.filter((s) => s.id !== exclude).map((s) => ({ id: s.id, cost: takeoverCost(s.id, items) }))
        .filter((x) => x.cost !== null).sort((a, b) => a.cost! - b.cost!);
    expect(takeoverCost("store_gupta", gupta)).toBe(38000);
    expect(rank(gupta, "store_gupta")[0]).toEqual({ id: "store_balaji", cost: 42000 }); // ₹395 + ₹25 → subsidy ₹40
    expect(takeoverCost("store_lakshmi", lakshmi)).toBe(55000);
    expect(rank(lakshmi, "store_lakshmi")[0]).toEqual({ id: "store_annapurna", cost: 55000 }); // ₹540 + ₹10 → subsidy ₹0
    expect(takeoverCost("store_sharma", [{ productId: "cp_atta_aashirvaad_10kg", qty: 1 }])).toBe(47000);
  });

  it("C3: jeera exists only as a 100 g pack", () => {
    const jeera = SEED.products.filter((p) => /jeera|cumin/.test(p.keywords + p.name.toLowerCase()));
    expect(jeera.map((p) => [p.pack_size, p.unit])).toEqual([[100, "g"]]);
  });
});

describe("resetAndSeed (database)", () => {
  const h = createDb(TEST_DATABASE_URL);
  beforeAll(async () => {
    await runMigrations(h.pool);
    await resetAndSeed(h.pool, { selfBaseUrl: "http://127.0.0.1:9999" });
    await resetAndSeed(h.pool, { selfBaseUrl: "http://127.0.0.1:9999" }); // idempotent
  });
  afterAll(() => h.close());

  it("loads everything", async () => {
    const q = async (sql: string) => (await h.pool.query<{ n: number }>(sql)).rows[0]!.n;
    expect(await q("SELECT count(*)::int n FROM bpp.store WHERE is_online")).toBe(5);
    expect(await q("SELECT count(*)::int n FROM bpp.canonical_product")).toBe(SEED.products.length);
    expect(await q("SELECT count(*)::int n FROM bpp.listing")).toBe(offers.length);
    expect(await q("SELECT count(*)::int n FROM registry.participant")).toBe(3);
    expect(await q("SELECT count(*)::int n FROM bap.customer")).toBe(2);
    expect(await q("SELECT offer_window_seconds n FROM bap.config")).toBe(45);
    expect(await q("SELECT count(*)::int n FROM pg_extension WHERE extname = 'pg_trgm'")).toBe(1);
  });

  it("has backups for Gupta's and Lakshmi's demo items", async () => {
    const { rows } = await h.pool.query<{ store_id: string; canonical_product_id: string }>(`
      SELECT l.store_id, l.canonical_product_id FROM bpp.listing l
      WHERE l.canonical_product_id IN ('cp_toor_tata_1kg', 'cp_tea_tata_premium_250g', 'cp_milk_amul_taaza_1l')
        AND l.store_id IN ('store_balaji', 'store_annapurna') AND l.stock_qty >= 8 AND l.active`);
    const have = rows.map((r) => `${r.store_id}:${r.canonical_product_id}`);
    expect(have).toEqual(expect.arrayContaining([
      "store_balaji:cp_toor_tata_1kg", "store_balaji:cp_tea_tata_premium_250g", "store_annapurna:cp_milk_amul_taaza_1l",
    ]));
  });

  it("trigram + full-text search index finds Hinglish keywords", async () => {
    const { rows } = await h.pool.query<{ id: string }>(
      "SELECT id FROM bpp.canonical_product WHERE search_text % 'gehun ka aata' OR to_tsvector('simple', search_text) @@ plainto_tsquery('simple', 'atta') ORDER BY id",
    );
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["cp_atta_aashirvaad_10kg", "cp_atta_fortune_10kg"]));
  });
});
