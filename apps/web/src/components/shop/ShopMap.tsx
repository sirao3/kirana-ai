import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AddressView, BasketView, OrderView, SubOrderView } from "@kiranaai/shared";
import { Basemap, HOME, PX_PER_KM, Pin, project, routeD, type PinState, type Pt } from "../demo/hood/HoodMap";
import { C, draw, ease, shortName, soft } from "../ui";

/*
 * The customer's neighbourhood as the stage behind the card: home, the delivery radius, every store (dimmed when it
 * doesn't deliver here), dashed routes to the basket's stores, and once an order is paid one route per dispatch attempt
 * (declined / expired retract, accepted is solid, delivered fades, a courier on OUT_FOR_DELIVERY). Customer data only:
 * the order's attempts, never a merchant API.
 */

const STAGE: Record<string, string> = { ACCEPTED: "Accepted", PREPARING: "Packing", READY: "Ready", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered" };

function pinFor(storeId: string, delivers: boolean, order: OrderView | null, basketIds: Set<string>): PinState {
  if (order?.paymentStatus === "PAID") {
    const sub = order.subOrders.find((s) => s.attempts.at(-1)?.storeId === storeId);
    const a = sub?.attempts.at(-1);
    if (sub && a) {
      // PinState.offer only keys the one-off ripple; an attempt id is enough for that.
      if (a.status === "OFFERED" || a.status === "PENDING") return { tone: "offer", offer: { id: a.id } as PinState["offer"], text: "Deciding" };
      if (a.status === "ACCEPTED") return sub.status === "DELIVERED" ? { tone: "done", text: "Delivered" } : { tone: "busy", text: STAGE[sub.status] };
    }
    const lost = order.subOrders.flatMap((s) => s.attempts).find((x) => x.storeId === storeId && (x.status === "REJECTED" || x.status === "EXPIRED"));
    if (lost) return { tone: "bad", text: lost.status === "EXPIRED" ? "Didn't answer" : "Declined" };
    if (!delivers) return { tone: "off", text: "Too far" };
    return { tone: "idle" };
  }
  if (!delivers) return { tone: "off", text: "Too far" };
  return { tone: basketIds.has(storeId) ? "busy" : "idle" };
}

export function ShopMap({ address, basket, order, wide, name, visible = 1 }: {
  /** Share of the map box's height not covered by the phone sheet; home is centred in it. */
  visible?: number;
  address: AddressView | undefined;
  basket: BasketView | undefined;
  order: OrderView | null;
  wide: boolean;
  /** Label under the home marker. */
  name: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1440, h: 900 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stores = address?.stores ?? [];
  const pos = new Map<string, Pt>(address ? stores.map((s) => [s.storeId, project(address, s)]) : []);
  const radius = 3 * PX_PER_KM; // the same 3 km neighbourhood ring as the cockpit; each store's own radius decides "Too far"

  // Fit home and the stores (and the radius ring on wide screens) into the area beside or above the card.
  const region = wide ? { x: 452, y: 0, w: size.w - 452, h: size.h } : { x: 0, y: 0, w: size.w, h: size.h - 28 };
  // Fit the stores, not the ring: the ring may run off the stage, the pins may not.
  const far = Math.max(wide ? 260 : 160, ...[...pos.values()].map((p) => Math.hypot(p.x - HOME.x, p.y - HOME.y) + 70));
  const s = Math.min(wide ? 1.2 : 1, Math.max(0.2, (Math.min(region.w, region.h) / 2 - (wide ? 40 : 16)) / far));
  const k = Math.max(1, (wide ? 0.95 : 0.8) / s); // markers keep a legible screen size at any zoom
  const tx = region.x + region.w / 2 - HOME.x * s;
  const ty = region.y + (region.h * visible) / 2 - HOME.y * s;

  const paid = order?.paymentStatus === "PAID";
  const basketIds = new Set(basket?.stores.map((g) => g.storeId) ?? []);
  const planned = paid ? [] : [...basketIds];
  const delivering = stores.filter((x) => x.delivers).length;
  const summary = address
    ? `Map of ${stores.length} stores around ${address.label}. ${delivering} deliver here.${planned.length ? ` Basket from ${planned.length} store${planned.length === 1 ? "" : "s"}.` : ""}`
    : "Map of the stores around your address";
  const scaled = (p: Pt) => `translate(${p.x} ${p.y}) scale(${k}) translate(${-p.x} ${-p.y})`;

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ background: C.land }}>
      <svg className="absolute inset-0 h-full w-full" role="img" aria-label={summary}>
        {/* CSS transform (not motion's SVG transform) so the origin is the view box corner; eases to a new address. */}
        <g className="transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformBox: "view-box", transformOrigin: "0 0" }}>
          <Basemap />
          {address && (
            <motion.circle cx={HOME.x} cy={HOME.y} fill="#007AFF" fillOpacity={0.05} stroke="#007AFF" strokeOpacity={0.22} strokeDasharray="4 8" vectorEffect="non-scaling-stroke"
              initial={{ r: 0 }} animate={{ r: radius }} transition={{ ...soft, delay: 0.3 }} />
          )}
          <AnimatePresence>
            {planned.map((id, i) => pos.get(id) && (
              <motion.path key={"plan" + id} d={routeD(pos.get(id)!)} fill="none" stroke="#8E8E93" strokeWidth={3 * k} strokeDasharray={`${2 * k} ${9 * k}`} strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ ...draw, delay: 0.2 + i * 0.12 }} />
            ))}
          </AnimatePresence>
          {paid && order!.subOrders.map((sub) => <Routes key={order!.basketId + sub.id} sub={sub} pos={pos} k={k} />)}
          <g transform={scaled(HOME)}><Home name={name} /></g>
          {stores.map((st) => pos.get(st.storeId) && (
            <motion.g key={st.storeId} initial={{ opacity: 0 }} animate={{ opacity: st.delivers || paid ? 1 : 0.55 }} transition={ease}>
              <g transform={scaled(pos.get(st.storeId)!)}><Pin at={pos.get(st.storeId)!} name={shortName(st.name)} st={pinFor(st.storeId, st.delivers, order, basketIds)} /></g>
            </motion.g>
          ))}
          {paid && order!.subOrders.map((sub) => {
            const cur = sub.attempts.at(-1);
            return sub.status === "OUT_FOR_DELIVERY" && cur && pos.get(cur.storeId) ? <Courier key={sub.id + cur.storeId} from={pos.get(cur.storeId)!} k={k} /> : null;
          })}
        </g>
      </svg>
    </div>
  );
}

