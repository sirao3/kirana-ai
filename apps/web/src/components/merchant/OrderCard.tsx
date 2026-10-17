import { Badge, Button } from "../kit";
import { formatINR } from "../../lib/format";
import type { FulfilmentStatus, Order } from "./types";

const LABEL: Record<FulfilmentStatus, string> = {
  ACCEPTED: "Accepted",
  PREPARING: "Preparing",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
};
/** The one-click action for each state (PRD MER-08). */
const ADVANCE: Partial<Record<FulfilmentStatus, string>> = {
  ACCEPTED: "Start preparing",
  PREPARING: "Mark ready",
  READY: "Out for delivery",
  OUT_FOR_DELIVERY: "Mark delivered",
};

export function OrderCard({ order, busy, onAdvance }: { order: Order; busy: boolean; onAdvance: () => void }) {
  const next = ADVANCE[order.fulfilmentStatus];
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-3" data-testid="order-card">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{formatINR(order.totalPaise)}</p>
        <Badge tone={order.fulfilmentStatus === "DELIVERED" ? "good" : "info"}>{LABEL[order.fulfilmentStatus]}</Badge>
      </div>
      <p className="text-xs text-stone-600">
        {order.buyerName} · <span className="font-mono">{order.buyerPhone}</span>
      </p>
      <p className="truncate text-xs text-stone-500" title={order.buyerAddress}>{order.buyerAddress}</p>
      <p className="mt-1 text-sm text-stone-700">{order.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</p>
      {next && (
        <Button className="mt-2 w-full" disabled={busy} onClick={onAdvance}>{next}</Button>
      )}
    </article>
  );
}
