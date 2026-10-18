import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AddressView, BasketView, OrderView, SubOrderView } from "@kiranaai/shared";
import { formatINR } from "../../../lib/format";
import { REJECT_REASONS } from "../../merchant/OfferCard";
import { useStore, type StoreState } from "../../merchant/useStore";
import type { StoreToken } from "../../merchant/useWallTokens";
import type { FulfilmentStatus, Offer, Order } from "../../merchant/types";
import { C, Press, Ring, draw, ease, shortName, soft, spring } from "./kit";

/*
 * The neighbourhood map: home in the middle, the real stores placed by their coordinates, routes drawn from the live
 * order, and the store side of the demo (offer callouts, next-step buttons) on the pins. Basemap streets are schematic.
 */

const W = 1600;
const H = 1000;
export const HOME = { x: 760, y: 500 };
export const SHEET_PX = 452; // the customer card + gaps, in screen px
const DX = 190; // shift the map so home sits in the middle of the area beside the card (viewBox units)
export const PX_PER_KM = 133;

export type Pt = { x: number; y: number };

/** lat/lng → viewBox, equirectangular around home (fine at neighbourhood scale). */
export function project(home: { lat: number; lng: number }, p: { lat: number; lng: number }): Pt {
  const kx = 111.32 * Math.cos((home.lat * Math.PI) / 180);
  return { x: HOME.x + (p.lng - home.lng) * kx * PX_PER_KM, y: HOME.y - (p.lat - home.lat) * 110.54 * PX_PER_KM };
}

