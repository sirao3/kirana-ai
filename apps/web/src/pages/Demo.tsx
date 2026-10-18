import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import { getSession, setSession, type Session } from "../lib/session";
import { EXPANDED, useMedia } from "../lib/useMedia";
import { AssistChip, BrandMark, CircularProgress, IconButton, InlineMessage, Menu, SegmentedButton, StatusLabel, ThemeToggle, TopAppBar, useSnackbar } from "../components/m3";
import { unlockAudio, useAudioUnlocked, usePendingOfferCount } from "../components/merchant/alert";
import { StoreTile } from "../components/merchant/StoreDashboard";
import { setAllOnline, useWallTokens } from "../components/merchant/useWallTokens";
import { bap } from "../components/shop/bap";
import { AdminActionDialog, type AdminAction } from "../components/demo/AdminActionDialog";
import { CustomerPane } from "../components/demo/CustomerPane";
import { ScriptRail } from "../components/demo/ScriptRail";
import { deriveSteps, type DemoView } from "../components/demo/steps";

const DEMO_CUSTOMER = "cust_priya";

/** The cockpit needs a customer session in this tab; wall tiles carry their own merchant tokens. */
function useCustomerSession(): { ready: boolean; failed: boolean } {
  const existing = getSession();
  const have = existing?.role === "customer";
  const q = useQuery({
    queryKey: ["demo-session"],
    enabled: !have,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const s = await api<Session>("/auth/persona", { method: "POST", token: "", json: { role: "customer", id: DEMO_CUSTOMER } });
      setSession({ token: s.token, role: s.role, sub: s.sub, name: s.name });
      return true;
    },
  });
  return { ready: have || q.isSuccess, failed: q.isError };
}

function SoundChip() {
  const on = useAudioUnlocked();
  return on ? (
    <StatusLabel tone="success" icon="volume_up">Sounds on</StatusLabel>
  ) : (
    <AssistChip icon="volume_off" onClick={() => void unlockAudio()}>Enable offer sounds</AssistChip>
  );
}

/**
 * /demo: the presenter cockpit (UX-06). The whole PRD §14 script in one tab: a script rail that ticks itself from live
 * state, and either the customer's app or the five stores, picked with the switch at the top right (`?view=stores`),
 * so the audience sees what each real user sees. Both views stay mounted: store tiles keep polling and beeping while
 * the customer view shows, and the Stores button counts pending offers. Expanded windows only.
 *
 * Tokens: the customer pane uses this tab's customer session (set on entry). Each store tile gets its own merchant
 * token explicitly (`useStore(storeId, token)`), and admin actions ask for the passcode and pass the admin token
 * explicitly, so the three roles never overwrite each other's session.
 */
export function Demo() {
  const wide = useMedia(EXPANDED);
  const qc = useQueryClient();
  const snack = useSnackbar();
  const { ready, failed } = useCustomerSession();
  const stores = useWallTokens();
  const adminToken = useRef<string | null>(null);
  const [adminAction, setAdminAction] = useState<AdminAction | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const [ledgerOpened, setLedgerOpened] = useState(false);
  const [baseline, setBaseline] = useState<Set<string> | null>(null);
  const [params, setParams] = useSearchParams();
  const view: DemoView = params.get("view") === "stores" ? "stores" : "customer";
  const setView = (v: DemoView) => setParams(v === "stores" ? { view: v } : {}, { replace: true });
  const pendingOffers = usePendingOfferCount();
  const storesRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (view === "stores") storesRef.current?.scrollTo({ top: 0 });
  }, [view]);

  const orders = useLive(["demo-orders"], bap.orders, { enabled: ready });
  const basket = useLive(["basket"], bap.basket, { enabled: ready });

  // Orders that existed when the cockpit opened belong to an earlier run: they must not tick this run's steps.
  if (baseline === null && orders.data) setBaseline(new Set(orders.data.map((o) => o.basketId)));
  const order = useMemo(() => {
    const fresh = (orders.data ?? []).filter((o) => !baseline?.has(o.basketId));
    return fresh.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }, [orders.data, baseline]);

  const steps = deriveSteps({
    basket: basket.data,
    order,
    staleOrders: (baseline?.size ?? 0) > 0,
    resetDone,
    ledgerOpened,
  });

  if (!wide) return <Navigate to="/" replace />;

  async function allOnline() {
    void unlockAudio();
    try {
      await setAllOnline(stores.data ?? [], qc);
      snack("All stores are online. Offer sounds are on.");
    } catch {
      snack("Could not bring every store online.");
    }
  }

  function openLedger() {
    window.open("/admin", "_blank");
    setLedgerOpened(true);
  }

  async function adminDone(action: AdminAction) {
    setAdminAction(null);
    if (action === "reset") {
      setBaseline(new Set());
      setResetDone(true);
      setLedgerOpened(false);
      await qc.invalidateQueries();
      snack("Demo reset. Data restored and all stores online.");
    } else {
      snack("Demo faults armed: 45 s window, Gupta never answers.");
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <TopAppBar
        leading={<BrandMark />}
        title="Demo cockpit"
        subtitle={view === "customer" ? "What Priya sees on her phone" : "What the five kirana owners see"}
        actions={
          <>
            <SegmentedButton
              label="Show"
              value={view}
              onChange={setView}
              className="mr-2"
              options={[
                { value: "customer", label: "Customer", icon: "person" },
                { value: "stores", label: "Stores", icon: "storefront", badge: pendingOffers, badgeLabel: `${pendingOffers} pending ${pendingOffers === 1 ? "offer" : "offers"}` },
              ]}
            />
            <SoundChip />
            <ThemeToggle />
            <Menu
              items={[
                { label: "All stores online", icon: "cloud_done", onSelect: () => void allOnline() },
                { label: "Arm demo faults…", icon: "build", supporting: "45 s window, Gupta never answers", onSelect: () => setAdminAction("arm") },
                { label: "Reset demo data…", icon: "restart_alt", onSelect: () => setAdminAction("reset") },
                { label: "Open admin ledger", icon: "admin_panel_settings", supporting: "New tab", onSelect: openLedger },
              ]}
              trigger={(p) => <IconButton icon="more_vert" label="Demo actions" {...p} />}
            />
          </>
        }
      />
      <ScriptRail steps={steps} onOpenLedger={openLedger} view={view} onSwitchView={setView} />

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2 sm:px-6">
        <section aria-label="Customer" hidden={view !== "customer"} className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-xl bg-surface-container-lowest ring-1 ring-outline-variant">
          {failed ? (
            <InlineMessage tone="error" className="m-4">Could not sign in as the demo customer. Is the server running?</InlineMessage>
          ) : !ready ? (
            <div className="flex items-center gap-3 p-6 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Signing in as Priya…</div>
          ) : (
            <div className="min-h-0 flex-1 px-3"><CustomerPane order={order} /></div>
          )}
        </section>

        <section ref={storesRef} aria-label="Stores" hidden={view !== "stores"} className="min-h-0 flex-1 overflow-y-auto pr-1">
          {stores.isError && <InlineMessage tone="error">Could not load the stores.</InlineMessage>}
          {stores.isLoading && <div className="flex items-center gap-3 py-8 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Loading stores…</div>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(268px,1fr))] items-start gap-3">
            {stores.data?.map((s) => <StoreTile key={s.id} storeId={s.id} token={s.token} dense />)}
          </div>
        </section>
      </div>

      <AdminActionDialog action={adminAction} tokenRef={adminToken} onClose={() => setAdminAction(null)} onDone={(a) => void adminDone(a)} />
    </div>
  );
}
