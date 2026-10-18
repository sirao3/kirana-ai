import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentReply, AgentTurnStep } from "@kiranaai/shared";
import { ApiError } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { AssistChip, Button, CircularProgress, cx, Icon, IconButton, LoadingDots, StatusLabel, SuggestionChip } from "../m3";
import { bap } from "./bap";
import { isAgentDown } from "./errors";

interface Msg {
  id: number;
  role: "user" | "model";
  text: string;
  events?: AgentEvent[];
  steps?: AgentReply["steps"];
  /** Last polled progress of the turn (carries summaries); preferred over `steps` in the disclosure. */
  liveSteps?: AgentTurnStep[];
  failed?: boolean;
}

const EXAMPLES = [
  "Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea.",
  "Also add 250 g jeera",
  "Where is my order?",
];

/** Chip text for an agent event. Amounts come from API data carried in the event. */
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

const TOOL_LABEL: Record<string, string> = {
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

const TOOL_ICON: Record<string, string> = {
  search_products: "search",
  plan_basket: "route",
  set_basket: "shopping_basket",
  update_item: "edit_square",
  remove_item: "delete",
  view_basket: "shopping_basket",
  get_quote: "verified",
  request_approval: "lock",
  get_order_status: "receipt_long",
};

/** Vertical step list: icon per tool, label, data-derived summary, spinner on the running step. */
export function StepList({ steps, className }: { steps: AgentTurnStep[]; className?: string }) {
  return (
    <ol className={cx("space-y-1.5", className)} aria-label="Assistant progress">
      {steps.map((s, i) => {
        const running = s.ok === null;
        return (
          <li key={i} className="flex items-center gap-2 type-body-medium">
            <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", running ? "bg-secondary-container text-on-secondary-container" : s.ok ? "bg-primary-container text-on-primary-container" : "bg-error-container text-on-error-container")}>
              {running ? <CircularProgress size={16} label={`${TOOL_LABEL[s.tool] ?? s.tool} in progress`} /> : <Icon name={s.ok ? (TOOL_ICON[s.tool] ?? "check") : "close"} size={16} label={s.ok ? undefined : "failed"} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-on-surface">{TOOL_LABEL[s.tool] ?? s.tool}</span>
              {s.summary && <span className="text-on-surface-variant"> · {s.summary}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function EventChips({ events, onOpenBasket, onReview }: { events: AgentEvent[]; onOpenBasket: () => void; onReview: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {events.map((e, i) => {
        const c = eventChip(e);
        if (e.type === "loose_declined") return <StatusLabel key={i} tone="warning" icon="scale" className="h-auto min-h-7 whitespace-normal py-1">{c.text}</StatusLabel>;
        if (e.type === "basket_updated") return <AssistChip key={i} icon="shopping_basket" onClick={onOpenBasket}>{c.text}</AssistChip>;
        return <AssistChip key={i} icon={e.type === "approval_requested" ? "lock" : "verified"} onClick={onReview}>{c.text} · Review</AssistChip>;
      })}
    </div>
  );
}

export function ChatPanel({ onEvents, onAgentDown, onUseManual, onOpenBasket, onReview }: {
  onEvents: (events: AgentEvent[]) => void;
  /** null clears the banner. */
  onAgentDown: (reason: "unavailable" | "rate_limited" | null) => void;
  onUseManual: () => void;
  onOpenBasket: () => void;
  onReview: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [progress, setProgress] = useState<AgentTurnStep[]>([]);
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    bap.chatHistory().then(
      (h) => alive && setMsgs((m) => (m.length ? m : h.messages.map((x) => ({ id: idRef.current++, role: x.role, text: x.text })))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs, thinking, progress.length]);

  // Poll the turn's tool steps once a second while the assistant works; stop when it reports done.
  useEffect(() => {
    if (!thinking || !turnId) return;
    let alive = true;
    const tick = async () => {
      try {
        const p = await bap.turn(turnId);
        if (!alive) return;
        setProgress(p.steps);
        if (p.done) clearInterval(timer);
      } catch {
        // 404 before the server registers the turn, or a blip: the next tick retries.
      }
    };
    const timer = setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [thinking, turnId]);

  async function send(message: string) {
    const m = message.trim();
    if (!m || thinking) return;
    setText("");
    setMsgs((x) => [...x, { id: idRef.current++, role: "user", text: m }]);
    const id = newTurnId();
    setProgress([]);
    setTurnId(id);
    setThinking(true);
    try {
      const r = await bap.chat(m, id);
      onAgentDown(null);
      // One last read so the disclosure keeps the per-step summaries.
      const final = await bap.turn(id).catch(() => null);
      setMsgs((x) => [...x, { id: idRef.current++, role: "model", text: r.text, events: r.events, steps: r.steps, liveSteps: final && final.steps.length === r.steps.length ? final.steps : undefined }]);
      onEvents(r.events);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) onAgentDown("rate_limited");
      else if (isAgentDown(e)) onAgentDown("unavailable");
      setMsgs((x) => [...x, { id: idRef.current++, role: "model", failed: true, text: "I could not answer just now. You can keep shopping with Search." }]);
    } finally {
      setThinking(false);
      inputRef.current?.focus();
    }
  }

  async function newChat() {
    await bap.chatReset().catch(() => undefined);
    setMsgs([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4" aria-live="polite" aria-busy={thinking}>
        {msgs.length === 0 ? (
          <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-2 pt-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-tertiary-container text-on-tertiary-container">
              <Icon name="auto_awesome" size={32} filled />
            </span>
            <h2 className="type-headline-small text-on-surface">What do you need this week?</h2>
            <p className="type-body-medium text-on-surface-variant">
              Tell me in English or Hinglish. I'll find the best nearby stores, build one basket and get a verified total for you to approve.
            </p>
            <div className="flex flex-col items-stretch gap-2 self-stretch" aria-label="Suggestions">
              {EXAMPLES.map((ex) => (
                <SuggestionChip key={ex} onClick={() => void send(ex)}>
                  {ex}
                </SuggestionChip>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-4">
            {msgs.map((m) =>
              m.role === "user" ? (
                <li key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-xs bg-primary px-4 py-2.5 type-body-large text-on-primary">
                    <span className="sr-only">You: </span>
                    {m.text}
                  </p>
                </li>
              ) : (
                <li key={m.id} className="flex items-start gap-2">
                  <span className={cx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", m.failed ? "bg-error-container text-on-error-container" : "bg-tertiary-container text-on-tertiary-container")} aria-hidden>
                    <Icon name={m.failed ? "error" : "auto_awesome"} size={18} filled />
                  </span>
                  <div className="min-w-0 max-w-[85%] space-y-2">
                    <p className="whitespace-pre-wrap rounded-[20px] rounded-tl-xs bg-surface-container-high px-4 py-2.5 type-body-large text-on-surface">
                      <span className="sr-only">Assistant: </span>
                      {m.text}
                    </p>
                    {m.events && m.events.length > 0 && <EventChips events={m.events} onOpenBasket={onOpenBasket} onReview={onReview} />}
                    {(m.liveSteps?.length || m.steps?.length) ? (
                      <details className="group type-body-small text-on-surface-variant">
                        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm py-1 [&::-webkit-details-marker]:hidden">
                          <Icon name="build" size={16} />
                          {(m.liveSteps ?? m.steps ?? []).length} tool call{(m.liveSteps ?? m.steps ?? []).length === 1 ? "" : "s"}
                          <Icon name="expand_more" size={16} className="transition-transform group-open:rotate-180" />
                        </summary>
                        {m.liveSteps ? (
                          <StepList steps={m.liveSteps} className="mt-1 border-l-2 border-outline-variant pl-3" />
                        ) : (
                          <ol className="mt-1 space-y-0.5 border-l-2 border-outline-variant pl-3">
                            {(m.steps ?? []).map((s, i) => (
                              <li key={i} className="flex items-center gap-1">
                                <Icon name={s.ok ? "check" : "close"} size={14} className={s.ok ? "text-primary" : "text-error"} label={s.ok ? "succeeded" : "failed"} />
                                {TOOL_LABEL[s.tool] ?? s.tool} <span className="font-mono opacity-70">({s.tool})</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </details>
                    ) : null}
                  </div>
                </li>
              ),
            )}
            {thinking && (
              <li className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tertiary-container text-on-tertiary-container" aria-hidden>
                  <Icon name="auto_awesome" size={18} filled />
                </span>
                <div className="min-w-0 max-w-[85%] space-y-2 rounded-[20px] rounded-tl-xs bg-surface-container-high px-4 py-3 type-body-medium text-on-surface-variant">
                  {progress.length > 0 && <StepList steps={progress} />}
                  <span className="flex items-center gap-3">
                    <LoadingDots label="Assistant is working" /> {progress.length > 0 ? "Working…" : "Thinking…"}
                  </span>
                </div>
              </li>
            )}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 pb-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <div className="flex min-h-14 min-w-0 flex-1 items-center rounded-[28px] bg-surface-container-high pl-5 pr-1 focus-within:shadow-1">
          <textarea
            ref={inputRef}
            rows={1}
            className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-4 type-body-large text-on-surface outline-none placeholder:text-on-surface-variant focus-visible:outline-none"
            placeholder="e.g. 2 atta, toor dal, milk, tea under ₹1500"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            aria-label="Message the assistant"
          />
          {msgs.length > 0 && <IconButton icon="edit_square" label="New chat" type="button" disabled={thinking} onClick={() => void newChat()} />}
        </div>
        <IconButton icon="send" label="Send" variant="filled" size={48} type="submit" disabled={thinking || !text.trim()} />
      </form>
      <p className="flex flex-wrap items-center gap-x-1 pb-2 type-body-small text-on-surface-variant">
        The assistant builds your basket; only you can approve and pay.
        <Button variant="text" size="sm" className="-ml-1" onClick={onUseManual}>Prefer to search yourself?</Button>
      </p>
    </div>
  );
}

/** Client-generated turn id (matches the server's [A-Za-z0-9_-]{8,64}). */
function newTurnId(): string {
  const u = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return `t${u ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`}`;
}
