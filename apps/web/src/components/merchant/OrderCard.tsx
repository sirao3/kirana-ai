import { motion } from "motion/react";
import { formatINR } from "../../lib/format";
import { Button, C, cx, soft } from "../ui";
import type { FulfilmentStatus, Order } from "./types";

export const STAGES: FulfilmentStatus[] = ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];
export const STAGE_LABEL: Record<FulfilmentStatus, string> = {
  ACCEPTED: "Accepted", PREPARING: "Packing", READY: "Ready", OUT_FOR_DELIVERY: "On the way", DELIVERED: "Delivered",
};
/** The one next step for each stage (PRD MER-08); same wording as the cockpit pins. */
export const NEXT_STEP: Partial<Record<FulfilmentStatus, string>> = {
  ACCEPTED: "Start packing", PREPARING: "Mark ready", READY: "Out for delivery", OUT_FOR_DELIVERY: "Mark delivered",
};

/** Five thin segments that fill as the order moves on. */
export function StageBar({ status }: { status: FulfilmentStatus }) {
  const n = STAGES.indexOf(status) + 1;
  return (
    <div className="flex gap-1" aria-hidden>
      {STAGES.map((s, i) => (
        <span key={s} className="h-[4px] flex-1 overflow-hidden rounded-full" style={{ background: C.fill }}>
          <motion.span className="block h-full rounded-full" style={{ background: C.green, originX: 0 }} initial={false} animate={{ scaleX: n > i ? 1 : 0 }} transition={soft} />
        </span>
      ))}
    </div>
  );
}

/** An accepted order in progress, as one row of a grouped list: who, what, where it is, and the next step. */
export function OrderRow({ order, busy, onAdvance, compact }: { order: Order; busy: boolean; onAdvance: () => void; compact?: boolean }) {
  const next = NEXT_STEP[order.fulfilmentStatus];
  const step = STAGES.indexOf(order.fulfilmentStatus) + 1;
  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={soft}
      data-testid="order-card" className={cx("[&+li]:border-t-[0.5px]", compact ? "px-3.5 py-3" : "px-4 py-4")} style={{ borderColor: C.sep }}>
      <div className={cx("flex gap-4", compact ? "flex-col gap-2.5" : "flex-col sm:flex-row sm:items-center")}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[15px] font-semibold" style={{ color: C.label }}>{order.buyerName}</p>
            <span className="shrink-0 text-[15px] font-semibold" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{formatINR(order.totalPaise)}</span>
          </div>
          <p className={cx("mt-0.5 text-[13px] leading-[1.4]", compact && "line-clamp-2")} style={{ color: C.secondary }}>{order.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</p>
          {!compact && (
            <p className="mt-0.5 truncate text-[13px]" style={{ color: C.secondary }} title={order.buyerAddress}>
              <a href={`tel:${order.buyerPhone.replace(/\s/g, "")}`} className="underline underline-offset-2" style={{ color: C.link, fontVariantNumeric: "tabular-nums" }}>{order.buyerPhone}</a> · {order.buyerAddress}
            </p>
          )}
          <div className="mt-2.5">
            <StageBar status={order.fulfilmentStatus} />
            <p className="mt-1.5 flex justify-between text-[12px]">
              <span className="font-semibold" style={{ color: C.green }}>{STAGE_LABEL[order.fulfilmentStatus]}</span>
              <span style={{ color: C.tertiary }}>Step {step} of 5</span>
            </p>
          </div>
        </div>
        {next && (
          <Button variant="secondary" busy={busy} onClick={onAdvance} className={compact ? "w-full" : "w-full sm:w-auto sm:min-w-[156px]"}>
            {next}
          </Button>
        )}
      </div>
    </motion.li>
  );
}
