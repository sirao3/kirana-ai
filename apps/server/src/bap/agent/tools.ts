import { Type, type FunctionDeclaration } from "@google/genai";
import {
  formatINR,
  type AgentEvent,
  type BasketView,
  type LooseDeclined,
  type OrderView,
  type PlanChoice,
  type PlanResult,
  type QuoteResponse,
  type QuoteView,
  type SearchResponse,
} from "@kiranaai/shared";
import type { ToolClient } from "./client.js";
import { qtyStatedByCustomer } from "./qty.js";

export const MAX_TOOL_CALLS = 8;

const str = (description: string) => ({ type: Type.STRING, description });
const int = (description: string) => ({ type: Type.INTEGER, description });

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "search_products",
    description: "Search nearby kirana stores for a packaged product. Returns offers grouped by product, cheapest first. Loose (unpackaged) requests come back as looseDeclined with a packaged alternative.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: str("Product text, e.g. 'atta', 'toor dal', 'jeera 100 g'"), max_price_rupees: { type: Type.NUMBER, description: "Optional unit price ceiling in rupees" } },
      required: ["query"],
    },
  },
  {
    name: "plan_basket",
    description: "Deterministic optimiser. Given needs (query + integer pack quantity) and an optional budget, picks the best store for each need across stores, weighing delivery charges. Returns choices with one-line reasons and an ESTIMATE (not a quote).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        needs: {
          type: Type.ARRAY,
          items: { type: Type.OBJECT, properties: { query: str("Product text"), qty: int("Number of packs, integer >= 1") }, required: ["query", "qty"] },
        },
        budget_rupees: { type: Type.NUMBER, description: "Optional total budget in rupees" },
      },
      required: ["needs"],
    },
  },
  {
    name: "set_basket",
    description: "Replace the whole basket with these items. listing_id values come from search_products or plan_basket results.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        items: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { listing_id: str("Listing id from search/plan"), qty: int("Integer packs >= 1") }, required: ["listing_id", "qty"] } },
      },
      required: ["items"],
    },
  },
  {
    name: "update_item",
    description: "Change the quantity of one basket item.",
    parameters: { type: Type.OBJECT, properties: { listing_id: str("Listing id"), qty: int("Integer packs >= 1") }, required: ["listing_id", "qty"] },
  },
  {
    name: "remove_item",
    description: "Remove one item from the basket.",
    parameters: { type: Type.OBJECT, properties: { listing_id: str("Listing id") }, required: ["listing_id"] },
  },
  { name: "view_basket", description: "Show the current basket (items per store, no totals).", parameters: { type: Type.OBJECT, properties: {} } },
  {
    name: "get_quote",
    description: "Get a verified quote (live price, stock, delivery per store, platform fee, grand total) for the current basket. The ONLY source of totals.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "request_approval",
    description: "Show the customer the approval card for the quoted basket. You cannot pay or confirm; the customer does that with a button. Requires a fresh quote from get_quote.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_order_status",
    description: "Read the status of the customer's latest order(s). The ONLY source of order status.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

export interface ToolRun {
  result: unknown;
  ok: boolean;
}

export interface ToolEnv {
  client: ToolClient;
  events: AgentEvent[];
  now?: () => number;
  /** The customer's message this turn: quantities are judged "stated" or "inferred" against it, never by the model. */
  userMessage?: string;
  /** Latest plan_basket output of this turn (server-side). set_basket takes reasons and qty flags from here, not from LLM text. */
  plan?: { choices: PlanChoice[]; reasons: string[] };
}

type Args = Record<string, unknown>;

const fail = (error: string, message?: string): ToolRun => ({ ok: false, result: { error, ...(message ? { message } : {}) } });
const apiFail = (r: { status: number; body: unknown }): ToolRun => {
  const b = (r.body ?? {}) as { error?: string; message?: string; details?: unknown };
  return { ok: false, result: { error: b.error ?? `http_${r.status}`, message: b.message, details: b.details } };
};

const isPosInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

function pushLoose(events: AgentEvent[], list: LooseDeclined[] | undefined) {
  for (const l of list ?? []) {
    if (events.some((e) => e.type === "loose_declined" && e.query === l.query)) continue;
    events.push({ type: "loose_declined", query: l.query, reason: l.reason, alternative: l.alternative });
  }
}

function pushOnce(events: AgentEvent[], e: AgentEvent) {
  if (!events.some((x) => x.type === e.type)) events.push(e);
}

function basketForModel(b: BasketView) {
  return {
    status: b.status,
    itemCount: b.itemCount,
    stores: b.stores.map((s) => ({
      store: s.storeName,
      items: s.items.map((i) => ({ listing_id: i.listingId, name: i.name, qty: i.qty, unitPrice: formatINR(i.seenPricePaise) })),
    })),
  };
}

function quoteForModel(q: QuoteView) {
  return {
    validUntil: q.validUntil,
    itemsTotal: formatINR(q.itemsTotalPaise),
    delivery: formatINR(q.deliveryTotalPaise),
    platformFee: formatINR(q.platformFeePaise),
    grandTotal: formatINR(q.grandTotalPaise),
    stores: q.stores.map((s) => ({
      store: s.storeName,
      lines: s.lines.map((l) => ({ name: l.name, qty: l.qty, unitPrice: formatINR(l.unitPricePaise), priceChanged: l.priceChanged, available: l.available })),
      delivery: formatINR(s.deliveryPaise),
      total: formatINR(s.totalPaise),
    })),
  };
}

export function quoteIsValid(b: BasketView, nowMs: number): b is BasketView & { quote: QuoteView } {
  return b.status === "QUOTED" && !!b.quote && !b.quote.expired && new Date(b.quote.validUntil).getTime() > nowMs;
}

/** Runs one tool. Never throws for API-level problems: they are returned to the model as { error }. */
export async function runTool(name: string, args: Args, env: ToolEnv): Promise<ToolRun> {
  const { client, events } = env;
  switch (name) {
    case "search_products": {
      const q = typeof args.query === "string" ? args.query.trim() : "";
      if (!q) return fail("bad_args", "query is required");
      const r = await client.call("GET", `/bap/search?q=${encodeURIComponent(q)}`);
      if (r.status !== 200) return apiFail(r);
      const s = r.body as SearchResponse;
      const max = typeof args.max_price_rupees === "number" ? Math.round(args.max_price_rupees * 100) : null;
      pushLoose(events, s.looseDeclined);
      return {
        ok: true,
        result: {
          groups: s.groups.slice(0, 6).map((g) => ({
            product: g.name,
            brand: g.brand,
            pack: g.packLabel,
            offers: g.offers
              .filter((o) => max === null || o.pricePaise <= max)
              .slice(0, 5)
              .map((o) => ({ listing_id: o.listingId, store: o.storeName, unitPrice: formatINR(o.pricePaise), distance: km(o.distanceM), delivery: o.deliveryChargePaise === null ? null : formatINR(o.deliveryChargePaise) })),
          })),
          looseDeclined: s.looseDeclined,
        },
      };
    }
    case "plan_basket": {
      const needs = Array.isArray(args.needs) ? (args.needs as Args[]) : [];
      if (!needs.length) return fail("bad_args", "needs must be a non-empty list");
      for (const n of needs) {
        if (typeof n.query !== "string" || !isPosInt(n.qty)) return fail("bad_args", "each need needs a query and an integer qty >= 1");
      }
      const budget = typeof args.budget_rupees === "number" ? Math.round(args.budget_rupees * 100) : undefined;
      const r = await client.call("POST", "/bap/plan", { needs: needs.map((n) => ({ query: n.query, qty: n.qty })), ...(budget ? { budgetPaise: budget } : {}) });
      if (r.status !== 200) return apiFail(r);
      const p = r.body as PlanResult;
      pushLoose(events, p.looseDeclined);
      const choices = p.choices.map((c) => ({ ...c, qtyInferred: env.userMessage !== undefined && !qtyStatedByCustomer(env.userMessage, c.query, c.qty) }));
      env.plan = { choices, reasons: p.reasons };
      return {
        ok: true,
        result: {
          note: "estimate only, not a quote; call set_basket then get_quote",
          choices: choices.map((c) => ({ query: c.query, qty: c.qty, ...(c.qtyInferred ? { qty_suggested: true } : {}), listing_id: c.offer.listingId, product: c.offer.name, store: c.offer.storeName, unitPrice: formatINR(c.offer.pricePaise), reason: c.reason })),
          stores: p.stores.map((s) => ({ store: s.storeName, items: formatINR(s.itemsTotalPaise), delivery: formatINR(s.deliveryPaise) })),
          estimatedTotal: formatINR(p.estimatedTotalPaise),
          withinBudget: p.withinBudget,
          reasons: p.reasons,
          unmatched: p.unmatched,
          looseDeclined: p.looseDeclined,
        },
      };
    }
    case "set_basket": {
      const items = Array.isArray(args.items) ? (args.items as Args[]) : [];
      if (!items.length) return fail("bad_args", "items must be a non-empty list");
      for (const i of items) {
        if (typeof i.listing_id !== "string" || !isPosInt(i.qty)) return fail("bad_args", "each item needs listing_id and an integer qty >= 1");
      }
      // Reasons and "suggested qty" flags come from the last plan_basket result held server-side, never from model text.
      const planned = new Map((env.plan?.choices ?? []).map((c) => [c.offer.listingId, c]));
      const body = {
        items: items.map((i) => {
          const c = planned.get(i.listing_id as string);
          if (!c) return { listingId: i.listing_id, qty: i.qty };
          const inferred = i.qty === c.qty ? !!c.qtyInferred : env.userMessage !== undefined && !qtyStatedByCustomer(env.userMessage, c.query, i.qty as number);
          return { listingId: i.listing_id, qty: i.qty, reason: c.reason, qtyInferred: inferred };
        }),
        ...(env.plan?.reasons.length && planned.size ? { planReasons: env.plan.reasons } : {}),
      };
      const r = await client.call("PUT", "/bap/basket", body);
      if (r.status !== 200) return apiFail(r);
      pushOnce(events, { type: "basket_updated" });
      return { ok: true, result: basketForModel(r.body as BasketView) };
    }
    case "update_item": {
      if (typeof args.listing_id !== "string" || !isPosInt(args.qty)) return fail("bad_args", "listing_id and integer qty >= 1 required");
      const r = await client.call("PATCH", `/bap/basket/items/${encodeURIComponent(args.listing_id)}`, { qty: args.qty });
      if (r.status !== 200) return apiFail(r);
      pushOnce(events, { type: "basket_updated" });
      return { ok: true, result: basketForModel(r.body as BasketView) };
    }
    case "remove_item": {
      if (typeof args.listing_id !== "string") return fail("bad_args", "listing_id required");
      const r = await client.call("DELETE", `/bap/basket/items/${encodeURIComponent(args.listing_id)}`);
      if (r.status !== 200) return apiFail(r);
      pushOnce(events, { type: "basket_updated" });
      return { ok: true, result: basketForModel(r.body as BasketView) };
    }
    case "view_basket": {
      const r = await client.call("GET", "/bap/basket");
      if (r.status !== 200) return apiFail(r);
      return { ok: true, result: basketForModel(r.body as BasketView) };
    }
    case "get_quote": {
      const r = await client.call("POST", "/bap/basket/quote", {});
      if (r.status !== 200) return apiFail(r);
      const q = r.body as QuoteResponse;
      pushOnce(events, { type: "basket_updated" });
      if (!q.quote) return { ok: false, result: { error: "quote_failed", problems: q.errors.map((e) => ({ store: e.storeName, code: e.code, message: e.message, listing_ids: e.listingIds })), hint: "fix the basket (remove or change the affected items) and call get_quote again" } };
      pushOnce(events, { type: "quote_ready", quoteId: q.quote.id, grandTotalPaise: q.quote.grandTotalPaise });
      return { ok: true, result: quoteForModel(q.quote) };
    }
    case "request_approval": {
      const r = await client.call("GET", "/bap/basket");
      if (r.status !== 200) return apiFail(r);
      const b = r.body as BasketView;
      if (!quoteIsValid(b, (env.now ?? Date.now)())) {
        return { ok: false, result: { error: "no_valid_quote", message: "There is no valid, unexpired quote for the current basket. Call get_quote first, then request_approval." } };
      }
      pushOnce(events, { type: "approval_requested", basketId: b.id, quoteHash: b.quote.quoteHash, grandTotalPaise: b.quote.grandTotalPaise });
      return { ok: true, result: { status: "awaiting_customer" } };
    }
    case "get_order_status": {
      const r = await client.call("GET", "/bap/orders");
      if (r.status !== 200) return apiFail(r);
      const orders = (r.body as OrderView[]).slice(0, 3);
      if (!orders.length) return { ok: true, result: { orders: [], message: "no orders yet" } };
      return {
        ok: true,
        result: {
          orders: orders.map((o) => ({
            basketId: o.basketId,
            payment: o.paymentStatus,
            basketStatus: o.basketStatus,
            settled: o.settled,
            refunded: o.refundedPaise ? formatINR(o.refundedPaise) : null,
            subOrders: o.subOrders.map((s) => ({
              store: s.currentStoreName ?? s.approvedStoreName,
              status: s.status,
              attempt: `${s.attemptCount}/${s.maxAttempts}`,
              items: s.lines.map((l) => `${l.qty} x ${l.name}`),
            })),
          })),
        },
      };
    }
    default:
      return fail("unknown_tool", name);
  }
}

/** Short, data-derived text for the live progress list (UX-01). Built from the tool result, never from model text. */
export function summarizeStep(name: string, run: ToolRun): string {
  const res = (run.result ?? {}) as Record<string, unknown>;
  if (!run.ok) return typeof res.error === "string" ? res.error.replaceAll("_", " ") : "failed";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  switch (name) {
    case "search_products": {
      const groups = (res.groups ?? []) as { offers?: { store?: string }[] }[];
      const offers = groups.flatMap((g) => g.offers ?? []);
      const stores = new Set(offers.map((o) => o.store));
      return offers.length ? `${plural(stores.size, "store")} · ${plural(offers.length, "offer")}` : "no matches";
    }
    case "plan_basket": {
      const stores = ((res.stores ?? []) as unknown[]).length;
      return `${plural(stores, "store")} · est ${String(res.estimatedTotal ?? "")}`.trim();
    }
    case "set_basket":
    case "update_item":
    case "remove_item":
    case "view_basket": {
      const stores = (res.stores ?? []) as { items?: unknown[] }[];
      const items = stores.reduce((n, s) => n + (s.items?.length ?? 0), 0);
      return `${plural(items, "item")} · ${plural(stores.length, "store")}`;
    }
    case "get_quote":
      return `${String(res.grandTotal ?? "")} verified`.trim();
    case "request_approval":
      return "Approval card shown";
    case "get_order_status": {
      const n = ((res.orders ?? []) as unknown[]).length;
      return n ? plural(n, "order") : "no orders yet";
    }
    default:
      return "done";
  }
}
