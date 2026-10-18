import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderView } from "@kiranaai/shared";
import { formatINR } from "../lib/format";
import { useLive } from "../lib/live";
import { setSession, type Session } from "../lib/session";
import { EXPANDED, useMedia } from "../lib/useMedia";
import { useRequireSession } from "../lib/useSession";
import { C, FONT, IBack, IBasket, IChevron, IPin, IReceipt, Segmented, Sheet, glass, soft, useNow } from "../components/ui";
import { AddressSheet } from "../components/shop/AddressSheet";
import { bap } from "../components/shop/bap";
import { BasketPanel, CheckoutButton, basketTotal } from "../components/shop/BasketPanel";
import { ChatPanel } from "../components/shop/ChatPanel";
import { ManualPanel } from "../components/shop/ManualPanel";
import { isInFlight } from "../components/shop/OrderDetail";
import { OrderPage, OrdersList } from "../components/shop/OrdersPanel";
import { PaySheet } from "../components/shop/PaySheet";
import { ShopMap } from "../components/shop/ShopMap";
import { useAddress } from "../components/shop/useAddress";
import { useCheckout } from "../components/shop/useCheckout";
import { DANGER, LINK } from "../components/shop/tokens";

type Tab = "assistant" | "search";

/**
 * The customer app (/shop, /shop/orders, /shop/orders/:id) in the Neighbourhood design: the map of the customer's
 * area is the stage and one glass card carries the flow. ≥ 840 px the card floats on the left; below, the map sits on
 * top and the card is a sheet under it. All three routes render this component, so the map and the chat persist
 * while moving between shopping and orders.
 */
export function Shop() {
  const session = useRequireSession("customer");
  if (!session) return null;
  return (
    <MotionConfig reducedMotion="user">
      <ShopApp session={session} />
    </MotionConfig>
  );
}

