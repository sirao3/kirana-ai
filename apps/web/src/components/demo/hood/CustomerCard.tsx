import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MAX_VOICE_SECONDS, type AgentReply, type AgentTurnStep, type BasketView, type OrderView, type StoreQuoteError, type SubOrderView } from "@kiranaai/shared";
import { ApiError } from "../../../lib/api";
import { formatINR } from "../../../lib/format";
import { useLive } from "../../../lib/live";
import { bap, newIdempotencyKey } from "../../shop/bap";
import { quoteIsLive } from "../../shop/BasketPanel";
import { orderFinished } from "../../shop/OrderDetail";
import { TOOL_LABEL } from "../../shop/ChatPanel";
import { errorMessage, isAgentDown } from "../../shop/errors";
import { useVoiceRecorder, voiceSupported } from "../../shop/voice";
import { DEMO_PROMPT } from "../steps";
import { C, CheckDraw, IArrowUp, IArrowUpRight, IMic, ISpark, IStop, Money, Press, Ring, Spinner, cardShadow, ease, sheet, shortName, soft, spring } from "./kit";

/*
 * The customer half of the cockpit, as one continuous flow in a floating card: ask → the agent works (live steps) →
 * the basket card → approve & pay in a sheet → the same card becomes the order tracker. Same rules as /shop:
 * suggested quantities are confirmed first, the total is always the API quote, only the Pay button approves and pays.
 */

interface Msg { id: number; role: "user" | "model"; text: string; failed?: boolean; voice?: boolean }

const EXAMPLES = [DEMO_PROMPT, "Also add 250 g jeera", "Where is my order?"];
// Manual fallback when the assistant is out of quota: the §14 needs through the deterministic planner.
const DEMO_NEEDS = [{ query: "atta", qty: 1 }, { query: "toor dal", qty: 2 }, { query: "tea", qty: 1 }, { query: "milk", qty: 8 }];

