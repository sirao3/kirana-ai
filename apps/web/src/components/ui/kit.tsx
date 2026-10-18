// KiranaAI design kit, part 1: tokens, springs, SF-style glyphs and small animated primitives (Neighbourhood design).
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform, type Transition } from "motion/react";
import { formatINR } from "../../lib/format";

export const spring: Transition = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 };
export const soft: Transition = { type: "spring", stiffness: 260, damping: 30 };
export const sheet: Transition = { type: "spring", stiffness: 300, damping: 34 };
export const ease: Transition = { duration: 0.24, ease: [0.25, 0.1, 0.25, 1] };
export const draw: Transition = { duration: 0.9, ease: [0.65, 0, 0.35, 1] };

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif';
export const C = {
  bg: "#F5F5F7", label: "#1D1D1F", secondary: "#6E6E73", tertiary: "#AEAEB2", sep: "rgba(60,60,67,0.12)", fill: "#F2F2F7",
  green: "#1F8A3E", red: "#E5372B", orange: "#F08A00", blue: "#007AFF", land: "#F3F1EC",
};
export const glass: CSSProperties = {
  background: "rgba(255,255,255,0.82)",
  backdropFilter: "blur(30px) saturate(180%)",
  WebkitBackdropFilter: "blur(30px) saturate(180%)",
  boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06), 0 18px 50px rgba(0,0,0,0.14)",
};
export const cardShadow = "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.06)";

// ---------- Glyphs ----------

