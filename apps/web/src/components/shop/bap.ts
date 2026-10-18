import type {
  AgentHistoryMessage,
  AgentReply,
  AgentTurnProgress,
  ApproveResponse,
  BasketPutItem,
  BasketView,
  OrderView,
  PayResponse,
  PlanNeed,
  PlanResult,
  QuoteResponse,
  SearchResponse,
} from "@kiranaai/shared";
import { api } from "../../lib/api";

/** Typed calls to the BAP HTTP API (packages/shared/src/api.ts). */
export const bap = {
  basket: () => api<BasketView>("/bap/basket"),
  search: (q: string) => api<SearchResponse>(`/bap/search?q=${encodeURIComponent(q)}`),
  addItem: (listingId: string, qty: number) => api<BasketView>("/bap/basket/items", { method: "PUT", json: { listingId, qty } }),
  setQty: (listingId: string, qty: number) =>
    api<BasketView>(`/bap/basket/items/${encodeURIComponent(listingId)}`, { method: "PATCH", json: { qty } }),
  remove: (listingId: string) => api<BasketView>(`/bap/basket/items/${encodeURIComponent(listingId)}`, { method: "DELETE" }),
  replace: (items: BasketPutItem[], planReasons?: string[]) =>
    api<BasketView>("/bap/basket", { method: "PUT", json: { items, ...(planReasons?.length ? { planReasons } : {}) } }),
  /** "Looks right": clears every suggested-quantity flag. */
  confirmQty: () => api<BasketView>("/bap/basket/confirm-qty", { method: "POST", json: {} }),
  plan: (needs: PlanNeed[], budgetPaise?: number) =>
    api<PlanResult>("/bap/plan", { method: "POST", json: { needs, ...(budgetPaise ? { budgetPaise } : {}) } }),
  quote: () => api<QuoteResponse>("/bap/basket/quote", { method: "POST", json: {} }),
  approve: (basketId: string, quoteHash: string) =>
    api<ApproveResponse>(`/bap/baskets/${encodeURIComponent(basketId)}/approve`, { method: "POST", json: { quoteHash } }),
  pay: (basketId: string, approvalToken: string, simulateFailure: boolean, idempotencyKey: string) =>
    api<PayResponse>(`/bap/baskets/${encodeURIComponent(basketId)}/pay`, {
      method: "POST",
      json: { approvalToken, simulateFailure },
      headers: { "Idempotency-Key": idempotencyKey },
    }),
  order: (basketId: string) => api<OrderView>(`/bap/baskets/${encodeURIComponent(basketId)}`),
  orders: () => api<OrderView[]>("/bap/orders"),
  chat: (message: string, turnId?: string) =>
    api<AgentReply>("/bap/agent/chat", { method: "POST", json: { message, ...(turnId ? { turnId } : {}) }, signal: AbortSignal.timeout(30_000) }),
  /** Live tool steps of a running agent turn (404 until the server has registered it). */
  turn: (turnId: string) => api<AgentTurnProgress>(`/bap/agent/turns/${encodeURIComponent(turnId)}`),
  chatHistory: () => api<{ messages: AgentHistoryMessage[] }>("/bap/agent/history"),
  chatReset: () => api<{ ok: boolean }>("/bap/agent/reset", { method: "POST", json: {} }),
};

/** A fresh key per payment attempt (CHK-07). */
export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
