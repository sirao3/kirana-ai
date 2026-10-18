import { existsSync, readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Content } from "@google/genai";
import { agentTestHooks, runTurn } from "../src/bap/agent/index.js";
import { isAllowedRoute, makeToolClient, ToolForbiddenError } from "../src/bap/agent/client.js";
import { createGeminiLlm, type Llm } from "../src/bap/agent/llm.js";
import { SYSTEM_PROMPT } from "../src/bap/agent/prompt.js";
import { TOOL_DECLARATIONS } from "../src/bap/agent/tools.js";
import { startTestApp, tokenFor } from "./helpers.js";

// ---------- fakes ----------

interface Call { method: string; path: string; body: unknown }

/** In-memory stand-in for the BAP API (lane B) behind the agent's loopback fetch. */
function fakeBap(opts: { quoteValid?: boolean } = {}) {
  const calls: Call[] = [];
  let items: { listingId: string; qty: number }[] = [];
  let status = "DRAFT";
  const basket = () => ({
    id: "bsk_1", status, transactionId: "txn_1", itemCount: items.length,
    stores: items.length ? [{ storeId: "st1", storeName: "Sharma General", itemsTotalPaise: 0, items: items.map((i) => ({ listingId: i.listingId, storeId: "st1", storeName: "Sharma General", canonicalProductId: "cp1", name: "Aashirvaad Atta 10 kg", qty: i.qty, seenPricePaise: 45000, lineTotalPaise: 45000 * i.qty })) }] : [],
    quote: status === "QUOTED" ? { id: "q1", quoteHash: "hash_abc", validUntil: new Date(Date.now() + (opts.quoteValid === false ? -1000 : 600_000)).toISOString(), expired: opts.quoteValid === false, itemsTotalPaise: 90000, deliveryTotalPaise: 2000, platformFeePaise: 500, grandTotalPaise: 92500, stores: [] } : null,
  });
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: u.pathname + u.search, body });
    const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    if (u.pathname === "/bap/search") {
      const q = u.searchParams.get("q") ?? "";
      if (/jeera/.test(q)) return json({ query: q, groups: [], looseDeclined: [{ query: q, reason: "Loose spices are not sold", alternative: { canonicalProductId: "cp_jeera", name: "Jeera 100 g", packLabel: "100 g" } }], tookMs: 1 });
      return json({ query: q, groups: [], looseDeclined: [], tookMs: 1 });
    }
    if (u.pathname === "/bap/plan") return json({ choices: [{ query: "atta", qty: 2, offer: { listingId: "lst_atta", storeName: "Sharma General", name: "Atta 10 kg", pricePaise: 45000 }, reason: "cheapest" }], stores: [], estimatedTotalPaise: 90000, budgetPaise: null, withinBudget: null, reasons: [], unmatched: [], looseDeclined: [] });
    if (u.pathname === "/bap/basket" && method === "PUT") { items = body.items; status = "DRAFT"; return json(basket()); }
    if (u.pathname === "/bap/basket") return json(basket());
    if (u.pathname === "/bap/basket/quote") { status = "QUOTED"; return json({ basket: basket(), quote: basket().quote, errors: [] }); }
    return json({ error: "not_found" }, 404);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const fc = (name: string, args: Record<string, unknown> = {}, sig?: string): Content => ({
  role: "model",
  parts: [{ functionCall: { name, args }, ...(sig ? { thoughtSignature: sig } : {}) }],
});
const say = (text: string): Content => ({ role: "model", parts: [{ text, thoughtSignature: "sig-final" }] });

/** Scripted model: returns the queued Contents in order and records what it was sent. */
function scriptedLlm(script: Content[]) {
  const seen: Content[][] = [];
  const llm: Llm = {
    async generate({ contents }) {
      seen.push(JSON.parse(JSON.stringify(contents)));
      const next = script.shift();
      if (!next) throw new Error("script exhausted");
      return next;
    },
  };
  return { llm, seen };
}

