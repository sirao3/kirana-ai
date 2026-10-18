import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditState } from "../src/beckn/audit.js";
import { resetAndSeed } from "../src/db/seed/seed.js";
import { startTestApp, tokenFor } from "./helpers.js";

describe("admin API (T15)", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let admin: string;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetAndSeed(t.pool, { selfBaseUrl: t.url });
    admin = await tokenFor(t.url, { role: "admin", passcode: "demo" });
  });

  const call = async (path: string, method = "GET", body?: unknown, token: string | null = admin) => {
    const res = await fetch(`${t.url}/admin/api${path}`, {
      method,
      headers: { ...(body !== undefined && method !== "GET" ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined || method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };

  it("every route needs an admin token", async () => {
    const merchant = await tokenFor(t.url, { role: "merchant", id: "store_sharma" });
    for (const [method, path] of [["POST", "/reset"], ["GET", "/config"], ["PATCH", "/config"], ["GET", "/faults/store_sharma"], ["PATCH", "/faults/store_sharma"], ["GET", "/ledger"], ["GET", "/audit?transactionId=x"]] as const) {
      expect((await call(path, method, {}, null)).status, `${method} ${path} anon`).toBe(401);
      expect((await call(path, method, {}, merchant)).status, `${method} ${path} merchant`).toBe(403);
    }
  });

  it("POST /reset wipes data and reseeds", async () => {
    await t.pool.query("UPDATE bpp.store SET is_online = false");
    await t.pool.query("UPDATE bap.config SET offer_window_seconds = 7, fail_next_payment = true");
    await t.pool.query("UPDATE bpp.listing SET price_paise = 1 WHERE id = 'lst_sharma_atta_aashirvaad_10kg'");
    await auditState(t.pool, "test", "junk", { transactionId: "txn_junk" });
    const r = await call("/reset", "POST");
    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect((await t.pool.query("SELECT count(*)::int AS n FROM bpp.store WHERE is_online")).rows[0].n).toBe(5);
    expect((await t.pool.query("SELECT price_paise FROM bpp.listing WHERE id = 'lst_sharma_atta_aashirvaad_10kg'")).rows[0].price_paise).not.toBe(1);
    expect((await t.pool.query("SELECT 1 FROM audit_log WHERE action = 'junk'")).rowCount).toBe(0);
    // registry restored with this server's URL, so Beckn still works after a reset
    expect((await t.pool.query("SELECT subscriber_url FROM registry.participant WHERE subscriber_id = 'kiranaai-bpp'")).rows[0].subscriber_url).toBe(`${t.url}/bpp`);
    // the admin token survives (stateless)
    expect((await call("/whoami")).status).toBe(200);
  });

  it("GET/PATCH /config reads and updates bap.config", async () => {
    const before = (await call("/config")).json;
    expect(before).toMatchObject({ offerWindowSeconds: 45, failNextPayment: false, platformFeePaise: 0, commissionBps: 0 });
    const patched = await call("/config", "PATCH", { offerWindowSeconds: 5, failNextPayment: true });
    expect(patched.json).toEqual({ offerWindowSeconds: 5, failNextPayment: true, platformFeePaise: 0, commissionBps: 0 });
    const row = (await t.pool.query("SELECT offer_window_seconds, fail_next_payment FROM bap.config WHERE id = 1")).rows[0];
    expect(row).toEqual({ offer_window_seconds: 5, fail_next_payment: true });
    // partial patch keeps the rest
    expect((await call("/config", "PATCH", { platformFeePaise: 1500, commissionBps: 200 })).json).toEqual({
      offerWindowSeconds: 5, failNextPayment: true, platformFeePaise: 1500, commissionBps: 200,
    });
    expect((await call("/config", "PATCH", { offerWindowSeconds: 0 })).status).toBe(400);
    expect((await call("/config", "PATCH", { failNextPayment: "yes" })).status).toBe(400);
    expect((await call("/config", "PATCH", {})).status).toBe(400);
    expect((await call("/config", "PATCH", { commissionBps: 20000 })).status).toBe(400);
  });

  it("GET/PATCH /faults/:storeId toggles bpp.fault, which the merchant dashboard reports", async () => {
    expect((await call("/faults/store_gupta")).json).toMatchObject({ storeId: "store_gupta", autoReject: false, neverAnswer: false });
    const r = await call("/faults/store_gupta", "PATCH", { neverAnswer: true });
    expect(r.json).toMatchObject({ autoReject: false, neverAnswer: true });
    expect((await call("/faults/store_gupta", "PATCH", { autoReject: true })).json).toMatchObject({ autoReject: true, neverAnswer: true });
    expect((await t.pool.query("SELECT auto_reject, never_answer FROM bpp.fault WHERE store_id = 'store_gupta'")).rows[0]).toEqual({ auto_reject: true, never_answer: true });
    const gupta = await tokenFor(t.url, { role: "merchant", id: "store_gupta" });
    const dash = await (await fetch(`${t.url}/bpp/merchant/store_gupta/dashboard`, { headers: { authorization: `Bearer ${gupta}` } })).json() as any;
    expect(dash.store.faults).toEqual({ autoReject: true, neverAnswer: true });
    expect((await call("/faults/store_gupta")).json.isOnline).toBe(true);
    expect((await call("/faults/store_gupta", "PATCH", { isOnline: false })).json).toMatchObject({ isOnline: false, autoReject: true });
    expect((await call("/faults/store_gupta", "PATCH", { isOnline: true })).json.isOnline).toBe(true);
    expect((await call("/faults/store_nope")).status).toBe(404);
    expect((await call("/faults/store_nope", "PATCH", { autoReject: true })).status).toBe(404);
    expect((await call("/faults/store_gupta", "PATCH", { autoReject: "x" })).status).toBe(400);
    const all = (await call("/faults")).json.faults;
    expect(all).toHaveLength(5);
    expect(all.find((f: any) => f.storeId === "store_gupta")).toMatchObject({ storeName: "Gupta Kirana", autoReject: true });
  });

  it("GET /ledger returns entries with store names and per-store totals", async () => {
    expect((await call("/ledger")).json).toEqual({ entries: [], byStore: [] });
    await t.pool.query("INSERT INTO bap.basket (id, customer_id, transaction_id) VALUES ('bsk_1', 'cust_priya', 'txn_1')");
    for (const [sub, store, gross, commission, net, subsidy] of [
      ["sub_1", "store_sharma", 47000, 0, 47000, 0],
      ["sub_2", "store_balaji", 42000, 0, 42000, 4000],
      ["sub_3", "store_sharma", 10000, 200, 9800, -100],
    ] as const) {
      await t.pool.query(
        `INSERT INTO bap.sub_order (id, basket_id, approved_store_id, locked_lines, approved_items_paise, approved_delivery_paise, approved_amount_paise)
         VALUES ($1, 'bsk_1', $2, '[]', 0, 0, 0)`,
        [sub, store],
      );
      await t.pool.query(
        `INSERT INTO bap.ledger_entry (id, sub_order_id, basket_id, store_id, gross_paise, commission_paise, net_payable_paise, platform_subsidy_paise)
         VALUES ($1, $2, 'bsk_1', $3, $4, $5, $6, $7)`,
        [`led_${sub}`, sub, store, gross, commission, net, subsidy],
      );
    }
    const { entries, byStore } = (await call("/ledger")).json;
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ id: "led_sub_1", storeName: "Sharma General Store", grossPaise: 47000, netPayablePaise: 47000 });
    expect(byStore).toEqual([
      { storeId: "store_balaji", storeName: "Balaji Mart", grossPaise: 42000, commissionPaise: 0, netPayablePaise: 42000, platformSubsidyPaise: 4000 },
      { storeId: "store_sharma", storeName: "Sharma General Store", grossPaise: 57000, commissionPaise: 200, netPayablePaise: 56800, platformSubsidyPaise: -100 },
    ]);
  });

  it("GET /audit returns a transaction's rows in order; /transactions lists recent ones", async () => {
    await auditState(t.pool, "bap", "first", { transactionId: "txn_aud", messageId: "m1", payload: { n: 1 } });
    await auditState(t.pool, "bpp", "second", { transactionId: "txn_aud", storeId: "store_sharma" });
    await auditState(t.pool, "bpp", "other", { transactionId: "txn_other" });
    const rows = (await call("/audit?transactionId=txn_aud")).json;
    expect(rows.map((r: any) => r.action)).toEqual(["first", "second"]);
    expect(rows[0]).toMatchObject({ transactionId: "txn_aud", messageId: "m1", actor: "bap", kind: "state", payload: { n: 1 } });
    expect(rows[1].storeId).toBe("store_sharma");
    expect((await call("/audit?transactionId=txn_none")).json).toEqual([]);
    expect((await call("/audit")).status).toBe(400);
    const txns = (await call("/transactions")).json.transactions;
    expect(txns.map((x: any) => x.transactionId)).toEqual(expect.arrayContaining(["txn_aud", "txn_other"]));
    expect(txns.find((x: any) => x.transactionId === "txn_aud").messages).toBe(2);
  });
});

