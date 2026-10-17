import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AgentEvent, AgentHistoryMessage, AgentReply } from "@kiranaai/shared";
import { audit } from "../../beckn/audit.js";
import { requireAuth } from "../../lib/auth.js";
import { makeToolClient, ToolForbiddenError, type ToolClient } from "./client.js";
import { createGeminiLlm, type Content, type Llm } from "./llm.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { MAX_TOOL_CALLS, runTool, TOOL_DECLARATIONS } from "./tools.js";

/** Test seams: inject a fake model / fake loopback fetch / tighter limits. Unset in production. */
export const agentTestHooks: { llm?: Llm; fetchImpl?: typeof fetch; timeoutMs?: number; maxPerWindow?: number } = {};

const TURN_TIMEOUT_MS = 20_000;
const WINDOW_MS = 10 * 60_000;
const PER_WINDOW = 20;
const HISTORY_ROWS = 40;
const FALLBACK_TEXT = "Sorry, I could not finish that. Please try again or use manual search.";

export class AgentTimeoutError extends Error {}

type Part = NonNullable<Content["parts"]>[number];
const isUserText = (c: Content) => c.role === "user" && !!c.parts?.some((p) => typeof p.text === "string" && p.text.length > 0);
const textOf = (c: Content) =>
  (c.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text as string).join("").trim();

/** Drop leading rows until the history starts at a user text turn (a window cut must not orphan tool calls). */
export function trimHistory(rows: Content[]): Content[] {
  const i = rows.findIndex(isUserText);
  return i < 0 ? [] : rows.slice(i);
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
  onTool?: (t: { tool: string; args: unknown; ok: boolean }) => void | Promise<void>;
}): Promise<{ reply: AgentReply; created: Content[] }> {
  const { llm, client, signal } = opts;
  const events: AgentEvent[] = [];
  const steps: AgentReply["steps"] = [];
  const created: Content[] = [{ role: "user", parts: [{ text: opts.message }] }];
  let calls = 0;
  let text = "";

  for (let round = 0; round < MAX_TOOL_CALLS + 2; round++) {
    if (signal.aborted) throw new AgentTimeoutError();
    const modelContent = await llm.generate({ contents: [...opts.history, ...created], allowTools: calls < MAX_TOOL_CALLS, signal });
    created.push(modelContent); // unchanged: Gemini 3 thoughtSignature must survive
    const fcs = (modelContent.parts ?? []).filter((p): p is Part & { functionCall: NonNullable<Part["functionCall"]> } => !!p.functionCall);
    if (!fcs.length) {
      text = textOf(modelContent);
      break;
    }
    const responses: Part[] = [];
    for (const p of fcs) {
      const fc = p.functionCall;
      const name = fc.name ?? "";
      const args = (fc.args ?? {}) as Record<string, unknown>;
      let run: { ok: boolean; result: unknown };
      if (calls >= MAX_TOOL_CALLS) {
        run = { ok: false, result: { error: "tool_budget_exhausted", message: "No more tool calls this turn. Answer the customer with what you have." } };
      } else {
        calls++;
        try {
          run = await runTool(name, args, { client, events });
        } catch (err) {
          if (err instanceof ToolForbiddenError) run = { ok: false, result: { error: "tool_forbidden" } };
          else if (signal.aborted) throw new AgentTimeoutError();
          else run = { ok: false, result: { error: "tool_failed", message: err instanceof Error ? err.message : "unknown" } };
        }
        steps.push({ tool: name, ok: run.ok });
        await opts.onTool?.({ tool: name, args, ok: run.ok });
      }
      responses.push({ functionResponse: { ...(fc.id ? { id: fc.id } : {}), name, response: run.ok ? { output: run.result } : { error: run.result } } });
    }
    created.push({ role: "user", parts: responses });
  }

  return { reply: { text: text || FALLBACK_TEXT, events, steps }, created };
}

/** Gemini shopping agent (/bap/agent/*). Tools call the BAP API over loopback HTTP with an allowlist (no approve/pay). */
export const agentRoutes: FastifyPluginAsync = async (app) => {
  const { config, pool } = app.ctx;
  const hits = new Map<string, number[]>();
  const inFlight = new Set<string>();
  let day = new Date().toISOString().slice(0, 10);
  let dayCount = 0;
  let llm: Llm | null = null;

  const getLlm = (): Llm | null => {
    if (agentTestHooks.llm) return agentTestHooks.llm;
    if (!config.GEMINI_API_KEY) return null;
    llm ??= createGeminiLlm({ apiKey: config.GEMINI_API_KEY, model: config.GEMINI_MODEL, systemInstruction: SYSTEM_PROMPT, declarations: TOOL_DECLARATIONS });
    return llm;
  };

  app.post("/chat", { preHandler: requireAuth("customer") }, async (req, reply) => {
    const body = z.object({ message: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
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

    const model = getLlm();
    if (!model) return reply.code(503).send({ error: "agent_unavailable" });
    if (inFlight.has(customerId)) return reply.code(409).send({ error: "agent_busy" });
    inFlight.add(customerId);

    const ac = new AbortController();
    const timeoutMs = agentTestHooks.timeoutMs ?? TURN_TIMEOUT_MS;
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
      const turn = runTurn({
        llm: model,
        history,
        message: body.data.message,
        client,
        signal: ac.signal,
        onTool: (t) => audit(pool, { kind: "state", action: "agent.tool", actor: "bap", entityId: customerId, payload: t }),
      });
      turn.catch(() => undefined); // if the deadline wins, don't leave an unhandled rejection
      const { reply: out, created } = await Promise.race([turn, deadline]);
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
    }
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
