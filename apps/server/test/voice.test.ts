import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentHistoryMessage, AgentReply, BasketView } from "@kiranaai/shared";
import { agentTestHooks } from "../src/bap/agent/index.js";
import { createGeminiLive, createLiveFromLlm, textHistory, type LiveAgent } from "../src/bap/agent/live.js";
import type { Content, Llm } from "../src/bap/agent/llm.js";
import { SYSTEM_PROMPT } from "../src/bap/agent/prompt.js";
import { TOOL_DECLARATIONS } from "../src/bap/agent/tools.js";
import { liveBackend } from "./fixtures/gemini-backend.js";
import { startHarness, type BapHarness } from "./fixtures/harness.js";

const fc = (name: string, args: Record<string, unknown> = {}): Content => ({ role: "model", parts: [{ functionCall: { name, args } }] });
/** 0.5 s of silence: shape-valid PCM for routes whose Live agent is scripted. */
const silence = (seconds = 0.5) => Buffer.alloc(Math.round(seconds * 32_000)).toString("base64");
const audio = (data = silence()) => ({ mimeType: "audio/pcm;rate=16000", data });

/** Scripted model: plan → set → quote → approval, then a short reply. */
function demoLlm(): Llm {
  return {
    async generate({ contents }) {
      const responses = contents.slice(contents.findLastIndex((c) => c.role === "user" && c.parts?.some((p) => typeof p.text === "string")));
      const n = responses.filter((c) => c.parts?.some((p) => p.functionResponse)).length;
      if (n === 0) return fc("plan_basket", { needs: [{ query: "atta", qty: 1 }, { query: "toor dal", qty: 2 }, { query: "milk", qty: 8 }, { query: "tea", qty: 1 }] });
      if (n === 1) {
        const out = contents.at(-1)!.parts![0]!.functionResponse!.response as { output: { choices: { listing_id: string; qty: number }[] } };
        return fc("set_basket", { items: out.output.choices.map((c) => ({ listing_id: c.listing_id, qty: c.qty })) });
      }
      if (n === 2) return fc("get_quote");
      if (n === 3) return fc("request_approval");
      return { role: "model", parts: [{ text: "Your basket is quoted. Review it and press Approve." }] };
    },
  };
}

describe("textHistory", () => {
  it("keeps only text turns (no tool calls, responses or thoughts) and the last N", () => {
    const h: Content[] = [
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "thinking", thought: true }, { functionCall: { name: "view_basket", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "view_basket", response: { output: {} } } }] },
      { role: "model", parts: [{ text: "Your basket is empty." }] },
    ];
    expect(textHistory(h)).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "Your basket is empty." }] },
    ]);
    expect(textHistory(h, 1)).toEqual([{ role: "model", parts: [{ text: "Your basket is empty." }] }]);
  });
});

