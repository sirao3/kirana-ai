import { useEffect, useState } from "react";
import { cx } from "./core";

/** Countdown ring: the arc drains from offeredAt to expiresAt; the number is whole seconds left. Turns to the error role under 10 s. */
export function CountdownRing({ offeredAt, expiresAt, size = 56 }: { offeredAt: string; expiresAt: string; size?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(1, new Date(expiresAt).getTime() - new Date(offeredAt).getTime());
  const leftMs = Math.max(0, new Date(expiresAt).getTime() - now);
  const frac = Math.min(1, leftMs / total);
  const stroke = size > 48 ? 6 : 4;
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const urgent = leftMs < 10_000;
  const secs = Math.ceil(leftMs / 1000);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={`${secs} seconds left to answer`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={urgent ? "stroke-error-container" : "stroke-secondary-container"} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
          className={cx("transition-[stroke-dashoffset] duration-300 ease-linear", urgent ? "stroke-error" : "stroke-primary")}
        />
      </svg>
      <span className={cx("absolute inset-0 flex flex-col items-center justify-center tabular-nums leading-none", urgent ? "text-error" : "text-on-surface")} aria-hidden>
        <span className={size > 48 ? "type-title-medium" : "type-label-large"}>{secs}</span>
        {size > 48 && <span className="type-label-small text-on-surface-variant">sec</span>}
      </span>
    </div>
  );
}
