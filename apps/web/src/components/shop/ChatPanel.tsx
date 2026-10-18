import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { MAX_VOICE_SECONDS, type AgentEvent, type AgentReply, type AgentTurnStep, type BasketView, type OrderView } from "@kiranaai/shared";
import { ApiError } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { Button, C, CheckDraw, IArrowUp, IArrowUpRight, IClose, IMic, ISpark, IStop, IWarning, Spinner, cardShadow, ease, soft } from "../ui";
import { bap } from "./bap";
import { BasketPanel, CheckoutButton } from "./BasketPanel";
import { isAgentDown } from "./errors";
import { OrderDetail, isInFlight } from "./OrderDetail";
import type { Checkout } from "./useCheckout";
import { useVoiceRecorder, voiceSupported } from "./voice";
import { LINK } from "./tokens";

interface Msg {
  id: number;
  role: "user" | "model";
  text: string;
  failed?: boolean;
  /** Voice turn: the bubble shows "Voice · 0:07", then the transcript once the reply arrives. */
  voice?: { seconds: number; pending: boolean };
  events?: AgentEvent[];
}

const EXAMPLES = [
  "Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea.",
  "Also add 250 g jeera",
  "Where is my order?",
];

export const TOOL_LABEL: Record<string, string> = {
  search_products: "Searched stores",
  plan_basket: "Compared stores",
  set_basket: "Built basket",
  update_item: "Changed quantity",
  remove_item: "Removed item",
  view_basket: "Read basket",
  get_quote: "Got verified quote",
  request_approval: "Asked for approval",
  get_order_status: "Checked order",
};

