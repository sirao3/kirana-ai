import { describe, expect, it } from "vitest";
import type { AttemptView, OrderView, SubOrderView } from "@kiranaai/shared";
import { diffAttempts, diffOrder, priceProtection, priceProtectionMessage } from "./handoff";
import { buildReceipt, receiptText } from "./receipt";

const att = (n: number, store: string, status: AttemptView["status"], over: Partial<AttemptView> = {}): AttemptView => ({
  id: `att_${n}`, attemptNo: n, storeId: store.toLowerCase(), storeName: store, status, expiresAt: null, rejectReason: null,
  quotedTotalPaise: 38000, createdAt: "2026-10-18T10:00:00Z", decidedAt: null, ...over,
});
const sub = (status: SubOrderView["status"], attempts: AttemptView[], over: Partial<SubOrderView> = {}): SubOrderView => ({
  id: "so_1", status, approvedStoreId: "gupta", approvedStoreName: "Gupta Kirana", currentStoreName: null, lines: [], approvedAmountPaise: 38000,
  attemptCount: attempts.length, maxAttempts: 3, attempts, refundPaise: null, ...over,
});
const order = (subs: SubOrderView[], over: Partial<OrderView> = {}): OrderView => ({
  basketId: "bsk_1", transactionId: "t", basketStatus: "SETTLED", paymentStatus: "PAID", grandTotalPaise: 140000, refundedPaise: 0, settled: true, subOrders: subs, createdAt: "2026-10-18T10:00:00Z", ...over,
});

describe("diffAttempts", () => {
  it("says nothing on first load", () => {
    expect(diffAttempts(undefined, sub("DISPATCHING", [att(1, "Lakshmi Stores", "OFFERED")]))).toEqual([]);
  });
  it("announces a decline and the next offer as one handoff", () => {
    const prev = sub("DISPATCHING", [att(1, "Lakshmi Stores", "OFFERED")]);
    const next = sub("DISPATCHING", [att(1, "Lakshmi Stores", "REJECTED", { rejectReason: "Out of stock" }), att(2, "Annapurna Provisions", "OFFERED")]);
    expect(diffAttempts(prev, next)).toEqual([
      { text: "Lakshmi Stores declined (Out of stock). Offered to Annapurna Provisions, attempt 2 of 3.", handoff: true },
    ]);
  });
  it("announces expiry and acceptance, each once", () => {
    const a = sub("DISPATCHING", [att(1, "Gupta Kirana", "OFFERED")]);
    const b = sub("DISPATCHING", [att(1, "Gupta Kirana", "EXPIRED"), att(2, "Balaji Mart", "OFFERED")]);
    const c = sub("ACCEPTED", [att(1, "Gupta Kirana", "EXPIRED"), att(2, "Balaji Mart", "ACCEPTED")]);
    expect(diffAttempts(a, b)[0]!.text).toBe("Gupta Kirana did not respond in time. Offered to Balaji Mart, attempt 2 of 3.");
    expect(diffAttempts(b, c)).toEqual([{ text: "Balaji Mart accepted.", handoff: false }]);
    expect(diffAttempts(c, c)).toEqual([]);
  });
  it("announces failure with no store left", () => {
    const prev = sub("DISPATCHING", [att(3, "X", "OFFERED")]);
    const next = sub("FAILED_NO_FULFILMENT", [att(3, "X", "REJECTED")]);
    expect(diffAttempts(prev, next)[0]).toMatchObject({ handoff: true });
    expect(diffAttempts(prev, next)[0]!.text).toContain("No store could take this order");
  });
  it("diffOrder ignores a different order", () => {
    const s = sub("DISPATCHING", [att(1, "A", "REJECTED")]);
    expect(diffOrder(order([sub("DISPATCHING", [att(1, "A", "OFFERED")])], { basketId: "other" }), order([s]))).toEqual([]);
  });
});

describe("price protection and receipt", () => {
  const reassigned = sub("DELIVERED", [att(1, "Gupta Kirana", "EXPIRED"), att(2, "Balaji Mart", "ACCEPTED", { quotedTotalPaise: 42000 })], { currentStoreName: "Balaji Mart" });
  it("covers the PRD worked example: Balaji charges 420, approved 380, 40 covered", () => {
    const p = priceProtection(reassigned)!;
    expect(p.coveredPaise).toBe(4000);
    expect(priceProtectionMessage(p)).toBe("Balaji Mart charges ₹420. You still pay ₹380. KiranaAI covers the ₹40 difference.");
  });
  it("shows nothing when the accepted price is not higher", () => {
    expect(priceProtection(sub("ACCEPTED", [att(1, "Gupta Kirana", "ACCEPTED")]))).toBeNull();
    expect(priceProtection(sub("ACCEPTED", [att(1, "Gupta Kirana", "ACCEPTED", { quotedTotalPaise: 37000 })]))).toBeNull();
  });
  it("builds a receipt that matches the ledger", () => {
    const o = order([reassigned, sub("DELIVERED", [att(1, "Sharma", "ACCEPTED")], { id: "so_2", approvedStoreName: "Sharma", currentStoreName: "Sharma" })]);
    const r = buildReceipt(o);
    expect(r.coveredPaise).toBe(4000);
    expect(r.rows[0]).toMatchObject({ finalStore: "Balaji Mart", status: "Delivered" });
    expect(r.rows[1]!.finalStore).toBeNull();
    expect(r.netPaise).toBe(140000);
    expect(receiptText(o)).toContain("Total paid: ₹1,400");
  });
});
