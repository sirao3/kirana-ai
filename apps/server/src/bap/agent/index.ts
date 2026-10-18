import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { FunctionCall, FunctionResponse } from "@google/genai";
import { MAX_VOICE_SECONDS, type AgentEvent, type AgentHistoryMessage, type AgentReply } from "@kiranaai/shared";
import { audit } from "../../beckn/audit.js";
import { requireAuth } from "../../lib/auth.js";
import { makeToolClient, ToolForbiddenError, type ToolClient } from "./client.js";
import { createFakeLlm } from "./fake-llm.js";
import { geminiBackend } from "./gemini.js";
import { REFUSAL_TEXT, screenInput, screenReply, type ScreenResult } from "./guardrails.js";
import { createGeminiLive, createLiveFromLlm, VOICE_BYTES_PER_SECOND, VOICE_MIME, type LiveAgent } from "./live.js";
import { createGeminiLlm, type Content, type Llm } from "./llm.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { TURN_ID_RE, TurnProgressStore } from "./progress.js";
import { MAX_TOOL_CALLS, runTool, summarizeStep, TOOL_DECLARATIONS, type ToolEnv } from "./tools.js";

/** Test seams: inject a fake model / fake loopback fetch / tighter limits. Unset in production. */
export const agentTestHooks: { llm?: Llm; live?: LiveAgent; fetchImpl?: typeof fetch; timeoutMs?: number; maxPerWindow?: number } = {};

const TURN_TIMEOUT_MS = 20_000;
/** Voice turns run on a Live model that speaks every reply (audio we drop), so each round takes a few seconds longer. */
const VOICE_TURN_TIMEOUT_MS = 40_000;
/** Transcript the scripted dev agent (AGENT_FAKE=1) pretends to have heard. */
export const FAKE_VOICE_TRANSCRIPT = "Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea.";
const WINDOW_MS = 10 * 60_000;
const PER_WINDOW = 20;
const HISTORY_ROWS = 40;
const FALLBACK_TEXT = "Sorry, I could not finish that. Please try again or use manual search.";

export class AgentTimeoutError extends Error {}

const isUserText = (c: Content) => c.role === "user" && !!c.parts?.some((p) => typeof p.text === "string" && p.text.length > 0);
const textOf = (c: Content) =>
  (c.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text as string).join("").trim();

/** Drop leading rows until the history starts at a user text turn (a window cut must not orphan tool calls). */
export function trimHistory(rows: Content[]): Content[] {
  const i = rows.findIndex(isUserText);
  return i < 0 ? [] : rows.slice(i);
}

type ToolHooks = {
  onToolStart?: (t: { tool: string }) => number | void;
  onTool?: (t: { tool: string; args: unknown; ok: boolean; summary: string; stepIndex: number | void }) => void | Promise<void>;
};

/**
 * Runs the model's function calls with the allowlisted tools and a per-turn budget (MAX_TOOL_CALLS). Shared by text
 * turns (runTurn) and voice turns (runVoiceTurn), so both get the same tools, progress steps and audit.
 */
export function makeToolExecutor(opts: { env: ToolEnv; steps: AgentReply["steps"]; signal: AbortSignal } & ToolHooks) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async run(fcs: FunctionCall[]): Promise<FunctionResponse[]> {
      const out: FunctionResponse[] = [];
      for (const fc of fcs) {
        const name = fc.name ?? "";
        const args = (fc.args ?? {}) as Record<string, unknown>;
        let run: { ok: boolean; result: unknown };
        if (calls >= MAX_TOOL_CALLS) {
          run = { ok: false, result: { error: "tool_budget_exhausted", message: "No more tool calls this turn. Answer the customer with what you have." } };
        } else {
          calls++;
          const stepIndex = opts.onToolStart?.({ tool: name });
          try {
            run = await runTool(name, args, opts.env);
          } catch (err) {
            if (err instanceof ToolForbiddenError) run = { ok: false, result: { error: "tool_forbidden" } };
            else if (opts.signal.aborted) throw new AgentTimeoutError();
            else run = { ok: false, result: { error: "tool_failed", message: err instanceof Error ? err.message : "unknown" } };
          }
          opts.steps.push({ tool: name, ok: run.ok });
          await opts.onTool?.({ tool: name, args, ok: run.ok, summary: summarizeStep(name, run), stepIndex });
        }
        out.push({ ...(fc.id ? { id: fc.id } : {}), name, response: run.ok ? { output: run.result } : { error: run.result } });
      }
      return out;
    },
  };
}

