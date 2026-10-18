import { describe, expect, it } from "vitest";
import type { AttemptView, OrderView, SubOrderStatus, SubOrderView } from "@kiranaai/shared";
import { flashTitle } from "../merchant/attention";
import { deriveSteps, reassignmentCounts, type DemoState, type StepKey } from "./steps";

const attempt = (n: number, status: AttemptView["status"]): AttemptView => ({
  id: `a${n}`, attemptNo: n, storeId: "s", storeName: "S", status, expiresAt: null, rejectReason: null, quotedTotalPaise: 100, createdAt: "", decidedAt: null,
});
const sub = (status: SubOrderStatus, attempts: AttemptView[] = [attempt(1, "ACCEPTED")]): SubOrderView => ({
  id: "x", status, approvedStoreId: "s", approvedStoreName: "S", currentStoreName: "S", lines: [], approvedAmountPaise: 100, attemptCount: attempts.length, maxAttempts: 3, attempts, refundPaise: null,
});
const order = (o: Partial<OrderView> & { subs?: SubOrderView[] }): OrderView => ({
  basketId: "b", transactionId: "t", basketStatus: "PAID", paymentStatus: "PAID", grandTotalPaise: 1400, refundedPaise: 0, settled: false,
  subOrders: o.subs ?? [], createdAt: "2026-10-18T10:00:00Z", ...o,
});
const base: DemoState = { basket: { itemCount: 0, status: "DRAFT" }, order: null, staleOrders: false, resetDone: false, ledgerOpened: false };
const status = (st: DemoState) => Object.fromEntries(deriveSteps(st).map((s) => [s.key, s.status])) as Record<StepKey, string>;
const current = (st: DemoState) => deriveSteps(st).find((s) => s.status === "current")?.key;

describe("deriveSteps", () => {
  it("starts at Ask on a clean database", () => {
    expect(current(base)).toBe("ask");
    expect(status(base).reset).toBe("done");
  });

  it("holds at Reset while earlier orders exist, until reset or progress", () => {
    const stale = { ...base, staleOrders: true };
    expect(current(stale)).toBe("reset");
    expect(current({ ...stale, resetDone: true })).toBe("ask");
    // starting anyway proves reset is moot
    expect(current({ ...stale, basket: { itemCount: 4, status: "DRAFT" } })).toBe("pay");
  });

  it("ticks Ask when the basket has items, then waits on payment", () => {
    const st = { ...base, basket: { itemCount: 4, status: "QUOTED" as const } };
    expect(status(st).ask).toBe("done");
    expect(current(st)).toBe("pay");
  });

  it("ticks pay when PAID and waits for the stores", () => {
    const st = { ...base, order: order({ subs: [sub("DISPATCHING", [attempt(1, "OFFERED")]), sub("DISPATCHING", [attempt(1, "OFFERED")])] }) };
    expect(status(st).pay).toBe("done");
    expect(current(st)).toBe("answer");
  });

  it("does not tick pay for an unpaid order", () => {
    const st = { ...base, order: order({ paymentStatus: "INITIATED" }) };
    expect(status(st).pay).not.toBe("done");
  });

  it("counts a reject and a timeout, and ticks answer once everyone has accepted", () => {
    const subs = [
      sub("PREPARING"),
      sub("ACCEPTED", [attempt(1, "REJECTED"), attempt(2, "ACCEPTED")]),
      sub("ACCEPTED", [attempt(1, "EXPIRED"), attempt(2, "ACCEPTED")]),
    ];
    const st = { ...base, order: order({ subs }) };
    expect(reassignmentCounts(st.order!)).toEqual({ rejected: 1, expired: 1 });
    const answer = deriveSteps(st).find((s) => s.key === "answer")!;
    expect(answer.status).toBe("done");
    expect(answer.detail).toBe("3/3 accepted · 1 rejected · 1 timed out · reassigned");
    expect(current(st)).toBe("deliver");
  });

  it("answer is current with live progress while one store is still deciding", () => {
    const subs = [sub("ACCEPTED"), sub("DISPATCHING", [attempt(1, "REJECTED"), attempt(2, "OFFERED")])];
    const answer = deriveSteps({ ...base, order: order({ subs }) }).find((s) => s.key === "answer")!;
    expect(answer.status).toBe("current");
    expect(answer.detail).toBe("1/2 accepted · 1 rejected");
  });

  it("walks delivered, settled and ledger", () => {
    const subs = [sub("DELIVERED"), sub("DELIVERED")];
    const delivered = { ...base, order: order({ subs }) };
    expect(status(delivered).deliver).toBe("done");
    expect(current(delivered)).toBe("settle");
    const settled = { ...base, order: order({ subs, settled: true }) };
    expect(current(settled)).toBe("ledger");
    expect(current({ ...settled, ledgerOpened: true })).toBeUndefined();
  });

  it("partial delivery shows progress", () => {
    const st = { ...base, order: order({ subs: [sub("DELIVERED"), sub("OUT_FOR_DELIVERY")] }) };
    const d = deriveSteps(st).find((s) => s.key === "deliver")!;
    expect(d.status).toBe("current");
    expect(d.detail).toBe("1/2 delivered");
  });
});

describe("flashTitle", () => {
  it("shows count and amount in the flash phase and the plain title otherwise", () => {
    expect(flashTitle("KiranaAI", 1, 47000, true)).toBe("(1) New offer ₹470 — KiranaAI");
    expect(flashTitle("KiranaAI", 2, 0, true)).toBe("(2) New offer — KiranaAI");
    expect(flashTitle("KiranaAI", 1, 47000, false)).toBe("KiranaAI");
  });
});
