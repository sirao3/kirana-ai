import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { OrderView } from "@kiranaai/shared";
import { unlockAudio, useAudioUnlocked } from "../../merchant/alert";
import type { StepView } from "../steps";
import { C, IMore, ISound, Press, ease, soft } from "./kit";

export interface MenuItem { label: string; hint?: string; onSelect: () => void; danger?: boolean }

/** The script as one Dynamic-Island-style pill: progress ring, the current step and what to do, sound and demo menu. */
export function Island({ steps, menu }: { steps: StepView[]; menu: MenuItem[] }) {
  const sound = useAudioUnlocked();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const done = steps.filter((s) => s.status === "done").length;
  const cur = steps.find((s) => s.status === "current");
  const n = Math.min(steps.length, done + 1);
  const C_LEN = 81.7;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <motion.div layout transition={soft} className="flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-1.5 text-white"
        style={{ background: "#0B0B0C", boxShadow: "0 8px 30px rgba(0,0,0,0.18)" }} aria-live="polite" aria-label="Demo script">
        <motion.span layout className="relative flex h-8 w-8 shrink-0 items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: "rotate(-90deg)" }} aria-hidden>
            <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2.5" />
            <motion.circle cx="16" cy="16" r="13" fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C_LEN}
              initial={false} animate={{ strokeDashoffset: C_LEN * (1 - done / steps.length) }} transition={soft} />
          </svg>
          <span className="absolute text-[12px] font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{cur ? n : "✓"}</span>
        </motion.span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={(cur?.key ?? "done") + (cur?.detail ?? "")} layout initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }} transition={ease} className="flex min-w-0 items-baseline gap-2 whitespace-nowrap text-[14px]">
            <span className="font-semibold">{cur ? cur.label : "Demo complete"}</span>
            <span className="max-w-[min(560px,40vw)] truncate" style={{ opacity: 0.62 }}>{cur ? (cur.detail ? `${cur.detail} · ${cur.hint}` : cur.hint) : "Reset to run it again"}</span>
          </motion.span>
        </AnimatePresence>
        <motion.span layout className="flex items-center gap-1">
          <Press label={sound ? "Offer sounds on" : "Turn on offer sounds"} onClick={() => void unlockAudio()} className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: sound ? "rgba(255,255,255,0.14)" : "#FF9F0A", color: sound ? "#fff" : "#1D1D1F" }}>
            <ISound on={sound} />
          </Press>
          <Press label="Demo actions" onClick={() => setOpen((o) => !o)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.14)" }}>
            <IMore />
          </Press>
        </motion.span>
      </motion.div>
      <AnimatePresence>
        {open && (
          <motion.ul role="menu" initial={{ opacity: 0, scale: 0.92, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={soft}
            className="absolute right-0 top-[52px] z-50 w-[280px] overflow-hidden rounded-[16px] bg-white py-1.5" style={{ transformOrigin: "top right", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.16)" }}>
            {menu.map((m) => (
              <li key={m.label} role="none">
                <button role="menuitem" type="button" onClick={() => { setOpen(false); m.onSelect(); }} className="block w-full cursor-pointer px-4 py-2 text-left hover:bg-black/[0.04]">
                  <span className="block text-[15px]" style={{ color: m.danger ? C.red : C.label }}>{m.label}</span>
                  {m.hint && <span className="block text-[12px]" style={{ color: C.secondary }}>{m.hint}</span>}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export interface LogEntry { at: number; text: string; tone: "neutral" | "good" | "bad" }

/** Activity derived from the live order: each new fact (offer, answer, stage, settlement) is logged once, when first seen. */
export function useActivity(order: OrderView | null) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const seen = useRef(new Set<string>());
  const add = (text: string, tone: LogEntry["tone"] = "neutral", key?: string) => {
    if (key) {
      if (seen.current.has(key)) return;
      seen.current.add(key);
    }
    setLog((l) => [...l, { at: Date.now(), text, tone }]);
  };
  useEffect(() => {
    if (!order || order.paymentStatus !== "PAID") return;
    for (const s of order.subOrders) {
      for (const a of s.attempts) {
        const who = a.storeName.split(" ")[0];
        if (a.status !== "PENDING") add(`Offered to ${who} (try ${a.attemptNo} of 3)`, "neutral", `${a.id}:offer`);
        if (a.status === "ACCEPTED") add(`${who} accepted`, "good", `${a.id}:acc`);
        if (a.status === "REJECTED") add(`${who} declined${a.rejectReason ? ` — ${a.rejectReason.toLowerCase()}` : ""}`, "bad", `${a.id}:rej`);
        if (a.status === "EXPIRED") add(`${who} didn't answer in time`, "bad", `${a.id}:exp`);
      }
      const who = (s.currentStoreName ?? s.approvedStoreName).split(" ")[0];
      if (s.status === "OUT_FOR_DELIVERY") add(`${who} sent it out for delivery`, "neutral", `${s.id}:out`);
      if (s.status === "DELIVERED") add(`${who} delivered`, "good", `${s.id}:del`);
      if (s.status === "FAILED_NO_FULFILMENT") add(`No store could fulfil ${s.approvedStoreName}'s items — refunded`, "bad", `${s.id}:fail`);
    }
    if (order.settled) add("Settled · stores paid out", "good", `${order.basketId}:settled`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);
  return { log, add, clear: () => { seen.current.clear(); setLog([]); } };
}

export function Activity({ log }: { log: LogEntry[] }) {
  const items = log.slice(-4).reverse();
  const t0 = log[0]?.at ?? 0;
  return (
    <AnimatePresence>
      {log.length > 0 && (
        <motion.aside initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={soft} aria-label="Activity"
          className="absolute bottom-4 right-4 w-[330px] px-4 py-3" style={{ borderRadius: 20, background: "rgba(255,255,255,0.84)", backdropFilter: "blur(30px) saturate(180%)", WebkitBackdropFilter: "blur(30px) saturate(180%)", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.12)" }}>
          <p className="mb-0.5 text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.tertiary }}>Activity</p>
          <ul aria-live="polite">
            <AnimatePresence initial={false}>
              {items.map((e) => (
                <motion.li key={e.at + e.text} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={soft} className="flex items-baseline gap-3 py-1.5 text-[13px]">
                  <span className="w-12 shrink-0 text-right" style={{ color: C.tertiary, fontVariantNumeric: "tabular-nums" }}>{((e.at - t0) / 1000).toFixed(1)}s</span>
                  <span style={{ color: e.tone === "good" ? C.green : e.tone === "bad" ? C.red : C.label }}>{e.text}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
