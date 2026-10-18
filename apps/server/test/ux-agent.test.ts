import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentTurnProgress, BasketView } from "@kiranaai/shared";
import { agentTestHooks } from "../src/bap/agent/index.js";
import type { Content, Llm } from "../src/bap/agent/llm.js";
import { TURN_TTL_MS, TurnProgressStore } from "../src/bap/agent/progress.js";
import { qtyStatedByCustomer } from "../src/bap/agent/qty.js";
import { summarizeStep } from "../src/bap/agent/tools.js";
import { tokenFor } from "./helpers.js";
import { L, startHarness, type BapHarness } from "./fixtures/harness.js";

const fc = (name: string, args: Record<string, unknown> = {}): Content => ({ role: "model", parts: [{ functionCall: { name, args } }] });

describe("TurnProgressStore (UX-01)", () => {
  it("records steps, scopes by customer, and expires after 5 minutes", () => {
    let now = 1_000_000;
    const s = new TurnProgressStore(() => now);
    s.start("c1", "turn-0001");
    const i = s.beginStep("c1", "turn-0001", "search_products");
    expect(s.get("c1", "turn-0001")).toMatchObject({ done: false, steps: [{ tool: "search_products", ok: null, endedAt: null, summary: null }] });
    s.finishStep("c1", "turn-0001", i, { ok: true, summary: "5 stores · 14 offers" });
    s.finish("c1", "turn-0001");
    const p = s.get("c1", "turn-0001")!;
    expect(p.done).toBe(true);
    expect(p.steps[0]).toMatchObject({ ok: true, summary: "5 stores · 14 offers" });
    expect(p.steps[0]!.endedAt).not.toBeNull();
    expect(s.get("c2", "turn-0001")).toBeNull();
    expect(s.get("c1", "turn-9999")).toBeNull();
    now += TURN_TTL_MS + 1;
    expect(s.get("c1", "turn-0001")).toBeNull();
  });
});

describe("qtyStatedByCustomer / summarizeStep", () => {
  it("compares the plan quantity to numbers in the clause about that need", () => {
    const msg = "Weekly groceries for 4: 2 packs toor dal, atta and milk, tea";
    expect(qtyStatedByCustomer(msg, "toor dal", 2)).toBe(true);
    expect(qtyStatedByCustomer(msg, "toor dal", 3)).toBe(false);
    expect(qtyStatedByCustomer(msg, "atta", 1)).toBe(false);
    expect(qtyStatedByCustomer("do packet milk and teen tea", "tea", 3)).toBe(true);
    expect(qtyStatedByCustomer("milk x4", "milk", 4)).toBe(true);
  });

  it("builds summaries from tool data", () => {
    const ok = (result: unknown) => ({ ok: true, result });
    expect(summarizeStep("search_products", ok({ groups: [{ offers: [{ store: "A" }, { store: "B" }] }, { offers: [{ store: "A" }] }] }))).toBe("2 stores · 3 offers");
    expect(summarizeStep("plan_basket", ok({ stores: [1, 2, 3], estimatedTotal: "₹1,380" }))).toBe("3 stores · est ₹1,380");
    expect(summarizeStep("get_quote", ok({ grandTotal: "₹1,400" }))).toBe("₹1,400 verified");
    expect(summarizeStep("get_quote", { ok: false, result: { error: "quote_failed" } })).toBe("quote failed");
  });
});

