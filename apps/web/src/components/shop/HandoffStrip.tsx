import { Fragment, useRef } from "react";
import type { AttemptStatus, AttemptView, SubOrderView } from "@kiranaai/shared";
import { cx, Icon } from "../m3";
import { CountdownRing } from "../m3/CountdownRing";

const LOOK: Record<AttemptStatus, { chip: string; icon: string; word: string }> = {
  PENDING: { chip: "bg-tertiary-container text-on-tertiary-container", icon: "sync", word: "contacting" },
  OFFERED: { chip: "bg-tertiary-container text-on-tertiary-container", icon: "timer", word: "offer live" },
  ACCEPTED: { chip: "bg-primary text-on-primary", icon: "check", word: "accepted" },
  REJECTED: { chip: "bg-error-container text-on-error-container", icon: "close", word: "declined" },
  EXPIRED: { chip: "bg-warning-container text-on-warning-container", icon: "timer_off", word: "no response" },
};

function Chip({ a, max, fresh }: { a: AttemptView; max: number; fresh: boolean }) {
  const look = LOOK[a.status];
  const sub = a.status === "REJECTED" ? (a.rejectReason ?? "Declined") : a.status === "EXPIRED" ? "No response" : a.status === "ACCEPTED" ? "Accepted" : a.status === "OFFERED" ? "Deciding" : "Contacting";
  return (
    <li
      className={cx("flex min-h-12 min-w-0 items-center gap-2 rounded-full py-1 pl-2 pr-4", look.chip, fresh && "motion-safe:animate-scale-in")}
      title={`${a.storeName}: ${look.word}${a.rejectReason ? ` (${a.rejectReason})` : ""}`}
    >
      {a.status === "OFFERED" && a.expiresAt ? (
        <CountdownRing offeredAt={a.createdAt} expiresAt={a.expiresAt} size={32} />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface/30">
          <Icon name={look.icon} size={20} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate type-label-large">{a.storeName}</span>
        <span className="block truncate type-label-small opacity-90">{sub} · {a.attemptNo}/{max}</span>
      </span>
    </li>
  );
}

/** One chip per dispatch attempt, joined by arrows: who was asked, who let go, who has it now. */
export function HandoffStrip({ sub }: { sub: SubOrderView }) {
  const attempts = [...sub.attempts].sort((a, b) => a.attemptNo - b.attemptNo);
  // Chips present on first render are static; ones that arrive later animate in.
  const initial = useRef(new Set(attempts.map((a) => a.id)));
  const dispatching = !attempts.some((a) => a.status === "ACCEPTED") && sub.status === "DISPATCHING";
  const empty = dispatching ? Array.from({ length: Math.max(0, sub.maxAttempts - attempts.length) }, (_, i) => attempts.length + i + 1) : [];
  if (attempts.length === 0 && !dispatching) return null;
  return (
    <ol aria-label="Store handoffs" className="flex flex-wrap items-center gap-x-1 gap-y-2 px-4 pb-3">
      {attempts.map((a, i) => (
        <Fragment key={a.id}>
          {i > 0 && <li aria-hidden className="flex text-on-surface-variant"><Icon name="arrow_forward" size={16} /></li>}
          <Chip a={a} max={sub.maxAttempts} fresh={!initial.current.has(a.id)} />
        </Fragment>
      ))}
      {empty.map((n, i) => (
        <Fragment key={`empty-${n}`}>
          {(attempts.length > 0 || i > 0) && <li aria-hidden className="flex text-outline"><Icon name="arrow_forward" size={16} /></li>}
          <li className="flex min-h-12 items-center rounded-full border border-dashed border-outline-variant px-4 type-label-medium text-on-surface-variant">
            attempt {n}/{sub.maxAttempts}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