function useViewport(ref: RefObject<HTMLDivElement | null>) {
  const [vp, setVp] = useState({ s: 1, ox: 0, oy: 0, w: 1440, h: 900 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      const s = Math.max(w / W, h / H);
      setVp({ s, ox: (w - W * s) / 2, oy: (h - H * s) / 2, w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return vp;
}

export function routeD(a: Pt) {
  const mx = (a.x + HOME.x) / 2, my = (a.y + HOME.y) / 2;
  const dx = HOME.x - a.x, dy = HOME.y - a.y;
  return `M${a.x},${a.y} Q${mx - dy * 0.22},${my + dx * 0.22} ${HOME.x},${HOME.y}`;
}

const NEXT: Record<Exclude<FulfilmentStatus, "DELIVERED">, string> = {
  ACCEPTED: "Start packing", PREPARING: "Mark ready", READY: "Out for delivery", OUT_FOR_DELIVERY: "Mark delivered",
};
const STATUS: Record<FulfilmentStatus, string> = { ACCEPTED: "Accepted", PREPARING: "Packing", READY: "Ready", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered" };

export type Tone = "idle" | "offer" | "busy" | "done" | "bad" | "off";
export interface PinState { tone: Tone; text?: string; offer?: Offer; active?: Order }

function pinState(s: StoreState | undefined, storeId: string, order: OrderView | null): PinState {
  const d = s?.d;
  if (!d) return { tone: "idle" };
  if (!d.store.isOnline) return { tone: "off", text: "Offline" };
  const offer = d.offers[0];
  if (offer) return { tone: "offer", offer };
  const active = d.orders.find((o) => o.fulfilmentStatus !== "DELIVERED");
  if (active) return { tone: "busy", text: STATUS[active.fulfilmentStatus], active };
  const mine = order?.subOrders.flatMap((x) => x.attempts).filter((a) => a.storeId === storeId) ?? [];
  if (mine.some((a) => a.status === "ACCEPTED") && d.orders.some((o) => o.fulfilmentStatus === "DELIVERED")) return { tone: "done", text: "Delivered" };
  const lost = mine.find((a) => a.status === "REJECTED" || a.status === "EXPIRED");
  if (lost) return { tone: "bad", text: lost.status === "EXPIRED" ? "Missed the order" : "Declined" };
  return { tone: "idle" };
}

/** Keeps one live useStore per store; the map reads the latest state from the ref on its own 4 Hz render. */
function StoreAgent({ store, into }: { store: StoreToken; into: Map<string, StoreState> }) {
  const s = useStore(store.id, store.token);
  useLayoutEffect(() => {
    into.set(store.id, s);
  });
  return null;
}

type Rect = { x: number; y: number; w: number; h: number };
const area = (r: Rect, o: Rect) => Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) * Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));

export function HoodMap({ address, stores, order, basket, now }: {
  address: AddressView | undefined;
  stores: StoreToken[];
  order: OrderView | null;
  basket: BasketView | undefined;
  now: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vp = useViewport(box);
  const agents = useRef(new Map<string, StoreState>()).current;
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  const pos = new Map<string, Pt>();
  if (address) for (const st of address.stores) pos.set(st.storeId, project(address, st));
  const names = new Map(stores.map((s) => [s.id, s.name]));
  const screen = (p: Pt) => ({ x: vp.ox + (DX + p.x) * vp.s, y: vp.oy + p.y * vp.s });

  const paid = order?.paymentStatus === "PAID";
  const planned = !paid ? (basket?.stores.map((g) => g.storeId) ?? []) : [];
  const states = new Map(stores.map((s) => [s.id, pinState(agents.get(s.id), s.id, order)]));

  // Offer callouts pick the first side that clears the island, the cards, other pins and other callouts.
  const fixed: Rect[] = [
    { x: 0, y: 0, w: SHEET_PX, h: vp.h }, // customer card
    { x: SHEET_PX, y: 0, w: vp.w - SHEET_PX, h: 72 }, // script pill band
    { x: vp.w - 346, y: vp.h - 220, w: 346, h: 220 }, // activity
    (() => { const q = screen(HOME); return { x: q.x - 30, y: q.y - 30, w: 60, h: 70 }; })(),
  ];
  const pinRects = [...pos.entries()].map(([id, p]) => { const q = screen(p); return { id, x: q.x - 22, y: q.y - 22, w: 44, h: 60 }; });
  const callouts: { id: string; rect: Rect; side: "above" | "below" | "left" | "right"; anchor: Pt }[] = [];
  for (const s of stores) {
    const st = states.get(s.id);
    const p = pos.get(s.id);
    if (st?.tone !== "offer" || !p) continue;
    const a = screen(p);
    const cw = 244, ch = reasonFor === st.offer!.id ? 262 : 204;
    const at = (side: "above" | "below" | "left" | "right", dx: number, dy: number) => ({
      side,
      rect: side === "above" ? { x: a.x - cw / 2 + dx, y: a.y - 30 - ch, w: cw, h: ch }
        : side === "below" ? { x: a.x - cw / 2 + dx, y: a.y + 30, w: cw, h: ch }
        : side === "right" ? { x: a.x + 30, y: a.y - ch / 2 + dy, w: cw, h: ch }
        : { x: a.x - 30 - cw, y: a.y - ch / 2 + dy, w: cw, h: ch },
    });
    const cands = [
      at("above", 0, 0), at("right", 0, 0), at("left", 0, 0), at("below", 0, 0),
      at("above", -96, 0), at("above", 96, 0), at("right", 0, -70), at("right", 0, 70), at("left", 0, -70), at("left", 0, 70), at("below", -96, 0), at("below", 96, 0),
    ];
    const inside = (r: Rect) => r.x >= 8 && r.y >= 8 && r.x + r.w <= vp.w - 8 && r.y + r.h <= vp.h - 8;
    // Never cover another callout; avoid the cards and pill; pins only as a last resort. Earlier candidates win ties.
    const cost = (r: Rect) => (inside(r) ? 0 : 1e9)
      + callouts.reduce((t, c) => t + area(r, c.rect) * 100, 0)
      + fixed.reduce((t, f) => t + area(r, f) * 10, 0)
      + pinRects.filter((q) => q.id !== s.id).reduce((t, q) => t + area(r, q), 0);
    const pick = cands.reduce((best, c) => (cost(c.rect) < cost(best.rect) ? c : best), cands[0]!);
    callouts.push({ id: s.id, rect: pick.rect, side: pick.side, anchor: a });
  }

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ background: C.land }}>
      {stores.map((s) => <StoreAgent key={s.id} store={s} into={agents} />)}
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Map of the stores around the customer's home">
        <g transform={`translate(${DX},0)`}>
          <Basemap />
          {address && (
            <motion.circle cx={HOME.x} cy={HOME.y} fill="#007AFF" fillOpacity={0.05} stroke="#007AFF" strokeOpacity={0.18} strokeDasharray="4 8"
              initial={{ r: 0 }} animate={{ r: 3 * PX_PER_KM }} transition={{ ...soft, delay: 0.3 }} />
          )}
          <AnimatePresence>
            {planned.map((id, i) => pos.get(id) && (
              <motion.path key={"plan" + id} d={routeD(pos.get(id)!)} fill="none" stroke="#8E8E93" strokeWidth={3} strokeDasharray="2 9" strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ ...draw, delay: 0.2 + i * 0.12 }} />
            ))}
          </AnimatePresence>
          {paid && order!.subOrders.map((sub) => <Routes key={sub.id} sub={sub} pos={pos} />)}
          <Home />
          {stores.map((s) => pos.get(s.id) && <Pin key={s.id} at={pos.get(s.id)!} name={shortName(s.name)} st={states.get(s.id)!} />)}
          {paid && order!.subOrders.map((sub) => {
            const cur = sub.attempts.at(-1);
            return sub.status === "OUT_FOR_DELIVERY" && cur && pos.get(cur.storeId) ? <Courier key={sub.id + cur.storeId} from={pos.get(cur.storeId)!} /> : null;
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0">
        <AnimatePresence>
          {callouts.map((c) => {
            const st = states.get(c.id)!;
            return (
              <Callout key={st.offer!.id} rect={c.rect} side={c.side} anchor={c.anchor} name={names.get(c.id) ?? c.id} offer={st.offer!} now={now}
                s={agents.get(c.id)} reasonOpen={reasonFor === st.offer!.id} setReasonOpen={(o) => setReasonFor(o ? st.offer!.id : null)} />
            );
          })}
        </AnimatePresence>
        <AnimatePresence>
          {stores.map((s) => {
            const st = states.get(s.id);
            const p = pos.get(s.id);
            if (st?.tone !== "busy" || !st.active || st.active.fulfilmentStatus === "DELIVERED" || !p) return null;
            const a = screen(p);
            const agent = agents.get(s.id);
            const next = NEXT[st.active.fulfilmentStatus];
            // Under the pin's labels, unless that lands on home or a callout; then above the pin.
            const below = { x: a.x - 70, y: a.y + 58, w: 140, h: 30 };
            const top = [fixed[3]!, ...callouts.map((c) => c.rect)].some((r) => area(below, r) > 0) ? a.y - 62 : a.y + 58;
            return (
              <motion.div key={s.id + st.active.fulfilmentStatus} className="pointer-events-auto absolute" style={{ left: a.x, top, x: "-50%" }}
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={soft}>
                <Press onClick={() => void agent?.advance(st.active!.id)} busy={agent?.busy === st.active.id}
                  className="whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold" style={{ color: C.green, boxShadow: "0 0 0 0.5px rgba(0,0,0,0.08), 0 4px 14px rgba(0,0,0,0.14)" }}
                  label={`${next} at ${s.name}`}>
                  {next} →
                </Press>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Routes({ sub, pos }: { sub: SubOrderView; pos: Map<string, Pt> }) {
  return (
    <>
      {sub.attempts.map((a, i) => {
        const p = pos.get(a.storeId);
        if (!p || a.status === "PENDING") return null;
        const last = i === sub.attempts.length - 1;
        const failed = a.status === "REJECTED" || a.status === "EXPIRED";
        const solid = last && a.status === "ACCEPTED";
        const delivered = sub.status === "DELIVERED" && last;
        return (
          <motion.path key={a.id} d={routeD(p)} fill="none" strokeLinecap="round" strokeWidth={solid ? 6 : 4} strokeDasharray={solid ? undefined : "1 10"}
            stroke={failed ? C.red : delivered ? C.green : C.blue}
            initial={{ pathLength: 0, opacity: 1 }}
            animate={failed ? { pathLength: 0, opacity: 0 } : { pathLength: 1, opacity: delivered ? 0.35 : 1 }}
            transition={failed ? { ...draw, delay: 0.5, duration: 0.8 } : draw} />
        );
      })}
    </>
  );
}

export function Home() {
  return (
    <g transform={`translate(${HOME.x},${HOME.y})`}>
      <motion.circle r={46} fill="#007AFF" fillOpacity={0.12} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...soft, delay: 0.2 }} />
      <circle r={13} fill="#fff" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.25))" }} />
      <circle r={9} fill="#007AFF" />
      <text y={36} textAnchor="middle" fontSize={13} fontWeight={600} fill={C.label} stroke="#fff" strokeWidth={4} paintOrder="stroke">Priya</text>
    </g>
  );
}

const PIN_FILL: Record<Tone, string> = { idle: "#FF9F0A", offer: "#FF9500", busy: C.green, done: C.green, bad: "#8E8E93", off: "#C7C7CC" };

export function Pin({ at, name, st }: { at: Pt; name: string; st: PinState }) {
  return (
    <g transform={`translate(${at.x},${at.y})`}>
      {st.tone === "offer" && <motion.circle key={st.offer!.id} r={18} fill="none" stroke="#FF9500" strokeWidth={3} initial={{ scale: 1, opacity: 0.8 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 1.1, ease: "easeOut" }} />}
      <motion.g animate={{ scale: st.tone === "idle" || st.tone === "off" ? 1 : 1.18 }} transition={spring}>
        <circle r={17} fill="#fff" style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.22))" }} />
        <motion.circle r={14} animate={{ fill: PIN_FILL[st.tone] }} transition={{ duration: 0.3 }} />
        {st.tone === "done" ? (
          <motion.path d="M-5.5 0.5 -1.5 4.5 6 -4" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} />
        ) : st.tone === "bad" ? (
          <path d="M-4.5 -4.5 4.5 4.5M4.5 -4.5 -4.5 4.5" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        ) : (
          <path d="M-6 -2.5h12l-1.2 8.5h-9.6z M-3 -2.5a3 3 0 0 1 6 0" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
        )}
      </motion.g>
      <text y={38} textAnchor="middle" fontSize={13} fontWeight={600} fill={C.label} stroke={C.land} strokeWidth={4} paintOrder="stroke">{name}</text>
      <AnimatePresence>
        {st.text && (
          <motion.text key={st.text} y={54} textAnchor="middle" fontSize={12} fill={st.tone === "bad" ? C.red : C.secondary} stroke={C.land} strokeWidth={4} paintOrder="stroke"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={ease}>{st.text}</motion.text>
        )}
      </AnimatePresence>
    </g>
  );
}

