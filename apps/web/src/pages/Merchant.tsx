import { useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { formatINR } from "../lib/format";
import { getSession, setSession, type Session } from "../lib/session";
import { useMedia } from "../lib/useMedia";
import { useSnackbar } from "../components/m3";
import { AppFrame, Button, C, CheckDraw, EmptyState, Group, IBolt, ICheckCircle, IList, IWallet, LargeTitle, Notice, Row, Skeleton, shortName, type FrameNav } from "../components/ui";
import { AudioBanner } from "../components/merchant/AudioBanner";
import { Catalogue } from "../components/merchant/Catalogue";
import { Earnings } from "../components/merchant/Earnings";
import { offerShortcut } from "../components/merchant/OfferCard";
import { OfferTakeover } from "../components/merchant/OfferTakeover";
import { StoreChooser } from "../components/merchant/StoreChooser";
import { FaultLabels, LiveBoard, OnlineSwitch, StoreError } from "../components/merchant/StoreDashboard";
import { useStore, type StoreState } from "../components/merchant/useStore";

type Dest = "live" | "delivered" | "earnings" | "catalogue";

function Live({ s }: { s: StoreState }) {
  const d = s.d!;
  const [rejectRequest, setRejectRequest] = useState(0);
  // A accepts the most urgent offer, R opens its reasons (not while typing or inside a sheet).
  const sRef = useRef(s);
  sRef.current = s;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => offerShortcut(e, sRef.current, () => setRejectRequest((n) => n + 1));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const n = d.offers.length;
  const active = d.orders.filter((o) => o.fulfilmentStatus !== "DELIVERED").length;
  const status = !d.store.isOnline ? "Offline" : n ? `${n} new ${n === 1 ? "order" : "orders"} waiting` : active ? `${active} in progress` : "Online, waiting for orders";

  return (
    <div className="space-y-6">
      <LargeTitle title={d.store.name} subtitle={status} actions={<OnlineSwitch s={s} />} />
      {!d.store.isOnline && (
        <Notice tone="warn" title="You're offline" action={<Button variant="primary" size="sm" busy={s.busy === "online"} onClick={() => void s.toggleOnline()}>Go online</Button>}>
          Customers can't send you orders until you go online.
        </Notice>
      )}
      <FaultLabels faults={d.store.faults} />
      <AudioBanner />
      <StoreError s={s} />
      <LiveBoard s={s} rejectRequest={rejectRequest} />
    </div>
  );
}

function Delivered({ s }: { s: StoreState }) {
  const delivered = s.d!.orders.filter((o) => o.fulfilmentStatus === "DELIVERED");
  const total = delivered.reduce((t, o) => t + o.totalPaise, 0);
  return (
    <div className="space-y-6">
      <LargeTitle title="Delivered" subtitle={delivered.length ? `${delivered.length} ${delivered.length === 1 ? "order" : "orders"} · ${formatINR(total)}` : undefined} />
      {delivered.length === 0 ? (
        <EmptyState title="No deliveries yet">Orders move here once you mark them delivered.</EmptyState>
      ) : (
        <Group>
          {delivered.map((o) => (
            <Row key={o.id} leading={<CheckDraw size={22} />} title={o.buyerName}
              subtitle={o.items.map((x) => `${x.qty} × ${x.name}`).join(", ")}
              detail={<span className="font-semibold" style={{ color: C.label }}>{formatINR(o.totalPaise)}</span>} />
          ))}
        </Group>
      )}
    </div>
  );
}

function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const s = useStore(session.sub, session.token);
  const [dest, setDest] = useState<Dest>("live");
  const snack = useSnackbar();
  const phone = useMedia("(max-width: 599.98px)");
  const d = s.d;

  // A new offer while the merchant is elsewhere: a toast with a way back (the sound and badge also signal it).
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const o of d?.offers ?? []) {
      if (seen.current.has(o.id)) continue;
      seen.current.add(o.id);
      if (dest !== "live" && !phone) snack(`New order: ${formatINR(o.totalPaise)}`, { label: "View", onClick: () => setDest("live") });
    }
  }, [d?.offers, dest, snack, phone]);

  const nav: FrameNav[] = [
    { key: "live", label: "Live", icon: <IBolt />, onSelect: () => setDest("live"), badge: s.pendingCount },
    { key: "delivered", label: "Delivered", icon: <ICheckCircle />, onSelect: () => setDest("delivered") },
    { key: "earnings", label: "Earnings", icon: <IWallet />, onSelect: () => setDest("earnings") },
    { key: "catalogue", label: "Catalogue", icon: <IList />, onSelect: () => setDest("catalogue") },
  ];
  const name = d?.store.name ?? session.name;

  return (
    <AppFrame nav={nav} active={dest} label="Store" maxWidth={dest === "catalogue" ? 1120 : 760}
      context={d ? `${shortName(name)} · ${d.store.isOnline ? "Online" : "Offline"}` : name}
      account={{ name, role: "merchant", switchLabel: "Switch store", onSwitch: onSignOut }}>
      {!d ? (
        s.q.isError ? (
          <Notice tone="bad" title="Could not load this store" action={<Button variant="plain" size="sm" onClick={() => void s.q.refetch()}>Retry</Button>}>
            {(s.q.error as Error).message}
          </Notice>
        ) : (
          <div className="space-y-4" role="status" aria-label="Loading store"><Skeleton className="h-9 w-64" /><Skeleton className="h-[220px] w-full" style={{ borderRadius: 22 }} /></div>
        )
      ) : (
        <>
          {phone && <OfferTakeover s={s} />}
          {dest === "live" && <Live s={s} />}
          {dest === "delivered" && <Delivered s={s} />}
          {dest === "earnings" && <Earnings storeId={session.sub} token={session.token} />}
          {dest === "catalogue" && <Catalogue storeId={session.sub} token={session.token} />}
        </>
      )}
    </AppFrame>
  );
}

/** /merchant: the logged-in store's dashboard; without a merchant session, a store chooser. */
export function Merchant() {
  const [session, setLocal] = useState<Session | null>(() => {
    const s = getSession();
    return s?.role === "merchant" ? s : null;
  });
  return (
    <MotionConfig reducedMotion="user">
      {!session ? (
        <StoreChooser onChosen={setLocal} />
      ) : (
        <Dashboard key={session.sub} session={session} onSignOut={() => { setSession(null); setLocal(null); }} />
      )}
    </MotionConfig>
  );
}
