import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApproveResponse, PayResponse, QuoteResponse } from "@kiranaai/shared";
import { buildDemoBasket, L, startHarness, type BapHarness } from "./fixtures/harness.js";

describe("approve, pay, sub-orders, confirm (T07)", () => {
  let h: BapHarness;
  beforeAll(async () => {
    process.env.PAYMENT_SETTLE_MS = "50";
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  const quote = async () => {
    await buildDemoBasket(h);
    const r = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    return { basketId: r.body.basket.id, hash: r.body.quote!.quoteHash };
  };
  const approve = async (basketId: string, hash: string) => {
    const r = await h.call<ApproveResponse>("POST", `/bap/baskets/${basketId}/approve`, { quoteHash: hash });
    expect(r.status).toBe(200);
    return r.body.approvalToken;
  };
  const pay = (basketId: string, approvalToken: string, key: string, extra: object = {}) =>
    h.call<PayResponse>("POST", `/bap/baskets/${basketId}/pay`, { approvalToken, ...extra }, { headers: { "idempotency-key": key } });
  const count = async (sql: string) => Number((await h.t.pool.query(sql)).rows[0].n);

  it("pay without approval → 403, and nothing is sent to any store", async () => {
    const { basketId } = await quote();
    expect((await pay(basketId, "made-up-token", "k1")).status).toBe(403);
    expect((await h.call("POST", `/bap/baskets/${basketId}/pay`, { approvalToken: "x" })).status).toBe(400); // no Idempotency-Key
    expect(h.fake.received.confirm ?? 0).toBe(0);
    expect(await count("SELECT count(*) n FROM bap.payment")).toBe(0);
    expect((await h.call("GET", "/bap/basket")).body.status).toBe("QUOTED");
  });

  it("approve binds to the quote hash; a wrong, changed or expired quote is refused", async () => {
    const { basketId, hash } = await quote();
    expect((await h.call("POST", `/bap/baskets/${basketId}/approve`, { quoteHash: "0".repeat(64) })).status).toBe(409);
    expect((await h.call("POST", "/bap/baskets/bsk_nope/approve", { quoteHash: hash })).status).toBe(404);

    // merchant changes a price, customer re-quotes: the old hash no longer approves
    h.fake.setPrice("store_gupta", "cp_toor_tata_1kg", 15500);
    const re = await h.call<QuoteResponse>("POST", "/bap/basket/quote");
    expect(re.body.quote!.quoteHash).not.toBe(hash);
    const stale = await h.call("POST", `/bap/baskets/${basketId}/approve`, { quoteHash: hash });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("quote_changed");
    expect((await h.call("POST", `/bap/baskets/${basketId}/approve`, { quoteHash: re.body.quote!.quoteHash })).status).toBe(200);

    await h.t.pool.query("UPDATE bap.quote SET valid_until = now() - interval '1 second'");
    const expired = await h.call("POST", `/bap/baskets/${basketId}/approve`, { quoteHash: re.body.quote!.quoteHash });
    expect(expired.status).toBe(409);
    expect(expired.body.error).toBe("quote_expired");
  });

  it("another customer cannot approve or pay my basket", async () => {
    const { basketId, hash } = await quote();
    const token = await approve(basketId, hash);
    const res = await fetch(`${h.t.url}/auth/persona`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "customer", id: "cust_rahul" }) });
    const rahul = ((await res.json()) as { token: string }).token;
    expect((await h.call("POST", `/bap/baskets/${basketId}/approve`, { quoteHash: hash }, { token: rahul })).status).toBe(404);
    const p = await h.call("POST", `/bap/baskets/${basketId}/pay`, { approvalToken: token }, { token: rahul, headers: { "idempotency-key": "r1" } });
    expect(p.status).toBe(404);
  });

  it("approve → pay → PAID, one sub-order per store with locked lines, attempt 1 to the approved store, confirm sent", async () => {
    const { basketId, hash } = await quote();
    const token = await approve(basketId, hash);
    expect((await h.call("GET", "/bap/basket")).body.status).toBe("APPROVED");
    const r = await pay(basketId, token, "idem-1");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "PAID" });
    expect(r.body.paymentId).toMatch(/^pay_/);

    expect((await h.t.pool.query("SELECT status FROM bap.basket WHERE id = $1", [basketId])).rows[0].status).toBe("PAID");
    const subs = await h.t.pool.query("SELECT approved_store_id, approved_amount_paise, attempt_count, status FROM bap.sub_order ORDER BY approved_store_id");
    expect(subs.rows).toEqual([
      { approved_store_id: "store_gupta", approved_amount_paise: 38000, attempt_count: 1, status: "DISPATCHING" },
      { approved_store_id: "store_lakshmi", approved_amount_paise: 55000, attempt_count: 1, status: "DISPATCHING" },
      { approved_store_id: "store_sharma", approved_amount_paise: 47000, attempt_count: 1, status: "DISPATCHING" },
    ]);
    const atts = await h.t.pool.query("SELECT id, store_id, attempt_no, quoted_total_paise FROM bap.attempt ORDER BY store_id");
    expect(atts.rows.map((a) => [a.store_id, a.attempt_no, a.quoted_total_paise])).toEqual([["store_gupta", 1, 38000], ["store_lakshmi", 1, 55000], ["store_sharma", 1, 47000]]);

    // confirm per contract: order.id = att_…, offer_window_seconds tag, PAID payment, the store's own totals
    expect(h.fake.received.confirm).toBe(3);
    const gupta = h.fake.latestFor("store_gupta")!;
    expect(gupta.id).toBe(atts.rows[0].id);
    expect(gupta.id).toMatch(/^att_/);
    expect(gupta.windowSeconds).toBe(45);
    expect(gupta.order.payment).toMatchObject({ type: "ON-ORDER", status: "PAID", params: { amount: "380.00", currency: "INR" } });
    expect(gupta.order.quote!.price.value).toBe("380.00");
    expect(gupta.items).toEqual([{ listingId: L.toor, qty: 2 }, { listingId: L.tea, qty: 1 }]);
    expect(gupta.order.billing).toMatchObject({ name: "Priya Nair", phone: "+919845000001" });
  });

  it("the offer window comes from bap.config", async () => {
    await h.reset({ offerWindowSeconds: 5 });
    const { basketId, hash } = await quote();
    await pay(basketId, await approve(basketId, hash), "idem-w");
    expect(h.fake.latestFor("store_sharma")!.windowSeconds).toBe(5);
  });

  it("the same Idempotency-Key twice → one payment and one set of confirms", async () => {
    const { basketId, hash } = await quote();
    const token = await approve(basketId, hash);
    const a = await pay(basketId, token, "same-key");
    const b = await pay(basketId, token, "same-key");
    expect(b.status).toBe(200);
    expect(b.body.paymentId).toBe(a.body.paymentId);
    expect(b.body.status).toBe("PAID");
    expect(await count("SELECT count(*) n FROM bap.payment")).toBe(1);
    expect(await count("SELECT count(*) n FROM bap.sub_order")).toBe(3);
    expect(h.fake.received.confirm).toBe(3);
    // a different key with the spent token is refused
    expect((await pay(basketId, token, "other-key")).status).toBe(403);
    expect(await count("SELECT count(*) n FROM bap.payment")).toBe(1);
  });

  it("concurrent requests with the same key create one payment", async () => {
    const { basketId, hash } = await quote();
    const token = await approve(basketId, hash);
    const rs = await Promise.all([pay(basketId, token, "race"), pay(basketId, token, "race"), pay(basketId, token, "race")]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(rs.map((r) => r.body.paymentId)).size).toBe(1);
    expect(await count("SELECT count(*) n FROM bap.payment")).toBe(1);
    expect(await count("SELECT count(*) n FROM bap.sub_order")).toBe(3);
    expect(h.fake.received.confirm).toBe(3);
  });

  it("simulated failure → PAYMENT_FAILED, no confirms sent, and a retry works", async () => {
    const { basketId, hash } = await quote();
    const t1 = await approve(basketId, hash);
    const failed = await pay(basketId, t1, "f1", { simulateFailure: true });
    expect(failed.body.status).toBe("FAILED");
    expect((await h.call("GET", "/bap/basket")).body.status).toBe("PAYMENT_FAILED");
    expect(h.fake.received.confirm ?? 0).toBe(0);
    expect(await count("SELECT count(*) n FROM bap.sub_order")).toBe(0);

    // retry: approve again (quote still valid), pay with a new key
    const t2 = await approve(basketId, hash);
    const ok = await pay(basketId, t2, "f2");
    expect(ok.body.status).toBe("PAID");
    expect(h.fake.received.confirm).toBe(3);
    expect(await count("SELECT count(*) n FROM bap.payment")).toBe(2);
    expect(await count("SELECT count(*) n FROM bap.payment WHERE status = 'PAID'")).toBe(1);
  });

  it("admin fail-next-payment flag fails exactly one payment and is cleared", async () => {
    await h.t.pool.query("UPDATE bap.config SET fail_next_payment = true");
    const { basketId, hash } = await quote();
    const failed = await pay(basketId, await approve(basketId, hash), "n1");
    expect(failed.body.status).toBe("FAILED");
    expect((await h.t.pool.query("SELECT fail_next_payment FROM bap.config")).rows[0].fail_next_payment).toBe(false);
    expect(h.fake.received.confirm ?? 0).toBe(0);
    const ok = await pay(basketId, await approve(basketId, hash), "n2");
    expect(ok.body.status).toBe("PAID");
  });

  it("editing the basket after approval invalidates the approval", async () => {
    const { basketId, hash } = await quote();
    const token = await approve(basketId, hash);
    await h.call("PATCH", `/bap/basket/items/${L.milk}`, { qty: 2 });
    expect((await pay(basketId, token, "e1")).status).toBe(403);
    expect(h.fake.received.confirm ?? 0).toBe(0);
  });

  it("an expired approval token is refused", async () => {
    const { basketId, hash } = await quote();
    const token = await approve(basketId, hash);
    await h.t.pool.query("UPDATE bap.approval SET expires_at = now() - interval '1 second'");
    expect((await pay(basketId, token, "x1")).status).toBe(403);
  });

  it("a stale INITIATED payment is settled by the ticker job", async () => {
    const { basketId, hash } = await quote();
    const token = await approve(basketId, hash);
    // simulate a request that died after creating the payment: create it, then age it and tick
    process.env.PAYMENT_SETTLE_MS = "1500";
    const slow = pay(basketId, token, "slow");
    await new Promise((r) => setTimeout(r, 300));
    expect((await h.call("GET", `/bap/basket`)).body.status).toBe("PAYMENT_INITIATED");
    await h.t.pool.query("UPDATE bap.payment SET created_at = now() - interval '2 minutes'");
    await h.t.app.ctx.ticker.tick(Date.now() + 10_000);
    expect(await count("SELECT count(*) n FROM bap.payment WHERE status = 'PAID'")).toBe(1);
    expect(h.fake.received.confirm).toBe(3);
    expect((await slow).body.status).toBe("PAID"); // the request's own settle is a no-op on a final payment
    process.env.PAYMENT_SETTLE_MS = "50";
  });
});