/**
 * One agent turn: model → tool calls → model … until text. Returns the reply and every Content created
 * this turn (user message, model contents exactly as returned, function responses) for persistence.
 */
export async function runTurn(opts: {
  llm: Llm;
  history: Content[];
  message: string;
  client: ToolClient;
  signal: AbortSignal;
} & ToolHooks): Promise<{ reply: AgentReply; created: Content[]; refused?: GuardrailRefusal }> {
  const { llm, client, signal } = opts;
  const events: AgentEvent[] = [];
  const steps: AgentReply["steps"] = [];
  const created: Content[] = [{ role: "user", parts: [{ text: opts.message }] }];

  // Guardrail: injection and clearly off-scope requests are refused without a model call (and without tools).
  const screen = screenInput(opts.message);
  if (!screen.ok) {
    created.push({ role: "model", parts: [{ text: REFUSAL_TEXT }] });
    return { reply: { text: REFUSAL_TEXT, events, steps }, created, refused: screen.reason };
  }
  let text = "";
  const env: ToolEnv = { client, events, userMessage: opts.message };
  const tools = makeToolExecutor({ env, steps, signal, onToolStart: opts.onToolStart, onTool: opts.onTool });

  for (let round = 0; round < MAX_TOOL_CALLS + 2; round++) {
    if (signal.aborted) throw new AgentTimeoutError();
    const modelContent = await llm.generate({ contents: [...opts.history, ...created], allowTools: tools.calls < MAX_TOOL_CALLS, signal });
    created.push(modelContent); // unchanged: Gemini 3 thoughtSignature must survive
    const fcs = (modelContent.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
    if (!fcs.length) {
      const checked = screenReply(textOf(modelContent));
      text = checked.text;
      if (checked.leaked) {
        created[created.length - 1] = { role: "model", parts: [{ text }] }; // never persist the leaked text either
        return { reply: { text, events, steps }, created, refused: "prompt_leak" };
      }
      break;
    }
    const responses = await tools.run(fcs);
    created.push({ role: "user", parts: responses.map((r) => ({ functionResponse: r })) });
  }

  return { reply: { text: text || FALLBACK_TEXT, events, steps }, created };
}

/** Why a turn's reply was replaced by REFUSAL_TEXT (audited as agent.refused). */
export type GuardrailRefusal = Extract<ScreenResult, { ok: false }>["reason"] | "prompt_leak";

/**
 * One voice turn (UX-12) on a Gemini Live model. Persists only the transcript and the reply text, so later text turns
 * (Flash Lite) never see Live tool calls without thought signatures.
 */
export async function runVoiceTurn(opts: {
  live: LiveAgent;
  history: Content[];
  audio: { mimeType: string; data: string };
  client: ToolClient;
  signal: AbortSignal;
} & ToolHooks): Promise<{ reply: AgentReply; created: Content[]; refused?: GuardrailRefusal }> {
  const events: AgentEvent[] = [];
  const steps: AgentReply["steps"] = [];
  const env: ToolEnv = { client: opts.client, events, userMessage: "" };
  const tools = makeToolExecutor({ env, steps, signal: opts.signal, onToolStart: opts.onToolStart, onTool: opts.onTool });
  const out = await opts.live.run({
    history: opts.history,
    audio: opts.audio,
    signal: opts.signal,
    onTranscript: (t) => (env.userMessage = t), // quantities are judged "stated" against what the customer said
    onToolCalls: (fcs) => tools.run(fcs),
  });
  const transcript = out.transcript;
  // The transcript only exists once the Live model has heard it, so voice gets the reply check, not the input screen.
  const checked = screenReply(out.text);
  // No reply text (the Live session went quiet) but tools ran: say what changed, from the events, not a generic failure.
  const text =
    checked.text ||
    (events.some((e) => e.type === "approval_requested")
      ? "Your basket is quoted. Review the total and press Approve, then Pay."
      : events.length
        ? "I updated your basket. Check it, then get a verified quote."
        : transcript
          ? FALLBACK_TEXT
          : "Sorry, I could not hear that. Please try again, or type your list.");
  const created: Content[] = [
    { role: "user", parts: [{ text: transcript || "(voice message)" }] },
    { role: "model", parts: [{ text }] },
  ];
  return { reply: { text, events, steps, transcript }, created, ...(checked.leaked ? { refused: "prompt_leak" as const } : {}) };
}

/** Gemini shopping agent (/bap/agent/*). Tools call the BAP API over loopback HTTP with an allowlist (no approve/pay). */
export const agentRoutes: FastifyPluginAsync = async (app) => {
  const { config, pool } = app.ctx;
  const hits = new Map<string, number[]>();
  const inFlight = new Set<string>();
  let day = new Date().toISOString().slice(0, 10);
  let dayCount = 0;
  let llm: Llm | null = null;
  let live: LiveAgent | null = null;
  const progress = new TurnProgressStore();
  const backend = geminiBackend(config);

  const getLlm = (): Llm | null => {
    if (agentTestHooks.llm) return agentTestHooks.llm;
    if (config.AGENT_FAKE === "1") return (llm ??= createFakeLlm());
    if (!backend) return null;
    llm ??= createGeminiLlm({ backend, model: config.GEMINI_MODEL, systemInstruction: SYSTEM_PROMPT, declarations: TOOL_DECLARATIONS });
    return llm;
  };

  const getLive = (): LiveAgent | null => {
    if (agentTestHooks.live) return agentTestHooks.live;
    if (config.AGENT_FAKE === "1") return (live ??= createLiveFromLlm(createFakeLlm(), FAKE_VOICE_TRANSCRIPT));
    if (!backend) return null;
    live ??= createGeminiLive({ backend, model: config.GEMINI_LIVE_MODEL, systemInstruction: SYSTEM_PROMPT, declarations: TOOL_DECLARATIONS, transcribeModel: config.GEMINI_TRANSCRIBE_MODEL || undefined, debug: process.env.LIVE_DEBUG === "1" });
    return live;
  };

  const maxAudioChars = Math.ceil(((MAX_VOICE_SECONDS + 1) * VOICE_BYTES_PER_SECOND * 4) / 3);
  const chatBody = z
    .object({
      message: z.string().trim().min(1).max(2000).optional(),
      audio: z
        .object({
          mimeType: z.literal(VOICE_MIME),
          // At least ~0.3 s of audio; at most 30 s (plus a little slack for the recorder's last chunk).
          data: z.string().min(12_800).max(maxAudioChars).regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .optional(),
      turnId: z.string().regex(TURN_ID_RE).optional(),
    })
    .refine((b) => !!b.message !== !!b.audio, { message: "send either message or audio" });

  // bodyLimit: 30 s of 16 kHz PCM is ~1.3 MB of base64, over Fastify's 1 MB default.
  app.post("/chat", { preHandler: requireAuth("customer"), bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const body = chatBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const voice = body.data.audio;
    const customerId = req.auth!.sub;

    // Rate limit: per IP per 10 min, plus a daily cap for the whole instance.
    const now = Date.now();
    const recent = (hits.get(req.ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= (agentTestHooks.maxPerWindow ?? PER_WINDOW)) return reply.code(429).send({ error: "rate_limited" });
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      dayCount = 0;
    }
    if (dayCount >= config.AGENT_DAILY_CAP) return reply.code(429).send({ error: "daily_cap" });
    recent.push(now);
    hits.set(req.ip, recent);
    dayCount++;

    const model = voice ? null : getLlm();
    const liveAgent = voice ? getLive() : null;
    if (!model && !liveAgent) return reply.code(503).send({ error: "agent_unavailable" });
    if (inFlight.has(customerId)) return reply.code(409).send({ error: "agent_busy" });
    inFlight.add(customerId);

    const turnId = body.data.turnId;
    if (turnId) progress.start(customerId, turnId);
    const ac = new AbortController();
    const timeoutMs = agentTestHooks.timeoutMs ?? (voice ? VOICE_TURN_TIMEOUT_MS : TURN_TIMEOUT_MS);
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, rej) => {
      timer = setTimeout(() => {
        ac.abort();
        rej(new AgentTimeoutError());
      }, timeoutMs);
    });
    try {
      const rows = await pool.query<{ content: Content }>(
        "SELECT content FROM bap.agent_message WHERE customer_id = $1 ORDER BY id DESC LIMIT $2",
        [customerId, HISTORY_ROWS],
      );
      const history = trimHistory(rows.rows.reverse().map((r) => r.content));
      const client = makeToolClient({
        baseUrl: config.selfBaseUrl,
        token: req.headers.authorization!.slice(7),
        fetchImpl: agentTestHooks.fetchImpl,
        signal: ac.signal,
      });
      const hooks: ToolHooks = {
        onToolStart: turnId ? (t) => progress.beginStep(customerId, turnId, t.tool) : undefined,
        onTool: async (t) => {
          if (turnId && typeof t.stepIndex === "number") progress.finishStep(customerId, turnId, t.stepIndex, { ok: t.ok, summary: t.summary });
          await audit(pool, { kind: "state", action: "agent.tool", actor: "bap", entityId: customerId, payload: { tool: t.tool, args: t.args, ok: t.ok, ...(voice ? { voice: true } : {}) } });
        },
      };
      const turn = voice
        ? runVoiceTurn({ live: liveAgent!, history, audio: voice, client, signal: ac.signal, ...hooks })
        : runTurn({ llm: model!, history, message: body.data.message!, client, signal: ac.signal, ...hooks });
      turn.catch(() => undefined); // if the deadline wins, don't leave an unhandled rejection
      const { reply: out, created, refused } = await Promise.race([turn, deadline]);
      if (refused) await audit(pool, { kind: "state", action: "agent.refused", actor: "bap", entityId: customerId, payload: { reason: refused, ...(voice ? { voice: true } : {}) } });
      // Persist only completed turns, so history never ends with a dangling function call.
      for (const c of created) {
        await pool.query("INSERT INTO bap.agent_message (customer_id, role, content) VALUES ($1, $2, $3)", [customerId, c.role ?? "model", JSON.stringify(c)]);
      }
      return out;
    } catch (err) {
      req.log.warn({ err: err instanceof Error ? err.message : String(err) }, "agent turn failed");
      await audit(pool, { kind: "state", action: "agent.unavailable", actor: "bap", entityId: customerId, payload: { reason: err instanceof AgentTimeoutError ? "timeout" : "error" } });
      return reply.code(503).send({ error: "agent_unavailable" });
    } finally {
      clearTimeout(timer);
      inFlight.delete(customerId);
      if (turnId) progress.finish(customerId, turnId);
    }
  });

  /** Live steps of a running (or just finished) turn, scoped to the caller. Polled once a second by the chat panel. */
  app.get("/turns/:turnId", { preHandler: requireAuth("customer") }, async (req, reply) => {
    const { turnId } = req.params as { turnId: string };
    const p = TURN_ID_RE.test(turnId) ? progress.get(req.auth!.sub, turnId) : null;
    if (!p) return reply.code(404).send({ error: "turn_not_found" });
    return p;
  });

  /** Chat transcript (text parts only) so the UI can restore the conversation after a reload. */
  app.get("/history", { preHandler: requireAuth("customer") }, async (req) => {
    const rows = await pool.query<{ content: Content }>(
      "SELECT content FROM bap.agent_message WHERE customer_id = $1 ORDER BY id DESC LIMIT $2",
      [req.auth!.sub, HISTORY_ROWS * 2],
    );
    const messages: AgentHistoryMessage[] = [];
    for (const { content } of rows.rows.reverse()) {
      const text = textOf(content);
      if (text) messages.push({ role: content.role === "user" ? "user" : "model", text });
    }
    return { messages };
  });

  app.post("/reset", { preHandler: requireAuth("customer") }, async (req) => {
    await pool.query("DELETE FROM bap.agent_message WHERE customer_id = $1", [req.auth!.sub]);
    return { ok: true };
  });
};