/** Travels most of the way home, then waits for the store to mark it delivered. */
function Courier({ from }: { from: Pt }) {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGGElement>(null);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const p = path.current, d = dot.current;
      if (p && d) {
        const t = Math.min(1, (performance.now() - t0) / 6000);
        const e = 1 - (1 - t) ** 3;
        const pt = p.getPointAtLength(p.getTotalLength() * 0.86 * e);
        d.setAttribute("transform", `translate(${pt.x},${pt.y})`);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <path ref={path} d={routeD(from)} fill="none" stroke="none" />
      <g ref={dot} transform={`translate(${from.x},${from.y})`}>
        <circle r={11} fill="#fff" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" }} />
        <circle r={7.5} fill={C.blue} />
      </g>
    </>
  );
}

function Callout({ rect, side, anchor, name, offer, now, s, reasonOpen, setReasonOpen }: {
  rect: Rect; side: "above" | "below" | "left" | "right"; anchor: Pt; name: string; offer: Offer; now: number; s: StoreState | undefined;
  reasonOpen: boolean; setReasonOpen: (o: boolean) => void;
}) {
  const [reason, setReason] = useState(REJECT_REASONS[0]!);
  const silent = !!s?.d?.store.faults.neverAnswer;
  const busy = s?.busy === offer.id;
  const origin = { above: "50% 100%", below: "50% 0%", left: "100% 50%", right: "0% 50%" }[side];
  const tail: React.CSSProperties = side === "above" ? { left: anchor.x - rect.x - 8, bottom: -7 }
    : side === "below" ? { left: anchor.x - rect.x - 8, top: -7 }
    : side === "right" ? { top: anchor.y - rect.y - 8, left: -7 } : { top: anchor.y - rect.y - 8, right: -7 };
  return (
    <motion.div role="alertdialog" aria-label={`New order for ${name}`} className="pointer-events-auto absolute" style={{ left: rect.x, top: rect.y, width: rect.w, transformOrigin: origin }}
      initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1, left: rect.x, top: rect.y }} exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }} transition={spring}>
      <div className="relative rounded-[18px] bg-white p-3.5" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06), 0 14px 36px rgba(0,0,0,0.18)" }}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: "#C76A00" }}>New order</p>
            <p className="truncate text-[15px] font-semibold" style={{ color: C.label }}>{name}</p>
            <p className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: C.secondary }}>{offer.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</p>
          </div>
          <Ring from={offer.offeredAt} until={offer.expiresAt} now={now} />
        </div>
        <p className="mt-2 text-[13px]" style={{ color: C.secondary }}>
          You get <b style={{ color: C.label }}>{formatINR(offer.totalPaise)}</b> · {(offer.distanceM / 1000).toFixed(1)} km · paid upfront
        </p>
        {silent ? (
          <p className="mt-3 rounded-[11px] px-3 py-2 text-[12px]" style={{ background: C.fill, color: C.secondary }}>This store is set to never answer (demo fault). The offer will time out.</p>
        ) : reasonOpen ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Reason">
              {REJECT_REASONS.slice(0, 4).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
                  className="cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-medium" style={reason === r ? { background: C.label, color: "#fff" } : { background: C.fill, color: C.label }}>{r}</button>
              ))}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Press onClick={() => setReasonOpen(false)} className="h-9 rounded-[11px] text-[14px] font-semibold" style={{ background: C.fill, color: C.label }}>Back</Press>
              <Press onClick={() => { void s?.reject(offer.id, reason); setReasonOpen(false); }} busy={busy} className="h-9 rounded-[11px] text-[14px] font-semibold text-white" style={{ background: C.red }}>Decline</Press>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Press onClick={() => setReasonOpen(true)} disabled={busy} className="h-9 rounded-[11px] text-[14px] font-semibold" style={{ background: C.fill, color: C.red }}>Decline</Press>
            <Press onClick={() => void s?.accept(offer.id)} busy={busy} className="h-9 rounded-[11px] text-[14px] font-semibold text-white" style={{ background: C.green }}>Accept</Press>
          </div>
        )}
        <span className="absolute h-4 w-4 rotate-45 bg-white" style={tail} />
      </div>
    </motion.div>
  );
}

