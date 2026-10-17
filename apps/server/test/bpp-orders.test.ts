import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTag, gpsOf, KTAG, makeContext, tag, type Context } from "@kiranaai/shared";
import { clearRegistryCache } from "../src/beckn/registry.js";
import { autoReject, sweepExpired } from "../src/bpp/attempts.js";
import { BPP_ID } from "../src/bpp/identity.js";
import { resetAndSeed } from "../src/db/seed/seed.js";
import { startTestApp, tokenFor } from "./helpers.js";

const PRIYA = gpsOf(12.9719, 77.6412);
const LISTING = "lst_sharma_atta_aashirvaad_10kg";

interface Received { action: string; body: { context: Context; message?: { order: any }; error?: any } }

/** A BAP stand-in: registered in the registry, ACKs and records every callback it gets. */
class FakeBap {
  received: Received[] = [];
  /** Respond 500 to the next n requests (retry tests). */
  failNext = 0;
  private server!: Server;
  url = "";
  static ID = "fake-bap";

  async start(pool: import("pg").Pool) {
    this.server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (this.failNext > 0) {
          this.failNext--;
          res.writeHead(500).end("{}");
          return;
        }
        this.received.push({ action: req.url!.split("/").pop()!, body: JSON.parse(raw) });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ message: { ack: { status: "ACK" } } }));
      });
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/bap`;
    await pool.query(
      `INSERT INTO registry.participant (subscriber_id, type, subscriber_url) VALUES ($1, 'BAP', $2)
       ON CONFLICT (subscriber_id) DO UPDATE SET subscriber_url = EXCLUDED.subscriber_url, status = 'SUBSCRIBED'`,
      [FakeBap.ID, this.url],
    );
    clearRegistryCache();
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
  of(action: string) {
    return this.received.filter((r) => r.action === action);
  }
}

describe("BPP confirm, offers, claim, sweeper, fulfilment (T05)", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bap: FakeBap;
  let sharma: string;
  let n = 0;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetAndSeed(t.pool, { selfBaseUrl: t.url });
    bap = new FakeBap();
    await bap.start(t.pool);
    sharma = await tokenFor(t.url, { role: "merchant", id: "store_sharma" });
  });
  afterEach(() => bap.stop());

  const attId = () => `att_t05_${Date.now()}_${++n}`;

  async function post(path: string, body: unknown, token?: string) {
    const res = await fetch(`${t.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }

  function confirmBody(orderId: string, o: { storeId?: string; listing?: string; qty?: number; windowSeconds?: number; txn?: string } = {}) {
    const context = makeContext({
      action: "confirm", transactionId: o.txn ?? `txn_${orderId}`, bapId: FakeBap.ID, bapUri: bap.url, bppId: BPP_ID, bppUri: `${t.url}/bpp`,
    });
    return {
      context,
      message: {
        order: {
          id: orderId,
          provider: { id: o.storeId ?? "store_sharma" },
          items: [{ id: o.listing ?? LISTING, quantity: { count: o.qty ?? 2 } }],
          billing: { name: "Priya Nair", phone: "+919845000001", address: "12, 7th Cross, Indiranagar" },
          fulfillments: [{ id: "f1", type: "Delivery", end: { location: { gps: PRIYA, address: "12, 7th Cross, Indiranagar" }, contact: { phone: "+919845000001" }, person: { name: "Priya Nair" } } }],
          payment: { type: "ON-ORDER", status: "PAID", params: { amount: "940.00", currency: "INR" } },
          tags: [tag(KTAG.group, { [KTAG.offerWindowSeconds]: String(o.windowSeconds ?? 45) })],
        },
      },
    };
  }

  const confirm = async (orderId = attId(), o: Parameters<typeof confirmBody>[1] = {}) => {
    const r = await post("/bpp/confirm", confirmBody(orderId, o));
    expect(r.status).toBe(200);
    expect(r.json.message.ack.status).toBe("ACK");
    return orderId;
  };
  const stock = async (listing = LISTING) =>
    (await t.pool.query<{ stock_qty: number }>("SELECT stock_qty FROM bpp.listing WHERE id = $1", [listing])).rows[0]!.stock_qty;
  const status = async (id: string) =>
    (await t.pool.query<{ status: string; fulfilment_status: string | null }>("SELECT status, fulfilment_status FROM bpp.attempt_order WHERE id = $1", [id])).rows[0]!;
  const merchant = (path: string, method: "GET" | "POST" | "PATCH" = "POST", body?: unknown, token = sharma) =>
    fetch(`${t.url}/bpp/merchant/store_sharma${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    });

  it("confirm creates an OFFERED attempt with expires_at from the tag and replies on_confirm", async () => {
    const id = await confirm(attId(), { windowSeconds: 30 });
    const [onConfirm] = bap.of("on_confirm");
    const order = onConfirm!.body.message!.order;
    expect(onConfirm!.body.error).toBeUndefined();
    expect(order).toMatchObject({ id, state: "Created", provider: { id: "store_sharma" } });
    const expires = new Date(getTag(order.tags, KTAG.group, "expires_at")!).getTime();
    // compare against the DB clock (the docker DB and this host can disagree by a second or two)
    const row = (await t.pool.query("SELECT expires_at, offered_at FROM bpp.attempt_order WHERE id = $1", [id])).rows[0];
    expect(expires).toBe(row.expires_at.getTime());
    expect(row.expires_at.getTime() - row.offered_at.getTime()).toBe(30_000);
    expect(order.quote.breakup.find((b: any) => b["@ondc/org/title_type"] === "delivery")).toBeTruthy();
    const { rows } = await t.pool.query("SELECT * FROM bpp.attempt_order WHERE id = $1", [id]);
    expect(rows[0]).toMatchObject({ status: "OFFERED", buyer_name: "Priya Nair", store_id: "store_sharma", transaction_id: `txn_${id}` });
    expect((await t.pool.query("SELECT 1 FROM bpp.attempt_order_item WHERE attempt_order_id = $1", [id])).rowCount).toBe(1);
    expect(await stock()).toBeGreaterThan(2); // stock is only decremented on accept
  });

  it("confirm is idempotent on order.id", async () => {
    const id = attId();
    await confirm(id);
    await confirm(id); // new message_id, same order
    expect((await t.pool.query("SELECT 1 FROM bpp.attempt_order WHERE id = $1", [id])).rowCount).toBe(1);
    expect((await t.pool.query("SELECT 1 FROM bpp.attempt_order_item WHERE attempt_order_id = $1", [id])).rowCount).toBe(1);
    const replies = bap.of("on_confirm");
    expect(replies).toHaveLength(2);
    expect(replies[1]!.body.message!.order.id).toBe(id);
    expect(replies[1]!.body.message!.order.state).toBe("Created");
  });

  it("confirm re-checks stock and replies with an error instead of creating an order", async () => {
    const id = await confirm(attId(), { qty: 9999 });
    const [r] = bap.of("on_confirm");
    expect(r!.body.error.code).toBe("40002");
    expect((await t.pool.query("SELECT 1 FROM bpp.attempt_order WHERE id = $1", [id])).rowCount).toBe(0);

    await t.pool.query("UPDATE bpp.store SET is_online = false WHERE id = 'store_sharma'");
    await confirm(attId());
    expect(bap.of("on_confirm")[1]!.body.error.code).toBe("30001");
  });

  it("merchant API enforces the store-scoped token", async () => {
    expect((await fetch(`${t.url}/bpp/merchant/store_sharma/dashboard`)).status).toBe(401);
    const gupta = await tokenFor(t.url, { role: "merchant", id: "store_gupta" });
    expect((await merchant("/dashboard", "GET", undefined, gupta)).status).toBe(403);
    const customer = await tokenFor(t.url, { role: "customer", id: "cust_priya" });
    expect((await merchant("/dashboard", "GET", undefined, customer)).status).toBe(403);
    const admin = await tokenFor(t.url, { role: "admin", passcode: "demo" });
    expect((await merchant("/dashboard", "GET", undefined, admin)).status).toBe(200);
  });

  it("dashboard lists the offer with the phone masked; accept unmasks, decrements stock and sends on_status", async () => {
    const before = await stock();
    const id = await confirm();
    const dash = await (await merchant("/dashboard", "GET")).json() as any;
    expect(dash.store).toMatchObject({ id: "store_sharma", isOnline: true, faults: { autoReject: false, neverAnswer: false } });
    expect(dash.offers).toHaveLength(1);
    expect(dash.offers[0]).toMatchObject({ id, status: "OFFERED", buyerName: "Priya Nair", items: [{ qty: 2 }] });
    expect(dash.offers[0].buyerPhone).toContain("•");
    expect(dash.offers[0].buyerPhone).not.toContain("845000001");
    expect(dash.offers[0].totalPaise).toBe(dash.offers[0].itemsTotalPaise + dash.offers[0].deliveryPaise);
    expect(dash.orders).toHaveLength(0);

    const acc = await merchant(`/offers/${id}/accept`);
    expect(acc.status).toBe(200);
    expect(await acc.json()).toEqual({ ok: true });
    expect(await stock()).toBe(before - 2);

    const [cb] = bap.of("on_status");
    expect(cb!.body.context).toMatchObject({ transaction_id: `txn_${id}`, action: "on_status", bpp_id: BPP_ID });
    expect(cb!.body.message!.order).toMatchObject({ id, state: "Accepted", fulfillments: [{ id: "f1", state: { descriptor: { code: "Pending" } } }] });

    const after = await (await merchant("/dashboard", "GET")).json() as any;
    expect(after.offers).toHaveLength(0);
    expect(after.orders[0]).toMatchObject({ id, fulfilmentStatus: "ACCEPTED", buyerPhone: "+919845000001" });
  });

  it("10 parallel accepts: exactly one 200, the rest 409 OFFER_NOT_AVAILABLE; stock moves once", async () => {
    const before = await stock();
    const id = await confirm();
    const results = await Promise.all(Array.from({ length: 10 }, () => merchant(`/offers/${id}/accept`)));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    const losers = await Promise.all(results.filter((r) => r.status === 409).map((r) => r.json()));
    expect(losers.every((b: any) => b.error === "OFFER_NOT_AVAILABLE")).toBe(true);
    expect(await stock()).toBe(before - 2);
    expect(bap.of("on_status")).toHaveLength(1);
  });

  it("accept after expiry → 409, and the sweeper then expires it", async () => {
    const id = await confirm();
    await t.pool.query("UPDATE bpp.attempt_order SET expires_at = now() - interval '1 second' WHERE id = $1", [id]);
    const acc = await merchant(`/offers/${id}/accept`);
    expect(acc.status).toBe(409);
    expect(((await acc.json()) as any).error).toBe("OFFER_NOT_AVAILABLE");
    expect(await stock()).toBeGreaterThan(2);
    await sweepExpired(t.app.ctx);
    expect((await status(id)).status).toBe("EXPIRED");
  });

  it("accept refuses when stock can no longer cover the order (offer stays open)", async () => {
    const id = await confirm();
    await t.pool.query("UPDATE bpp.listing SET stock_qty = 1 WHERE id = $1", [LISTING]);
    const acc = await merchant(`/offers/${id}/accept`);
    expect(acc.status).toBe(409);
    expect(((await acc.json()) as any).error).toBe("INSUFFICIENT_STOCK");
    expect((await status(id)).status).toBe("OFFERED");
    expect(await stock()).toBe(1);
  });

  it("reject with a reason sends on_cancel; a second reject or accept is 409", async () => {
    const id = await confirm();
    const rej = await merchant(`/offers/${id}/reject`, "POST", { reason: "Out of atta" });
    expect(rej.status).toBe(200);
    const [cb] = bap.of("on_cancel");
    expect(cb!.body.message!.order).toMatchObject({
      id, state: "Cancelled",
      cancellation: { cancelled_by: "kiranaai-bpp", reason: { id: "MERCHANT_REJECTED", descriptor: { name: "Out of atta" } } },
    });
    expect((await merchant(`/offers/${id}/reject`, "POST", { reason: "x" })).status).toBe(409);
    expect((await merchant(`/offers/${id}/accept`)).status).toBe(409);
    expect((await t.pool.query("SELECT reject_reason FROM bpp.attempt_order WHERE id = $1", [id])).rows[0].reject_reason).toBe("Out of atta");
  });

  it("advance walks PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED with on_status each; nothing beyond", async () => {
    const id = await confirm();
    expect((await merchant(`/orders/${id}/advance`)).status).toBe(409); // not accepted yet
    await merchant(`/offers/${id}/accept`);
    const seen: string[] = [];
    for (const want of ["PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"]) {
      const r = await merchant(`/orders/${id}/advance`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ fulfilmentStatus: want });
      seen.push(want);
    }
    const cbs = bap.of("on_status").map((r) => r.body.message!.order);
    expect(cbs.map((o) => [o.state, o.fulfillments[0].state.descriptor.code])).toEqual([
      ["Accepted", "Pending"], ["In-progress", "Pending"], ["In-progress", "Packed"], ["In-progress", "Out-for-delivery"], ["Completed", "Order-delivered"],
    ]);
    // every callback has its own message_id
    expect(new Set(bap.of("on_status").map((r) => r.body.context.message_id)).size).toBe(5);
    const bad = await merchant(`/orders/${id}/advance`);
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as any).error).toBe("INVALID_TRANSITION");
    expect((await merchant(`/orders/att_nope/advance`)).status).toBe(404);
    expect(seen).toHaveLength(4);
  });

  it("retries a failed callback with the same message_id", async () => {
    const id = await confirm();
    bap.failNext = 2;
    expect((await merchant(`/offers/${id}/accept`)).status).toBe(200);
    expect(bap.of("on_status")).toHaveLength(1);
    expect(bap.failNext).toBe(0);
  });

  it("store online toggle", async () => {
    const off = await merchant("/store", "PATCH", { isOnline: false });
    expect(await off.json()).toEqual({ isOnline: false });
    expect((await t.pool.query("SELECT is_online FROM bpp.store WHERE id = 'store_sharma'")).rows[0].is_online).toBe(false);
    expect((await merchant("/store", "PATCH", { isOnline: "yes" })).status).toBe(400);
  });

  it("auto_reject fault rejects ~3 s after the offer, not before", async () => {
    await t.pool.query("UPDATE bpp.fault SET auto_reject = true WHERE store_id = 'store_sharma'");
    const id = await confirm();
    expect(await autoReject(t.app.ctx)).toBe(0); // default 3 s not reached
    expect((await status(id)).status).toBe("OFFERED");
    expect(await autoReject(t.app.ctx, 0)).toBe(1);
    expect((await status(id)).status).toBe("REJECTED");
    expect(bap.of("on_cancel")[0]!.body.message!.order.cancellation.reason.id).toBe("MERCHANT_REJECTED");
    expect(await autoReject(t.app.ctx, 0)).toBe(0);
  });

  it("status returns the current state; unknown order errors; cancel NACKs 30000", async () => {
    const id = await confirm();
    await merchant(`/offers/${id}/accept`);
    const ctx = (action: string) => makeContext({ action: action as any, transactionId: `txn_${id}`, bapId: FakeBap.ID, bapUri: bap.url, bppId: BPP_ID, bppUri: `${t.url}/bpp` });
    expect((await post("/bpp/status", { context: ctx("status"), message: { order_id: id } })).status).toBe(200);
    const last = bap.of("on_status").at(-1)!;
    expect(last.body.message!.order).toMatchObject({ id, state: "Accepted" });

    await post("/bpp/status", { context: ctx("status"), message: { order_id: "att_missing" } });
    expect(bap.of("on_status").at(-1)!.body.error.code).toBe("30004");

    const c = await post("/bpp/cancel", { context: ctx("cancel"), message: { order_id: id, cancellation_reason_id: "001" } });
    expect(c.json.message.ack.status).toBe("NACK");
    expect(c.json.error.code).toBe("30000");
  });

  it("an overdue offer present at boot expires exactly once and on_cancel is sent once", async () => {
    // Create the offer through the running app, make it overdue, then "boot" a fresh app on the same DB.
    const id = await confirm();
    await t.pool.query("UPDATE bpp.attempt_order SET expires_at = now() - interval '2 seconds' WHERE id = $1", [id]);
    const before = bap.of("on_cancel").length;

    const booted = await startTestApp();
    try {
      await booted.app.ctx.ticker.tick(); // boot pass
      await booted.app.ctx.ticker.tick(Date.now() + 5000); // later passes find nothing
      await booted.app.ctx.ticker.tick(Date.now() + 10_000);
    } finally {
      await booted.close();
    }
    expect((await status(id)).status).toBe("EXPIRED");
    const cancels = bap.of("on_cancel").slice(before);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.body.message!.order).toMatchObject({
      id, state: "Cancelled", cancellation: { reason: { id: "OFFER_EXPIRED" } },
    });
    const { rows } = await t.pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'on_cancel' AND direction = 'out' AND transaction_id = $1", [`txn_${id}`]);
    expect(rows[0].n).toBe(1);
    expect((await t.pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'attempt.EXPIRED' AND entity_id = $1", [id])).rows[0].n).toBe(1);
  });
});