// ---------- allowlist ----------

describe("agent tool client allowlist", () => {
  it("allows only the read/edit/quote routes", () => {
    for (const [m, p] of [
      ["GET", "/bap/search?q=atta"], ["POST", "/bap/plan"], ["GET", "/bap/basket"], ["PUT", "/bap/basket"],
      ["PUT", "/bap/basket/items"], ["PATCH", "/bap/basket/items/lst_1"], ["DELETE", "/bap/basket/items/lst_1"],
      ["POST", "/bap/basket/quote"], ["GET", "/bap/orders"], ["GET", "/bap/baskets/bsk_1"],
    ] as const) expect(isAllowedRoute(m, p), `${m} ${p}`).toBe(true);
  });

  it("rejects approve, pay and everything else", async () => {
    for (const [m, p] of [
      ["POST", "/bap/baskets/bsk_1/approve"], ["POST", "/bap/baskets/bsk_1/pay"], ["POST", "/bap/baskets/bsk_1"],
      ["GET", "/bap/baskets/bsk_1/pay"], ["POST", "/bap/baskets/../baskets/bsk_1/pay"], ["GET", "/bap/baskets/bsk_1/%2e%2e/pay"],
      ["POST", "/bap/admin/anything"], ["GET", "/admin/api/ledger"], ["POST", "/auth/persona"], ["DELETE", "/bap/basket"],
      ["GET", "/bap/search/../baskets/x/pay"],
    ] as const) expect(isAllowedRoute(m, p), `${m} ${p}`).toBe(false);

    const { calls, fetchImpl } = fakeBap();
    const client = makeToolClient({ baseUrl: "http://x", token: "t", fetchImpl });
    await expect(client.call("POST", "/bap/baskets/bsk_1/approve", { quoteHash: "h" })).rejects.toBeInstanceOf(ToolForbiddenError);
    await expect(client.call("POST", "/bap/baskets/bsk_1/pay", {})).rejects.toBeInstanceOf(ToolForbiddenError);
    expect(calls).toHaveLength(0);
  });

  it("declares no approve/pay tool", () => {
    expect(TOOL_DECLARATIONS.map((d) => d.name).join(",")).not.toMatch(/pay|approve|confirm|order$/);
  });
});

// ---------- HTTP route with a mocked model ----------

