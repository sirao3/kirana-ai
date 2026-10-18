import { formatINR } from "../../lib/format";
import { Button, Card, Icon, LinearProgress, StatusLabel, type Tone } from "../m3";
import type { FulfilmentStatus, Order } from "./types";

const STATUS: Record<FulfilmentStatus, { label: string; icon: string; tone: Tone; progress: number }> = {
  ACCEPTED: { label: "Accepted", icon: "thumb_up", tone: "primary", progress: 0.2 },
  PREPARING: { label: "Preparing", icon: "inventory_2", tone: "primary", progress: 0.45 },
  READY: { label: "Ready", icon: "shopping_bag", tone: "primary", progress: 0.65 },
  OUT_FOR_DELIVERY: { label: "Out for delivery", icon: "two_wheeler", tone: "info", progress: 0.85 },
  DELIVERED: { label: "Delivered", icon: "check_circle", tone: "success", progress: 1 },
};
/** The one-click action for each state (PRD MER-08). */
const ADVANCE: Partial<Record<FulfilmentStatus, { label: string; icon: string }>> = {
  ACCEPTED: { label: "Start preparing", icon: "inventory_2" },
  PREPARING: { label: "Mark ready", icon: "shopping_bag" },
  READY: { label: "Out for delivery", icon: "two_wheeler" },
  OUT_FOR_DELIVERY: { label: "Mark delivered", icon: "check_circle" },
};

export function OrderCard({ order, busy, onAdvance, compact }: { order: Order; busy: boolean; onAdvance: () => void; compact?: boolean }) {
  const next = ADVANCE[order.fulfilmentStatus];
  const st = STATUS[order.fulfilmentStatus];
  return (
    <Card variant="outlined" className={compact ? "p-3" : "p-4"} data-testid="order-card">
      <div className="flex items-center justify-between gap-2">
        <p className="type-title-medium tabular-nums text-on-surface">{formatINR(order.totalPaise)}</p>
        <StatusLabel tone={st.tone} icon={st.icon}>{st.label}</StatusLabel>
      </div>
      <LinearProgress value={st.progress} label={`Fulfilment: ${st.label}`} className="my-2" />
      <p className="flex items-center gap-1 type-body-medium text-on-surface">
        <Icon name="person" size={16} className="text-on-surface-variant" />
        {order.buyerName} · <span className="font-mono type-body-small">{order.buyerPhone}</span>
      </p>
      {!compact && (
        <p className="flex items-start gap-1 type-body-small text-on-surface-variant" title={order.buyerAddress}>
          <Icon name="location_on" size={16} className="mt-px" />
          <span className="line-clamp-2">{order.buyerAddress}</span>
        </p>
      )}
      <p className="mt-1 type-body-small text-on-surface-variant">{order.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</p>
      {next && (
        <Button variant="tonal" className="mt-3 w-full" icon={next.icon} loading={busy} onClick={onAdvance}>
          {next.label}
        </Button>
      )}
    </Card>
  );
}
