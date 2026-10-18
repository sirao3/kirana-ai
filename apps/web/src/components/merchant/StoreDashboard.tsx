import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { formatINR } from "../../lib/format";
import { Button, C, Notice, Skeleton, StatusText, Switch, cx } from "../ui";
import { OfferCard, offerShortcut } from "./OfferCard";
import { OrderRow } from "./OrderCard";
import { useStore, type StoreState } from "./useStore";

/** Demo fault labels, as plain status text. */
export function FaultLabels({ faults }: { faults: { autoReject: boolean; neverAnswer: boolean } }) {
  if (!faults.autoReject && !faults.neverAnswer) return null;
  return (
    <span className="flex flex-wrap gap-x-3">
      {faults.autoReject && <StatusText tone="warn">Auto-rejects (demo fault)</StatusText>}
      {faults.neverAnswer && <StatusText tone="warn">Never answers (demo fault)</StatusText>}
    </span>
  );
}

export function OnlineSwitch({ s, hideLabel, label }: { s: StoreState; hideLabel?: boolean; label?: string }) {
  return (
    <Switch checked={!!s.d?.store.isOnline} busy={s.busy === "online"} onChange={() => void s.toggleOnline()} label={label ?? "Online"} hideLabel={hideLabel} />
  );
}

export function StoreError({ s, className }: { s: StoreState; className?: string }) {
  if (!s.error) return null;
  return (
    <Notice tone="bad" className={className} action={<Button variant="plain" size="sm" onClick={s.clearError}>Dismiss</Button>}>
      {s.error}
    </Notice>
  );
}

/** Screen-reader announcement for the newest offer. */
function OfferAnnouncer({ s }: { s: StoreState }) {
  const o = s.d?.offers[0];
  return <p className="sr-only" aria-live="assertive">{o ? `New order: you get ${formatINR(o.totalPaise)}, ${o.items.length} items, ${(o.distanceM / 1000).toFixed(1)} km.` : ""}</p>;
}

/** Offers first (the decision), then orders in progress. One line when there is nothing to do. */
export function LiveBoard({ s, compact = false, rejectRequest }: { s: StoreState; compact?: boolean; rejectRequest?: number }) {
  const d = s.d!;
  const active = d.orders.filter((o) => o.fulfilmentStatus !== "DELIVERED");
  const idle = d.offers.length === 0 && active.length === 0;
  return (
    <div className={compact ? "space-y-3" : "space-y-8"}>
      <OfferAnnouncer s={s} />
      {d.offers.length > 0 && (
        <section aria-label="New orders" className={compact ? "space-y-3" : "space-y-4"}>
          <AnimatePresence initial={false}>
            {d.offers.map((o, i) => <OfferCard key={o.id} offer={o} s={s} compact={compact} rejectRequest={i === 0 ? rejectRequest : undefined} />)}
          </AnimatePresence>
        </section>
      )}
      {active.length > 0 && (
        <section aria-label="In progress">
          <h2 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.tertiary }}>In progress · {active.length}</h2>
          <ul className={cx("overflow-hidden bg-white", compact ? "rounded-[16px]" : "rounded-[18px]")} style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)" }}>
            <AnimatePresence initial={false}>
              {active.map((o) => <OrderRow key={o.id} order={o} compact={compact} busy={s.busy === o.id} onAdvance={() => void s.advance(o.id)} />)}
            </AnimatePresence>
          </ul>
        </section>
      )}
      {idle && (
        <p className={cx(compact ? "px-1 text-[14px]" : "py-6 text-center text-[15px]")} style={{ color: C.secondary }}>
          {d.store.isOnline ? (compact ? "Waiting for orders" : "No new orders. They ring here the moment one arrives.") : "Offline — not receiving orders"}
        </p>
      )}
    </div>
  );
}

/** One store column on the wall: name, online switch, offers and orders. Focus it and press A / R. */
export function StoreTile({ storeId, token }: { storeId: string; token: string }) {
  const s = useStore(storeId, token);
  const d = s.d;
  const [rejectRequest, setRejectRequest] = useState(0);
  const answerable = !!d?.offers.length && !d.store.faults.neverAnswer;

  return (
    <section aria-label={d?.store.name ?? "Store"} aria-keyshortcuts={answerable ? "A R" : undefined} tabIndex={0}
      onKeyDown={(e) => offerShortcut(e, s, () => setRejectRequest((n) => n + 1))} data-testid={`dashboard-${storeId}`}
      className="min-w-0 rounded-[20px] p-1 outline-none focus-visible:ring-2" style={{ ["--tw-ring-color" as string]: C.blue }}>
      {!d ? (
        s.q.isError ? (
          <Notice tone="bad">Could not load this store.</Notice>
        ) : (
          <div className="space-y-2 p-1"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-20" /></div>
        )
      ) : (
        <>
          <header className="mb-3 flex items-center gap-2 px-1">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em]" style={{ color: C.label }}>{d.store.name}</h2>
              <StatusText tone={d.store.isOnline ? "good" : "neutral"}>{d.store.isOnline ? "Online" : "Offline"}</StatusText>
            </div>
            <OnlineSwitch s={s} hideLabel label={`${d.store.name} online`} />
          </header>
          {(d.store.faults.autoReject || d.store.faults.neverAnswer) && <div className="mb-3 px-1"><FaultLabels faults={d.store.faults} /></div>}
          <StoreError s={s} className="mb-3" />
          <LiveBoard s={s} compact rejectRequest={rejectRequest} />
          {answerable && (
            <p className="mt-2.5 px-1 text-[12px] max-sm:hidden" style={{ color: C.tertiary }}>
              Focus and press <kbd className="font-semibold" style={{ color: C.secondary }}>A</kbd> to accept, <kbd className="font-semibold" style={{ color: C.secondary }}>R</kbd> to decline
            </p>
          )}
        </>
      )}
    </section>
  );
}
