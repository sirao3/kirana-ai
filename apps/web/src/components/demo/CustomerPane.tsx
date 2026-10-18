import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentEvent, OrderView, StoreQuoteError } from "@kiranaai/shared";
import { useLive } from "../../lib/live";
import { Button, CircularProgress, EmptyState, InlineMessage, TabPanel, Tabs } from "../m3";
import { ApprovalDialog } from "../shop/ApprovalCard";
import { BasketPanel, quoteIsLive } from "../shop/BasketPanel";
import { bap } from "../shop/bap";
import { ChatPanel } from "../shop/ChatPanel";
import { errorMessage } from "../shop/errors";
import { ManualPanel } from "../shop/ManualPanel";
import { OrderDetail } from "../shop/OrderDetail";

type Tab = "assistant" | "search" | "basket" | "order";

/**
 * The customer half of the /demo cockpit: the Shop experience (assistant, search & plan, basket, approve & pay) and the
 * live order, in one pane with tabs. It reads the tab's customer session through `api()`, which /demo guarantees.
 * Paying switches to the Order tab, so the presenter never leaves the screen.
 */
export function CustomerPane({ order }: { order: OrderView | null }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("assistant");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [quoteErrors, setQuoteErrors] = useState<StoreQuoteError[]>([]);
  const [agentDown, setAgentDown] = useState<"unavailable" | "rate_limited" | null>(null);
  const basketQ = useLive(["basket"], bap.basket);
  const basket = basketQ.data;

  // The first time a paid order appears in this session, follow it.
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (order?.paymentStatus === "PAID" && followed.current !== order.basketId) {
      followed.current = order.basketId;
      setApprovalOpen(false);
      setTab("order");
    }
  }, [order]);

  const quote = useMutation({
    mutationFn: bap.quote,
    onSuccess: (r) => {
      qc.setQueryData(["basket"], r.basket);
      setQuoteErrors(r.errors);
      if (r.quote) setApprovalOpen(true);
      else setTab("basket");
    },
  });

  function onEvents(events: AgentEvent[]) {
    setQuoteErrors([]);
    void qc.invalidateQueries({ queryKey: ["basket"] });
    if (events.some((e) => e.type === "approval_requested")) setApprovalOpen(true);
  }
  function review() {
    if (basket && quoteIsLive(basket)) setApprovalOpen(true);
    else quote.mutate();
  }

  const basketView = basketQ.isError && !basket ? (
    <InlineMessage tone="error" action={<Button variant="text" onClick={() => void basketQ.refetch()}>Retry</Button>}>
      Could not load your basket: {errorMessage(basketQ.error)}
    </InlineMessage>
  ) : basket ? (
    <BasketPanel basket={basket} onCheckout={review} checkingOut={quote.isPending} error={quote.error ? errorMessage(quote.error) : null} quoteErrors={quoteErrors} />
  ) : (
    <div className="flex items-center gap-3 py-6 type-body-medium text-on-surface-variant">
      <CircularProgress size={20} className="text-primary" /> Loading basket…
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {agentDown && (
        <InlineMessage
          tone="warning"
          className="mb-2"
          title={agentDown === "rate_limited" ? "The assistant is busy" : "The assistant is unavailable"}
          action={<Button variant="tonal" size="sm" icon="search" onClick={() => setTab("search")}>Search instead</Button>}
        >
          You can still search and build the basket by hand.
        </InlineMessage>
      )}
      <Tabs
        label="Customer view"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "assistant", label: "Assistant", icon: "auto_awesome" },
          { value: "search", label: "Search & plan", icon: "manage_search" },
          { value: "basket", label: "Basket", icon: "shopping_basket", badge: basket?.itemCount },
          { value: "order", label: "Order", icon: "receipt_long" },
        ]}
      />
      <TabPanel value="assistant" active={tab} className="min-h-0 flex-1 overflow-hidden">
        <ChatPanel onEvents={onEvents} onAgentDown={setAgentDown} onUseManual={() => setTab("search")} onOpenBasket={() => setTab("basket")} onReview={review} />
      </TabPanel>
      <TabPanel value="search" active={tab} className="min-h-0 flex-1 overflow-y-auto py-3">
        <ManualPanel basketItemIds={new Set(basket?.stores.flatMap((s) => s.items.map((i) => i.listingId)) ?? [])} onOpenBasket={() => setTab("basket")} />
      </TabPanel>
      <TabPanel value="basket" active={tab} className="min-h-0 flex-1 overflow-y-auto py-3">{basketView}</TabPanel>
      <TabPanel value="order" active={tab} className="min-h-0 flex-1 overflow-y-auto py-3">
        {order ? (
          <OrderDetail order={order} />
        ) : (
          <EmptyState icon="receipt_long" title="No order yet">After you approve and pay, each store's progress shows up here.</EmptyState>
        )}
      </TabPanel>

      {basket && basket.quote && (
        <ApprovalDialog
          open={approvalOpen}
          basket={basket}
          onClose={() => setApprovalOpen(false)}
          onPaid={() => setTab("order")}
          onRequote={() => quote.mutate()}
          requoting={quote.isPending}
        />
      )}
    </div>
  );
}
