import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADDRESS_PRESETS, haversineM, type AddressView, type PlanResult, type SearchResponse } from "@kiranaai/shared";
import { clearRegistryCache } from "../src/beckn/registry.js";
import { resetAndSeed } from "../src/db/seed/seed.js";
import { startTestApp, tokenFor } from "./helpers.js";

/** UX-14: saved delivery address, its effect on search / plan, and reset. Uses the real BPP (no fake). */
describe("delivery address (UX-14)", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let priya: string;
  let rahul: string;

  const call = async <T>(method: string, path: string, body?: unknown, token = priya) => {
    const res = await fetch(`${t.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const patchPreset = (presetId: string) => call<AddressView>("PATCH", "/bap/profile/address", { presetId });
  const storesIn = (r: SearchResponse) => new Set(r.groups.flatMap((g) => g.offers.map((o) => o.storeId)));

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetAndSeed(t.pool, { selfBaseUrl: t.url });
    clearRegistryCache();
    priya = await tokenFor(t.url, { role: "customer", id: "cust_priya" });
    rahul = await tokenFor(t.url, { role: "customer", id: "cust_rahul" });
  });

  it("GET returns the saved address, a label and all 5 stores with their distances", async () => {
    const r = await call<AddressView>("GET", "/bap/profile/address");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ label: "Indiranagar, Bengaluru", lat: 12.9719, lng: 77.6412 });
    expect(r.body.address).toContain("Indiranagar");
    expect(r.body.stores).toHaveLength(5);
    expect(r.body.stores.every((s) => s.delivers)).toBe(true);
    expect(r.body.presets.length).toBeGreaterThanOrEqual(3);
  });

  it("requires a customer session", async () => {
    const merchant = await tokenFor(t.url, { role: "merchant", id: "store_sharma" });
    expect((await call("GET", "/bap/profile/address", undefined, merchant)).status).toBe(403);
    expect((await fetch(`${t.url}/bap/profile/address`)).status).toBe(401);
  });

  it("presets are consistent with the seeded stores: one drops exactly two, one drops all", () => {
    const stores = [
      { lat: 12.9791, lng: 77.6412, r: 3000 }, { lat: 12.9719, lng: 77.6514, r: 3000 }, { lat: 12.9593, lng: 77.6412, r: 2500 },
      { lat: 12.9719, lng: 77.6237, r: 3500 }, { lat: 12.9872, lng: 77.6569, r: 8000 },
    ];
    const out = (id: string) => {
      const p = ADDRESS_PRESETS.find((x) => x.id === id)!;
      return stores.filter((s) => haversineM(s, p) > s.r).length;
    };
    expect(out("indiranagar")).toBe(0);
    expect(out("cv-raman-nagar")).toBe(2);
    expect(out("whitefield")).toBe(5);
  });

  it("PATCH by preset persists and reports which stores no longer deliver", async () => {
    const r = await patchPreset("cv-raman-nagar");
    expect(r.status).toBe(200);
    expect(r.body.label).toBe("CV Raman Nagar, Bengaluru");
    expect(r.body.stores.filter((s) => !s.delivers).map((s) => s.storeId).sort()).toEqual(["store_balaji", "store_lakshmi"]);
    const again = await call<AddressView>("GET", "/bap/profile/address");
    expect(again.body.lat).toBeCloseTo(12.985, 5);
    // Other customers are untouched.
    const other = await call<AddressView>("GET", "/bap/profile/address", undefined, rahul);
    expect(other.body.label).toBe("Koramangala, Bengaluru");
  });

  it("PATCH with a custom address validates input", async () => {
    const ok = await call<AddressView>("PATCH", "/bap/profile/address", { address: "5, MG Road, Bengaluru 560001", lat: 12.975, lng: 77.606 });
    expect(ok.status).toBe(200);
    expect(ok.body.label).toBe("MG Road, Bengaluru");
    for (const bad of [{ presetId: "nope" }, { address: "x", lat: 12.9, lng: 77.6 }, { address: "Somewhere far away", lat: 99, lng: 77.6 }, { address: "Somewhere far away", lat: 12.9 }, {}]) {
      const r = await call("PATCH", "/bap/profile/address", bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("search and the planner drop the stores that are out of radius, and a reset restores the default", async () => {
    const before = await call<SearchResponse>("GET", "/bap/search?q=atta");
    expect(storesIn(before.body).has("store_lakshmi")).toBe(true);
    expect(storesIn(before.body).has("store_balaji")).toBe(true);

    await patchPreset("cv-raman-nagar");
    const moved = await call<SearchResponse>("GET", "/bap/search?q=atta");
    const stores = storesIn(moved.body);
    expect(stores.has("store_lakshmi")).toBe(false);
    expect(stores.has("store_balaji")).toBe(false);
    expect(stores.has("store_sharma")).toBe(true);

    const plan = await call<PlanResult>("POST", "/bap/plan", { needs: [{ query: "milk", qty: 2 }, { query: "toor dal", qty: 1 }] });
    expect(plan.status).toBe(200);
    expect(plan.body.stores.map((s) => s.storeId).every((id) => id !== "store_lakshmi" && id !== "store_balaji")).toBe(true);
    expect(plan.body.choices.length).toBeGreaterThan(0);

    await patchPreset("whitefield");
    const none = await call<SearchResponse>("GET", "/bap/search?q=atta");
    expect(none.body.groups).toEqual([]);

    await resetAndSeed(t.pool, { selfBaseUrl: t.url });
    clearRegistryCache();
    const back = await call<AddressView>("GET", "/bap/profile/address");
    expect(back.body.label).toBe("Indiranagar, Bengaluru");
    expect(back.body.stores.every((s) => s.delivers)).toBe(true);
  });

  it("GET /bpp/serviceability validates its query", async () => {
    expect((await fetch(`${t.url}/bpp/serviceability?lat=abc&lng=1`)).status).toBeGreaterThanOrEqual(400);
    const ok = await fetch(`${t.url}/bpp/serviceability?lat=12.97&lng=77.64`);
    expect(ok.status).toBe(200);
  });
});
