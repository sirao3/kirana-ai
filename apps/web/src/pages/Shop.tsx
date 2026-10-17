import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentEvent, StoreQuoteError } from "@kiranaai/shared";
import { formatINR } from "../lib/format";
import { useLive } from "../lib/live";
import { setSession } from "../lib/session";
import { useRequireSession } from "../lib/useSession";
import { Badge, Button, Card } from "../components/kit";
import { bap } from "../components/shop/bap";
import { ApprovalCard } from "../components/shop/ApprovalCard";
import { BasketPanel, quoteIsLive } from "../components/shop/BasketPanel";
import { ChatPanel } from "../components/shop/ChatPanel";
import { errorMessage } from "../components/shop/errors";
import { ManualPanel } from "../components/shop/ManualPanel";
import { QuotePanel } from "../components/shop/QuotePanel";

type Tab = "assistant" | "manual";

/** Customer shopping: chat + manual mode on the left; basket, quote and approval on the right. */
export function Shop() {
  const session = useRequireSession("customer");
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("assistant");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [quoteErrors, setQuoteErrors] = useState<StoreQuoteError[]>([]);
  const [agentDown, setAgentDown] = useState<"unavailable" | "rate_limited" | null>(null);

  const basketQ = useLive(["basket"], bap.basket, { enabled: !!session });
  const orders = useQuery({ queryKey: ["orders"], queryFn: bap.orders, enabled: !!session, refetchInterval: 5000 });

  const quote = useMutation({
    mutationFn: bap.quote,
    onSuccess: (r) => {
      qc.setQueryData(["basket"], r.basket);
      setQuoteErrors(r.errors);
      if (r.quote) setApprovalOpen(true);
    },
  });

  if (!session) return null;
  const basket = basketQ.data;

  function onEvents(events: AgentEvent[]) {
    setQuoteErrors([]);
    void qc.invalidateQueries({ queryKey: ["basket"] });
    if (events.some((e) => e.type === "approval_requested")) setApprovalOpen(true);
  }

  function checkout() {
    if (basket && quoteIsLive(basket)) setApprovalOpen(true);
    else quote.mutate();
  }

  const showApproval = approvalOpen && !!basket && quoteIsLive(basket);

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">KiranaAI</h1>
          <p className="text-sm text-stone-600">Shopping as {session.name}</p>
        </div>
        <Button
          tone="ghost"
          onClick={() => {
            setSession(null);
            nav("/");
          }}
        >
          Switch persona
        </Button>
      </header>

      {agentDown && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span>
            {agentDown === "rate_limited"
              ? "The assistant is busy (too many requests). Please wait a bit, or shop manually."
              : "The assistant is unavailable right now. You can still search and build your basket manually."}
          </span>
          <Button tone="secondary" onClick={() => setTab("manual")}>Use manual mode</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div role="tablist" className="flex gap-1 rounded-lg bg-stone-200 p-1 text-sm">
            {(["assistant", "manual"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === t ? "bg-white shadow-sm" : "text-stone-600"}`}
                onClick={() => setTab(t)}
              >
                {t === "assistant" ? "Assistant" : "Manual"}
              </button>
            ))}
          </div>
          <div className={tab === "assistant" ? "" : "hidden"}>
            <ChatPanel onEvents={onEvents} onAgentDown={setAgentDown} onUseManual={() => setTab("manual")} />
          </div>
          <div className={tab === "manual" ? "" : "hidden"}>
            <ManualPanel basketItemIds={new Set(basket?.stores.flatMap((s) => s.items.map((i) => i.listingId)) ?? [])} />
          </div>
        </div>

        <div className="space-y-4">
          {showApproval && basket && (
            <ApprovalCard
              basket={basket}
              onClose={() => setApprovalOpen(false)}
              onPaid={(id) => nav(`/shop/orders/${id}`)}
              onRequote={() => quote.mutate()}
            />
          )}
          {basketQ.isError && !basket ? (
            <Card><p className="text-sm text-rose-700">Could not load your basket: {errorMessage(basketQ.error)}</p></Card>
          ) : basket ? (
            <>
              <BasketPanel
                basket={basket}
                onCheckout={checkout}
                checkingOut={quote.isPending}
                error={quote.error ? errorMessage(quote.error) : null}
              />
              <QuotePanel basket={basket} errors={quoteErrors} />
            </>
          ) : (
            <Card><p className="text-sm text-stone-500">Loading basket…</p></Card>
          )}
          {orders.data && orders.data.length > 0 && (
            <Card title="Your orders">
              <ul className="divide-y divide-stone-100 text-sm">
                {orders.data.slice(0, 5).map((o) => (
                  <li key={o.basketId} className="flex items-center justify-between gap-2 py-2">
                    <Link className="text-emerald-700 underline" to={`/shop/orders/${o.basketId}`}>
                      {formatINR(o.grandTotalPaise)} · {o.subOrders.length} store{o.subOrders.length === 1 ? "" : "s"}
                    </Link>
                    <Badge tone={o.settled ? "good" : o.paymentStatus === "PAID" ? "info" : "neutral"}>{o.settled ? "settled" : o.paymentStatus.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
