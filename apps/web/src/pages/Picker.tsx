import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { StoreServiceability } from "@kiranaai/shared";
import { api } from "../lib/api";
import { EXPANDED, useMedia } from "../lib/useMedia";
import { setSession, type Session } from "../lib/session";
import { Basemap, HOME, Home, PX_PER_KM, Pin, project, routeD, type Pt } from "../components/demo/hood/HoodMap";
import { C, FONT, Press, Spinner, draw, ease, shortName, soft } from "../components/demo/hood/kit";

interface Personas {
  customers: { id: string; name: string }[];
  stores: { id: string; name: string }[];
}

type Login = { role: "customer" | "merchant"; id: string };

async function signIn(body: Login): Promise<Session> {
  const s = await api<Session>("/auth/persona", { method: "POST", json: body });
  const session: Session = { token: s.token, role: s.role, sub: s.sub, name: s.name };
  setSession(session);
  return session;
}

const DEMO_CUSTOMER = "cust_priya";
/** The demo customer's home (seed: 12, 7th Cross, Indiranagar). The map is centred on it. */
const PRIYA = { lat: 12.9719, lng: 77.6412 };
/** The stores the planner picks for the §14 prompt; drawn as the intro's example plan. */
const PLAN_IDS = ["store_sharma", "store_gupta", "store_lakshmi"];

const STEPS = [
  { title: "Say what the house needs", body: "In English or Hinglish, typed or spoken. The assistant asks every kirana nearby over Beckn/ONDC." },
  { title: "Approve one verified total", body: "Each store re-checks price and stock. You pay once, even when the basket spans three stores." },
  { title: "Stores answer like ride-hailing", body: "Every store gets a timed offer. If one declines or goes quiet, the order moves to the next on its own." },
];

/** Cold start: ping /health; true once it has been slow (> 1.5 s) and has not answered yet. Clears itself on the first OK. */
function useWakingServer(): boolean {
  const [waking, setWaking] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    let stop = false;
    let slow = false;
    const timer = setTimeout(() => { if (!stop) { slow = true; setWaking(true); } }, 1500);
    (async () => {
      for (let i = 0; i < 40 && !stop; i++) {
        try {
          if ((await fetch("/health", { cache: "no-store" })).ok) break;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
      clearTimeout(timer);
      if (stop) return;
      setWaking(false);
      if (slow) void qc.invalidateQueries();
    })();
    return () => { stop = true; clearTimeout(timer); };
  }, [qc]);
  return waking;
}

