import { describe, expect, it } from "vitest";
import type { AttemptView, SubOrderView } from "@kiranaai/shared";
import { deriveTimeline } from "./timeline";

const attempt = (n: number, store: string, status: AttemptView["status"], over: Partial<AttemptView> = {}): AttemptView => ({
  id: `att_${n}_${store}`, attemptNo: n, storeId: store.toLowerCase(), storeName: store, status, expiresAt: null, rejectReason: null,
  quotedTotalPaise: 10000, createdAt: "2026-10-18T10:00:00Z", decidedAt: null, ...over,
});

const sub = (status: SubOrderView["status"], attempts: AttemptView[], over: Partial<SubOrderView> = {}): SubOrderView => ({
  id: "so_1", status, approvedStoreId: "x", approvedStoreName: "X", currentStoreName: null, lines: [], approvedAmountPaise: 10000,
  attemptCount: attempts.length, maxAttempts: 3, attempts, refundPaise: null, ...over,
});

const view = (s: SubOrderView) => deriveTimeline(s).map((t) => `${t.state}:${t.label}`);

describe("deriveTimeline", () => {
  it("starts at Finding store before any attempt", () => {
    expect(view(sub("DISPATCHING", []))[0]).toBe("active:Finding store");
  });

  it("shows a live offer with its countdown", () => {
    const t = deriveTimeline(sub("DISPATCHING", [attempt(1, "Gupta", "OFFERED", { expiresAt: "2026-10-18T10:00:45Z" })]));
    const offer = t.find((s) => s.state === "active" && s.label.startsWith("Offered to Gupta"))!;
    expect(offer.label).toBe("Offered to Gupta (attempt 1/3)");
    expect(offer.expiresAt).toBe("2026-10-18T10:00:45Z");
  });

  it("one reject then accepted at the backup, preparing", () => {
    const t = view(
      sub("PREPARING", [
        attempt(1, "Lakshmi", "REJECTED", { rejectReason: "out of stock" }),
        attempt(2, "Annapurna", "ACCEPTED"),
      ]),
    );
    expect(t).toEqual([
      "done:Finding store",
      "done:Offered to Lakshmi (attempt 1/3)",
      "failed:Lakshmi declined: out of stock",
      "done:Offered to Annapurna (attempt 2/3)",
      "done:Accepted by Annapurna",
      "active:Preparing",
      "pending:Ready",
      "pending:Out for delivery",
      "pending:Delivered",
    ]);
  });

  it("one timeout then the next store is offered", () => {
    const t = view(
      sub("DISPATCHING", [attempt(1, "Gupta", "EXPIRED"), attempt(2, "Balaji", "OFFERED", { expiresAt: "2026-10-18T10:01:30Z" })]),
    );
    expect(t.slice(0, 5)).toEqual([
      "done:Finding store",
      "done:Offered to Gupta (attempt 1/3)",
      "failed:Gupta did not respond in time",
      "active:Offered to Balaji (attempt 2/3)",
      "pending:Accepted",
    ]);
  });

  it("shows 'Finding next store' between attempts", () => {
    const t = view(sub("DISPATCHING", [attempt(1, "Gupta", "EXPIRED")]));
    expect(t).toContain("active:Finding next store…");
  });

  it("marks everything done when delivered", () => {
    const t = deriveTimeline(sub("DELIVERED", [attempt(1, "Sharma", "ACCEPTED")]));
    expect(t.every((s) => s.state === "done")).toBe(true);
    expect(t[t.length - 1]!.label).toBe("Delivered");
  });

  it("ends with failure and refund after three failed attempts", () => {
    const t = view(
      sub("FAILED_NO_FULFILMENT", [attempt(1, "A", "REJECTED"), attempt(2, "B", "EXPIRED"), attempt(3, "C", "REJECTED")], { refundPaise: 45000 }),
    );
    expect(t.slice(-2)).toEqual(["failed:No store could take this order", "done:Refund of ₹450 issued"]);
    expect(t.some((l) => l.includes("Preparing"))).toBe(false);
  });
});
