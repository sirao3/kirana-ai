import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callbackContext, makeContext, priceOf } from "@kiranaai/shared";
import { resetAndSeed } from "../src/db/seed/seed.js";
import { BecknTimeoutError } from "../src/beckn/waiters.js";
import { startTestApp, tokenFor } from "./helpers.js";

describe("Beckn layer + gateway (T03)", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let admin: string;

  beforeAll(async () => {
    t = await startTestApp();
    await resetAndSeed(t.pool, { selfBaseUrl: t.url });
    admin = await tokenFor(t.url, { role: "admin", passcode: "demo" });
  });
  afterAll(() => t.close());

  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${t.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it("search → gateway → stub BPP → on_search → BAP waiter, over real HTTP", async () => {
    const res = await post("/test/beckn-roundtrip", {}, admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; callbacks: { bpp_id: string }[] };
    expect(body.ok).toBe(true);
    expect(body.callbacks.map((c) => c.bpp_id)).toContain("kiranaai-stub-bpp");
    // stub is removed afterwards
    const { rows } = await t.pool.query("SELECT 1 FROM registry.participant WHERE subscriber_id = 'kiranaai-stub-bpp'");
    expect(rows).toHaveLength(0);
    // every hop is audited under one transaction
    const audit = await t.pool.query<{ action: string; actor: string; direction: string }>(
      "SELECT action, actor, direction FROM audit_log WHERE transaction_id LIKE 'txn_test_%' ORDER BY id",
    );
    const hops = audit.rows.map((r) => `${r.actor}:${r.direction}:${r.action}`);
    expect(hops).toEqual(expect.arrayContaining(["bap:out:search", "gw:in:search", "gw:out:search", "test:in:search", "test:out:on_search", "bap:in:on_search"]));
  });

  it("gateway lookup lists the registry", async () => {
    const res = await post("/gw/lookup", { type: "BPP" });
    expect(((await res.json()) as { subscriber_id: string }[]).map((p) => p.subscriber_id)).toEqual(["kiranaai-bpp"]);
  });

  const bppCallback = (action: "on_select", messageId?: string) => {
    const req = makeContext({ action: "select", transactionId: "txn_dedupe", messageId, bapId: "kiranaai-bap", bapUri: `${t.url}/bap` });
    return {
      context: callbackContext(req, { bppId: "kiranaai-bpp", bppUri: `${t.url}/bpp` }),
      message: { order: { provider: { id: "store_sharma" }, items: [{ id: "lst_x", quantity: { count: 1 } }], quote: { price: priceOf(100), breakup: [] } } },
      action,
    };
  };

  it("dedupes callbacks by (message_id, action, sender)", async () => {
    const cb = bppCallback("on_select");
    const got = t.app.ctx.waiters.collect(cb.context.message_id, "on_select", 400);
    const r1 = await post("/bap/on_select", { context: cb.context, message: cb.message });
    const r2 = await post("/bap/on_select", { context: cb.context, message: cb.message });
    expect(((await r1.json()) as { message: { ack: { status: string } } }).message.ack.status).toBe("ACK");
    expect(((await r2.json()) as { message: { ack: { status: string } } }).message.ack.status).toBe("ACK");
    expect(await got).toHaveLength(1);
  });

  it("rejects unknown senders and invalid payloads with NACK", async () => {
    const cb = bppCallback("on_select");
    const forged = { ...cb.context, bpp_id: "evil-bpp", bpp_uri: "http://evil.example/bpp" };
    const r1 = await post("/bap/on_select", { context: forged, message: cb.message });
    expect(r1.status).toBe(401);
    const r2 = await post("/bap/on_select", { context: cb.context, message: { order: { items: "nope" } } });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { message: { ack: { status: string } } }).message.ack.status).toBe("NACK");
  });

  it("NACKs actions a module has not implemented yet", async () => {
    const ctx = makeContext({ action: "status", transactionId: "txn_x", bapId: "kiranaai-bap", bapUri: `${t.url}/bap`, bppId: "kiranaai-bpp", bppUri: `${t.url}/bpp` });
    const res = await post("/bpp/status", { context: ctx, message: { order_id: "att_x" } });
    const body = (await res.json()) as { message: { ack: { status: string } }; error: { code: string } };
    expect(body.message.ack.status).toBe("NACK");
  });

  it("waitFor times out", async () => {
    await expect(t.app.ctx.waiters.waitFor("msg_none", "on_init", 50)).rejects.toBeInstanceOf(BecknTimeoutError);
    expect(t.app.ctx.waiters.size).toBe(0);
  });

  it("issues persona tokens and enforces roles", async () => {
    const cust = await tokenFor(t.url, { role: "customer", id: "cust_priya" });
    expect((await fetch(`${t.url}/admin/api/whoami`, { headers: { authorization: `Bearer ${cust}` } })).status).toBe(403);
    expect((await fetch(`${t.url}/admin/api/whoami`, { headers: { authorization: `Bearer ${admin}` } })).status).toBe(200);
    expect((await fetch(`${t.url}/admin/api/whoami`, { headers: { authorization: `Bearer ${cust}x` } })).status).toBe(401);
    expect((await post("/auth/persona", { role: "admin", passcode: "wrong" })).status).toBe(401);
    expect((await post("/auth/persona", { role: "merchant", id: "store_nope" })).status).toBe(404);
    const personas = (await (await fetch(`${t.url}/auth/personas`)).json()) as { stores: unknown[]; customers: unknown[] };
    expect(personas.stores).toHaveLength(5);
  });
});
