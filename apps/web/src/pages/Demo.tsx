import { useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { MotionConfig, motion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import { getSession, setSession, type Session } from "../lib/session";
import { EXPANDED, useMedia } from "../lib/useMedia";
import { useSnackbar } from "../components/ui/toast";
import { unlockAudio, usePendingOfferCount } from "../components/merchant/alert";
import { setAllOnline, useWallTokens } from "../components/merchant/useWallTokens";
import { bap } from "../components/shop/bap";
import { AdminActionDialog, type AdminAction } from "../components/demo/AdminActionDialog";
import { deriveSteps, type DemoView } from "../components/demo/steps";
import { CustomerCard } from "../components/demo/hood/CustomerCard";
import { HoodMap, SHEET_PX } from "../components/demo/hood/HoodMap";
import { Activity, Island, useActivity } from "../components/demo/hood/Island";
import { C, FONT, Spinner, soft, useNow } from "../components/demo/hood/kit";

const DEMO_CUSTOMER = "cust_priya";

/** The cockpit needs a customer session in this tab; store pins carry their own merchant tokens. */
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

/**
 * /demo: the presenter cockpit, "Neighbourhood" design. The map of the customer's area is the stage: the customer flow
 * floats in a card on the left, the five stores are pins (offers appear as callouts, next-step buttons under busy pins),
 * routes follow the live order, and the script pill at the top ticks itself from live state. Expanded windows only.
 *
 * Tokens: the customer card uses this tab's customer session. Each store pin gets its own merchant token
 * (`useStore(storeId, token)`), and admin actions ask for the passcode, so the three roles never overwrite each other.
 */
export function Demo() {
  const wide = useMedia(EXPANDED);
  const qc = useQueryClient();
  const snack = useSnackbar();
  const now = useNow(250);
  const { ready, failed } = useCustomerSession();
  const stores = useWallTokens();
  const adminToken = useRef<string | null>(null);
  const [adminAction, setAdminAction] = useState<AdminAction | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const [ledgerOpened, setLedgerOpened] = useState(false);
  const [baseline, setBaseline] = useState<Set<string> | null>(null);
  const [run, setRun] = useState(0); // remounts the customer card after a reset or a new order
  // One side at a time, as each real user sees it: the customer's app, or the stores (?view=stores).
  const [params, setParams] = useSearchParams();
  const view: DemoView = params.get("view") === "stores" ? "stores" : "customer";
  const setView = (v: DemoView) => setParams(v === "stores" ? { view: v } : {}, { replace: true });
  const pending = usePendingOfferCount();

  const orders = useLive(["demo-orders"], bap.orders, { enabled: ready });
  const basket = useLive(["basket"], bap.basket, { enabled: ready });
  const address = useQuery({ queryKey: ["address"], queryFn: bap.address, enabled: ready });

  // Orders that existed when the cockpit opened belong to an earlier run: they must not tick this run's steps.
  if (baseline === null && orders.data) setBaseline(new Set(orders.data.map((o) => o.basketId)));
  const order = useMemo(() => {
    const fresh = (orders.data ?? []).filter((o) => !baseline?.has(o.basketId));
    return fresh.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }, [orders.data, baseline]);
  const activity = useActivity(order);

  const steps = deriveSteps({ basket: basket.data, order, staleOrders: (baseline?.size ?? 0) > 0, resetDone, ledgerOpened });

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

  /** After a finished order: it joins the earlier runs, the chat clears and the card starts fresh. */
  async function newOrder() {
    if (order) setBaseline((b) => new Set([...(b ?? []), order.basketId]));
    activity.clear();
    await bap.chatReset().catch(() => undefined);
    setRun((r) => r + 1);
  }

  async function adminDone(action: AdminAction) {
    setAdminAction(null);
    if (action === "reset") {
      setBaseline(new Set());
      setResetDone(true);
      setLedgerOpened(false);
      activity.clear();
      await bap.chatReset().catch(() => undefined);
      await qc.invalidateQueries();
      setRun((r) => r + 1);
      snack("Demo reset. Data restored and all stores online.");
    } else {
      snack("Demo faults armed: 45 s window, Gupta never answers.");
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-dvh overflow-hidden" style={{ fontFamily: FONT, color: C.label }}>
        <HoodMap address={address.data} stores={stores.data ?? []} order={order} basket={basket.data} now={now} controls={view === "stores"} left={view === "customer" ? SHEET_PX : 0} />

        {failed ? (
          <p role="alert" className="absolute left-4 top-4 rounded-[18px] bg-white px-5 py-4 text-[15px]" style={{ color: C.red }}>Could not sign in as the demo customer. Is the server running?</p>
        ) : !ready ? (
          <p className="absolute left-4 top-4 flex items-center gap-2 rounded-[18px] bg-white px-5 py-4 text-[15px]" style={{ color: C.secondary }}><Spinner /> Signing in as Priya…</p>
        ) : (
          // Stays mounted in the Stores view (the chat and the pay sheet keep their state); it just slides away.
          <motion.div aria-hidden={view !== "customer"} ref={(el) => { if (el) el.inert = view !== "customer"; }} initial={false}
            animate={view === "customer" ? { x: 0, opacity: 1 } : { x: -460, opacity: 0 }} transition={soft}>
            <CustomerCard key={run} order={order} now={now} onLog={(t, tone) => activity.add(t, tone)} onNewOrder={() => void newOrder()} />
          </motion.div>
        )}

        <div className="pointer-events-none absolute right-4 top-4 flex justify-center" style={{ left: view === "customer" ? SHEET_PX : 16 }}>
          <div className="pointer-events-auto">
            <Island
              view={view}
              onView={setView}
              pending={pending}
              steps={steps}
              menu={[
                { label: "All stores online", onSelect: () => void allOnline() },
                { label: "Arm demo faults…", hint: "45 s window, Gupta never answers", onSelect: () => setAdminAction("arm") },
                { label: "Open admin ledger", hint: "New tab", onSelect: openLedger },
                { label: "Reset demo data…", onSelect: () => setAdminAction("reset"), danger: true },
              ]}
            />
          </div>
        </div>

        {stores.isError && <p role="alert" className="absolute bottom-4 right-4 rounded-[14px] bg-white px-4 py-3 text-[14px]" style={{ color: C.red }}>Could not load the stores.</p>}
        <Activity log={activity.log} />
        <AdminActionDialog action={adminAction} tokenRef={adminToken} onClose={() => setAdminAction(null)} onDone={(a) => void adminDone(a)} />
      </div>
    </MotionConfig>
  );
}
