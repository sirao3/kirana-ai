import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderView, SubOrderView } from "@kiranaai/shared";
import { reconcileDispatch, startNextAttempt } from "../src/bap/dispatch.js";
import { payDemoBasket, startHarness, waitForOrder, type BapHarness } from "./fixtures/harness.js";

describe("dispatch engine, refunds, ledger, settlement (T08)", () => {
  let h: BapHarness;
  beforeAll(async () => {
    process.env.PAYMENT_SETTLE_MS = "20";
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  const view = async (basketId: string) => (await h.call<OrderView>("GET", `/bap/baskets/${basketId}`)).body;
  const sub = (v: OrderView, approvedStoreId: string) => v.subOrders.find((s) => s.approvedStoreId === approvedStoreId)!;
  const openAttempt = (s: SubOrderView) => s.attempts.find((a) => a.status === "OFFERED")!;
  const deliver = async (attId: string) => {
    while ((await h.fake.advance(attId)) !== "DELIVERED");
  };
  const rows = async (sql: string) => (await h.t.pool.query(sql)).rows;

  it("confirm → on_confirm marks the attempt OFFERED with the BPP's expires_at; GET /bap/baskets/:id and /bap/orders", async () => {
    expect((await h.call("GET", "/bap/orders")).body).toEqual([]);
    const o = await payDemoBasket(h);
    const v = await view(o.basketId);
    expect(v).toMatchObject({ basketStatus: "PAID", paymentStatus: "PAID", grandTotalPaise: 140000, refundedPaise: 0, settled: false });
    expect(v.subOrders).toHaveLength(3);
    const g = sub(v, "store_gupta");
    expect(g).toMatchObject({ status: "DISPATCHING", approvedAmountPaise: 38000, attemptCount: 1, maxAttempts: 3, currentStoreName: "Gupta Kirana", refundPaise: null });
    expect(g.attempts).toHaveLength(1);
    expect(g.attempts[0]).toMatchObject({ attemptNo: 1, storeId: "store_gupta", status: "OFFERED", quotedTotalPaise: 38000 });
    expect(new Date(g.attempts[0]!.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 40_000);
    expect(g.lines.map((l) => l.listingId)).toHaveLength(2);

    const list = (await h.call<OrderView[]>("GET", "/bap/orders")).body;
    expect(list.map((x) => x.basketId)).toEqual([o.basketId]);
  });

  it("accept → ACCEPTED, then mirrors PREPARING / READY / OUT_FOR_DELIVERY / DELIVERED and writes the ledger", async () => {
    const o = await payDemoBasket(h);
    await h.fake.accept(o.sharma);
    let s = sub(await view(o.basketId), "store_sharma");
    expect(s.status).toBe("ACCEPTED");
    expect(s.attempts[0]!.status).toBe("ACCEPTED");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await h.fake.advance(o.sharma);
      seen.push(sub(await view(o.basketId), "store_sharma").status);
    }
    expect(seen).toEqual(["PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"]);
    expect(await rows("SELECT store_id, gross_paise, commission_paise, net_payable_paise, platform_subsidy_paise FROM bap.ledger_entry")).toEqual([
      { store_id: "store_sharma", gross_paise: 47000, commission_paise: 0, net_payable_paise: 47000, platform_subsidy_paise: 0 },
    ]);
    // others are still being offered, so the basket is not settled
    expect((await view(o.basketId)).basketStatus).toBe("PAID");
  });

  it("reject → attempt 2 at a backup store within 2 s; the first store is excluded", async () => {
    const o = await payDemoBasket(h);
    const started = Date.now();
    await h.fake.reject(o.lakshmi);
    const v = await waitForOrder(h, o.basketId, (x) => sub(x, "store_lakshmi").attempts.length === 2 && sub(x, "store_lakshmi").attempts[1]?.status === "OFFERED", 2000);
    expect(Date.now() - started).toBeLessThan(2000);
    const s = sub(v, "store_lakshmi");
    expect(s.attempts.map((a) => [a.attemptNo, a.storeId, a.status])).toEqual([[1, "store_lakshmi", "REJECTED"], [2, "store_annapurna", "OFFERED"]]);
    expect(s.attempts[0]!.rejectReason).toBeTruthy();
    expect(s).toMatchObject({ status: "DISPATCHING", attemptCount: 2, currentStoreName: "Annapurna Provisions" });
    expect(h.fake.latestFor("store_annapurna")!.id).toBe(s.attempts[1]!.id);
    // the customer's approved lines were re-offered under the same transaction, with the new store's own listings
    expect(h.fake.latestFor("store_annapurna")!.items).toEqual([{ listingId: "lst_annapurna_milk_amul_taaza_1l", qty: 8 }]);
    const lat = await rows("SELECT payload FROM audit_log WHERE action = 'dispatch.next_offer_latency'");
    expect(lat).toHaveLength(1);
    expect(lat[0].payload.ms).toBeLessThan(2000);
    // reassignment reuses the basket's transaction_id: 3 confirms + 1, and a canonical-filter search
    const sent = Object.fromEntries(
      (await rows(`SELECT action, count(*)::int n FROM audit_log WHERE transaction_id = '${v.transactionId}' AND actor = 'bap' AND direction = 'out' GROUP BY action`)).map((r) => [r.action, r.n]),
    );
    expect(sent.confirm).toBe(4);
    expect(sent.search).toBe(1);
  });

  it("an on_confirm error counts as a REJECTED attempt and the next store is offered", async () => {
    h.fake.confirmError.set("store_gupta", "40002");
    const o = await payDemoBasket(h);
    const s = sub(await view(o.basketId), "store_gupta");
    expect(s.attempts.map((a) => [a.storeId, a.status])).toEqual([["store_gupta", "REJECTED"], ["store_balaji", "OFFERED"]]);
    expect(s.attempts[0]!.rejectReason).toBe("out of stock");
  });

  it("falls through to the next candidate when select fails, without using up an attempt", async () => {
    const o = await payDemoBasket(h);
    h.fake.quoteError.set("store_balaji", "40002"); // looks fine in the catalogue, cannot be verified
    await h.fake.expire(o.gupta);
    const s = sub(await view(o.basketId), "store_gupta");
    expect(s.attempts.map((a) => [a.attemptNo, a.storeId, a.status])).toEqual([[1, "store_gupta", "EXPIRED"], [2, "store_annapurna", "OFFERED"]]);
    expect(s.attemptCount).toBe(2);
    expect(await rows("SELECT 1 FROM audit_log WHERE action = 'dispatch.candidate_skipped' AND store_id = 'store_balaji'")).toHaveLength(1);
  });

  it("three failed attempts → FAILED_NO_FULFILMENT and a refund of that sub-order", async () => {
    const o = await payDemoBasket(h);
    for (let n = 1; n <= 3; n++) {
      const v = await view(o.basketId);
      await h.fake.reject(openAttempt(sub(v, "store_sharma")).id, "out of stock");
    }
    const v = await view(o.basketId);
    const s = sub(v, "store_sharma");
    expect(s.attempts.map((a) => a.status)).toEqual(["REJECTED", "REJECTED", "REJECTED"]);
    expect(new Set(s.attempts.map((a) => a.storeId)).size).toBe(3);
    expect(s).toMatchObject({ status: "FAILED_NO_FULFILMENT", attemptCount: 3, refundPaise: 47000, currentStoreName: null });
    expect(v).toMatchObject({ basketStatus: "PARTIALLY_REFUNDED", refundedPaise: 47000, settled: false });
    expect(h.fake.received.confirm).toBe(3 + 2); // no fourth attempt
  });

  it("no eligible store left → refund straight away", async () => {
    const o = await payDemoBasket(h);
    for (const id of ["store_gupta", "store_lakshmi", "store_balaji", "store_annapurna"]) h.fake.setOnline(id, false);
    await h.fake.reject(o.sharma);
    const v = await view(o.basketId);
    expect(sub(v, "store_sharma")).toMatchObject({ status: "FAILED_NO_FULFILMENT", attemptCount: 1, refundPaise: 47000 });
    expect(v.basketStatus).toBe("PARTIALLY_REFUNDED");
  });

  it("all sub-orders fail → REFUNDED, and the refunds add up to what was paid including the platform fee", async () => {
    await h.t.pool.query("UPDATE bap.config SET platform_fee_paise = 500");
    const o = await payDemoBasket(h);
    for (let round = 0; round < 3; round++) {
      for (const store of ["store_sharma", "store_gupta", "store_lakshmi"]) {
        const att = (await view(o.basketId)).subOrders.find((s) => s.approvedStoreId === store)!.attempts.find((a) => a.status === "OFFERED");
        if (att) await h.fake.reject(att.id);
      }
    }
    const v = await view(o.basketId);
    expect(v.subOrders.every((s) => s.status === "FAILED_NO_FULFILMENT")).toBe(true);
    expect(v).toMatchObject({ basketStatus: "REFUNDED", grandTotalPaise: 140500, refundedPaise: 140500 });
    expect(Object.fromEntries(v.subOrders.map((s) => [s.approvedStoreId, s.refundPaise]))).toEqual({
      store_gupta: 38000 + 140, store_lakshmi: 55000 + 192, store_sharma: 47000 + 168,
    });
  });

  it("PRD §9 worked example: Sharma accepts, Gupta times out → Balaji, Lakshmi rejects → Annapurna; ledger Net ₹1,440, subsidy ₹40", async () => {
    const o = await payDemoBasket(h);
    await h.fake.accept(o.sharma);
    await h.fake.expire(o.gupta);
    await h.fake.reject(o.lakshmi, "out of stock");

    let v = await view(o.basketId);
    expect(sub(v, "store_gupta").attempts.map((a) => [a.storeId, a.status, a.quotedTotalPaise])).toEqual([["store_gupta", "EXPIRED", 38000], ["store_balaji", "OFFERED", 42000]]);
    expect(sub(v, "store_lakshmi").attempts.map((a) => [a.storeId, a.status, a.quotedTotalPaise])).toEqual([["store_lakshmi", "REJECTED", 55000], ["store_annapurna", "OFFERED", 55000]]);

    const balaji = h.fake.latestFor("store_balaji")!.id;
    const annapurna = h.fake.latestFor("store_annapurna")!.id;
    await h.fake.accept(balaji);
    await h.fake.accept(annapurna);
    v = await view(o.basketId);
    expect(v.subOrders.map((s) => s.status)).toEqual(["ACCEPTED", "ACCEPTED", "ACCEPTED"]);
    expect(v.basketStatus).toBe("PAID");

    await deliver(o.sharma);
    await deliver(balaji);
    expect((await view(o.basketId)).basketStatus).toBe("PAID");
    await deliver(annapurna);

    v = await view(o.basketId);
    expect(v).toMatchObject({ basketStatus: "SETTLED", settled: true, paymentStatus: "PAID", refundedPaise: 0 });
    expect(v.subOrders.every((s) => s.status === "DELIVERED")).toBe(true);

    const led = await rows("SELECT store_id, gross_paise g, commission_paise c, net_payable_paise n, platform_subsidy_paise s FROM bap.ledger_entry ORDER BY store_id");
    expect(led).toEqual([
      { store_id: "store_annapurna", g: 55000, c: 0, n: 55000, s: 0 },
      { store_id: "store_balaji", g: 42000, c: 0, n: 42000, s: 4000 },
      { store_id: "store_sharma", g: 47000, c: 0, n: 47000, s: 0 },
    ]);
    expect(led.reduce((a, r) => a + r.n, 0)).toBe(144000); // Net ₹1,440
    expect(led.reduce((a, r) => a + r.s, 0)).toBe(4000); // subsidy ₹40
  });

  it("commission comes from bap.config", async () => {
    await h.t.pool.query("UPDATE bap.config SET commission_bps = 250");
    const o = await payDemoBasket(h);
    await h.fake.accept(o.sharma);
    await deliver(o.sharma);
    expect(await rows("SELECT gross_paise g, commission_paise c, net_payable_paise n FROM bap.ledger_entry")).toEqual([{ g: 47000, c: 1175, n: 45825 }]);
  });

  it("duplicate and stale callbacks are no-ops", async () => {
    const o = await payDemoBasket(h);
    await h.fake.accept(o.sharma);
    await h.fake.expire(o.gupta);
    await h.fake.resend(o.sharma, "status"); // accept again, new message id
    await h.fake.resend(o.gupta, "cancel"); // the expired attempt, again
    const v = await view(o.basketId);
    expect(sub(v, "store_sharma")).toMatchObject({ status: "ACCEPTED", attemptCount: 1 });
    expect(sub(v, "store_gupta").attempts).toHaveLength(2);
    // a late "Accepted" for an attempt we already gave up on does not resurrect it
    await h.fake.resend(o.gupta, "status");
    expect(sub(await view(o.basketId), "store_gupta").attempts.map((a) => a.status)).toEqual(["EXPIRED", "OFFERED"]);
  });

  it("reconciler: a DISPATCHING sub-order with no open attempt gets its next attempt", async () => {
    const o = await payDemoBasket(h);
    const att = (await view(o.basketId)).subOrders.find((s) => s.approvedStoreId === "store_gupta")!.attempts[0]!;
    // as if the process died right after recording the rejection
    await h.t.pool.query("UPDATE bap.attempt SET status = 'REJECTED', decided_at = now() - interval '10 seconds' WHERE id = $1", [att.id]);
    await h.t.pool.query("UPDATE bap.sub_order SET excluded_store_ids = ARRAY['store_gupta'] WHERE approved_store_id = 'store_gupta'");
    await reconcileDispatch(h.t.app.ctx);
    const s = sub(await view(o.basketId), "store_gupta");
    expect(s.attempts.map((a) => [a.attemptNo, a.storeId, a.status])).toEqual([[1, "store_gupta", "REJECTED"], [2, "store_balaji", "OFFERED"]]);
  });

  it("reconciler: an overdue OFFERED attempt whose on_cancel never came is refreshed with `status`", async () => {
    const o = await payDemoBasket(h);
    h.fake.silent = true;
    await h.fake.expire(o.gupta); // the BPP expired it but its on_cancel was lost
    expect(sub(await view(o.basketId), "store_gupta").attempts[0]!.status).toBe("OFFERED");
    await h.t.pool.query("UPDATE bap.attempt SET expires_at = now() - interval '10 seconds' WHERE id = $1", [o.gupta]);
    await reconcileDispatch(h.t.app.ctx);
    const s = sub(await view(o.basketId), "store_gupta");
    expect(s.attempts.map((a) => [a.storeId, a.status])).toEqual([["store_gupta", "EXPIRED"], ["store_balaji", "OFFERED"]]);
    expect(h.fake.received.status).toBe(1);
  });

  it("reconciler: a PENDING attempt whose on_confirm never arrived is re-confirmed (idempotent order.id)", async () => {
    const o = await payDemoBasket(h);
    await h.t.pool.query("UPDATE bap.attempt SET status = 'PENDING', expires_at = NULL, created_at = now() - interval '15 seconds' WHERE id = $1", [o.sharma]);
    await reconcileDispatch(h.t.app.ctx);
    expect(sub(await view(o.basketId), "store_sharma").attempts[0]!.status).toBe("OFFERED");
    expect(h.fake.orders.get(o.sharma)!.confirms).toBe(2);
    expect(h.fake.orders.size).toBe(3); // still one BPP order per attempt
  });

  it("concurrent startNextAttempt calls claim exactly one attempt row", async () => {
    const o = await payDemoBasket(h);
    const s0 = (await view(o.basketId)).subOrders.find((s) => s.approvedStoreId === "store_lakshmi")!;
    await h.t.pool.query("UPDATE bap.attempt SET status = 'REJECTED', decided_at = now() WHERE id = $1", [s0.attempts[0]!.id]);
    await Promise.all([1, 2, 3].map(() => startNextAttempt(h.t.app.ctx, s0.id)));
    const s = sub(await view(o.basketId), "store_lakshmi");
    expect(s.attempts).toHaveLength(2);
    expect(s.attemptCount).toBe(2);
    expect(h.fake.received.confirm).toBe(3 + 1);
  });
});
