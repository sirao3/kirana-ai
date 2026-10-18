/**
 * Deterministic guardrails around the agent's model calls (no LLM). The system prompt sets the scope; these checks
 * catch what a prompt alone cannot guarantee:
 * - screenInput: refuse prompt-injection and clearly off-scope requests before spending a model call.
 * - screenReply: never send text that echoes the system prompt.
 * - REFUSAL_TEXT also replaces replies Gemini blocks for safety (see llm.ts).
 * Topic scope beyond these patterns is left to the model: keyword lists are unreliable for Hinglish.
 */

import { SYSTEM_PROMPT } from "./prompt.js";

export const REFUSAL_TEXT =
  "I can only help with shopping at nearby KiranaAI stores: finding products, building and quoting your basket, and checking your orders. What would you like to buy?";

export type ScreenResult = { ok: true } | { ok: false; reason: "prompt_injection" | "off_scope" };

const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules|guidelines|prompts?|restrictions)\b/i,
  /\b(system|developer|hidden|initial)\s+(prompt|message|instructions?)\b/i,
  /\b(reveal|print|repeat|dump|leak)\b.{0,30}\b(instructions|prompt|rules|guidelines)\b/i,
  /\b(show|tell|give)\b.{0,20}\byour\s+(instructions|prompt|rules|guidelines|tools)\b/i,
  /\b(you are now|from now on you are|pretend (to be|you are)|act as (an?|my)|role-?play as|jailbreak|dan mode|developer mode)\b/i,
  /\b(instructions?|rules)\b.{0,20}\b(bhool|bhul|ignore)\b/i, // Hinglish: "saare instructions bhool jao"
];

const OFF_SCOPE: RegExp[] = [
  /\b(write|generate|debug|fix|explain)\b.{0,40}\b(code|program|script|function|sql|python|javascript|typescript|html|css|regex)\b/i,
  /\b(write|compose|draft)\b.{0,30}\b(essay|poem|story|email|letter|song|lyrics|cover letter|resume)\b/i,
];

export function screenInput(message: string): ScreenResult {
  if (INJECTION.some((re) => re.test(message))) return { ok: false, reason: "prompt_injection" };
  if (OFF_SCOPE.some((re) => re.test(message))) return { ok: false, reason: "off_scope" };
  return { ok: true };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
/** Prompt sentences long enough that quoting one verbatim can only mean the model is leaking its instructions. */
const PROMPT_FRAGMENTS = SYSTEM_PROMPT.split(/(?<=[.:])\s+|\n+/)
  .map((s) => norm(s.replace(/^- /, "")).trim())
  .filter((s) => s.length >= 50);

/** Returns the reply unchanged, or REFUSAL_TEXT when it quotes the system prompt. */
export function screenReply(text: string): { text: string; leaked: boolean } {
  const t = norm(text);
  return PROMPT_FRAGMENTS.some((f) => t.includes(f)) ? { text: REFUSAL_TEXT, leaked: true } : { text, leaked: false };
}

/** Most packs of one item the agent may put in a basket; the customer can still set more by hand. */
export const AGENT_MAX_QTY = 50;
