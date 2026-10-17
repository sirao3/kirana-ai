import { describe, expect, it } from "vitest";
import { formatINR, paiseToRupees, rupeesToPaise } from "./money.js";
import { newId } from "./ids.js";

describe("money", () => {
  it("round-trips rupee strings", () => {
    expect(rupeesToPaise("450")).toBe(45000);
    expect(rupeesToPaise("12.5")).toBe(1250);
    expect(rupeesToPaise("0.05")).toBe(5);
    expect(paiseToRupees(45000)).toBe("450.00");
    expect(paiseToRupees(-1205)).toBe("-12.05");
    expect(rupeesToPaise(paiseToRupees(123456))).toBe(123456);
  });
  it("rejects bad input", () => {
    expect(() => rupeesToPaise("1.234")).toThrow();
    expect(() => paiseToRupees(1.5)).toThrow();
  });
  it("formats INR", () => {
    expect(formatINR(140000)).toBe("₹1,400");
    expect(formatINR(1250)).toBe("₹12.50");
  });
  it("makes prefixed ids", () => {
    expect(newId("bsk")).toMatch(/^bsk_[0-9A-Z]{26}$/);
  });
});
