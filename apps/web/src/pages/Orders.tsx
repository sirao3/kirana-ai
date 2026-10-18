import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { OrderView } from "@kiranaai/shared";
import { formatINR } from "../lib/format";
import { useLive } from "../lib/live";
import { EXPANDED, useMedia } from "../lib/useMedia";
import { useRequireSession } from "../lib/useSession";
import { Button, CircularProgress, cx, EmptyState, Icon, IconButton, InlineMessage, StatusLabel } from "../components/m3";
import { bap } from "../components/shop/bap";
import { CustomerShell } from "../components/shop/CustomerShell";
import { errorMessage } from "../components/shop/errors";
import { orderPriceProtected } from "../components/shop/handoff";
import { OrderDetail, orderSummary } from "../components/shop/OrderDetail";

function OrderList({ orders, selected }: { orders: OrderView[]; selected?: string }) {
  return (
    <ul aria-label="Your orders">
      {orders.map((o) => {
        const s = orderSummary(o);
        const sel = o.basketId === selected;
        return (
          <li key={o.basketId}>
            <Link
              to={`/shop/orders/${o.basketId}`}
              aria-current={sel ? "page" : undefined}
              className={cx("state-layer flex min-h-[72px] items-center gap-4 rounded-lg px-4 py-3", sel ? "bg-secondary-container text-on-secondary-container" : "text-on-surface")}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant">
                <Icon name="receipt_long" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block type-body-large tabular-nums">
                  {formatINR(o.grandTotalPaise)} · {o.subOrders.length} store{o.subOrders.length === 1 ? "" : "s"}
                </span>
                <span className="block truncate type-body-medium text-on-surface-variant">
                  {new Date(o.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </span>
                {orderPriceProtected(o) && <StatusLabel tone="success" icon="shield" className="mt-1">Price protected</StatusLabel>}
              </span>
              <StatusLabel tone={s.tone} icon={s.icon}>{s.label}</StatusLabel>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ id }: { id: string }) {
  const q = useLive(["order", id], () => bap.order(id));
  if (q.data) return <OrderDetail order={q.data} />;
  if (q.isError)
    return (
      <InlineMessage tone="error" action={<Button variant="text" onClick={() => void q.refetch()}>Retry</Button>}>
        Could not load this order: {errorMessage(q.error)}
      </InlineMessage>
    );
  return (
    <div className="flex items-center gap-3 py-8 type-body-medium text-on-surface-variant">
      <CircularProgress size={20} className="text-primary" /> Loading order…
    </div>
  );
}

/** Orders destination: list-detail. ≥840 px shows both panes; below that, one pane at a time with Back. Detail polls every second. */
export function Orders() {
  const session = useRequireSession("customer");
  const { id } = useParams();
  const nav = useNavigate();
  const wide = useMedia(EXPANDED);
  const orders = useQuery({ queryKey: ["orders"], queryFn: bap.orders, enabled: !!session, refetchInterval: 5000 });
  if (!session) return null;

  const list = orders.data ? (
    orders.data.length ? (
      <OrderList orders={orders.data} selected={id} />
    ) : (
      <EmptyState icon="receipt_long" title="No orders yet" action={<Button variant="tonal" icon="shopping_basket" onClick={() => nav("/shop")}>Start shopping</Button>}>
        Paid orders show up here with live tracking for every store.
      </EmptyState>
    )
  ) : orders.isError ? (
    <InlineMessage tone="error">Could not load your orders: {errorMessage(orders.error)}</InlineMessage>
  ) : (
    <div className="flex items-center gap-3 p-4 type-body-medium text-on-surface-variant">
      <CircularProgress size={20} className="text-primary" /> Loading orders…
    </div>
  );

  const showDetailOnly = !wide && !!id;

  return (
    <CustomerShell
      session={session}
      active="orders"
      title={showDetailOnly ? "Order" : "Orders"}
      leading={showDetailOnly ? <IconButton icon="arrow_back" label="Back to orders" className="mx-1" onClick={() => nav("/shop/orders")} /> : undefined}
    >
      <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-8 sm:px-6">
        {wide ? (
          <div className="flex gap-6">
            <section aria-label="Orders" className="sticky top-16 max-h-[calc(100dvh-80px)] w-[360px] shrink-0 self-start overflow-y-auto">
              {list}
            </section>
            <section aria-label="Order detail" className="min-w-0 max-w-3xl flex-1">
              {id ? (
                <Detail id={id} />
              ) : (
                <EmptyState icon="touch_app" title="Select an order" className="rounded-xl bg-surface-container-low">
                  Pick an order on the left to follow each store live.
                </EmptyState>
              )}
            </section>
          </div>
        ) : showDetailOnly ? (
          <div className="mx-auto max-w-3xl">
            <Detail id={id!} />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">{list}</div>
        )}
      </div>
    </CustomerShell>
  );
}