function newTurnId() {
  return globalThis.crypto?.randomUUID?.() ?? `turn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function CustomerCard({ order, now, onLog, onNewOrder }: { order: OrderView | null; now: number; onLog: (text: string, tone?: "neutral" | "good" | "bad") => void; onNewOrder?: () => void }) {
  const qc = useQueryClient();
  const basketQ = useQueryBasket();
  const basket = basketQ.data;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(DEMO_PROMPT);
  const [thinking, setThinking] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentTurnStep[]>([]);
  const [agentDown, setAgentDown] = useState(false);
  const [quoteErrors, setQuoteErrors] = useState<StoreQuoteError[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const idRef = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const [canVoice] = useState(voiceSupported);
  const voice = useVoiceRecorder((audio) => void ask((id) => bap.chatVoice(audio, id), true));
  const recording = voice.state === "recording" || voice.state === "starting";

  const paid = order?.paymentStatus === "PAID";
  const hasItems = (basket?.itemCount ?? 0) > 0;
  const started = msgs.length > 0 || hasItems || !!order;
  const suggested = !!basket?.stores.some((s) => s.items.some((i) => i.qtyInferred));

  // Poll the running turn's tool steps.
  useEffect(() => {
    if (!thinking || !turnId) return;
    let alive = true;
    const tick = async () => {
      try {
        const p = await bap.turn(turnId);
        if (alive) setSteps(p.steps);
      } catch { /* 404 until registered */ }
    };
    const t = setInterval(() => void tick(), 700);
    void tick();
    return () => { alive = false; clearInterval(t); };
  }, [thinking, turnId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, steps.length, hasItems, paid, order?.settled]);

  useEffect(() => {
    if (paid) setSheetOpen(false);
  }, [paid]);

  async function ask(call: (turnId: string) => Promise<AgentReply>, isVoice = false, userText?: string) {
    if (thinking) return;
    const id = newTurnId();
    const userId = idRef.current++;
    setMsgs((m) => [...m, { id: userId, role: "user", text: userText ?? "…", voice: isVoice }]);
    setSteps([]);
    setTurnId(id);
    setThinking(true);
    onLog(isVoice ? "Asked the assistant by voice" : "Asked the assistant");
    try {
      const r = await call(id);
      setAgentDown(false);
      if (isVoice) setMsgs((m) => m.map((x) => (x.id === userId ? { ...x, text: r.transcript || "(could not hear that)" } : x)));
      setMsgs((m) => [...m, { id: idRef.current++, role: "model", text: r.text }]);
      setQuoteErrors([]);
      await qc.invalidateQueries({ queryKey: ["basket"] });
      if (r.events.some((e) => e.type === "basket_updated")) onLog("Basket planned by the assistant");
      if (r.events.some((e) => e.type === "approval_requested")) review();
    } catch (e) {
      const down = isAgentDown(e) || (e instanceof ApiError && e.status === 429);
      setAgentDown(down);
      if (isVoice) setMsgs((m) => m.map((x) => (x.id === userId ? { ...x, text: "Voice message not sent" } : x)));
      setMsgs((m) => [...m, { id: idRef.current++, role: "model", failed: true, text: down ? "The assistant is busy right now. You can plan the same basket without it." : "I could not answer just now." }]);
    } finally {
      setThinking(false);
    }
  }

  function send(message: string) {
    const m = message.trim();
    if (!m) return;
    setText("");
    void ask((id) => bap.chat(m, id), false, m);
  }

  const manual = useMutation({
    mutationFn: async () => {
      const plan = await bap.plan(DEMO_NEEDS, 150000);
      return bap.replace(plan.choices.map((c) => ({ listingId: c.offer.listingId, qty: c.qty, reason: c.reason, qtyInferred: c.qtyInferred })), plan.reasons);
    },
    onSuccess: (b) => { qc.setQueryData(["basket"], b); onLog("Basket planned without the assistant"); },
  });

  const quote = useMutation({
    mutationFn: bap.quote,
    onSuccess: (r) => {
      qc.setQueryData(["basket"], r.basket);
      setQuoteErrors(r.errors);
      if (r.quote) { setSheetOpen(true); onLog(`Verified quote ${formatINR(r.quote.grandTotalPaise)}`); }
    },
  });
  const confirm = useMutation({
    mutationFn: bap.confirmQty,
    onSuccess: (b) => { qc.setQueryData(["basket"], b); proceed(b); },
  });
  function proceed(b: BasketView | undefined) {
    if (b && quoteIsLive(b)) setSheetOpen(true);
    else quote.mutate();
  }
  function review() {
    const b = qc.getQueryData<BasketView>(["basket"]) ?? basket;
    if (b?.stores.some((s) => s.items.some((i) => i.qtyInferred))) return; // the card asks to confirm quantities first
    proceed(b);
  }

  const showBasket = hasItems && !paid;
  const total = basket?.quote && quoteIsLive(basket) ? basket.quote.grandTotalPaise : (basket?.stores.reduce((t, s) => t + s.itemsTotalPaise, 0) ?? 0);

  return (
    <section aria-label="Customer" className="absolute bottom-4 left-4 top-4 flex w-[420px] flex-col overflow-hidden"
      style={{ borderRadius: 26, background: "rgba(255,255,255,0.84)", backdropFilter: "blur(30px) saturate(180%)", WebkitBackdropFilter: "blur(30px) saturate(180%)", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06), 0 18px 50px rgba(0,0,0,0.14)" }}>
      <header className="flex items-center gap-2.5 px-5 pb-1 pt-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[13px] font-bold text-white" style={{ background: C.green }}>K</span>
        <span className="text-[15px] font-semibold" style={{ color: C.label }}>KiranaAI</span>
        <span className="ml-auto text-[13px]" style={{ color: C.secondary }}>Priya · Indiranagar</span>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6" style={{ scrollbarWidth: "none", maskImage: "linear-gradient(to bottom, transparent 0, #000 20px)" }} aria-live="polite" aria-busy={thinking}>
        <LayoutGroup>
          <AnimatePresence mode="popLayout" initial={false}>
            {!started && (
              <motion.div key="hero" exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }} className="pt-[13vh]">
                <h1 className="text-[32px] font-bold leading-[1.08] tracking-[-0.03em]" style={{ color: C.label }}>What does the house need this week?</h1>
                <p className="mt-2 text-[15px]" style={{ color: C.secondary }}>We ask the kiranas on the map and come back with one total.</p>
                <motion.ul initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.05, delayChildren: 0.2 } } }} className="mt-6">
                  {EXAMPLES.slice(1).map((e) => (
                    <motion.li key={e} variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }} transition={ease}>
                      <button type="button" onClick={() => send(e)} className="flex w-full cursor-pointer items-center gap-3 py-2 text-left text-[15px]" style={{ color: C.secondary }}>
                        <IArrowUpRight size={16} /> {e}
                      </button>
                    </motion.li>
                  ))}
                </motion.ul>
              </motion.div>
            )}
          </AnimatePresence>

          {started && (
            <div className="space-y-3 pt-3">
              {msgs.map((m) => m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <motion.p layoutId={m.id === 1 ? "composer" : undefined} initial={m.id === 1 ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={soft}
                    className="max-w-[86%] text-[14px] text-white" style={{ background: C.label, borderRadius: 20, padding: "8px 14px" }}>
                    {m.voice && <span className="mr-1 inline-flex align-[-2px]"><IMic size={14} /></span>}{m.text}
                  </motion.p>
                </div>
              ) : (
                <motion.p key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={soft} className="flex gap-2 text-[14px] leading-[1.45]" style={{ color: m.failed ? C.red : C.label }}>
                  <span className="mt-0.5 shrink-0" style={{ color: m.failed ? C.red : C.tertiary }}><ISpark size={15} /></span>
                  <span className="min-w-0">{m.text}</span>
                </motion.p>
              ))}
              {thinking && <AgentSteps steps={steps} />}
              {agentDown && !hasItems && (
                <Press onClick={() => manual.mutate()} busy={manual.isPending} className="w-full rounded-[14px] px-4 py-3 text-left text-[14px] font-semibold" style={{ background: C.fill, color: C.label }}>
                  Plan this week's basket without the assistant →
                </Press>
              )}
              <AnimatePresence initial={false}>
                {showBasket && basket && (
                  <BasketBlock key="basket" basket={basket} total={total} now={now} errors={quoteErrors} suggested={suggested} />
                )}
              </AnimatePresence>
              {paid && order && <OrderBlock order={order} now={now} onNewOrder={onNewOrder} />}
            </div>
          )}
        </LayoutGroup>
      </div>

      {/* Bottom: the one primary action, or the composer. */}
      <div className="px-4 pb-4 pt-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {showBasket && !thinking ? (
            <motion.div key="cta" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} transition={soft}>
              {quote.error && <p className="mb-2 text-[13px]" style={{ color: C.red }}>{errorMessage(quote.error)}</p>}
              <Press onClick={() => (suggested ? confirm.mutate() : proceed(basket))} busy={quote.isPending || confirm.isPending}
                className="flex h-[54px] w-full items-center justify-center gap-2 text-[17px] font-semibold text-white" style={{ background: C.label, borderRadius: 16 }}>
                {quote.isPending || confirm.isPending ? <Spinner size={20} color="#fff" /> : suggested ? "Quantities look right" : quoteIsLive(basket!) ? `Pay ${formatINR(total)}` : "Get verified total"}
              </Press>
            </motion.div>
          ) : (
            <motion.div key="composer" layoutId={msgs.length === 0 ? "composer" : undefined} transition={soft}
              className="flex items-end gap-2 bg-white" style={{ borderRadius: 20, padding: "8px 8px 8px 16px", boxShadow: cardShadow }}>
              {recording ? (
                <p className="flex min-h-9 flex-1 items-center gap-2 text-[15px]" style={{ color: C.red }}>
                  <motion.span className="h-2 w-2 rounded-full" style={{ background: C.red }} animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} />
                  Listening · {Math.floor(voice.seconds)}s / {MAX_VOICE_SECONDS}s
                </p>
              ) : (
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={text.length > 44 ? 2 : 1} disabled={thinking} aria-label="Message the assistant"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
                  placeholder="Ask for anything from the kirana…" className="min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none" style={{ color: C.label }} />
              )}
              {canVoice && (
                <Press label={recording ? "Stop and send" : "Speak"} disabled={thinking} onClick={() => { if (!recording) return void voice.start(); const out = voice.stop(); if (out) void ask((id) => bap.chatVoice(out.audio, id), true); }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={recording ? { background: C.red, color: "#fff" } : { color: C.secondary }}>
                  {recording ? <IStop size={12} /> : <IMic />}
                </Press>
              )}
              {!recording && (
                <Press label="Send" onClick={() => send(text)} disabled={!text.trim()} busy={thinking}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: C.label }}>
                  {thinking ? <Spinner size={16} color="#fff" /> : <IArrowUp size={18} />}
                </Press>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {sheetOpen && basket?.quote && (
          <PaySheet key="sheet" basket={basket} now={now} onClose={() => setSheetOpen(false)} onRequote={() => quote.mutate()} requoting={quote.isPending} onLog={onLog} />
        )}
      </AnimatePresence>
    </section>
  );
}

/** Basket query shared with the rest of the app's cache key. */
function useQueryBasket() {
  return useLive(["basket"], bap.basket);
}

function AgentSteps({ steps }: { steps: AgentTurnStep[] }) {
  return (
    <motion.ul layout className="space-y-2 py-1" aria-label="Assistant progress">
      {steps.length === 0 && <li className="flex items-center gap-2.5 text-[14px]" style={{ color: C.secondary }}><Spinner size={15} /> Thinking</li>}
      {steps.map((s, i) => (
        <motion.li key={i} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={soft} className="flex items-center gap-2.5 text-[14px]" style={{ color: s.ok === null ? C.label : C.secondary }}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">{s.ok === null ? <Spinner size={15} /> : s.ok ? <CheckDraw size={17} color={C.tertiary} /> : <span style={{ color: C.red }}>✕</span>}</span>
          <span className="min-w-0 truncate">{TOOL_LABEL[s.tool] ?? s.tool}{s.summary ? <span style={{ color: C.tertiary }}> · {s.summary}</span> : null}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

function BasketBlock({ basket, total, now, errors, suggested }: {
  basket: BasketView; total: number; now: number; errors: StoreQuoteError[]; suggested: boolean;
}) {
  const live = quoteIsLive(basket);
  const q = basket.quote;
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={soft}
      className="bg-white" style={{ borderRadius: 22, padding: 18, boxShadow: cardShadow }}>
      <p className="text-[13px] font-medium" style={{ color: C.secondary }}>
        {live ? "Verified with every store" : `Your basket · ${basket.stores.length} store${basket.stores.length === 1 ? "" : "s"}`}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <Money value={total} className="text-[34px] font-bold leading-none tracking-[-0.03em]" style={{ color: C.label }} />
        {live && q ? (
          <span className="text-[12px]" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>Price held {mmss(new Date(q.validUntil).getTime() - now)}</span>
        ) : <span className="text-[12px]" style={{ color: C.tertiary }}>+ delivery, confirmed at quote</span>}
      </div>
      <motion.div initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } } }} className="mt-4">
        {basket.stores.map((g, i) => {
          const qs = q?.stores.find((s) => s.storeId === g.storeId);
          const err = errors.find((e) => e.storeId === g.storeId);
          return (
            <motion.div key={g.storeId} variants={{ h: { opacity: 0, y: 10 }, s: { opacity: 1, y: 0 } }} transition={soft} className="py-3" style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined, paddingTop: i ? undefined : 0 }}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[15px] font-semibold" style={{ color: C.label }}>{g.storeName}</p>
                <span className="text-[15px] font-semibold" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{formatINR(qs && live ? qs.totalPaise : g.itemsTotalPaise)}</span>
              </div>
              {qs && live && <p className="text-[12px]" style={{ color: C.secondary }}>{qs.deliveryPaise ? `${formatINR(qs.deliveryPaise)} delivery` : "Free delivery"}</p>}
              {err && <p className="text-[12px]" style={{ color: C.red }}>{err.message}</p>}
              <ul className="mt-1.5 space-y-1">
                {g.items.map((it) => (
                  <li key={it.listingId}>
                    <div className="flex justify-between gap-3 text-[14px]" style={{ color: C.label }}>
                      <span><span style={{ color: C.secondary }}>{it.qty}×</span> {it.name}{it.qtyInferred && <span className="ml-1.5 rounded-[5px] px-1.5 py-px text-[11px] font-semibold" style={{ background: "#FFF4E0", color: "#9A5B00" }}>suggested</span>}</span>
                      <span style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>{formatINR(it.lineTotalPaise)}</span>
                    </div>
                    {it.reason && <p className="mt-0.5 flex items-center gap-1 text-[12px]" style={{ color: C.tertiary }}><ISpark size={12} />{it.reason}</p>}
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </motion.div>
      {suggested && (
        <p className="mt-1 text-[12px]" style={{ color: C.secondary }}>
          The assistant suggested some quantities. Check them, then confirm below.
        </p>
      )}
    </motion.div>
  );
}

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

const STAGES = ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
const STAGE_LABEL: Record<string, string> = { ACCEPTED: "Accepted", PREPARING: "Packing", READY: "Ready", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered" };

function OrderBlock({ order, now, onNewOrder }: { order: OrderView; now: number; onNewOrder?: () => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={soft} className="bg-white" style={{ borderRadius: 22, padding: 18, boxShadow: cardShadow }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium" style={{ color: C.secondary }}>{order.settled ? "Delivered and settled" : "Order placed · paid by UPI"}</p>
          <Money value={order.grandTotalPaise} className="mt-1 block text-[34px] font-bold leading-none tracking-[-0.03em]" style={{ color: C.label }} />
        </div>
        <CheckDraw size={30} />
      </div>
      <div className="mt-4">
        {order.subOrders.map((s, i) => <SubRow key={s.id} sub={s} now={now} first={i === 0} />)}
      </div>
      <AnimatePresence>
        {order.settled && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={soft} className="overflow-hidden text-[13px]" style={{ color: C.green }}>
            <span className="block pt-3">Everything arrived. Stores have been paid out.</span>
          </motion.p>
        )}
      </AnimatePresence>
      {onNewOrder && orderFinished(order) && (
        <Press onClick={onNewOrder} className="mt-4 flex h-[50px] w-full items-center justify-center text-[16px] font-semibold text-white" style={{ background: C.label, borderRadius: 14 }}>
          Start a new order
        </Press>
      )}
    </motion.div>
  );
}

function SubRow({ sub, now, first }: { sub: SubOrderView; now: number; first: boolean }) {
  const cur = sub.attempts.at(-1);
  const name = sub.currentStoreName ?? cur?.storeName ?? sub.approvedStoreName;
  const failed = sub.attempts.filter((a) => a.status === "REJECTED" || a.status === "EXPIRED");
  const n = STAGES.indexOf(sub.status as (typeof STAGES)[number]) + 1;
  const subsidy = cur && cur.status === "ACCEPTED" ? cur.quotedTotalPaise - sub.approvedAmountPaise : 0;
  const lost = sub.status === "FAILED_NO_FULFILMENT";
  return (
    <div className="py-3" style={{ borderTop: first ? undefined : `0.5px solid ${C.sep}`, paddingTop: first ? 0 : undefined }}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="relative min-w-0 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p key={name} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={soft} className="truncate text-[15px] font-semibold" style={{ color: C.label }}>{name}</motion.p>
          </AnimatePresence>
        </div>
        <span className="text-[15px] font-semibold" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{formatINR(sub.approvedAmountPaise)}</span>
      </div>
      <div className="relative mt-1.5 flex min-h-[22px] items-center gap-2 text-[13px] font-medium">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={sub.status + (cur?.id ?? "")} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={ease} className="flex items-center gap-1.5"
            style={{ color: lost ? C.red : sub.status === "DELIVERED" ? C.green : sub.status === "DISPATCHING" ? C.secondary : C.label }}>
            {sub.status === "DELIVERED" ? <CheckDraw size={15} /> : sub.status === "DISPATCHING" ? <Spinner size={13} /> : null}
            {lost ? `No store could take it · refunded ${formatINR(sub.refundPaise ?? sub.approvedAmountPaise)}` : sub.status === "DISPATCHING" ? `Waiting for ${shortName(cur?.storeName ?? name)} · try ${sub.attemptCount} of ${sub.maxAttempts}` : STAGE_LABEL[sub.status]}
          </motion.span>
        </AnimatePresence>
        {sub.status === "DISPATCHING" && cur?.status === "OFFERED" && cur.expiresAt && <span className="ml-auto"><Ring from={cur.createdAt} until={cur.expiresAt} now={now} size={22} label={false} /></span>}
      </div>
      {!lost && (
        <div className="mt-2 flex gap-1" aria-hidden>
          {STAGES.map((s, i) => (
            <span key={s} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: C.fill }}>
              <motion.span className="block h-full rounded-full" style={{ background: C.green, originX: 0 }} initial={false} animate={{ scaleX: n > i ? 1 : 0 }} transition={soft} />
            </span>
          ))}
        </div>
      )}
      <AnimatePresence initial={false}>
        {failed.length > 0 && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={soft} className="overflow-hidden text-[12px]" style={{ color: C.secondary }}>
            <span className="block pt-2">
              {failed.map((a) => `${shortName(a.storeName)} ${a.status === "EXPIRED" ? "didn't answer in time" : `declined${a.rejectReason ? ` (${a.rejectReason.toLowerCase()})` : ""}`}`).join(" · ")}
              {cur && cur.status !== "REJECTED" && cur.status !== "EXPIRED" && ` · moved to ${shortName(cur.storeName)} · your price stays ${formatINR(sub.approvedAmountPaise)}`}
              {subsidy > 0 && ` · KiranaAI covers ${formatINR(subsidy)}`}
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Approve & pay: one sheet, one button. The button contracts into a spinner, then a check. */
function PaySheet({ basket, now, onClose, onRequote, requoting, onLog }: {
  basket: BasketView; now: number; onClose: () => void; onRequote: () => void; requoting: boolean; onLog: (t: string, tone?: "neutral" | "good" | "bad") => void;
}) {
  const quote = basket.quote!;
  const [stage, setStage] = useState<"idle" | "paying" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [failNext, setFailNext] = useState(false);
  const expired = !quoteIsLive(basket) || new Date(quote.validUntil).getTime() <= now;

  async function pay() {
    setError(null);
    setStage("paying");
    try {
      let t = (await bap.approve(basket.id, quote.quoteHash)).approvalToken;
      let r;
      try {
        r = await bap.pay(basket.id, t, failNext, newIdempotencyKey());
      } catch (e) {
        if (!(e instanceof ApiError) || (e.status !== 403 && e.status !== 409)) throw e;
        t = (await bap.approve(basket.id, quote.quoteHash)).approvalToken;
        r = await bap.pay(basket.id, t, failNext, newIdempotencyKey());
      }
      if (r.status === "FAILED") {
        setStage("idle");
        setFailNext(false);
        setError("Payment failed. You were not charged. Try again.");
        onLog("Payment failed (simulated)", "bad");
        return;
      }
      setStage("done");
      onLog(`Paid ${formatINR(quote.grandTotalPaise)} by UPI`, "good");
    } catch (e) {
      setStage("idle");
      setError(e instanceof ApiError && (e.status === 403 || e.status === 409) ? "The quote changed or expired. Get a fresh total." : errorMessage(e));
    }
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={ease} onClick={stage === "idle" ? onClose : undefined} className="absolute inset-0" style={{ background: "rgba(0,0,0,0.16)" }} />
      <motion.div role="dialog" aria-modal="true" aria-label="Approve and pay" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "105%" }} transition={sheet}
        className="absolute inset-x-0 bottom-0 bg-white px-6 pb-6 pt-3" style={{ borderRadius: 26, boxShadow: "0 -8px 30px rgba(0,0,0,0.12)" }}>
        <div className="mx-auto mb-4 h-[5px] w-9 rounded-full" style={{ background: C.tertiary, opacity: 0.5 }} />
        <p className="text-center text-[13px] font-medium" style={{ color: C.secondary }}>Approve and pay</p>
        <Money value={quote.grandTotalPaise} className="mt-1 block text-center text-[46px] font-bold tracking-[-0.03em]" style={{ color: C.label }} />
        <p className="text-center text-[13px]" style={{ color: expired ? C.red : C.secondary }}>{expired ? "This quote has expired" : `Verified with each store · held for ${mmss(new Date(quote.validUntil).getTime() - now)}`}</p>
        <ul className="mt-5" style={{ borderTop: `0.5px solid ${C.sep}` }}>
          {quote.stores.map((s) => (
            <li key={s.storeId} className="flex justify-between py-2.5 text-[15px]" style={{ borderBottom: `0.5px solid ${C.sep}`, color: C.label }}>
              <span>{s.storeName}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(s.totalPaise)}</span>
            </li>
          ))}
          <li className="flex justify-between py-2.5 text-[15px]" style={{ borderBottom: `0.5px solid ${C.sep}`, color: C.secondary }}>
            <span>Platform fee</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(quote.platformFeePaise)}</span>
          </li>
        </ul>
        <p className="mt-3 text-[13px]" style={{ color: C.secondary }}>Only you can approve. The assistant can't pay or confirm on your behalf.</p>
        {error && <p className="mt-2 text-[13px]" style={{ color: C.red }}>{error}</p>}
        <div className="mt-4 flex justify-center">
          {expired ? (
            <Press onClick={onRequote} busy={requoting} className="flex h-[54px] w-full items-center justify-center text-[17px] font-semibold text-white" style={{ background: C.label, borderRadius: 27 }}>
              {requoting ? <Spinner size={20} color="#fff" /> : "Get a fresh total"}
            </Press>
          ) : (
            <motion.button type="button" layout onClick={stage === "idle" ? () => void pay() : undefined} whileTap={stage === "idle" ? { scale: 0.97 } : undefined} transition={soft}
              aria-busy={stage === "paying" || undefined} className="flex h-[54px] cursor-pointer items-center justify-center overflow-hidden text-[17px] font-semibold text-white"
              style={{ background: stage === "done" ? C.green : C.label, borderRadius: 27, width: stage === "idle" ? "100%" : 54 }}>
              <AnimatePresence mode="popLayout" initial={false}>
                {stage === "done" ? <motion.span key="ok" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring}><CheckDraw size={26} ring={false} color="#fff" /></motion.span>
                  : stage === "paying" ? <motion.span key="spin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Spinner size={22} color="#fff" /></motion.span>
                  : <motion.span key="txt" exit={{ opacity: 0 }} className="whitespace-nowrap">Approve and pay {formatINR(quote.grandTotalPaise)}</motion.span>}
              </AnimatePresence>
            </motion.button>
          )}
        </div>
        {stage === "idle" && (
          <div className="mt-2 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-[12px]" style={{ color: C.tertiary }}>
              <input type="checkbox" checked={failNext} onChange={(e) => setFailNext(e.target.checked)} /> Simulate a failed payment
            </label>
            <button type="button" onClick={onClose} className="cursor-pointer py-2 text-[15px]" style={{ color: C.blue }}>Not now</button>
          </div>
        )}
      </motion.div>
    </>
  );
}