describe("POST /bap/agent/chat (mocked Gemini)", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let token: string;
  beforeAll(async () => {
    t = await startTestApp();
    token = await tokenFor(t.url, { role: "customer", id: "cust_priya" });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.pool.query("DELETE FROM bap.agent_message");
    agentTestHooks.timeoutMs = undefined;
    agentTestHooks.maxPerWindow = undefined;
  });
  afterEach(() => {
    agentTestHooks.llm = undefined;
    agentTestHooks.fetchImpl = undefined;
  });

  const chat = (message: string, tok: string | null = token) =>
    fetch(`${t.url}/bap/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({ message }),
    });

  it("requires a customer token", async () => {
    expect((await chat("hi", null)).status).toBe(401);
    const merchant = await tokenFor(t.url, { role: "merchant", id: (await t.pool.query("SELECT id FROM bpp.store LIMIT 1")).rows[0].id });
    expect((await chat("hi", merchant)).status).toBe(403);
  });

  it("tool loop builds a basket, quotes it and requests approval; never touches approve/pay", async () => {
    const bap = fakeBap();
    agentTestHooks.fetchImpl = bap.fetchImpl;
    const { llm } = scriptedLlm([
      fc("plan_basket", { needs: [{ query: "atta", qty: 2 }], budget_rupees: 1500 }, "sigA"),
      fc("set_basket", { items: [{ listing_id: "lst_atta", qty: 2 }] }),
      fc("get_quote"),
      fc("request_approval"),
      say("Basket ready. Please review and approve."),
    ]);
    agentTestHooks.llm = llm;

    const res = await chat("Weekly groceries under 1500: atta");
    expect(res.status).toBe(200);
    const reply = await res.json();
    expect(reply.text).toBe("Basket ready. Please review and approve.");
    expect(reply.steps).toEqual([
      { tool: "plan_basket", ok: true }, { tool: "set_basket", ok: true }, { tool: "get_quote", ok: true }, { tool: "request_approval", ok: true },
    ]);
    expect(reply.events).toEqual([
      { type: "basket_updated" },
      { type: "quote_ready", quoteId: "q1", grandTotalPaise: 92500 },
      { type: "approval_requested", basketId: "bsk_1", quoteHash: "hash_abc", grandTotalPaise: 92500 },
    ]);
    // Reason + suggested-qty flag come from the plan_basket result held server-side ("atta, 2" was not stated in the message).
    expect(bap.calls.find((c) => c.method === "PUT")?.body).toEqual({ items: [{ listingId: "lst_atta", qty: 2, reason: "cheapest", qtyInferred: true }] });
    expect(bap.calls.some((c) => /approve|pay/.test(c.path))).toBe(false);

    const audits = await t.pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'agent.tool' AND entity_id = 'cust_priya'");
    expect(audits.rows[0].n).toBe(4);
  });

  it("request_approval without a valid quote emits no approval event", async () => {
    agentTestHooks.fetchImpl = fakeBap({ quoteValid: false }).fetchImpl;
    agentTestHooks.llm = scriptedLlm([fc("request_approval"), say("Let me re-quote.")]).llm;
    const reply = await (await chat("just pay for me")).json();
    expect(reply.events).toEqual([]);
    expect(reply.steps).toEqual([{ tool: "request_approval", ok: false }]);
  });

  it("an attempt to call a pay tool is refused and reaches no route", async () => {
    const bap = fakeBap();
    agentTestHooks.fetchImpl = bap.fetchImpl;
    agentTestHooks.llm = scriptedLlm([fc("pay", { basket_id: "bsk_1" }), say("I cannot pay; please use the approval card.")]).llm;
    const reply = await (await chat("pay now")).json();
    expect(reply.steps).toEqual([{ tool: "pay", ok: false }]);
    expect(bap.calls).toHaveLength(0);
  });

  it("surfaces loose_declined for 250 g jeera", async () => {
    agentTestHooks.fetchImpl = fakeBap().fetchImpl;
    agentTestHooks.llm = scriptedLlm([fc("search_products", { query: "250 g jeera" }), say("Jeera is only sold as a 100 g pack.")]).llm;
    const reply = await (await chat("Also add 250 g jeera")).json();
    expect(reply.events).toEqual([
      { type: "loose_declined", query: "250 g jeera", reason: "Loose spices are not sold", alternative: { canonicalProductId: "cp_jeera", name: "Jeera 100 g", packLabel: "100 g" } },
    ]);
  });

  it("round-trips model Content unchanged, thoughtSignature included", async () => {
    agentTestHooks.fetchImpl = fakeBap().fetchImpl;
    const modelA = fc("view_basket", {}, "SIG-ABC==");
    const modelB = say("Basket is empty.");
    const first = scriptedLlm([modelA, modelB]);
    agentTestHooks.llm = first.llm;
    expect((await chat("what is in my basket?")).status).toBe(200);

    const rows = await t.pool.query("SELECT role, content FROM bap.agent_message WHERE customer_id = 'cust_priya' ORDER BY id");
    expect(rows.rows.map((r) => r.role)).toEqual(["user", "model", "user", "model"]);
    expect(rows.rows[1].content).toEqual(modelA);
    expect(rows.rows[1].content.parts[0].thoughtSignature).toBe("SIG-ABC==");
    expect(rows.rows[3].content).toEqual(modelB);

    // Next turn: the model is sent the stored history verbatim.
    const second = scriptedLlm([say("Anything else?")]);
    agentTestHooks.llm = second.llm;
    await chat("thanks");
    const sent = second.seen[0]!;
    expect(sent.slice(0, 4)).toEqual(rows.rows.map((r) => r.content));
    expect(sent[1]!.parts![0]!.thoughtSignature).toBe("SIG-ABC==");
    expect(sent[sent.length - 1]).toEqual({ role: "user", parts: [{ text: "thanks" }] });

    const h = await (await fetch(`${t.url}/bap/agent/history`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(h.messages.map((m: { role: string }) => m.role)).toEqual(["user", "model", "user", "model"]);
  });

  it("times out with 503 agent_unavailable and stores nothing", async () => {
    agentTestHooks.timeoutMs = 150;
    agentTestHooks.llm = { generate: ({ signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) };
    const res = await chat("hello");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "agent_unavailable" });
    expect((await t.pool.query("SELECT count(*)::int AS n FROM bap.agent_message")).rows[0].n).toBe(0);
  });

  it("returns 503 when the model call fails", async () => {
    agentTestHooks.llm = { generate: async () => { throw new Error("boom"); } };
    expect((await chat("hello")).status).toBe(503);
  });
});

describe("rate limit", () => {
  it("returns 429 after the per-IP limit", async () => {
    const t = await startTestApp();
    try {
      agentTestHooks.maxPerWindow = 2;
      const token = await tokenFor(t.url, { role: "customer", id: "cust_priya" });
      agentTestHooks.llm = scriptedLlm([say("one"), say("two")]).llm;
      const post = () => fetch(`${t.url}/bap/agent/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ message: "hi" }) });
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(200);
      const third = await post();
      expect(third.status).toBe(429);
      expect(await third.json()).toEqual({ error: "rate_limited" });
    } finally {
      agentTestHooks.llm = undefined;
      agentTestHooks.maxPerWindow = undefined;
      await t.close();
    }
  });
});