/** Light basemap in the Apple Maps palette. Streets are schematic, not survey-accurate. */
export function Basemap() {
  const majors = [
    { id: "r1", d: "M700,-40 C720,300 690,620 745,1040", name: "100 Feet Road" },
    { id: "r2", d: "M120,400 C640,430 1000,380 1660,300", name: "CMH Road" },
    { id: "r3", d: "M240,1040 C690,830 1110,820 1660,760", name: "Old Airport Road", arterial: true },
    { id: "r4", d: "M1010,-40 C990,300 1100,600 1250,1040", name: "HAL 2nd Stage Road" },
  ];
  return (
    <g>
      <rect x={-400} y={-200} width={W + 600} height={H + 400} fill={C.land} />
      <g transform={`rotate(-8 ${W / 2} ${H / 2})`} stroke="#FFFFFF" strokeWidth={7} opacity={0.95}>
        {Array.from({ length: 16 }, (_, i) => <line key={"h" + i} x1={-500} x2={W + 300} y1={-100 + i * 82} y2={-100 + i * 82} />)}
        {Array.from({ length: 22 }, (_, i) => <line key={"v" + i} y1={-300} y2={H + 300} x1={-400 + i * 104} x2={-400 + i * 104} />)}
      </g>
      <rect x={880} y={545} width={190} height={120} rx={26} fill="#D5EBC6" />
      <rect x={380} y={140} width={170} height={110} rx={24} fill="#D5EBC6" />
      <ellipse cx={1290} cy={110} rx={170} ry={90} fill="#AAD3F2" />
      <text x={1290} y={114} textAnchor="middle" fontSize={13} fontStyle="italic" fill="#5D8FB8">Ulsoor Lake</text>
      {majors.map((r) => <path key={r.id + "c"} d={r.d} fill="none" stroke={r.arterial ? "#F1D77F" : "#E3DED4"} strokeWidth={20} strokeLinecap="round" />)}
      {majors.map((r) => <path key={r.id} id={r.id} d={r.d} fill="none" stroke={r.arterial ? "#FCE9A8" : "#FFFFFF"} strokeWidth={15} strokeLinecap="round" />)}
      {majors.map((r) => <text key={r.id + "t"} fontSize={12} fill="#8A857C" letterSpacing={0.4} dy={4}><textPath href={`#${r.id}`} startOffset="62%">{r.name}</textPath></text>)}
      {([["INDIRANAGAR", 900, 330], ["DOMLUR", 1040, 905], ["HAL 2ND STAGE", 420, 470], ["DEFENCE COLONY", 975, 610]] as const).map(([t, x, y]) => (
        <text key={t} x={x} y={y} textAnchor="middle" fontSize={12} fontWeight={600} letterSpacing={3} fill="#A8A296">{t}</text>
      ))}
    </g>
  );
}
