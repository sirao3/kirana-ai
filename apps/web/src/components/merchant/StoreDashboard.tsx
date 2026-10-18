import { useState, type KeyboardEvent } from "react";
import { Button, CircularProgress, cx, Icon, InlineMessage, StatusLabel, Switch } from "../m3";
import { OfferCard } from "./OfferCard";
import { OrderCard } from "./OrderCard";
import { useStore, type StoreState } from "./useStore";

/** Fault-injection labels shown next to a store name. */
export function FaultLabels({ faults }: { faults: { autoReject: boolean; neverAnswer: boolean } }) {
  if (!faults.autoReject && !faults.neverAnswer) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {faults.autoReject && <StatusLabel tone="warning" icon="block">Auto-reject</StatusLabel>}
      {faults.neverAnswer && <StatusLabel tone="warning" icon="phone_disabled">Never answers</StatusLabel>}
    </span>
  );
}

export function OnlineSwitch({ s, compact }: { s: StoreState; compact?: boolean }) {
  const online = !!s.d?.store.isOnline;
  return (
    <Switch
      checked={online}
      busy={s.busy === "online"}
      onChange={() => void s.toggleOnline()}
      label={online ? "Online" : "Offline"}
      hideLabel={compact}
      className={compact ? undefined : "pr-1"}
      labelClassName="max-sm:sr-only"
    />
  );
}

function ColumnHeading({ title, count, icon }: { title: string; count: number; icon: string }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 type-title-small text-on-surface-variant">
      <Icon name={icon} size={20} />
      {title}
      {count > 0 && <span className="rounded-full bg-secondary-container px-2 type-label-medium text-on-secondary-container">{count}</span>}
    </h3>
  );
}

/** Offers (most urgent) and in-progress orders. Two columns on wide windows; one stack on the wall tiles. */
export function LiveBoard({ s, compact = false, dense = false, rejectRequest }: { s: StoreState; compact?: boolean; /** Cockpit tiles: empty sections collapse to one line so five stores fit a screen. */ dense?: boolean; rejectRequest?: number }) {
  const d = s.d!;
  const online = d.store.isOnline;
  const active = d.orders.filter((o) => o.fulfilmentStatus !== "DELIVERED");
  if (dense && d.offers.length === 0 && active.length === 0) {
    return (
      <p className="flex items-center gap-2 type-body-medium text-on-surface-variant">
        <Icon name={online ? "hourglass_empty" : "cloud_off"} size={18} />
        {online ? "Waiting for orders…" : "Offline"}
      </p>
    );
  }
  return (
    <div className={compact ? "space-y-4" : "grid items-start gap-6 md:grid-cols-2"}>
      <section aria-label="New offers" hidden={dense && d.offers.length === 0}>
        <ColumnHeading title="New offers" count={d.offers.length} icon="notifications_active" />
        <div className="space-y-3">
          {d.offers.length === 0 && (
            <p className={cx("flex items-center justify-center gap-2 rounded-md border border-dashed border-outline-variant text-center type-body-medium text-on-surface-variant", compact ? "p-3" : "p-6")}>
              <Icon name={online ? "hourglass_empty" : "cloud_off"} size={20} />
              {online ? "Waiting for orders…" : "Go online to receive orders"}
            </p>
          )}
          {d.offers.map((o, i) => (
            <OfferCard
              key={o.id}
              offer={o}
              compact={compact}
              hideActions={d.store.faults.neverAnswer}
              tooLate={s.tooLate.has(o.id)}
              busy={s.busy === o.id}
              onAccept={() => void s.accept(o.id)}
              onReject={(reason) => void s.reject(o.id, reason)}
              rejectRequest={i === 0 ? rejectRequest : undefined}
            />
          ))}
        </div>
      </section>
      <section aria-label="In progress" hidden={dense && active.length === 0}>
        <ColumnHeading title="In progress" count={active.length} icon="local_shipping" />
        <div className="space-y-3">
          {active.length === 0 && (
            <p className={cx("rounded-md border border-dashed border-outline-variant text-center type-body-medium text-on-surface-variant", compact ? "p-3" : "p-6")}>No orders in progress</p>
          )}
          {active.map((o) => (
            <OrderCard key={o.id} order={o} compact={compact} busy={s.busy === o.id} onAdvance={() => void s.advance(o.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function StoreError({ s }: { s: StoreState }) {
  if (!s.error) return null;
  return (
    <InlineMessage tone="error" className="mb-3" action={<Button variant="text" size="sm" onClick={s.clearError}>Dismiss</Button>}>
      {s.error}
    </InlineMessage>
  );
}

/** Wall tile: one store, compact. Tiles with a pending offer get a primary outline so they stand out across the room. */
export function StoreTile({ storeId, token, dense = false }: { storeId: string; token: string; dense?: boolean }) {
  const s = useStore(storeId, token);
  const d = s.d;
  const hot = (d?.offers.length ?? 0) > 0;
  const [rejectRequest, setRejectRequest] = useState(0);
  const answerable = hot && !d?.store.faults.neverAnswer;

  // Keyboard on a focused tile: A accepts the most urgent offer, R opens its reject reasons.
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey || !answerable || !d) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select")) return;
    const offer = d.offers[0]!;
    if (s.busy === offer.id || s.tooLate.has(offer.id)) return;
    const k = e.key.toLowerCase();
    if (k === "a") {
      e.preventDefault();
      void s.accept(offer.id);
    } else if (k === "r") {
      e.preventDefault();
      setRejectRequest((n) => n + 1);
    }
  }

  return (
    <section
      aria-label={d?.store.name ?? "Store"}
      aria-keyshortcuts={answerable ? "A R" : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid={`dashboard-${storeId}`}
      className={cx(dense ? "p-3" : "p-4", "rounded-xl bg-surface-container-low transition-shadow duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", hot && "ring-2 ring-primary")}
    >
      {!d ? (
        s.q.isError ? (
          <InlineMessage tone="error">Could not load this store ({(s.q.error as Error).message}).</InlineMessage>
        ) : (
          <div className="flex items-center gap-3 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Loading store…</div>
        )
      ) : (
        <>
          <header className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate type-title-medium text-on-surface">{d.store.name}</h2>
              <p className={cx("type-body-small", d.store.isOnline ? "text-primary" : "text-on-surface-variant")}>{d.store.isOnline ? "Online" : "Offline"}</p>
              <div className="mt-1"><FaultLabels faults={d.store.faults} /></div>
            </div>
            <OnlineSwitch s={s} compact />
          </header>
          <StoreError s={s} />
          <LiveBoard s={s} compact dense={dense} rejectRequest={rejectRequest} />
          {answerable && (
            <p className="mt-3 flex items-center gap-1.5 whitespace-nowrap type-label-small text-on-surface-variant" title="Focus this tile, then press A to accept or R to reject">
              <Icon name="keyboard" size={16} />
              <kbd className="rounded-xs bg-surface-container-highest px-1.5 font-mono">A</kbd> accept ·
              <kbd className="rounded-xs bg-surface-container-highest px-1.5 font-mono">R</kbd> reject
            </p>
          )}
        </>
      )}
    </section>
  );
}