/** Fits the map (pinned to the viewport) so home lands beside the card on wide screens and above it on phones. */
function useStage(wide: boolean) {
  const [st, setSt] = useState({ w: 1440, h: 900 });
  useLayoutEffect(() => {
    const on = () => setSt({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const s = wide ? Math.max(st.h / 1000, st.w / 1600) : Math.min(st.w / 760, (st.h * 0.42) / 760) * 1.1;
  const target = wide ? { x: 452 + (st.w - 452) / 2, y: st.h * 0.52 } : { x: st.w / 2, y: st.h * 0.2 };
  return { ...st, s, tx: target.x - HOME.x * s, ty: target.y - HOME.y * s };
}

/** Landing page and persona picker: the neighbourhood is the stage, the story and the roles float in a card. */
export function Picker() {
  const nav = useNavigate();
  const wide = useMedia(EXPANDED);
  const personas = useQuery({ queryKey: ["personas"], queryFn: () => api<Personas>("/auth/personas") });
  const stores = useQuery({
    queryKey: ["serviceability", PRIYA],
    queryFn: () => api<{ stores: StoreServiceability[] }>(`/bpp/serviceability?lat=${PRIYA.lat}&lng=${PRIYA.lng}`),
    staleTime: Infinity,
  });
  const waking = useWakingServer();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const stage = useStage(wide);

  async function go(key: string, login: Login, to: string) {
    setBusy(key);
    setError(null);
    try {
      await signIn(login);
      nav(to);
    } catch {
      setError("Could not sign in. Is the server running?");
    } finally {
      setBusy(null);
    }
  }

  async function startDemo() {
    setBusy("demo");
    setError(null);
    setPopupBlocked(false);
    if (window.matchMedia(EXPANDED).matches) {
      try {
        await signIn({ role: "customer", id: DEMO_CUSTOMER });
        nav("/demo");
      } catch {
        setError("Could not start the demo. Is the server running?");
      } finally {
        setBusy(null);
      }
      return;
    }
    const wall = window.open("/wall", "_blank");
    if (!wall) setPopupBlocked(true);
    try {
      await signIn({ role: "customer", id: DEMO_CUSTOMER });
      if (wall) nav("/shop");
    } catch {
      wall?.close();
      setError("Could not start the demo. Is the server running?");
    } finally {
      setBusy(null);
    }
  }

  const pos = new Map<string, Pt>((stores.data?.stores ?? []).map((s) => [s.storeId, project(PRIYA, s)]));
  const loading = personas.isLoading;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-dvh overflow-hidden" style={{ fontFamily: FONT, color: C.label, background: C.land }}>
        {/* Stage: the neighbourhood, introduced once. */}
        <motion.svg className="fixed inset-0 h-dvh w-full" viewBox={`0 0 ${stage.w} ${stage.h}`} aria-hidden
          initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}>
          <g transform={`translate(${stage.tx},${stage.ty}) scale(${stage.s})`}>
            <Basemap />
            <motion.circle cx={HOME.x} cy={HOME.y} fill="#007AFF" fillOpacity={0.05} stroke="#007AFF" strokeOpacity={0.18} strokeDasharray="4 8"
              initial={{ r: 0 }} animate={{ r: 3 * PX_PER_KM }} transition={{ ...soft, delay: 0.5 }} />
            {PLAN_IDS.map((id, i) => pos.get(id) && (
              <motion.path key={id} d={routeD(pos.get(id)!)} fill="none" stroke={C.blue} strokeWidth={4} strokeDasharray="1 10" strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.9 }} transition={{ ...draw, delay: 1.5 + i * 0.15 }} />
            ))}
            <Home />
            {(stores.data?.stores ?? []).map((s, i) => (
              <motion.g key={s.storeId} initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: 0.8 + i * 0.08 }}>
                <Pin at={pos.get(s.storeId)!} name={shortName(s.name)} st={{ tone: hover === s.storeId ? "busy" : "idle" }} />
              </motion.g>
            ))}
          </g>
        </motion.svg>

        {/* The example plan, as a quiet caption beside home. */}
        <AnimatePresence>
          {pos.size > 0 && (
            <motion.div aria-hidden initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...soft, delay: 2.4 }}
              className="pointer-events-none fixed rounded-[14px] bg-white px-3 py-2"
              style={{ left: stage.tx + (HOME.x + 40) * stage.s, top: stage.ty + (HOME.y + 40) * stage.s, boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.12)" }}>
              <p className="text-[17px] font-bold leading-tight tracking-[-0.02em]" style={{ fontVariantNumeric: "tabular-nums" }}>₹1,400</p>
              <p className="text-[12px]" style={{ color: C.secondary }}>3 stores · ₹100 under budget</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The card: story, one primary action, the roles. */}
        <motion.main initial={{ opacity: 0, y: wide ? 0 : 24, x: wide ? -16 : 0 }} animate={{ opacity: 1, x: 0, y: 0 }} transition={{ ...soft, delay: 0.15 }}
          className={wide ? "absolute bottom-4 left-4 top-4 flex w-[420px] flex-col overflow-hidden" : "relative mx-3 mb-3 mt-[40vh] flex flex-col overflow-hidden"}
          style={{ borderRadius: 26, background: "rgba(255,255,255,0.86)", backdropFilter: "blur(30px) saturate(180%)", WebkitBackdropFilter: "blur(30px) saturate(180%)", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06), 0 18px 50px rgba(0,0,0,0.14)" }}>
          <header className="flex items-center gap-2.5 px-6 pt-5">
            <span className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[13px] font-bold text-white" style={{ background: C.green }}>K</span>
            <span className="text-[15px] font-semibold">KiranaAI</span>
            <span className="ml-auto text-[12px] font-medium" style={{ color: C.secondary }}>Beckn / ONDC</span>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: "none", maskImage: "linear-gradient(to bottom, transparent 0, #000 24px)", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 24px)" }}>
            <motion.div initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.07, delayChildren: 0.35 } } }}>
              <motion.h1 variants={rise} transition={soft} className="mt-10 text-[36px] font-bold leading-[1.06] tracking-[-0.03em]">
                Your weekly basket, from the kiranas on your street.
              </motion.h1>
              <motion.p variants={rise} transition={soft} className="mt-3 text-[17px] leading-[1.45]" style={{ color: C.secondary }}>
                Tell the assistant what you need. It compares the shops nearby, builds one basket and comes back with one verified total.
              </motion.p>

              <motion.div variants={rise} transition={soft} className="mt-7">
                <Press onClick={startDemo} busy={busy === "demo"} disabled={busy !== null && busy !== "demo"}
                  className="flex h-[54px] w-full items-center justify-center gap-2 text-[17px] font-semibold text-white" style={{ background: C.label, borderRadius: 16 }}>
                  {busy === "demo" ? <Spinner size={20} color="#fff" /> : "Start the live demo"}
                </Press>
                <p className="mt-2.5 text-[13px] leading-[1.4]" style={{ color: C.secondary }}>
                  {wide ? "Signs you in as Priya and opens the cockpit: the customer, all five stores and the script on one screen." : "Signs you in as Priya and opens the store wall in a second tab."}
                </p>
              </motion.div>

              <AnimatePresence initial={false}>
                {waking && <Note key="wake" tone="neutral"><Spinner size={14} /> Waking the demo server… this takes a few seconds the first time.</Note>}
                {error && <Note key="err" tone="bad">{error}</Note>}
                {personas.isError && !waking && (
                  <Note key="pers" tone="bad">
                    Could not load the demo personas.{" "}
                    <button type="button" className="cursor-pointer font-semibold underline" onClick={() => void personas.refetch()}>Retry</button>
                  </Note>
                )}
                {popupBlocked && (
                  <Note key="pop" tone="neutral">
                    Your browser blocked the store wall. <a className="font-semibold" style={{ color: C.blue }} href="/wall" target="_blank" rel="noreferrer">Open it</a> or{" "}
                    <button type="button" className="cursor-pointer font-semibold" style={{ color: C.blue }} onClick={() => nav("/shop")}>continue to the shop</button>.
                  </Note>
                )}
              </AnimatePresence>

              <motion.ol variants={rise} transition={soft} className="mt-8" aria-label="How it works">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-3.5 py-3" style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined }}>
                    <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold" style={{ background: C.fill, color: C.label }}>{i + 1}</span>
                    <div>
                      <p className="text-[15px] font-semibold">{s.title}</p>
                      <p className="mt-0.5 text-[13px] leading-[1.45]" style={{ color: C.secondary }}>{s.body}</p>
                    </div>
                  </li>
                ))}
              </motion.ol>

              <motion.div variants={rise} transition={soft}>
                <Group title="Shop as a customer">
                  {loading ? <Row label="Loading…" /> : (personas.data?.customers ?? []).map((c) => (
                    <Row key={c.id} label={c.name} busy={busy === c.id} disabled={busy !== null} onClick={() => go(c.id, { role: "customer", id: c.id }, "/shop")} />
                  ))}
                </Group>
                <Group title="Run a store">
                  {loading ? <Row label="Loading…" /> : (personas.data?.stores ?? []).map((s) => (
                    <Row key={s.id} label={s.name} busy={busy === s.id} disabled={busy !== null} onHover={(h) => setHover(h ? s.id : null)}
                      onClick={() => go(s.id, { role: "merchant", id: s.id }, "/merchant")} />
                  ))}
                </Group>
                <Group title="For the presenter">
                  <Row label="Store wall" detail="All five stores, side by side" disabled={busy !== null} onClick={() => nav("/wall")} />
                  <Row label="Admin console" detail="Reset, faults, ledger, audit" disabled={busy !== null} onClick={() => nav("/admin")} />
                </Group>
              </motion.div>
            </motion.div>
          </div>
        </motion.main>
      </div>
    </MotionConfig>
  );
}

