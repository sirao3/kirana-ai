import { Link } from "react-router-dom";
import { motion } from "motion/react";
import type { OrderView } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { Button, C, IChevron, Skeleton, Spinner, StatusText, soft } from "../ui";
import { errorMessage } from "./errors";
import { orderPriceProtected } from "./handoff";
import { OrderDetail, orderSummary } from "./OrderDetail";
import { LINK } from "./tokens";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Orders, newest first: total and stores, when, and the status in words. */
export function OrdersList({ orders, error, onRetry, onShop }: { orders: OrderView[] | undefined; error: unknown; onRetry: () => void; onShop: () => void }) {
  if (!orders) {
    return error ? (
      <p role="alert" className="px-1 pt-4 text-[15px]" style={{ color: C.red }}>
        Could not load your orders: {errorMessage(error)}{" "}
        <button type="button" onClick={onRetry} className="cursor-pointer font-semibold" style={{ color: LINK }}>Retry</button>
      </p>
    ) : (
      <div className="space-y-2 pt-4" role="status" aria-label="Loading orders">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[64px] w-full" style={{ borderRadius: 14 }} />)}
      </div>
    );
  }
  if (!orders.length) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <p className="text-[17px] font-semibold" style={{ color: C.label }}>No orders yet</p>
        <p className="mt-1 max-w-xs text-[15px] leading-[1.45]" style={{ color: C.secondary }}>Paid orders show up here, with every store followed live on the map.</p>
        <Button className="mt-4" onClick={onShop}>Start shopping</Button>
      </div>
    );
  }
  const sorted = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <motion.ul initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.04 } } }} aria-label="Your orders"
      className="mt-3 overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.03)" }}>
      {sorted.map((o, i) => {
        const s = orderSummary(o);
        return (
          <motion.li key={o.basketId} variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }} transition={soft} style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined }}>
            <Link to={`/shop/orders/${o.basketId}`} className="flex min-h-[64px] items-center gap-3 py-2.5 pl-4 pr-3 transition-colors hover:bg-black/[0.025] active:bg-black/[0.05]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>
                  {formatINR(o.grandTotalPaise)} <span className="font-normal" style={{ color: C.secondary }}>· {o.subOrders.length} store{o.subOrders.length === 1 ? "" : "s"}</span>
                </span>
                <span className="block truncate text-[13px]" style={{ color: C.secondary }}>{when(o.createdAt)}{orderPriceProtected(o) ? " · price protected" : ""}</span>
              </span>
              <StatusText tone={s.tone}>{s.label}</StatusText>
              <span style={{ color: C.tertiary }}><IChevron size={14} /></span>
            </Link>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

export function OrderPage({ order, error, onRetry, now }: { order: OrderView | undefined; error: unknown; onRetry: () => void; now: number }) {
  if (order) return <div className="pt-3"><OrderDetail order={order} now={now} full /></div>;
  return error ? (
    <p role="alert" className="px-1 pt-4 text-[15px]" style={{ color: C.red }}>
      Could not load this order: {errorMessage(error)}{" "}
      <button type="button" onClick={onRetry} className="cursor-pointer font-semibold" style={{ color: LINK }}>Retry</button>
    </p>
  ) : <p className="flex items-center gap-2 px-1 pt-6 text-[15px]" style={{ color: C.secondary }}><Spinner /> Loading order…</p>;
}
