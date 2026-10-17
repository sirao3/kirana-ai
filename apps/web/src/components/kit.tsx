import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { secondsUntil } from "../lib/format";

// Shared UI kit. Add new shared components as new files in components/ rather than editing this one.

type Tone = "primary" | "secondary" | "danger" | "ghost";
const TONES: Record<Tone, string> = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-700",
  secondary: "bg-white text-stone-900 border border-stone-300 hover:bg-stone-50",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
  ghost: "text-stone-700 hover:bg-stone-100",
};

export function Button({ tone = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${TONES[tone]} ${className}`}
      {...rest}
    />
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const BADGES = {
  neutral: "bg-stone-100 text-stone-700",
  good: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-rose-100 text-rose-800",
  info: "bg-sky-100 text-sky-800",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGES[tone]}`}>{children}</span>;
}

/** Live "mm:ss" countdown to an ISO time; calls onDone once at zero. */
export function Countdown({ until, onDone }: { until: string | null; onDone?: () => void }) {
  const [left, setLeft] = useState(() => secondsUntil(until));
  useEffect(() => {
    setLeft(secondsUntil(until));
    const t = setInterval(() => {
      const s = secondsUntil(until);
      setLeft(s);
      if (s === 0) {
        clearInterval(t);
        onDone?.();
      }
    }, 250);
    return () => clearInterval(t);
  }, [until, onDone]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return <span className="font-mono tabular-nums">{mm}:{ss}</span>;
}