describe("daily cap", () => {
  it("returns 429 once AGENT_DAILY_CAP is reached", async () => {
    const t = await startTestApp({ AGENT_DAILY_CAP: "1" });
    try {
      const token = await tokenFor(t.url, { role: "customer", id: "cust_priya" });
      agentTestHooks.llm = scriptedLlm([say("ok")]).llm;
      const post = () => fetch(`${t.url}/bap/agent/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ message: "hi" }) });
      expect((await post()).status).toBe(200);
      const r = await post();
      expect(r.status).toBe(429);
      expect(await r.json()).toEqual({ error: "daily_cap" });
    } finally {
      agentTestHooks.llm = undefined;
      await t.close();
    }
  });
});

// ---------- live smoke (skipped without a key) ----------

function liveKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envFile = new URL("../../../.env", import.meta.url);
  if (!existsSync(envFile)) return undefined;
  return /^GEMINI_API_KEY=(.+)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.trim();
}
const key = liveKey();

describe.skipIf(!key)("live Gemini smoke", () => {
  it("answers a trivial message through the tool loop with a stub tool", async () => {
    const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
    const llm = createGeminiLlm({ apiKey: key!, model, systemInstruction: SYSTEM_PROMPT, declarations: TOOL_DECLARATIONS });
    const bap = fakeBap();
    const client = makeToolClient({ baseUrl: "http://stub", token: "t", fetchImpl: bap.fetchImpl });
    const started = Date.now();
    const { reply } = await runTurn({ llm, history: [], message: "What is in my basket right now? Use the tool.", client, signal: AbortSignal.timeout(30_000) });
    const ms = Date.now() - started;
    console.log(`LIVE_SMOKE model=${model} latency_ms=${ms} steps=${JSON.stringify(reply.steps)} text_len=${reply.text.length}`);
    expect(reply.text.length).toBeGreaterThan(0);
    expect(reply.steps.some((s) => s.tool === "view_basket" && s.ok)).toBe(true);
  }, 40_000);
});