function ShopApp({ session }: { session: Session }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const { id } = useParams();
  const view: "shop" | "orders" | "order" = id ? "order" : pathname.startsWith("/shop/orders") ? "orders" : "shop";
  const wide = useMedia(EXPANDED);
  const now = useNow(500);
  const [tab, setTab] = useState<Tab>("assistant");
  const [addressOpen, setAddressOpen] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  const [trackId, setTrackId] = useState<string | null>(null);

  const basketQ = useLive(["basket"], bap.basket);
  const basket = basketQ.data;
  const addressQ = useAddress();
  const address = addressQ.data;
  const ordersQ = useQuery({ queryKey: ["orders"], queryFn: bap.orders, refetchInterval: 5000 });
  const inFlight = (ordersQ.data ?? []).filter(isInFlight);
  const tracked = useLive(["order", trackId], () => bap.order(trackId!), { enabled: !!trackId });
  const detail = useLive(["order", id], () => bap.order(id!), { enabled: !!id });
  const checkout = useCheckout();

  // Coming back with an order on its way: the assistant thread keeps tracking it.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !ordersQ.data) return;
    seeded.current = true;
    const latest = [...ordersQ.data].filter(isInFlight).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (latest) setTrackId(latest.basketId);
  }, [ordersQ.data]);

  // The shop map follows the tracked order while it is on its way; afterwards it shows the basket again.
  const mapOrder: OrderView | null = view === "order" ? (detail.data ?? null) : view === "shop" && tracked.data && isInFlight(tracked.data) ? tracked.data : null;
  const hasItems = (basket?.itemCount ?? 0) > 0;
  const firstName = session.name.split(" ")[0] ?? session.name;

  function onPaid(basketId: string) {
    checkout.closePay();
    setBasketOpen(false);
    setTrackId(basketId);
    setTab("assistant");
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["basket"] });
    if (view !== "shop") nav("/shop");
  }

  // Phones: the card is a sheet under the map with two heights. It rises once there is something to read.
  const [sheetUp, setSheetUp] = useState<boolean | null>(null);
  const [chatActive, setChatActive] = useState(false);
  useEffect(() => setSheetUp(null), [view, tab]);
  const up = sheetUp ?? (view !== "shop" || tab === "search" || hasItems || chatActive || !!tracked.data);
  const top = up ? "12dvh" : "34dvh";

  const ordersLink = (
    <Link to="/shop/orders" aria-current={view !== "shop" ? "page" : undefined} aria-label={`Orders${inFlight.length ? `, ${inFlight.length} in progress` : ""}`} title="Orders"
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/[0.05]" style={{ color: view === "shop" ? C.secondary : C.green }}>
      <IReceipt />
      <AnimatePresence>
        {inFlight.length > 0 && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={soft} aria-hidden
            className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white" style={{ background: DANGER }}>{inFlight.length}</motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
  const account = <AccountMenu name={session.name} onSwitch={() => { setSession(null); qc.clear(); nav("/"); }} />;
  const addressButton = (
    <button type="button" onClick={() => setAddressOpen(true)} aria-haspopup="dialog"
      className="-mx-1 flex min-h-9 min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-[8px] px-1 text-left text-[13px] transition-colors hover:bg-black/[0.04]" style={{ color: C.secondary }}>
      <span className="shrink-0" style={{ color: LINK }}><IPin size={15} /></span>
      <span className="truncate">{address ? <>Delivering to <span style={{ color: C.label }}>{address.label}</span></> : addressQ.isError ? "Set delivery address" : "Delivering to…"}</span>
      <span className="shrink-0 rotate-90" style={{ color: C.tertiary }}><IChevron size={12} /></span>
    </button>
  );

  const card = (
    <section aria-label="KiranaAI shop"
      className={wide ? "absolute bottom-4 left-4 top-4 flex w-[420px] flex-col overflow-hidden print:static print:w-auto print:overflow-visible"
        : "absolute inset-x-0 bottom-0 flex flex-col overflow-hidden transition-[top] duration-500 ease-[cubic-bezier(0.2,0.9,0.3,1)] motion-reduce:transition-none print:static print:overflow-visible"}
      style={{ ...glass, background: "rgba(255,255,255,0.86)", borderRadius: wide ? 26 : "26px 26px 0 0", top: wide ? undefined : top }}>
      {!wide && (
        <button type="button" onClick={() => setSheetUp(!up)} aria-expanded={up} aria-label={up ? "Show more of the map" : "Show more of the list"}
          className="flex h-5 w-full shrink-0 cursor-pointer items-center justify-center">
          <span className="h-[5px] w-9 rounded-full" style={{ background: "#D1D1D6" }} />
        </button>
      )}
      <header className={wide ? "px-5 pt-5" : "px-5"}>
        {wide ? (
          <>
            <div className="flex items-center gap-2.5">
              <Link to="/" aria-label="KiranaAI home" className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[13px] font-bold text-white" style={{ background: C.green }}>K</span>
                <span className="text-[15px] font-semibold" style={{ color: C.label }}>KiranaAI</span>
              </Link>
              <span className="ml-auto flex items-center gap-1">{ordersLink}{account}</span>
            </div>
            <div className="mt-1">{addressButton}</div>
          </>
        ) : (
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">{addressButton}</div>
            {ordersLink}{account}
          </div>
        )}
        {address && address.stores.length > 0 && address.stores.some((s) => !s.delivers) && view === "shop" && (
          <p className="mt-0.5 px-0.5 text-[12px]" style={{ color: "#B25E00" }}>
            {address.stores.every((s) => !s.delivers) ? "No store delivers here. Pick another address to shop." : `${address.stores.filter((s) => !s.delivers).map((s) => s.name.split(" ")[0]).join(", ")} can't deliver here; plans leave ${address.stores.filter((s) => !s.delivers).length === 1 ? "it" : "them"} out.`}
          </p>
        )}
        <AnimatePresence mode="wait" initial={false}>
          {view === "shop" ? (
            <motion.div key="seg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="pb-1 pt-3">
              <Segmented label="How to shop" value={tab} onChange={setTab} className="flex w-full"
                options={[{ value: "assistant", label: "Assistant" }, { value: "search", label: "Search & plan" }]} />
            </motion.div>
          ) : (
            <motion.div key="nav" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={soft} className="pt-2">
              <Link to={view === "order" ? "/shop/orders" : "/shop"} className="-ml-1.5 inline-flex min-h-9 items-center gap-0.5 pr-2 text-[15px]" style={{ color: LINK }}>
                <IBack size={18} /> {view === "order" ? "Orders" : "Shop"}
              </Link>
              <h1 className="text-[28px] font-bold leading-tight tracking-[-0.025em]" style={{ color: C.label }}>{view === "order" ? "Order" : "Orders"}</h1>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Shopping stays mounted (chat, search results) while orders are open. */}
      <div className="flex min-h-0 flex-1 flex-col" style={{ display: view === "shop" ? undefined : "none" }}>
        <Pane active={tab === "assistant"}>
          <ChatPanel onActive={() => setChatActive(true)} basket={basket} checkout={checkout} tracked={tracked.data ?? null} now={now} onUseSearch={() => setTab("search")} onOpenOrder={(b) => nav(`/shop/orders/${b}`)}
            onNewOrder={() => { setTrackId(null); setChatActive(false); }} />
        </Pane>
        <Pane active={tab === "search"}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5" style={{ scrollbarWidth: "none" }}>
            <ManualPanel basketItemIds={new Set(basket?.stores.flatMap((s) => s.items.map((i) => i.listingId)) ?? [])} />
          </div>
          <AnimatePresence initial={false}>
            {hasItems && basket && (
              <motion.div key="bar" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={soft} className="px-4 pb-4 pt-2">
                <motion.button type="button" onClick={() => setBasketOpen(true)} whileTap={{ scale: 0.98 }} transition={soft} aria-haspopup="dialog"
                  className="flex h-[54px] w-full cursor-pointer items-center gap-3 px-5 text-left text-white" style={{ background: C.label, borderRadius: 16 }}>
                  <IBasket size={20} />
                  <span className="flex-1 text-[17px] font-semibold">Review basket</span>
                  <span className="text-[15px] opacity-80" style={{ fontVariantNumeric: "tabular-nums" }}>{basket.itemCount} · {formatINR(basketTotal(basket))}</span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </Pane>
      </div>

      {view !== "shop" && (
        <motion.div key={view + (id ?? "")} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={soft}
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 print:overflow-visible" style={{ scrollbarWidth: "none" }}>
          {view === "orders" ? (
            <OrdersList orders={ordersQ.data} error={ordersQ.error} onRetry={() => void ordersQ.refetch()} onShop={() => nav("/shop")} />
          ) : (
            <OrderPage order={detail.data} error={detail.error} onRetry={() => void detail.refetch()} now={now}
              onNewOrder={() => { void bap.chatReset().catch(() => undefined); setTrackId(null); setTab("assistant"); nav("/shop"); }} />
          )}
        </motion.div>
      )}
    </section>
  );

  return (
    <div className="relative h-dvh overflow-hidden print:h-auto print:overflow-visible" style={{ fontFamily: FONT, color: C.label, background: C.land }}>
      <div className={wide ? "absolute inset-0 print:hidden" : "absolute inset-x-0 top-0 print:hidden"} style={wide ? undefined : { height: "calc(34dvh + 28px)" }}>
        <ShopMap address={address} basket={basket} order={mapOrder} wide={wide} name={firstName} visible={wide || !up ? 1 : 12 / 34} />
      </div>
      {card}

      <Sheet open={basketOpen && hasItems && !checkout.payOpen} onClose={() => setBasketOpen(false)} title="Basket" width={480}>
        {basket && (
          <div className="space-y-4">
            <BasketPanel basket={basket} now={now} quoteErrors={checkout.quoteErrors} bare />
            <CheckoutButton basket={basket} checkout={checkout} />
          </div>
        )}
      </Sheet>
      <PaySheet open={checkout.payOpen} basket={basket} now={now} onClose={checkout.closePay} onRequote={checkout.requote} requoting={checkout.requoting} onPaid={onPaid} />
      <AddressSheet open={addressOpen} onClose={() => setAddressOpen(false)} address={address} error={addressQ.error} onRetry={() => void addressQ.refetch()} />
    </div>
  );
}

/** Keeps its content mounted; fades and slides in when it becomes the active segment. */
function Pane({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <motion.div role="tabpanel" className="min-h-0 flex-1 flex-col" style={{ display: active ? "flex" : "none" }}
      initial={false} animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }} transition={soft}>
      {children}
    </motion.div>
  );
}

function AccountMenu({ name, onSwitch }: { name: string; onSwitch: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [open]);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${name}`} onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-black/[0.05]">
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold" style={{ background: "#E5E5EA", color: C.label }}>{initials}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, scale: 0.94, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={soft}
            className="absolute right-0 top-12 z-50 w-60 origin-top-right overflow-hidden rounded-[14px] bg-white py-1" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.16)" }}>
            <p className="px-4 pb-1 pt-2 text-[12px]" style={{ color: C.secondary }}>Signed in as {name}</p>
            <button ref={first} role="menuitem" type="button" onClick={() => { setOpen(false); onSwitch(); }} className="block min-h-11 w-full cursor-pointer px-4 text-left text-[15px] hover:bg-black/[0.04]" style={{ color: LINK }}>
              Switch persona
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
