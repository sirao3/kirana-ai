import { describe, expect, it } from "vitest";
import type { BasketView } from "@kiranaai/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BasketPanel, CheckoutButton, quoteIsLive } from "./BasketPanel";
import type { Checkout } from "./useCheckout";
import { eventChip, StepList } from "./ChatPanel";
import { isAgentDown } from "./errors";
import { ApiError } from "../../lib/api";

const basket = (over: Partial<BasketView> = {}): BasketView => ({
  id: "b", status: "QUOTED", transactionId: "t", stores: [], itemCount: 0,
  quote: { id: "q", quoteHash: "h", validUntil: new Date(Date.now() + 60_000).toISOString(), expired: false, itemsTotalPaise: 0, deliveryTotalPaise: 0, platformFeePaise: 0, grandTotalPaise: 0, stores: [] },
  ...over,
});

describe("shop logic", () => {
  it("quoteIsLive needs a QUOTED, unexpired quote", () => {
    expect(quoteIsLive(basket())).toBe(true);
    expect(quoteIsLive(basket({ status: "DRAFT" }))).toBe(false);
    expect(quoteIsLive(basket({ quote: null }))).toBe(false);
    expect(quoteIsLive(basket({ quote: { ...basket().quote!, expired: true } }))).toBe(false);
    expect(quoteIsLive(basket({ quote: { ...basket().quote!, validUntil: new Date(Date.now() - 1000).toISOString() } }))).toBe(false);
  });

  it("event chips use API amounts", () => {
    expect(eventChip({ type: "quote_ready", quoteId: "q", grandTotalPaise: 138000 }).text).toBe("Quote ready · ₹1,380");
    expect(eventChip({ type: "loose_declined", query: "250 g jeera", reason: "r", alternative: { canonicalProductId: "c", name: "Jeera 100 g", packLabel: "100 g" } }).text).toContain("Jeera 100 g");
  });

  it("503, network errors and timeouts mean the agent is down; 4xx does not", () => {
    expect(isAgentDown(new ApiError(503, "agent_unavailable"))).toBe(true);
    expect(isAgentDown(new TypeError("Failed to fetch"))).toBe(true);
    expect(isAgentDown(new ApiError(400, "bad_request"))).toBe(false);
  });
});

describe("agent progress and basket reasons (static render)", () => {
  const wrap = (el: React.ReactElement) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));

  it("StepList shows label, summary and a spinner on the running step", () => {
    const now = new Date().toISOString();
    const html = renderToStaticMarkup(
      createElement(StepList, {
        steps: [
          { tool: "search_products", ok: true, startedAt: now, endedAt: now, summary: "5 stores · 14 offers" },
          { tool: "plan_basket", ok: null, startedAt: now, endedAt: null, summary: null },
        ],
      }),
    );
    expect(html).toContain("Searched stores");
    expect(html).toContain("5 stores · 14 offers");
    expect(html).toMatch(/Compared stores.*in progress/);
  });

  it("BasketPanel shows reason, the suggested marker, plan reasons and the confirm prompt; the CTA confirms first", () => {
    const item = (over: object) => ({ listingId: "l1", storeId: "s1", storeName: "Gupta", canonicalProductId: "c", name: "Atta 10 kg", qty: 2, seenPricePaise: 45000, lineTotalPaise: 90000, ...over });
    const b = basket({
      status: "DRAFT", quote: null, itemCount: 2, planReasons: ["Adding Lakshmi saves ₹38 even after ₹30 delivery"],
      stores: [{ storeId: "s1", storeName: "Gupta", itemsTotalPaise: 180000, items: [item({ reason: "₹12 cheaper than Sharma", qtyInferred: true }), item({ listingId: "l2", name: "Tea", reason: null })] }],
    });
    const html = wrap(createElement(BasketPanel, { basket: b, now: Date.now(), quoteErrors: [] }));
    expect(html).toContain("₹12 cheaper than Sharma");
    expect(html.match(/>suggested</g)).toHaveLength(1);
    expect(html).toContain("Adding Lakshmi saves");
    expect(html).toContain("We guessed 1 quantity");
    const checkout = { busy: false, error: null, primary: () => undefined } as unknown as Checkout;
    expect(wrap(createElement(CheckoutButton, { basket: b, checkout }))).toContain("Quantities look right");
    const confirmed = basket({ ...b, stores: [{ ...b.stores[0]!, items: b.stores[0]!.items.map((i) => ({ ...i, qtyInferred: false })) }] });
    const none = wrap(createElement(CheckoutButton, { basket: confirmed, checkout }));
    expect(none).not.toContain("Quantities look right");
    expect(none).toContain("Get verified total");
  });
});