const rise = { h: { opacity: 0, y: 12 }, s: { opacity: 1, y: 0 } };

function Note({ tone, children }: { tone: "neutral" | "bad"; children: ReactNode }) {
  return (
    <motion.p role={tone === "bad" ? "alert" : "status"} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={ease}
      className="overflow-hidden text-[13px]" style={{ color: tone === "bad" ? C.red : C.secondary }}>
      <span className="mt-3 flex items-center gap-2 rounded-[12px] px-3 py-2.5" style={{ background: tone === "bad" ? "#FDECEA" : C.fill }}>{children}</span>
    </motion.p>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.tertiary }}>{title}</h2>
      <ul className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.05)" }}>{children}</ul>
    </section>
  );
}

function Row({ label, detail, onClick, busy, disabled, onHover }: { label: string; detail?: string; onClick?: () => void; busy?: boolean; disabled?: boolean; onHover?: (h: boolean) => void }) {
  return (
    <li className="[&+li]:border-t-[0.5px]" style={{ borderColor: C.sep }}>
      <button type="button" onClick={onClick} disabled={disabled || !onClick} onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)} onFocus={() => onHover?.(true)} onBlur={() => onHover?.(false)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.03] disabled:cursor-default disabled:hover:bg-transparent">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px]" style={{ color: onClick ? C.label : C.secondary }}>{label}</span>
          {detail && <span className="block text-[12px]" style={{ color: C.secondary }}>{detail}</span>}
        </span>
        {busy ? <Spinner size={16} /> : onClick && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.tertiary} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
        )}
      </button>
    </li>
  );
}