function Routes({ sub, pos, k }: { sub: SubOrderView; pos: Map<string, Pt>; k: number }) {
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
          <motion.path key={a.id} d={routeD(p)} fill="none" strokeLinecap="round" strokeWidth={(solid ? 6 : 4) * k} strokeDasharray={solid ? undefined : `${k} ${10 * k}`}
            stroke={failed ? C.red : delivered ? C.green : C.blue}
            initial={{ pathLength: 0, opacity: 1 }}
            animate={failed ? { pathLength: 0, opacity: 0 } : { pathLength: 1, opacity: delivered ? 0.35 : 1 }}
            transition={failed ? { ...draw, delay: 0.5, duration: 0.8 } : draw} />
        );
      })}
    </>
  );
}

function Home({ name }: { name: string }) {
  return (
    <g transform={`translate(${HOME.x},${HOME.y})`}>
      <motion.circle r={46} fill="#007AFF" fillOpacity={0.12} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...soft, delay: 0.2 }} />
      <circle r={13} fill="#fff" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.25))" }} />
      <circle r={9} fill="#007AFF" />
      <text y={36} textAnchor="middle" fontSize={13} fontWeight={600} fill={C.label} stroke="#fff" strokeWidth={4} paintOrder="stroke">{name}</text>
    </g>
  );
}

/** Travels most of the way home, then waits for the store to mark it delivered. */
function Courier({ from, k }: { from: Pt; k: number }) {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGGElement>(null);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const p = path.current, d = dot.current;
      if (p && d) {
        const t = Math.min(1, (performance.now() - t0) / 6000);
        const pt = p.getPointAtLength(p.getTotalLength() * 0.86 * (1 - (1 - t) ** 3));
        d.setAttribute("transform", `translate(${pt.x},${pt.y}) scale(${k})`);
      }
      if (t0 + 6000 > performance.now()) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [k]);
  return (
    <>
      <path ref={path} d={routeD(from)} fill="none" stroke="none" />
      <g ref={dot} transform={`translate(${from.x},${from.y}) scale(${k})`}>
        <circle r={11} fill="#fff" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" }} />
        <circle r={7.5} fill={C.blue} />
      </g>
    </>
  );
}
