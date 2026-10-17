import { describe, expect, it } from "vitest";
import { Ticker } from "../src/lib/ticker.js";

describe("Ticker", () => {
  it("runs overdue jobs once and never overlaps", async () => {
    const t = new Ticker();
    let runs = 0;
    let release!: () => void;
    t.add({ name: "j", everyMs: 1000, run: () => { runs++; return new Promise<void>((r) => (release = r)); } });
    const p1 = t.tick(10_000);
    void t.tick(20_000); // still running → no second start
    expect(runs).toBe(1);
    release();
    await p1;
    await t.tick(10_500); // not overdue yet
    expect(runs).toBe(1);
    void t.tick(11_000);
    expect(runs).toBe(2);
    release();
  });
});