/** Short text for an agent event. Amounts come from API data carried in the event, never from the model's words. */
export function eventChip(e: AgentEvent): { tone: "good" | "info" | "warn"; text: string } {
  switch (e.type) {
    case "basket_updated":
      return { tone: "info", text: "Basket updated" };
    case "quote_ready":
      return { tone: "good", text: `Quote ready · ${formatINR(e.grandTotalPaise)}` };
    case "approval_requested":
      return { tone: "good", text: `Approval requested · ${formatINR(e.grandTotalPaise)}` };
    case "loose_declined":
      return { tone: "warn", text: `Not sold loose: ${e.query}${e.alternative ? ` → try ${e.alternative.name}` : ""}` };
  }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Client-generated turn id (matches the server's [A-Za-z0-9_-]{8,64}). */
function newTurnId(): string {
  const u = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return `t${u ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`}`;
}

/** The assistant's live tool steps: a spinner on the running one, a drawn check when done. */
export function StepList({ steps }: { steps: AgentTurnStep[] }) {
  return (
    <motion.ol layout className="space-y-2 py-1" aria-label="Assistant progress">
      {steps.length === 0 && <li className="flex items-center gap-2.5 text-[14px]" style={{ color: C.secondary }}><Spinner size={15} /> Thinking</li>}
      {steps.map((s, i) => (
        <motion.li key={i} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={soft} className="flex items-center gap-2.5 text-[14px]" style={{ color: s.ok === null ? C.label : C.secondary }}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">{s.ok === null ? <Spinner size={15} /> : s.ok ? <CheckDraw size={17} color={C.tertiary} /> : <span style={{ color: C.red }}><IClose size={14} /></span>}</span>
          <span className="min-w-0 truncate">
            {TOOL_LABEL[s.tool] ?? s.tool}
            {s.summary ? <span style={{ color: C.tertiary }}> · {s.summary}</span> : null}
            <span className="sr-only">{s.ok === null ? " in progress" : s.ok ? " done" : " failed"}</span>
          </span>
        </motion.li>
      ))}
    </motion.ol>
  );
}

/**
 * The assistant as one continuous flow: ask → live tool steps → the basket card → one primary action → (after paying)
 * the same thread becomes the tracker. The agent can only build the basket; an `approval_requested` event at most
 * opens the pay sheet, and only once suggested quantities are confirmed.
 */
export function ChatPanel({ basket, checkout, tracked, now, onUseSearch, onOpenOrder, onActive }: {
  /** The conversation has content (history or a new message): phones raise the sheet. */
  onActive?: () => void;
  basket: BasketView | undefined;
  checkout: Checkout;
  tracked: OrderView | null;
  now: number;
  onUseSearch: () => void;
  onOpenOrder: (basketId: string) => void;
}) {
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentTurnStep[]>([]);
  const [agentDown, setAgentDown] = useState<"busy" | "down" | null>(null);
  const idRef = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [canVoice] = useState(voiceSupported);
  const voice = useVoiceRecorder((audio, seconds) => void sendVoice(audio, seconds));
  const recording = voice.state === "recording" || voice.state === "starting";

  const hasItems = (basket?.itemCount ?? 0) > 0;
  const started = msgs.length > 0 || hasItems || !!tracked;

  useEffect(() => {
    let alive = true;
    bap.chatHistory().then(
      (h) => {
        if (!alive) return;
        if (h.messages.length) onActive?.();
        setMsgs((m) => (m.length ? m : h.messages.map((x) => ({ id: idRef.current++, role: x.role, text: x.text }))));
      },
      () => undefined,
    );
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, steps.length, hasItems, tracked?.basketId, thinking, checkout.quoteErrors]);

  // Poll the running turn's tool steps once a second.
  useEffect(() => {
    if (!thinking || !turnId) return;
    let alive = true;
    const tick = async () => {
      try {
        const p = await bap.turn(turnId);
        if (alive) setSteps(p.steps);
      } catch { /* 404 until the server registers the turn */ }
    };
    const t = setInterval(() => void tick(), 1000);
    void tick();
    return () => { alive = false; clearInterval(t); };
  }, [thinking, turnId]);

  async function ask(call: (turnId: string) => Promise<AgentReply>): Promise<AgentReply | null> {
    const id = newTurnId();
    setSteps([]);
    setTurnId(id);
    setThinking(true);
    try {
      const r = await call(id);
      setAgentDown(null);
      setMsgs((m) => [...m, { id: idRef.current++, role: "model", text: r.text, events: r.events.filter((e) => e.type === "loose_declined") }]);
      checkout.clearErrors();
      await qc.invalidateQueries({ queryKey: ["basket"] });
      if (r.events.some((e) => e.type === "approval_requested")) void checkout.agentAskedForApproval();
      return r;
    } catch (e) {
      const busy = e instanceof ApiError && e.status === 429;
      setAgentDown(busy ? "busy" : isAgentDown(e) ? "down" : null);
      setMsgs((m) => [...m, { id: idRef.current++, role: "model", failed: true, text: "I couldn't answer just now." }]);
      return null;
    } finally {
      setThinking(false);
      input.current?.focus();
    }
  }

  function send(message: string) {
    const m = message.trim();
    if (!m || thinking) return;
    setText("");
    onActive?.();
    setMsgs((x) => [...x, { id: idRef.current++, role: "user", text: m }]);
    void ask((id) => bap.chat(m, id));
  }

  async function sendVoice(audio: Parameters<typeof bap.chatVoice>[0], seconds: number) {
    if (thinking) return;
    const userId = idRef.current++;
    onActive?.();
    setMsgs((x) => [...x, { id: userId, role: "user", text: "", voice: { seconds, pending: true } }]);
    const r = await ask((id) => bap.chatVoice(audio, id));
    setMsgs((x) => x.map((m) => (m.id === userId ? { ...m, text: r?.transcript || (r ? "(could not hear that)" : "Voice message not sent"), voice: { seconds, pending: false } } : m)));
  }

  async function newChat() {
    await bap.chatReset().catch(() => undefined);
    setMsgs([]);
    setAgentDown(null);
  }

  const showCta = hasItems && !thinking && basket;

  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 print:overflow-visible" style={{ scrollbarWidth: "none", maskImage: "linear-gradient(to bottom, transparent 0, #000 16px)", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 16px)" }}
        aria-busy={thinking}>
        <LayoutGroup>
          <AnimatePresence mode="popLayout" initial={false}>
            {!started && (
              <motion.div key="hero" exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }} className="pt-[6vh]">
                <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.03em]" style={{ color: C.label }}>What does the house need this week?</h1>
                <p className="mt-2 text-[15px] leading-[1.45]" style={{ color: C.secondary }}>
                  Type or speak, in English or Hinglish. The assistant asks the kiranas on the map and comes back with one basket and one verified total. Only you can pay.
                </p>
                <motion.ul initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } } }} className="mt-5" aria-label="Suggestions">
                  {EXAMPLES.map((e, i) => (
                    <motion.li key={e} variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }} transition={ease} style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined }}>
                      <button type="button" onClick={() => send(e)} className="flex min-h-11 w-full cursor-pointer items-center gap-3 py-2 text-left text-[15px] transition-colors hover:text-[#1D1D1F]" style={{ color: C.secondary }}>
                        <span className="shrink-0" style={{ color: C.tertiary }}><IArrowUpRight size={16} /></span> {e}
                      </button>
                    </motion.li>
                  ))}
                </motion.ul>
              </motion.div>
            )}
          </AnimatePresence>

          {started && (
            <div className="space-y-3 pt-3">
              {msgs.length > 0 && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => void newChat()} disabled={thinking} className="min-h-8 cursor-pointer px-1 text-[13px] font-medium disabled:opacity-40" style={{ color: LINK }}>New chat</button>
                </div>
              )}
              <ol className="space-y-3" aria-live="polite" aria-label="Conversation">
                {msgs.map((m) => m.role === "user" ? (
                  <li key={m.id} className="flex justify-end">
                    <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={soft}
                      className="max-w-[86%] whitespace-pre-wrap text-[14px] leading-[1.4] text-white" style={{ background: C.label, borderRadius: 20, padding: "8px 14px" }}>
                      <span className="sr-only">You{m.voice ? " (voice)" : ""}: </span>
                      {m.voice && <span className="mr-1 inline-flex align-[-2px] opacity-80"><IMic size={14} /></span>}
                      {m.voice?.pending ? <span className="opacity-80">Voice · {clock(m.voice.seconds)} · understanding…</span> : m.text}
                    </motion.p>
                  </li>
                ) : (
                  <motion.li key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={soft} className="flex gap-2 text-[14px] leading-[1.45]" style={{ color: m.failed ? C.secondary : C.label }}>
                    <span className="mt-0.5 shrink-0" style={{ color: m.failed ? C.orange : C.tertiary }}>{m.failed ? <IWarning size={15} /> : <ISpark size={15} />}</span>
                    <span className="min-w-0 whitespace-pre-wrap">
                      <span className="sr-only">Assistant: </span>{m.text}
                      {m.events?.map((e, i) => <span key={i} className="mt-1 block text-[13px]" style={{ color: "#B25E00" }}>{eventChip(e).text}</span>)}
                    </span>
                  </motion.li>
                ))}
              </ol>
              {thinking && <StepList steps={steps} />}
              {agentDown && !thinking && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={soft} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] px-4 py-3" style={{ background: C.fill }}>
                  <p className="min-w-0 flex-1 text-[14px]" style={{ color: C.label }}>{agentDown === "busy" ? "Too many requests right now." : "The assistant is unavailable."} Search works without it.</p>
                  <Button size="sm" variant="primary" onClick={onUseSearch}>Search instead</Button>
                </motion.div>
              )}
              {tracked && (isInFlight(tracked) || !hasItems) && <OrderDetail order={tracked} now={now} onOpen={() => onOpenOrder(tracked.basketId)} />}
              <AnimatePresence initial={false}>
                {hasItems && basket && <BasketPanel key="basket" basket={basket} now={now} quoteErrors={checkout.quoteErrors} />}
              </AnimatePresence>
            </div>
          )}
        </LayoutGroup>
      </div>

      {/* Bottom: the one primary action, and the composer. */}
      <div className="space-y-2 px-4 pb-4 pt-2">
        <AnimatePresence initial={false}>
          {showCta && (
            <motion.div key="cta" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} transition={soft}>
              <CheckoutButton basket={basket!} checkout={checkout} />
            </motion.div>
          )}
        </AnimatePresence>
        {(voice.state === "denied" || voice.state === "error") && (
          <div role="alert" className="flex items-start gap-3 rounded-[14px] px-4 py-3 text-[13px]" style={{ background: "#FFF4E0", color: C.label }}>
            <p className="min-w-0 flex-1">
              {voice.state === "denied" ? "The microphone is blocked. Allow it for this site (left of the address bar), then tap the mic again, or type your list." : "Could not start the microphone. Check that one is connected and not in use, or type your list."}
            </p>
            <button type="button" onClick={voice.dismiss} className="cursor-pointer font-semibold" style={{ color: LINK }}>OK</button>
          </div>
        )}
        {recording ? (
          <div role="group" aria-label="Recording a voice message" className="flex items-center gap-2 bg-white" style={{ borderRadius: 22, padding: 6, boxShadow: cardShadow }}>
            <button type="button" aria-label="Cancel recording" onClick={voice.cancel} className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-black/[0.05]" style={{ color: C.secondary }}><IClose size={16} /></button>
            <motion.span className="h-2 w-2 shrink-0 rounded-full" style={{ background: C.red }} animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[15px]" style={{ color: C.label }}>{voice.state === "starting" ? "Starting mic…" : "Listening…"}</span>
            <Level level={voice.level} />
            <span className="shrink-0 text-[13px]" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }} aria-label={`${Math.floor(voice.seconds)} of ${MAX_VOICE_SECONDS} seconds`}>{clock(voice.seconds)} / {clock(MAX_VOICE_SECONDS)}</span>
            <motion.button type="button" aria-label="Stop and send voice message" autoFocus disabled={voice.state !== "recording"} whileTap={{ scale: 0.92 }}
              onClick={() => { const out = voice.stop(); if (out) void sendVoice(out.audio, out.seconds); }}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white disabled:opacity-50" style={{ background: C.red }}><IStop size={12} /></motion.button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-end gap-1.5 bg-white focus-within:ring-2" style={{ borderRadius: 22, padding: "6px 6px 6px 16px", boxShadow: cardShadow, ["--tw-ring-color" as string]: "rgba(0,122,255,0.35)" }}>
            <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={text.length > 40 ? 2 : 1} maxLength={2000} aria-label="Message the assistant"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
              placeholder={hasItems ? "Change anything, e.g. add jeera" : "e.g. atta, dal, milk under ₹1500"} className="min-h-9 flex-1 resize-none bg-transparent py-[7px] text-[15px] outline-none placeholder:text-[#AEAEB2]" style={{ color: C.label }} />
            {canVoice && (
              <motion.button type="button" aria-label="Speak your list" title="Speak your list" disabled={thinking} whileTap={{ scale: 0.92 }} onClick={() => void voice.start()}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-black/[0.05] disabled:opacity-40" style={{ color: C.secondary }}><IMic /></motion.button>
            )}
            <motion.button type="submit" aria-label="Send" disabled={thinking || !text.trim()} aria-busy={thinking || undefined} whileTap={{ scale: 0.92 }}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white transition-opacity disabled:cursor-default disabled:opacity-30" style={{ background: C.label }}>
              {thinking ? <Spinner size={16} color="#fff" /> : <IArrowUp size={18} />}
            </motion.button>
          </form>
        )}
      </div>
    </>
  );
}

/** Five bars that follow the mic level. */
function Level({ level }: { level: number }) {
  return (
    <span className="flex h-6 items-center gap-[3px]" aria-hidden>
      {[0.45, 0.75, 1, 0.75, 0.45].map((w, i) => (
        <motion.span key={i} className="w-[3px] rounded-full" style={{ background: C.red }} animate={{ height: 4 + 18 * Math.min(1, level * w * 1.4) }} transition={{ duration: 0.08 }} />
      ))}
    </span>
  );
}