describe("agent live progress, reasons and suggested quantities (real BAP, scripted model)", () => {
  let h: BapHarness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());
  afterEach(() => {
    agentTestHooks.llm = undefined;
  });

  /** Scripted model that plans, sets, quotes, approves; records live progress each time it is called. */
  function demoLlm(token: string, turnId: string, seenSteps: number[]): Llm {
    let n = 0;
    return {
      async generate({ contents }) {
        const p = await h.call<AgentTurnProgress>("GET", `/bap/agent/turns/${turnId}`, undefined, { token });
        seenSteps.push(p.status === 200 ? p.body.steps.filter((s) => s.endedAt).length : -1);
        n++;
        if (n === 1) return fc("plan_basket", { needs: [{ query: "atta", qty: 1 }, { query: "toor dal", qty: 2 }, { query: "milk", qty: 8 }, { query: "tea", qty: 1 }] });
        if (n === 2) {
          const out = contents.at(-1)!.parts![0]!.functionResponse!.response as { output: { choices: { listing_id: string; qty: number }[] } };
          return fc("set_basket", { items: out.output.choices.map((c) => ({ listing_id: c.listing_id, qty: c.qty })) });
        }
        if (n === 3) return fc("get_quote");
        if (n === 4) return fc("request_approval");
        return { role: "model", parts: [{ text: "Done." }] };
      },
    };
  }

  it("steps appear one by one; reasons and suggested qty persist from plan_basket; other customers get 404", async () => {
    const turnId = "turn_abcdef12";
    const seen: number[] = [];
    agentTestHooks.llm = demoLlm(h.token, turnId, seen);
    const res = await h.call("POST", "/bap/agent/chat", { message: "weekly essentials: 2 kg toor dal, 8 litres milk, atta, tea", turnId });
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(4);
    // Model call k saw k-1 finished steps (call 1 may race the registration: 404 -> -1 is not allowed since start() runs first).
    expect(seen).toEqual([0, 1, 2, 3, 4]);

    const done = await h.call<AgentTurnProgress>("GET", `/bap/agent/turns/${turnId}`);
    expect(done.body.done).toBe(true);
    expect(done.body.steps.map((s) => s.tool)).toEqual(["plan_basket", "set_basket", "get_quote", "request_approval"]);
    expect(done.body.steps.every((s) => s.ok === true && s.summary && s.endedAt)).toBe(true);
    expect(done.body.steps[0]!.summary).toMatch(/^\d+ stores? · est ₹/);
    expect(done.body.steps[2]!.summary).toMatch(/verified$/);

    const other = await tokenFor(h.t.url, { role: "customer", id: "cust_rahul" }).catch(() => null);
    if (other) expect((await h.call("GET", `/bap/agent/turns/${turnId}`, undefined, { token: other })).status).toBe(404);
    expect((await h.call("GET", "/bap/agent/turns/turn_unknown1")).status).toBe(404);

    const basket = (await h.call<BasketView>("GET", "/bap/basket")).body;
    const items = basket.stores.flatMap((s) => s.items);
    expect(items).toHaveLength(4);
    expect(items.every((i) => typeof i.reason === "string" && i.reason.length > 0)).toBe(true);
    const byName = (re: RegExp) => items.find((i) => re.test(i.name.toLowerCase()))!;
    expect(byName(/dal/).qtyInferred).toBe(false); // "2 kg toor dal" states 2
    expect(byName(/milk/).qtyInferred).toBe(false); // "8 litres milk" states 8
    expect(byName(/atta/).qtyInferred).toBe(true);
    expect(byName(/tea/).qtyInferred).toBe(true);
  });

  it("a turnId with a bad shape is rejected; a turn without turnId leaves no progress", async () => {
    agentTestHooks.llm = { generate: async () => ({ role: "model", parts: [{ text: "hi" }] }) };
    expect((await h.call("POST", "/bap/agent/chat", { message: "hi", turnId: "x" })).status).toBe(400);
    expect((await h.call("POST", "/bap/agent/chat", { message: "hi" })).status).toBe(200);
  });

  it("PUT /bap/basket persists reasons; qty edit keeps the reason and clears the flag; manual add has none; confirm-qty clears all", async () => {
    await Promise.all(["atta", "tea", "milk"].map((q) => h.call("GET", `/bap/search?q=${q}`)));
    const put = await h.call<BasketView>("PUT", "/bap/basket", {
      items: [
        { listingId: L.atta, qty: 1, reason: "Cheapest at Sharma", qtyInferred: true },
        { listingId: L.tea, qty: 1, reason: "Same store as dal", qtyInferred: true },
      ],
      planReasons: ["Adding Lakshmi saves ₹38 even after ₹30 delivery"],
    });
    expect(put.status).toBe(200);
    expect(put.body.planReasons).toEqual(["Adding Lakshmi saves ₹38 even after ₹30 delivery"]);
    const line = (b: BasketView, id: string) => b.stores.flatMap((s) => s.items).find((i) => i.listingId === id)!;
    expect(line(put.body, L.atta)).toMatchObject({ reason: "Cheapest at Sharma", qtyInferred: true });

    const patched = await h.call<BasketView>("PATCH", `/bap/basket/items/${L.atta}`, { qty: 2 });
    expect(line(patched.body, L.atta)).toMatchObject({ qty: 2, reason: "Cheapest at Sharma", qtyInferred: false });
    expect(line(patched.body, L.tea)).toMatchObject({ qtyInferred: true });
    expect(patched.body.planReasons).toHaveLength(1);

    const manual = await h.call<BasketView>("PUT", "/bap/basket/items", { listingId: L.milk, qty: 1 });
    expect(line(manual.body, L.milk)).toMatchObject({ reason: null, qtyInferred: false });

    const confirmed = await h.call<BasketView>("POST", "/bap/basket/confirm-qty");
    expect(line(confirmed.body, L.tea).qtyInferred).toBe(false);
    expect(line(confirmed.body, L.tea).reason).toBe("Same store as dal");

    const replaced = await h.call<BasketView>("PUT", "/bap/basket", { items: [{ listingId: L.atta, qty: 1 }] });
    expect(line(replaced.body, L.atta)).toMatchObject({ reason: null, qtyInferred: false });
    expect(replaced.body.planReasons).toEqual([]);
  });
});
