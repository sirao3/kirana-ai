import { describe, expect, it } from "vitest";
import type { BasketView } from "@kiranaai/shared";
import { quoteIsLive } from "./BasketPanel";
import { eventChip } from "./ChatPanel";
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