const G = ({ d, size = 20, w = 1.8 }: { d: string; size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
type GP = { size?: number };
export const IArrowUp = (p: GP) => <G {...p} w={2.2} d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />;
export const IMic = (p: GP) => <G {...p} d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />;
export const IStop = (p: GP) => <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>;
export const ISpark = (p: GP) => <G {...p} w={1.6} d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8L4.5 10.8 10.2 9 12 3.5Z" />;
export const IMore = (p: GP) => <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>;
export const ISound = ({ on, size = 16 }: GP & { on: boolean }) => <G size={size} d={on ? "M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" : "M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"} />;
export const IArrowUpRight = (p: GP) => <G {...p} d="M7 17 17 7M9 7h8v8" />;
export const IClose = (p: GP) => <G {...p} w={2} d="M6 6l12 12M18 6 6 18" />;
export const IChevron = (p: GP) => <G {...p} w={2.2} d="m9 6 6 6-6 6" />;
export const IBack = (p: GP) => <G {...p} w={2.2} d="m15 6-6 6 6 6" />;
export const ICheck = (p: GP) => <G {...p} w={2.2} d="M5 12.5 10 17.5 19 7" />;
export const IPlus = (p: GP) => <G {...p} w={2} d="M12 5v14M5 12h14" />;
export const IMinus = (p: GP) => <G {...p} w={2} d="M5 12h14" />;
export const ISearch = (p: GP) => <G {...p} w={2} d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20" />;
export const IBasket = (p: GP) => <G {...p} d="M4 9.5h16l-1.6 9a2 2 0 0 1-2 1.5H7.6a2 2 0 0 1-2-1.5L4 9.5ZM8.5 9.5 12 4l3.5 5.5" />;
export const IReceipt = (p: GP) => <G {...p} d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4v-17ZM9 8h6M9 11.5h6M9 15h3.5" />;
export const IBolt = (p: GP) => <G {...p} d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3Z" />;
export const ICheckCircle = (p: GP) => <G {...p} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12.3l2.7 2.7L16 9.5" />;
export const IWallet = (p: GP) => <G {...p} d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5v10A2.5 2.5 0 0 0 6.5 20H20V8H6.5A2.5 2.5 0 0 1 4 7.5ZM16 14h.01" />;
export const IBox = (p: GP) => <G {...p} d="M4 8l8-4 8 4v8l-8 4-8-4V8ZM4 8l8 4 8-4M12 12v8" />;
export const ISliders = (p: GP) => <G {...p} d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1M16 4v4M10 10v4M18 16v4" />;
export const IBank = (p: GP) => <G {...p} d="M3.5 9.5 12 4l8.5 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3.5 20h17" />;
export const IList = (p: GP) => <G {...p} d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />;
export const IGrid = (p: GP) => <G {...p} d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />;
export const IStore = (p: GP) => <G {...p} d="M4 10v10h16V10M3 10l1.5-5h15L21 10a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0ZM10 20v-5h4v5" />;
export const IPin = (p: GP) => <G {...p} d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />;
export const IUpload = (p: GP) => <G {...p} d="M12 16V4M7 8.5 12 4l5 4.5M5 15v4h14v-4" />;
export const IEye = ({ off, size = 20 }: GP & { off?: boolean }) => <G size={size} d={off ? "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.3-3.2 3.6M6.4 7.6C4.6 8.9 3.3 10.7 2.5 12c1 1.5 4.5 6 9.5 6 1.4 0 2.7-.3 3.8-.9M9.9 9.9a3 3 0 0 0 4.2 4.2" : "M2.5 12c1-1.5 4.5-6 9.5-6s8.5 4.5 9.5 6c-1 1.5-4.5 6-9.5 6s-8.5-4.5-9.5-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"} />;
export const ILogout = (p: GP) => <G {...p} d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16l4-4-4-4M14 12H4" />;
export const IWarning = (p: GP) => <G {...p} d="M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.5h.01" />;
export const IInfo = (p: GP) => <G {...p} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.5h.01" />;
export const IPrint = (p: GP) => <G {...p} d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2M7 14h10v6H7z" />;
export const IDownload = (p: GP) => <G {...p} d="M12 4v12M7 11.5 12 16l5-4.5M5 20h14" />;
export const ITrash = (p: GP) => <G {...p} d="M5 7h14M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />;
export const IRefresh = (p: GP) => <G {...p} d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5" />;

// ---------- Primitives ----------

/** Button with a subtle press compression, never a bounce. */
export function Press({ children, className = "", style, onClick, disabled, label, busy }: {
  children: ReactNode; className?: string; style?: CSSProperties; onClick?: () => void; disabled?: boolean; label?: string; busy?: boolean;
}) {
  return (
    <motion.button type="button" aria-label={label} aria-busy={busy || undefined} disabled={disabled || busy} onClick={onClick}
      whileTap={disabled || busy ? undefined : { scale: 0.97 }} transition={spring}
      className={`cursor-pointer select-none disabled:cursor-default disabled:opacity-50 ${className}`} style={style}>
      {children}
    </motion.button>
  );
}

/** Amount that rolls to its new value. */
export function Money({ value, className, style }: { value: number; className?: string; style?: CSSProperties }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => formatINR(Math.round(v / 100) * 100));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span className={className} style={{ fontVariantNumeric: "tabular-nums", ...style }}>{text}</motion.span>;
}

export function CheckDraw({ size = 22, color = C.green, ring = true }: { size?: number; color?: string; ring?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {ring && <motion.circle cx="12" cy="12" r="10.5" fill={color} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} style={{ transformOrigin: "12px 12px" }} />}
      <motion.path d="M7.2 12.4 10.4 15.6 16.8 8.8" fill="none" stroke={ring ? "#fff" : color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: ring ? 0.12 : 0, duration: 0.32, ease: [0.65, 0, 0.35, 1] }} />
    </svg>
  );
}

export function Spinner({ size = 16, color = C.secondary }: { size?: number; color?: string }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 24 24" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeOpacity={0.2} strokeWidth={2.6} />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    </motion.svg>
  );
}

/** Countdown ring between two ISO times, re-rendered by the caller's clock. */
export function Ring({ from, until, now, size = 34, label = true }: { from: string; until: string; now: number; size?: number; label?: boolean }) {
  const total = Math.max(1, new Date(until).getTime() - new Date(from).getTime());
  const left = Math.max(0, new Date(until).getTime() - now);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const color = left < 8000 ? C.red : left < 15000 ? C.orange : C.green;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.fill} strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, left / total))} style={{ transition: "stroke-dashoffset 250ms linear, stroke 300ms" }} />
      </svg>
      {label && <span className="absolute text-[11px] font-semibold" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{Math.ceil(left / 1000)}</span>}
    </span>
  );
}

/** A shared 4 Hz clock for countdowns. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** First word of a store name: "Sharma General Store" → "Sharma". */
export const shortName = (name: string) => name.split(" ")[0] ?? name;