describe("merchant ledger (UX-11)", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => { t = await startTestApp(); });
  afterAll(() => t.close());

  it("GET /bpp/merchant/:storeId/ledger returns only that store's rows and totals; other stores get 403", async () => {
    await resetAndSeed(t.pool, { selfBaseUrl: t.url });
    await t.pool.query("INSERT INTO bap.basket (id, customer_id, transaction_id) VALUES ('bsk_1', 'cust_priya', 'txn_1')");
    for (const [sub, store, gross, commission, net, subsidy] of [
      ["sub_1", "store_sharma", 47000, 0, 47000, 0],
      ["sub_2", "store_balaji", 42000, 2000, 40000, 4000],
      ["sub_3", "store_balaji", 10000, 0, 10000, 0],
    ] as const) {
      await t.pool.query(
        `INSERT INTO bap.sub_order (id, basket_id, approved_store_id, locked_lines, approved_items_paise, approved_delivery_paise, approved_amount_paise)
         VALUES ($1, 'bsk_1', $2, '[]', 0, 0, 0)`, [sub, store]);
      await t.pool.query(
        `INSERT INTO bap.ledger_entry (id, sub_order_id, basket_id, store_id, gross_paise, commission_paise, net_payable_paise, platform_subsidy_paise)
         VALUES ($1, $2, 'bsk_1', $3, $4, $5, $6, $7)`, [`led_${sub}`, sub, store, gross, commission, net, subsidy]);
    }
    const get = async (storeId: string, token: string | null) => {
      const r = await fetch(`${t.url}/bpp/merchant/${storeId}/ledger`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      return { status: r.status, json: (await r.json().catch(() => null)) as any };
    };
    const balaji = await tokenFor(t.url, { role: "merchant", id: "store_balaji" });
    const ok = await get("store_balaji", balaji);
    expect(ok.status).toBe(200);
    expect(ok.json.entries.map((e: any) => e.id).sort()).toEqual(["led_sub_2", "led_sub_3"]);
    expect(ok.json.totals).toEqual({ grossPaise: 52000, commissionPaise: 2000, netPayablePaise: 50000, platformSubsidyPaise: 4000 });
    expect((await get("store_sharma", balaji)).status).toBe(403);
    expect((await get("store_balaji", null)).status).toBe(401);
    const admin = await tokenFor(t.url, { role: "admin", passcode: "demo" });
    expect((await get("store_nope", admin)).status).toBe(404);
  });
});
