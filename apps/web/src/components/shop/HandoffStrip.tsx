import { Fragment } from "react";
import type { AttemptStatus, SubOrderView } from "@kiranaai/shared";
import { C, shortName } from "../ui";

const WORD: Record<AttemptStatus, string> = { PENDING: "contacting", OFFERED: "deciding", ACCEPTED: "accepted", REJECTED: "declined", EXPIRED: "no answer" };
const COLOR: Record<AttemptStatus, string> = { PENDING: C.secondary, OFFERED: "#B25E00", ACCEPTED: C.green, REJECTED: C.red, EXPIRED: C.red };

/** Who was asked, in order: "1 Lakshmi declined → 2 Annapurna accepted". Shown only when the order changed hands. */
export function HandoffStrip({ sub }: { sub: SubOrderView }) {
  const attempts = [...sub.attempts].sort((a, b) => a.attemptNo - b.attemptNo);
  if (attempts.length < 2) return null;
  return (
    <ol aria-label="Store handoffs" className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]" style={{ color: C.secondary }}>
      {attempts.map((a, i) => (
        <Fragment key={a.id}>
          {i > 0 && <li aria-hidden style={{ color: C.tertiary }}>→</li>}
          <li title={a.rejectReason ?? undefined}>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{a.attemptNo}/{sub.maxAttempts}</span> {shortName(a.storeName)}{" "}
            <span className="font-semibold" style={{ color: COLOR[a.status] }}>{WORD[a.status]}{a.rejectReason ? ` (${a.rejectReason.toLowerCase()})` : ""}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
