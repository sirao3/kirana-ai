import { useEffect, useRef, useState } from "react";
import { formatINR } from "../lib/format";
import { getSession, setSession, type Session } from "../lib/session";
import {
  AccountMenu, AppShell, Button, Card, CircularProgress, EmptyState, Icon, InlineMessage, ThemeToggle, TopAppBar, useSnackbar, type NavItem,
} from "../components/m3";
import { Catalogue } from "../components/merchant/Catalogue";
import { StoreChooser } from "../components/merchant/StoreChooser";
import { FaultLabels, LiveBoard, OnlineSwitch, StoreError } from "../components/merchant/StoreDashboard";
import { useStore } from "../components/merchant/useStore";

type Dest = "live" | "delivered" | "catalogue";

function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const s = useStore(session.sub, session.token);
  const [dest, setDest] = useState<Dest>("live");
  const snack = useSnackbar();
  const d = s.d;

  // A new offer while the merchant is elsewhere: snackbar with a way back (the sound and badge also signal it).
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const o of d?.offers ?? []) {
      if (seen.current.has(o.id)) continue;
      seen.current.add(o.id);
      if (dest !== "live") snack(`New offer: ${formatINR(o.totalPaise)}`, { label: "View", onClick: () => setDest("live") });
    }
  }, [d?.offers, dest, snack]);

  const delivered = d?.orders.filter((o) => o.fulfilmentStatus === "DELIVERED") ?? [];
  const nav: NavItem[] = [
    { key: "live", label: "Live", icon: "bolt", onSelect: () => setDest("live"), badge: s.pendingCount },
    { key: "delivered", label: "Delivered", icon: "task_alt", onSelect: () => setDest("delivered") },
    { key: "catalogue", label: "Catalogue", icon: "inventory_2", onSelect: () => setDest("catalogue") },
  ];

  return (
    <AppShell
      nav={nav}
      active={dest}
      navLabel="Store"
      topBar={
        <TopAppBar
          leading={
            <span className="ml-2 mr-1 flex h-10 w-10 items-center justify-center rounded-md bg-primary-container text-on-primary-container">
              <Icon name="storefront" filled />
            </span>
          }
          title={d?.store.name ?? session.name}
          subtitle={!d ? "Store dashboard" : `${d.store.isOnline ? "Online" : "Offline"}${d.store.faults.autoReject || d.store.faults.neverAnswer ? " · fault injection active" : ""}`}
          actions={
            <>
              {d && <OnlineSwitch s={s} />}
              <ThemeToggle />
              <AccountMenu name={session.name} role="merchant" switchLabel="Switch store" onSwitch={onSignOut} />
            </>
          }
        />
      }
    >
      <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-8 sm:px-6">
        {!d ? (
          s.q.isError ? (
            <InlineMessage tone="error" action={<Button variant="text" onClick={() => void s.q.refetch()}>Retry</Button>}>
              Could not load this store ({(s.q.error as Error).message}).
            </InlineMessage>
          ) : (
            <div className="flex items-center gap-3 py-8 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Loading store…</div>
          )
        ) : (
          <>
            <div className="mb-3 empty:hidden"><FaultLabels faults={d.store.faults} /></div>
            <StoreError s={s} />
            {dest === "live" && (
              <>
                {!d.store.isOnline && (
                  <InlineMessage
                    tone="warning"
                    icon="cloud_off"
                    className="mb-4"
                    title="You are offline"
                    action={<Button variant="tonal" size="sm" icon="cloud_done" loading={s.busy === "online"} onClick={() => void s.toggleOnline()}>Go online</Button>}
                  >
                    Customers can't send you orders until you go online.
                  </InlineMessage>
                )}
                <LiveBoard s={s} />
              </>
            )}
            {dest === "delivered" &&
              (delivered.length === 0 ? (
                <EmptyState icon="task_alt" title="No deliveries yet">Orders move here once you mark them delivered.</EmptyState>
              ) : (
                <Card variant="outlined" className="max-w-3xl overflow-hidden">
                  <ul>
                    {delivered.map((o, i) => (
                      <li key={o.id} className={i > 0 ? "border-t border-outline-variant" : undefined}>
                        <div className="flex items-center gap-4 px-4 py-3">
                          <Icon name="check_circle" className="text-primary" label="Delivered" />
                          <div className="min-w-0 flex-1">
                            <p className="type-body-large text-on-surface">{o.buyerName}</p>
                            <p className="truncate type-body-medium text-on-surface-variant">{o.items.map((x) => `${x.qty} × ${x.name}`).join(", ")}</p>
                          </div>
                          <span className="type-title-medium tabular-nums text-on-surface">{formatINR(o.totalPaise)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            {dest === "catalogue" && <Catalogue storeId={session.sub} token={session.token} />}
          </>
        )}
      </div>
    </AppShell>
  );
}

/** /merchant: the logged-in store's dashboard; without a merchant session, a store chooser. */
export function Merchant() {
  const [session, setLocal] = useState<Session | null>(() => {
    const s = getSession();
    return s?.role === "merchant" ? s : null;
  });
  if (!session) return <StoreChooser onChosen={setLocal} />;
  return (
    <Dashboard
      key={session.sub}
      session={session}
      onSignOut={() => {
        setSession(null);
        setLocal(null);
      }}
    />
  );
}
