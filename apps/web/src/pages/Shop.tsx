import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentEvent, BasketView, StoreQuoteError } from "@kiranaai/shared";
import { formatINR } from "../lib/format";
import { useLive } from "../lib/live";
import { useRequireSession } from "../lib/useSession";
import { Badge, BottomSheet, Button, CircularProgress, Fab, IconButton, InlineMessage, TabPanel, Tabs } from "../components/m3";
import { EXPANDED, useMedia } from "../lib/useMedia";
import { bap } from "../components/shop/bap";
import { ApprovalDialog } from "../components/shop/ApprovalCard";
import { BasketPanel, quoteIsLive } from "../components/shop/BasketPanel";
import { ChatPanel } from "../components/shop/ChatPanel";
import { CustomerShell } from "../components/shop/CustomerShell";
import { errorMessage } from "../components/shop/errors";
import { ManualPanel } from "../components/shop/ManualPanel";

type Tab = "assistant" | "search";

/**
 * Customer shopping. Primary pane: Assistant / Search tabs. Supporting pane (≥840 px): the basket.
 * Below 840 px the basket lives in a bottom sheet opened from an extended FAB. Approve & pay is a dialog.
 */
export function Shop() {
  const session = useRequireSession("customer");
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("assistant");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quoteErrors, setQuoteErrors] = useState<StoreQuoteError[]>([]);
  const [confirmQty, setConfirmQty] = useState(false);
  const [agentDown, setAgentDown] = useState<"unavailable" | "rate_limited" | null>(null);

  const basketQ = useLive(["basket"], bap.basket, { enabled: !!session });
  const wide = useMedia(EXPANDED);

  const quote = useMutation({
    mutationFn: bap.quote,
    onSuccess: (r) => {
      qc.setQueryData(["basket"], r.basket);
      setQuoteErrors(r.errors);
      if (r.quote) {
        setSheetOpen(false); // never stack the dialog on the sheet
        setApprovalOpen(true);
      } else {
        setSheetOpen(!window.matchMedia(EXPANDED).matches);
      }
    },
  });

  const confirm = useMutation({
    mutationFn: bap.confirmQty,
    onSuccess: (b) => {
      qc.setQueryData(["basket"], b);
      setConfirmQty(false);
      proceed(b);
    },
  });

  if (!session) return null;
  const basket = basketQ.data;
  const hasSuggested = (b?: BasketView) => !!b?.stores.some((s) => s.items.some((i) => i.qtyInferred));

  function onEvents(events: AgentEvent[]) {
    setQuoteErrors([]);
    const approval = events.some((e) => e.type === "approval_requested");
    // An agent event may only open the dialog (never approve or pay). Suggested quantities are checked first.
    void qc.invalidateQueries({ queryKey: ["basket"] }).then(async () => {
      if (!approval) return;
      const fresh = (await basketQ.refetch()).data ?? qc.getQueryData<BasketView>(["basket"]);
      if (hasSuggested(fresh)) askToConfirm();
      else setApprovalOpen(true);
    });
  }

  /** Quote (or open the dialog for a live quote). */
  function proceed(b: BasketView | undefined) {
    setSheetOpen(false);
    if (b && quoteIsLive(b)) setApprovalOpen(true);
    else quote.mutate();
  }

  function askToConfirm() {
    setApprovalOpen(false);
    setConfirmQty(true);
    openBasket();
  }

  function review() {
    if (hasSuggested(basket)) askToConfirm();
    else proceed(basket);
  }

  const basketView = basketQ.isError && !basket ? (
    <InlineMessage tone="error" action={<Button variant="text" onClick={() => void basketQ.refetch()}>Retry</Button>}>
      Could not load your basket: {errorMessage(basketQ.error)}
    </InlineMessage>
  ) : basket ? (
    <BasketPanel basket={basket} onCheckout={review} checkingOut={quote.isPending} error={quote.error ? errorMessage(quote.error) : null} quoteErrors={quoteErrors}
      confirmQty={confirmQty}
      confirmingQty={confirm.isPending}
      onConfirmQty={() => confirm.mutate()}
      onEditQty={() => setConfirmQty(false)}
    />
  ) : (
    <div className="flex items-center gap-3 py-6 type-body-medium text-on-surface-variant">
      <CircularProgress size={20} className="text-primary" /> Loading basket…
    </div>
  );

  const openBasket = () => {
    if (wide) document.getElementById("basket-title")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    else setSheetOpen(true);
  };
  const live = basket ? quoteIsLive(basket) : false;
  const fabTotal = basket ? (live && basket.quote ? basket.quote.grandTotalPaise : basket.stores.reduce((s, g) => s + g.itemsTotalPaise, 0)) : 0;

  return (
    <CustomerShell
      session={session}
      active="shop"
      title="Shop"
      subtitle={`Shopping as ${session.name}`}
      actions={
        !wide && (
          <span className="relative inline-flex">
            <IconButton icon="shopping_basket" label={`Basket, ${basket?.itemCount ?? 0} items`} onClick={() => setSheetOpen(true)} />
            <Badge count={basket?.itemCount ?? 0} />
          </span>
        )
      }
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 gap-6 px-4 sm:px-6">
        {/* Primary pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          {agentDown && (
            <InlineMessage
              tone="warning"
              className="mb-2"
              title={agentDown === "rate_limited" ? "The assistant is busy" : "The assistant is unavailable"}
              action={<Button variant="tonal" size="sm" icon="search" onClick={() => setTab("search")}>Search instead</Button>}
            >
              {agentDown === "rate_limited" ? "Too many requests right now. Wait a moment, or search and build your basket yourself." : "You can still search and build your basket yourself."}
            </InlineMessage>
          )}
          <Tabs
            label="How to shop"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "assistant", label: "Assistant", icon: "auto_awesome" },
              { value: "search", label: "Search & plan", icon: "manage_search" },
            ]}
          />
          <TabPanel value="assistant" active={tab} className="mx-auto h-[calc(100dvh-64px-48px-80px)] min-h-[420px] w-full max-w-3xl sm:h-[calc(100dvh-64px-48px)]">
            <ChatPanel onEvents={onEvents} onAgentDown={setAgentDown} onUseManual={() => setTab("search")} onOpenBasket={openBasket} onReview={review} />
          </TabPanel>
          <TabPanel value="search" active={tab} className="mx-auto w-full max-w-3xl pb-28 md:pb-8">
            <ManualPanel basketItemIds={new Set(basket?.stores.flatMap((s) => s.items.map((i) => i.listingId)) ?? [])} onOpenBasket={openBasket} />
          </TabPanel>
        </div>

        {/* Supporting pane: the basket, always visible from 840 px */}
        {wide && (
          <aside aria-label="Basket" className="sticky top-16 max-h-[calc(100dvh-80px)] w-[380px] shrink-0 self-start overflow-y-auto rounded-xl bg-surface-container-low p-4 lg:w-[420px]">
            {basketView}
          </aside>
        )}
      </div>

      {/* Below 840 px: basket in a bottom sheet, opened from the app bar or (on Search) an extended FAB */}
      {!wide && tab === "search" && basket && basket.itemCount > 0 && !sheetOpen && (
        <Fab
          icon="shopping_basket"
          label="Open basket"
          className="fixed bottom-24 right-4 z-20 sm:bottom-6 sm:right-6"
          onClick={() => setSheetOpen(true)}
          extended={
            <span>
              Basket · {basket.itemCount} · {formatINR(fabTotal)}
            </span>
          }
        />
      )}
      {!wide && (
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Basket">
          {basketView}
        </BottomSheet>
      )}

      {basket && basket.quote && (
        <ApprovalDialog
          open={approvalOpen}
          basket={basket}
          onClose={() => setApprovalOpen(false)}
          onPaid={(id) => nav(`/shop/orders/${id}`)}
          onRequote={() => quote.mutate()}
          requoting={quote.isPending}
        />
      )}
    </CustomerShell>
  );
}
