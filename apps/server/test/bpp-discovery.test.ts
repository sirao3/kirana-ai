import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTag, gpsOf, KTAG, paiseOf, tag, type Envelope } from "@kiranaai/shared";
import { becknCall, searchViaGateway } from "../src/bap/beckn-client.js";
import { clearRegistryCache } from "../src/beckn/registry.js";
import { BPP_ID } from "../src/bpp/identity.js";
import { resetAndSeed } from "../src/db/seed/seed.js";
import { startTestApp } from "./helpers.js";

const PRIYA = gpsOf(12.9719, 77.6412);
const RAHUL = gpsOf(12.9352, 77.6245); // outside most radii

describe("BPP search / select / init (T04)", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let n = 0;
  const txn = () => `txn_t04_${++n}`;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetAndSeed(t.pool, { selfBaseUrl: t.url });
    clearRegistryCache();
  });

  async function search(text: string, gps = PRIYA, tags?: ReturnType<typeof tag>[]) {
    const replies = await searchViaGateway(t.app.ctx, {
      transactionId: txn(),
      message: { intent: { item: { descriptor: { name: text } }, fulfillment: { end: { location: { gps } } }, ...(tags ? { tags } : {}) } },
    });
    expect(replies).toHaveLength(1);
    const cat = replies[0]!.message.catalog;
    return { providers: cat["bpp/providers"], tags: (cat.tags ?? []) as ReturnType<typeof tag>[] };
  }

  const select = (action: "select" | "init", storeId: string, items: { id: string; count: number; seen?: string }[], gps = PRIYA) =>
    becknCall(t.app.ctx, {
      action,
      bppId: BPP_ID,
      bppUri: `${t.url}/bpp`,
      transactionId: txn(),
      message: {
        order: {
          provider: { id: storeId },
          items: items.map((i) => ({ id: i.id, quantity: { count: i.count }, ...(i.seen ? { tags: [tag(KTAG.group, { seen_price: i.seen })] } : {}) })),
          fulfillments: [{ id: "f1", type: "Delivery", end: { location: { gps } } }],
          ...(action === "init"
            ? { billing: { name: "Priya Nair", phone: "+919845000001", address: "12, 7th Cross" } }
            : {}),
        },
      },
    }) as Promise<Envelope<"on_select" | "on_init">>;

  it("'atta' returns at least 3 serviceable stores with contract-shaped items", async () => {
    const { providers, tags } = await search("atta");
    expect(providers.length).toBeGreaterThanOrEqual(3);
    expect(tags).toHaveLength(0);
    const p = providers.find((x) => x.id === "store_sharma")!;
    expect(p.locations![0]).toMatchObject({ id: "store_sharma_loc" });
    expect(getTag(p.tags, KTAG.group, "delivery_charge")).toBe("20.00");
    expect(Number(getTag(p.tags, KTAG.group, "distance_m"))).toBeGreaterThan(0);
    const it = p.items.find((i) => i.id === "lst_sharma_atta_aashirvaad_10kg")!;
    expect(it.descriptor.name).toBe("Aashirvaad Whole Wheat Atta 10 kg");
    expect(it.price.maximum_value).toBe("499.00");
    expect(getTag(it.tags, KTAG.group, "canonical_id")).toBe("cp_atta_aashirvaad_10kg");
    expect(getTag(it.tags, KTAG.group, "pack_label")).toBe("10 kg");
    expect(it.quantity?.available?.count).toBeGreaterThan(0);
    // unrelated products are not matched
    // (besan's catalogue keywords include atta, so it legitimately matches too)
    const canon = new Set(providers.flatMap((x) => x.items).map((i) => getTag(i.tags, KTAG.group, "canonical_id")));
    expect([...canon].every((c) => /atta|besan/.test(c!))).toBe(true);
  });

  it("expands synonyms, multi-word first: 'gehun ka aata' and a Devanagari term find atta", async () => {
    for (const q of ["gehun ka aata", "आटा", "Aata"]) {
      const { providers } = await search(q);
      expect(providers.length, q).toBeGreaterThanOrEqual(3);
      expect(providers[0]!.items.some((i) => /Atta/.test(i.descriptor.name!)), q).toBe(true);
    }
    const { providers } = await search("doodh");
    expect(providers.flatMap((p) => p.items).some((i) => /Milk/.test(i.descriptor.name!))).toBe(true);
  });

  it("matches by trigram when the full-text prefix misses (typo)", async () => {
    const { providers } = await search("basmatti rice");
    expect(providers.flatMap((p) => p.items).some((i) => /Basmati/.test(i.descriptor.name!))).toBe(true);
  });

  it("excludes stores outside the delivery radius", async () => {
    const near = await search("atta", PRIYA);
    expect(near.providers.map((p) => p.id)).toContain("store_sharma");
    const far = await search("atta", RAHUL);
    const ids = far.providers.map((p) => p.id);
    expect(ids).not.toContain("store_sharma");
    expect(ids).not.toContain("store_lakshmi");
    expect(ids).toContain("store_annapurna"); // 8 km radius
  });

  it("skips offline stores, inactive listings and out-of-stock listings", async () => {
    await t.pool.query("UPDATE bpp.store SET is_online = false WHERE id = 'store_sharma'");
    await t.pool.query("UPDATE bpp.listing SET stock_qty = 0 WHERE id = 'lst_gupta_atta_aashirvaad_10kg'");
    await t.pool.query("UPDATE bpp.listing SET active = false WHERE id = 'lst_lakshmi_atta_aashirvaad_10kg'");
    const { providers } = await search("aashirvaad atta");
    const ids = providers.map((p) => p.id);
    expect(ids).not.toContain("store_sharma");
    expect(ids).not.toContain("store_gupta");
    expect(ids).not.toContain("store_lakshmi");
    expect(ids).toContain("store_balaji");
  });

  it("respects store hours in IST (closed now → excluded)", async () => {
    const ist = new Date(Date.now() + 330 * 60_000);
    const mm = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const hhmm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
    await t.pool.query("UPDATE bpp.store SET open_time = $1, close_time = $2 WHERE id = 'store_sharma'", [hhmm(mm + 120), hhmm(mm + 180)]);
    const { providers } = await search("atta");
    expect(providers.map((p) => p.id)).not.toContain("store_sharma");
  });

  it("declines a loose gram request with the nearest packaged alternative (DIS-06)", async () => {
    const { providers, tags } = await search("250 g jeera");
    expect(getTag(tags, KTAG.group, KTAG.looseDeclined)).toBe("true");
    expect(getTag(tags, KTAG.group, KTAG.reason)).toMatch(/250 g/);
    expect(getTag(tags, KTAG.group, "alternative_canonical_id")).toBe("cp_jeera_everest_100g");
    // the packaged alternative's listings are still returned
    expect(providers.flatMap((p) => p.items).some((i) => getTag(i.tags, KTAG.group, "canonical_id") === "cp_jeera_everest_100g")).toBe(true);
  });

  it("does not decline an amount that matches a pack, and declines loose terms", async () => {
    expect(getTag((await search("100 g jeera")).tags, KTAG.group, KTAG.looseDeclined)).toBeUndefined();
    expect(getTag((await search("1 kg toor dal")).tags, KTAG.group, KTAG.looseDeclined)).toBeUndefined();
    const loose = await search("khula atta");
    expect(getTag(loose.tags, KTAG.group, KTAG.looseDeclined)).toBe("true");
    expect(loose.providers.length).toBeGreaterThan(0);
  });

  it("filters to canonical ids when the tag is present (text ignored)", async () => {
    const { providers } = await search("", PRIYA, [tag(KTAG.group, { [KTAG.canonicalIds]: "cp_jeera_everest_100g,cp_salt_tata_1kg" })]);
    const canon = new Set(providers.flatMap((p) => p.items).map((i) => getTag(i.tags, KTAG.group, "canonical_id")));
    expect([...canon].sort()).toEqual(["cp_jeera_everest_100g", "cp_salt_tata_1kg"]);
  });

  it("returns an empty catalog (no error) when nothing matches", async () => {
    const { providers, tags } = await search("zzzqqq");
    expect(providers).toEqual([]);
    expect(tags).toEqual([]);
  });

  it("on_select returns a quote with item and delivery rows; a changed price is flagged", async () => {
    const item = "lst_sharma_atta_aashirvaad_10kg";
    const { providers } = await search("atta");
    const seen = providers.find((p) => p.id === "store_sharma")!.items.find((i) => i.id === item)!.price.value;

    const ok = await select("select", "store_sharma", [{ id: item, count: 2, seen }]);
    expect(ok.error).toBeUndefined();
    const q = ok.message.order.quote!;
    const itemRow = q.breakup.find((b) => b["@ondc/org/title_type"] === "item")!;
    expect(itemRow["@ondc/org/item_id"]).toBe(item);
    expect(itemRow["@ondc/org/item_quantity"]!.count).toBe(2);
    expect(paiseOf(itemRow.price)).toBe(paiseOf({ value: seen }) * 2);
    const del = q.breakup.find((b) => b["@ondc/org/title_type"] === "delivery")!;
    expect(del["@ondc/org/item_id"]).toBe("f1");
    expect(paiseOf(del.price)).toBe(2000);
    expect(paiseOf(q.price)).toBe(paiseOf(itemRow.price) + 2000);
    expect(itemRow.item?.tags).toBeUndefined();

    // merchant changes the price after the customer saw it
    await t.pool.query("UPDATE bpp.listing SET price_paise = price_paise + 500 WHERE id = $1", [item]);
    const changed = await select("select", "store_sharma", [{ id: item, count: 2, seen }]);
    const row = changed.message.order.quote!.breakup.find((b) => b["@ondc/org/title_type"] === "item")!;
    const tags = row.item!.tags as ReturnType<typeof tag>[];
    expect(getTag(tags, KTAG.group, "price_changed")).toBe("true");
    expect(getTag(tags, KTAG.group, "previous_price")).toBe(seen);
    expect(paiseOf(row.item!.price)).toBe(paiseOf({ value: seen }) + 500);
  });

  it("select error codes: 40002 stock, 30009 radius, 30001 offline", async () => {
    const item = "lst_sharma_atta_aashirvaad_10kg";
    const short = await select("select", "store_sharma", [{ id: item, count: 9999 }, { id: "lst_sharma_nope", count: 1 }]);
    expect(short.error?.code).toBe("40002");
    expect(short.error?.message?.split(",").sort()).toEqual([item, "lst_sharma_nope"].sort());

    const far = await select("select", "store_sharma", [{ id: item, count: 1 }], RAHUL);
    expect(far.error?.code).toBe("30009");

    await t.pool.query("UPDATE bpp.store SET is_online = false WHERE id = 'store_sharma'");
    const off = await select("select", "store_sharma", [{ id: item, count: 1 }]);
    expect(off.error?.code).toBe("30001");
  });

  it("on_init carries ttl PT10M and ON-ORDER NOT-PAID payment terms", async () => {
    const init = await select("init", "store_gupta", [{ id: "lst_gupta_atta_aashirvaad_10kg", count: 1 }]);
    expect(init.error).toBeUndefined();
    expect(init.message.order.quote!.ttl).toBe("PT10M");
    expect(init.message.order.payment).toMatchObject({ type: "ON-ORDER", collected_by: "BAP", status: "NOT-PAID" });
    expect(init.message.order.billing?.name).toBe("Priya Nair");
  });
});