describe("voice turns: POST /bap/agent/chat {audio} (UX-12, scripted Live agent)", () => {
  let h: BapHarness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());
  afterEach(() => {
    agentTestHooks.live = undefined;
    agentTestHooks.llm = undefined;
  });

  it("runs the tools, returns the transcript, judges quantities against it, and stores only text", async () => {
    const said = "weekly essentials: 2 kg toor dal, 8 litres milk, atta, tea";
    agentTestHooks.live = createLiveFromLlm(demoLlm(), said);
    const res = await h.call<AgentReply>("POST", "/bap/agent/chat", { audio: audio(), turnId: "voice_turn_01" });
    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe(said);
    expect(res.body.text).toMatch(/Approve/);
    expect(res.body.steps.map((s) => s.tool)).toEqual(["plan_basket", "set_basket", "get_quote", "request_approval"]);
    expect(res.body.events.some((e) => e.type === "approval_requested")).toBe(true);

    const progress = await h.call("GET", "/bap/agent/turns/voice_turn_01");
    expect(progress.body).toMatchObject({ done: true });
    expect(progress.body.steps).toHaveLength(4);

    const items = (await h.call<BasketView>("GET", "/bap/basket")).body.stores.flatMap((s) => s.items);
    expect(items).toHaveLength(4);
    const byName = (re: RegExp) => items.find((i) => re.test(i.name.toLowerCase()))!;
    expect(byName(/dal/).qtyInferred).toBe(false); // "2 kg toor dal" was said
    expect(byName(/atta/).qtyInferred).toBe(true);

    const hist = (await h.call<{ messages: AgentHistoryMessage[] }>("GET", "/bap/agent/history")).body.messages;
    expect(hist).toEqual([
      { role: "user", text: said },
      { role: "model", text: res.body.text },
    ]);
  });

  it("passes the audio through and gives the Live agent a text-only history after a text turn", async () => {
    agentTestHooks.llm = { generate: async ({ contents }) => (contents.at(-1)!.parts!.some((p) => p.functionResponse) ? { role: "model", parts: [{ text: "Empty basket." }] } : fc("view_basket")) };
    expect((await h.call("POST", "/bap/agent/chat", { message: "what's in my basket?" })).status).toBe(200);

    let seen: { history: Content[]; audio: { mimeType: string; data: string } } | undefined;
    const live: LiveAgent = {
      async run(req) {
        seen = { history: req.history, audio: req.audio };
        return { transcript: "hello", text: "Hi! What do you need?" };
      },
    };
    agentTestHooks.live = live;
    const data = silence(1);
    const res = await h.call<AgentReply>("POST", "/bap/agent/chat", { audio: audio(data) });
    expect(res.status).toBe(200);
    expect(seen!.audio).toEqual({ mimeType: "audio/pcm;rate=16000", data });
    // The route passes full history; the Live client reduces it to text (textHistory) before sending.
    expect(textHistory(seen!.history)).toEqual([
      { role: "user", parts: [{ text: "what's in my basket?" }] },
      { role: "model", parts: [{ text: "Empty basket." }] },
    ]);
  });

  it("an empty transcript still answers, and a Live failure is a 503 like text turns", async () => {
    agentTestHooks.live = { run: async () => ({ transcript: "", text: "" }) };
    const quiet = await h.call<AgentReply>("POST", "/bap/agent/chat", { audio: audio() });
    expect(quiet.status).toBe(200);
    expect(quiet.body.text).toMatch(/could not hear/i);

    agentTestHooks.live = { run: async () => { throw new Error("gemini live closed (1011)"); } };
    const down = await h.call("POST", "/bap/agent/chat", { audio: audio() });
    expect(down.status).toBe(503);
    expect(down.body).toEqual({ error: "agent_unavailable" });
  });

  it("validates the body: exactly one of message/audio, PCM 16 kHz only, 0.3–30 s, base64", async () => {
    agentTestHooks.live = { run: async () => ({ transcript: "x", text: "y" }) };
    const bad = async (body: unknown) => (await h.call("POST", "/bap/agent/chat", body)).status;
    expect(await bad({ message: "hi", audio: audio() })).toBe(400);
    expect(await bad({})).toBe(400);
    expect(await bad({ audio: { mimeType: "audio/webm", data: silence() } })).toBe(400);
    expect(await bad({ audio: audio(silence(0.1)) })).toBe(400);
    expect(await bad({ audio: audio(silence(32)) })).toBe(400);
    expect(await bad({ audio: audio("!".repeat(20_000)) })).toBe(400);
    expect(await bad({ audio: audio(silence(29)) })).toBe(200); // ~1.24 MB body: over Fastify's 1 MB default
  });
});

// ---------- live smoke (skipped without a key): real speech through the Gemini Live model ----------

const backend = liveBackend();

describe.skipIf(!backend)("live Gemini Live smoke (voice)", () => {
  let h: BapHarness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());
  afterEach(() => {
    agentTestHooks.live = undefined;
  });

  it("transcribes 'Where is my order?' and answers through the tools", async () => {
    const model = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live";
    agentTestHooks.live = createGeminiLive({ backend: backend!, model, systemInstruction: SYSTEM_PROMPT, declarations: TOOL_DECLARATIONS, transcribeModel: process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-3.5-transcribe-live" });
    const pcm = readFileSync(new URL("./fixtures/voice-where-is-my-order.pcm", import.meta.url));
    const started = Date.now();
    const res = await h.call<AgentReply>("POST", "/bap/agent/chat", { audio: audio(pcm.toString("base64")) });
    console.log(`LIVE_VOICE_SMOKE model=${model} latency_ms=${Date.now() - started} status=${res.status} transcript=${JSON.stringify(res.body.transcript)} steps=${JSON.stringify(res.body.steps)}`);
    expect(res.status).toBe(200);
    expect(res.body.transcript).toMatch(/order/i);
    expect(res.body.text.length).toBeGreaterThan(0);
  }, 45_000);
});
