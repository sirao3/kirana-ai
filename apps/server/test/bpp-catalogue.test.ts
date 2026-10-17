import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTag, gpsOf, KTAG } from "@kiranaai/shared";
import { searchViaGateway } from "../src/bap/beckn-client.js";
import { clearRegistryCache } from "../src/beckn/registry.js";
import { parseCsv } from "../src/bpp/merchant/csv.js";
import { resetAndSeed } from "../src/db/seed/seed.js";
import { startTestApp, tokenFor } from "./helpers.js";

const PRIYA = gpsOf(12.9719, 77.6412);

describe("merchant catalogue and CSV import (T14)", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let token: string;
  let n = 0;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetAndSeed(t.pool, { selfBaseUrl: t.url });
    clearRegistryCache();
    token = await tokenFor(t.url, { role: "merchant", id: "store_sharma" });
  });

  const call = async (path: string, method = "GET", body?: unknown, tok: string | null = token) => {
    const res = await fetch(`${t.url}/bpp/merchant/store_sharma/catalogue${path}`, {
      method,
      headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, json, text, headers: res.headers };
  };

  /** Product names (store → names) that a search returns, via the real gateway. */
  async function searchNames(text: string): Promise<Map<string, string[]>> {
    const replies = await searchViaGateway(t.app.ctx, {
      transactionId: `txn_t14_${++n}`,
      message: { intent: { item: { descriptor: { name: text } }, fulfillment: { end: { location: { gps: PRIYA } } } } },
    });
    const out = new Map<string, string[]>();
    for (const p of replies[0]!.message.catalog["bpp/providers"]) out.set(p.id, p.items.map((i) => i.descriptor.name!));
    return out;
  }

  it("requires the store's own token", async () => {
    expect((await call("", "GET", undefined, null)).status).toBe(401);
    const gupta = await tokenFor(t.url, { role: "merchant", id: "store_gupta" });
    expect((await call("", "GET", undefined, gupta)).status).toBe(403);
  });

  it("lists the store's catalogue plus the canonical picker", async () => {
    const { status, json } = await call("");
    expect(status).toBe(200);
    expect(json.items.length).toBeGreaterThan(10);
    expect(json.items.every((i: any) => typeof i.pricePaise === "number" && Number.isInteger(i.stockQty))).toBe(true);
    expect(json.canonicalProducts.length).toBeGreaterThanOrEqual(32);
    const atta = json.items.find((i: any) => i.listingId === "lst_sharma_atta_aashirvaad_10kg");
    expect(atta).toMatchObject({ brand: "Aashirvaad", packLabel: "10 kg", active: true });
  });

  it("edits price and stock inline, rejects invalid values and other stores' listings", async () => {
    const id = "lst_sharma_atta_aashirvaad_10kg";
    const ok = await call(`/${id}`, "PATCH", { pricePaise: 46000, stockQty: 7 });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ pricePaise: 46000, stockQty: 7 });
    expect((await call(`/${id}`, "PATCH", { pricePaise: 0 })).status).toBe(400);
    expect((await call(`/${id}`, "PATCH", { stockQty: -1 })).status).toBe(400);
    expect((await call(`/${id}`, "PATCH", { stockQty: 1.5 })).status).toBe(400);
    expect((await call(`/${id}`, "PATCH", {})).status).toBe(400);
    expect((await call(`/lst_gupta_atta_aashirvaad_10kg`, "PATCH", { stockQty: 1 })).status).toBe(404);
  });

  it("deactivating a listing removes it from search; reactivating brings it back", async () => {
    const id = "lst_sharma_atta_aashirvaad_10kg";
    expect((await searchNames("aashirvaad atta")).get("store_sharma")).toBeTruthy();
    expect((await call(`/${id}`, "PATCH", { active: false })).json.active).toBe(false);
    expect((await searchNames("aashirvaad atta")).has("store_sharma")).toBe(false);
    await call(`/${id}`, "PATCH", { active: true });
    expect((await searchNames("aashirvaad atta")).has("store_sharma")).toBe(true);
  });

  it("adding a brand-new product makes it searchable", async () => {
    expect((await searchNames("kesar masala chai")).size).toBe(0);
    const add = await call("", "POST", {
      newProduct: { brand: "Wagh Bakri", name: "Kesar Masala Chai", packSize: 250, unit: "g", category: "Tea & Coffee" },
      pricePaise: 18500, mrpPaise: 20000, stockQty: 9,
    });
    expect(add.status).toBe(201);
    expect(add.json).toMatchObject({ brand: "Wagh Bakri", packLabel: "250 g", pricePaise: 18500, stockQty: 9, active: true });
    const found = await searchNames("kesar masala chai");
    expect(found.get("store_sharma")).toEqual(["Wagh Bakri Kesar Masala Chai 250 g"]);
    expect(found.size).toBe(1); // only the store that listed it
  });

  it("adding an existing canonical product to a store lists it there (and re-adding updates it)", async () => {
    // Lakshmi doesn't stock Fortune atta in the seed.
    const tok = await tokenFor(t.url, { role: "merchant", id: "store_lakshmi" });
    const before = await searchNames("fortune atta");
    const res = await fetch(`${t.url}/bpp/merchant/store_lakshmi/catalogue`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ canonicalProductId: "cp_atta_fortune_10kg", pricePaise: 47500, stockQty: 5 }),
    });
    expect(res.status).toBe(201);
    expect(before.has("store_lakshmi")).toBe(false);
    expect((await searchNames("fortune atta")).has("store_lakshmi")).toBe(true);
    expect((await call("", "POST", { canonicalProductId: "nope", pricePaise: 100, stockQty: 1 })).status).toBe(404);
    expect((await call("", "POST", { pricePaise: 100, stockQty: 1 })).status).toBe(400);
    expect((await call("", "POST", { canonicalProductId: "cp_salt_tata_1kg", pricePaise: 500, mrpPaise: 400, stockQty: 1 })).status).toBe(400);
  });

  it("serves a CSV template that its own importer accepts", async () => {
    const r = await call("/template.csv");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    const rows = parseCsv(r.text);
    expect(rows[0]).toContain("price_rupees");
    const dry = await call("/import", "POST", { csv: r.text, dryRun: true });
    expect(dry.json).toMatchObject({ total: 2, applied: 0, dryRun: true, rejected: [] });
  });

  it("CSV import reports invalid rows per line and applies the valid ones in one transaction", async () => {
    const csv = [
      "canonical_product_id,brand,name,variant,pack_size,unit,category,gtin,price_rupees,mrp_rupees,stock",
      "cp_salt_tata_1kg,,,,,,,,31.50,35,12", // ok: existing product
      ",Patanjali,\"Doodh, Biscuit\",,300,g,Biscuits,,45,50,20", // ok: new product, quoted comma
      "cp_nope,,,,,,,,10,12,5", // unknown product
      ",Amul,Lassi,,200,oz,Dairy,,25,,5", // bad unit
      "cp_sugar_madhur_1kg,,,,,,,,abc,,5", // bad price
      "cp_poha_tata_500g,,,,,,,,40,30,5", // mrp < price
      "cp_besan_rajdhani_500g,,,,,,,,60,70,-3", // bad stock
      ",,,,,,,,10,12,5", // nothing identifies a product
    ].join("\r\n");
    const r = await call("/import", "POST", { csv });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(8);
    expect(r.json.applied).toBe(2);
    expect(r.json.rejected.map((x: any) => x.line)).toEqual([4, 5, 6, 7, 8, 9]);
    const byLine = Object.fromEntries(r.json.rejected.map((x: any) => [x.line, x.errors.join(" | ")]));
    expect(byLine[4]).toMatch(/unknown canonical_product_id/);
    expect(byLine[5]).toMatch(/unit must be one of/);
    expect(byLine[6]).toMatch(/price_rupees/);
    expect(byLine[7]).toMatch(/mrp_rupees is lower/);
    expect(byLine[8]).toMatch(/stock/);
    expect(byLine[9]).toMatch(/brand|required/);

    const { items } = (await call("")).json;
    expect(items.find((i: any) => i.listingId === "lst_sharma_salt_tata_1kg")).toMatchObject({ pricePaise: 3150, mrpPaise: 3500, stockQty: 12 });
    expect(items.find((i: any) => i.name === "Doodh, Biscuit")).toMatchObject({ pricePaise: 4500, stockQty: 20 });
    // rejected rows changed nothing
    expect((await t.pool.query("SELECT price_paise FROM bpp.listing WHERE id = 'lst_sharma_sugar_madhur_1kg'")).rows[0].price_paise).not.toBe(0);
    expect((await searchNames("patanjali biscuit")).get("store_sharma")).toEqual(["Patanjali Doodh, Biscuit 300 g"]);
  });

  it("CSV import caps absurd stock values as validation errors (minimal columns are enough for existing products)", async () => {
    const csv = ["canonical_product_id,price_rupees,stock", "cp_salt_tata_1kg,99,50", "cp_sugar_madhur_1kg,50,99999999999"].join("\n");
    const r = await call("/import", "POST", { csv });
    expect(r.status).toBe(200);
    expect(r.json.applied).toBe(1);
    expect(r.json.rejected[0].line).toBe(3);
  });

  it("rejects a file with the wrong columns", async () => {
    const r = await call("/import", "POST", { csv: "foo,bar\n1,2\n" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BAD_HEADER");
  });

  it("parseCsv handles quotes, escaped quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n\r\nlast,')).toEqual([["a", "b"], ["x,1", 'he said "hi"'], ["last", ""]]);
  });
});
