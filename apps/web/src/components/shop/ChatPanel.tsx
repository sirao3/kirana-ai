import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentReply } from "@kiranaai/shared";
import { ApiError } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { Badge, Button, Card } from "../kit";
import { bap } from "./bap";
import { isAgentDown } from "./errors";

interface Msg {
  id: number;
  role: "user" | "model";
  text: string;
  events?: AgentEvent[];
  steps?: AgentReply["steps"];
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

export function ChatPanel({ onEvents, onAgentDown, onUseManual }: {
  onEvents: (events: AgentEvent[]) => void;
  /** null clears the banner. */
  onAgentDown: (reason: "unavailable" | "rate_limited" | null) => void;
  onUseManual: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

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
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, thinking]);

  async function send(message: string) {
    const m = message.trim();
    if (!m || thinking) return;
    setText("");
    setMsgs((x) => [...x, { id: idRef.current++, role: "user", text: m }]);
    setThinking(true);
    try {
      const r = await bap.chat(m);
      onAgentDown(null);
      setMsgs((x) => [...x, { id: idRef.current++, role: "model", text: r.text, events: r.events, steps: r.steps }]);
      onEvents(r.events);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) onAgentDown("rate_limited");
      else if (isAgentDown(e)) onAgentDown("unavailable");
      setMsgs((x) => [...x, { id: idRef.current++, role: "model", text: "I could not answer just now. You can keep shopping in the Manual tab." }]);
    } finally {
      setThinking(false);
    }
  }

  async function newChat() {
    await bap.chatReset().catch(() => undefined);
    setMsgs([]);
  }

  return (
    <Card
      title="Assistant"
      className="flex h-[70vh] min-h-[420px] flex-col"
      actions={msgs.length > 0 ? <button className="text-xs text-stone-500 hover:text-stone-800" onClick={newChat}>New chat</button> : undefined}
    >
      <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1" aria-live="polite">
        {msgs.length === 0 && (
          <div className="space-y-2 text-sm text-stone-600">
            <p>Tell me what you need, in English or Hinglish. I will find the best stores and build one basket.</p>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="rounded-lg border border-stone-200 px-3 py-2 text-left hover:bg-stone-50" onClick={() => send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] space-y-1.5 rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-900"}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.events && m.events.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.events.map((e, i) => {
                    const c = eventChip(e);
                    return <Badge key={i} tone={c.tone}>{c.text}</Badge>;
                  })}
                </div>
              )}
              {m.steps && m.steps.length > 0 && (
                <div className="text-xs text-stone-500">
                  {m.steps.map((s) => `${s.tool}${s.ok ? "" : " ✕"}`).join(" → ")}
                </div>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="animate-pulse rounded-2xl bg-stone-100 px-3 py-2 text-sm text-stone-500">thinking…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
          placeholder="e.g. 2 atta, 1 toor dal, milk, tea under ₹1500"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          aria-label="Message the assistant"
        />
        <Button type="submit" disabled={thinking || !text.trim()}>Send</Button>
      </form>
      <button className="mt-2 self-start text-xs text-stone-500 underline md:hidden" onClick={onUseManual}>
        Prefer to search yourself? Manual mode
      </button>
    </Card>
  );
}
