/**
 * BAP HTTP API contract (/bap/*). Lane B implements it; the web app (lane C) and the agent's
 * tools (lane C, loopback HTTP) consume it. Change it only with the other lanes in mind.
 *
 * Auth: `Authorization: Bearer <customer token>` (POST /auth/persona) on every route below
 * except /bap/admin/* (admin token). Money is integer paise; quantities are integer packs.
 * Errors: non-2xx with { error: string, message?: string, details?: unknown }.
 */

export type BasketStatus =
  | "DRAFT" | "QUOTED" | "EXPIRED" | "APPROVED" | "PAYMENT_INITIATED" | "PAID" | "PAYMENT_FAILED"
  | "PARTIALLY_REFUNDED" | "REFUNDED" | "SETTLED";
export type SubOrderStatus =
  | "DISPATCHING" | "ACCEPTED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED_NO_FULFILMENT";
export type AttemptStatus = "PENDING" | "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
export type PaymentStatus = "NONE" | "INITIATED" | "PAID" | "FAILED";

// ---------- Discovery: GET /bap/search?q=<text> ----------

export interface SearchOffer {
  listingId: string;
  storeId: string;
  storeName: string;
  bppId: string;
  bppUri: string;
  canonicalProductId: string;
  name: string;
  brand: string;
  /** e.g. "10 kg" */
  packLabel: string;
  pricePaise: number;
  mrpPaise: number;
  stockQty: number;
  distanceM: number;
  /** This store's delivery charge for this customer for a basket of just this item; null if unknown. */
  deliveryChargePaise: number | null;
  /** Search data is catalogue stock; quotes are "verified". */
  badge: "catalogue";
}

export interface SearchGroup {
  canonicalProductId: string;
  name: string;
  brand: string;
  packLabel: string;
  /** Cheapest first. */
  offers: SearchOffer[];
}

export interface LooseDeclined {
  query: string;
  reason: string;
  alternative: { canonicalProductId: string; name: string; packLabel: string; listingId?: string } | null;
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  looseDeclined: LooseDeclined[];
  tookMs: number;
}

// ---------- Suggestions: GET /bap/suggest?q= → SuggestResponse (autocomplete from the catalogue; synonyms expand in the BPP) ----------

export interface Suggestion {
  canonicalProductId: string;
  name: string;
  packLabel: string;
  /** Cheapest catalogue price seen across stores. */
  fromPricePaise: number;
}

export interface SuggestResponse {
  query: string;
  suggestions: Suggestion[];
}

// ---------- Basket ----------
// GET    /bap/basket                       → BasketView (customer's open basket; creates a DRAFT if none)
// PUT    /bap/basket       {items:[{listingId, qty}]}  → BasketView (replace all; agent set_basket)
// PUT    /bap/basket/items {listingId, qty}            → BasketView (add or set qty)
// PATCH  /bap/basket/items/:listingId {qty}           → BasketView
// DELETE /bap/basket/items/:listingId                 → BasketView
// listingId must be one the BAP has seen in an on_search (it resolves store/price from that).
// Any edit of a QUOTED/EXPIRED basket moves it back to DRAFT.

export interface BasketItemView {
  listingId: string;
  storeId: string;
  storeName: string;
  canonicalProductId: string;
  name: string;
  qty: number;
  seenPricePaise: number;
  lineTotalPaise: number;
  /** Why the optimiser chose this store (from plan_basket output, never LLM text). Cleared when the line is added manually. */
  reason?: string | null;
  /** True while the quantity is a suggestion the customer has not confirmed or edited. */
  qtyInferred?: boolean;
}

export interface BasketStoreGroup {
  storeId: string;
  storeName: string;
  items: BasketItemView[];
  itemsTotalPaise: number;
}

export interface BasketView {
  id: string;
  status: BasketStatus;
  transactionId: string;
  stores: BasketStoreGroup[];
  itemCount: number;
  /** Latest quote, if any (check `expired`). */
  quote: QuoteView | null;
  /** Basket-level optimiser reasons stored with the last plan-derived PUT /bap/basket. */
  planReasons?: string[];
}

// PUT /bap/basket also accepts per item `reason?: string|null`, `qtyInferred?: boolean`, and top level `planReasons?: string[]`.
// POST /bap/basket/confirm-qty clears every qtyInferred flag on the open basket (the "Looks right" button) → BasketView.
export interface BasketPutItem {
  listingId: string;
  qty: number;
  reason?: string | null;
  qtyInferred?: boolean;
}

// ---------- Quote: POST /bap/basket/quote → QuoteResponse ----------

export interface QuoteLineView {
  listingId: string;
  canonicalProductId: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  seenPricePaise: number;
  priceChanged: boolean;
  available: boolean;
  lineTotalPaise: number;
}

export interface QuoteStoreView {
  storeId: string;
  storeName: string;
  lines: QuoteLineView[];
  itemsTotalPaise: number;
  deliveryPaise: number;
  totalPaise: number;
}

export interface QuoteView {
  id: string;
  quoteHash: string;
  /** ISO time; quotes are valid 10 min. */
  validUntil: string;
  expired: boolean;
  itemsTotalPaise: number;
  deliveryTotalPaise: number;
  platformFeePaise: number;
  grandTotalPaise: number;
  stores: QuoteStoreView[];
}

export interface StoreQuoteError {
  storeId: string;
  storeName: string;
  code: "OUT_OF_STOCK" | "NOT_SERVICEABLE" | "STORE_OFFLINE" | "TIMEOUT" | "ERROR";
  message: string;
  listingIds?: string[];
}

export interface QuoteResponse {
  basket: BasketView;
  /** null when any store failed; fix the basket using `errors` and re-quote. */
  quote: QuoteView | null;
  errors: StoreQuoteError[];
}

// ---------- Approve + pay (UI only; the agent has no route to these) ----------
// POST /bap/baskets/:id/approve {quoteHash}                  → ApproveResponse   (403/409 if quote changed/expired)
// POST /bap/baskets/:id/pay {approvalToken, simulateFailure?} + header Idempotency-Key → PayResponse
//   403 without a valid unused approval token. Same Idempotency-Key → same payment.

export interface ApproveResponse {
  approvalToken: string;
  expiresAt: string;
}

export interface PayResponse {
  paymentId: string;
  status: Exclude<PaymentStatus, "NONE">;
}

// ---------- Orders: GET /bap/baskets/:id → OrderView, GET /bap/orders → OrderView[] (newest first, paid baskets) ----------

export interface AttemptView {
  id: string;
  attemptNo: number;
  storeId: string;
  storeName: string;
  status: AttemptStatus;
  /** ISO; set while OFFERED. */
  expiresAt: string | null;
  rejectReason: string | null;
  quotedTotalPaise: number;
  createdAt: string;
  decidedAt: string | null;
}

export interface SubOrderView {
  id: string;
  status: SubOrderStatus;
  approvedStoreId: string;
  approvedStoreName: string;
  currentStoreName: string | null;
  lines: QuoteLineView[];
  approvedAmountPaise: number;
  attemptCount: number;
  maxAttempts: 3;
  attempts: AttemptView[];
  refundPaise: number | null;
}

export interface OrderView {
  basketId: string;
  transactionId: string;
  basketStatus: BasketStatus;
  /** Payment and fulfilment are separate (ORD-03). */
  paymentStatus: PaymentStatus;
  grandTotalPaise: number;
  refundedPaise: number;
  settled: boolean;
  subOrders: SubOrderView[];
  createdAt: string;
}

// ---------- Optimiser: POST /bap/plan {needs:[{query, qty}], budgetPaise?} → PlanResult ----------

export interface PlanNeed {
  query: string;
  qty: number;
  /** Optional: only consider offers of this canonical product (used when optimising an existing basket). */
  canonicalProductId?: string;
}

/** POST /bap/plan also accepts `current?: {listingId, qty}[]`: the basket being compared, priced into `PlanResult.baseline`. */
export interface PlanCurrentItem {
  listingId: string;
  qty: number;
}

export interface PlanChoice {
  query: string;
  qty: number;
  offer: SearchOffer;
  /** One line, built from the numbers, e.g. "₹12 cheaper than Gupta Kirana". */
  reason: string;
  /** Set by the agent's plan_basket tool (server-side): the quantity was not stated in the customer's message. */
  qtyInferred?: boolean;
}

export interface PlanResult {
  choices: PlanChoice[];
  stores: { storeId: string; storeName: string; itemsTotalPaise: number; deliveryPaise: number }[];
  estimatedTotalPaise: number;
  budgetPaise: number | null;
  withinBudget: boolean | null;
  /** Basket-level reasons, e.g. "Adding Lakshmi Stores saves ₹38 even after ₹30 delivery". */
  reasons: string[];
  /** Only when the request carried `current`: catalogue cost of those items as they stand (items + per-store delivery). */
  baseline?: { estimatedTotalPaise: number; stores: { storeId: string; storeName: string; itemsTotalPaise: number; deliveryPaise: number }[] };
  unmatched: { query: string; reason: string }[];
  looseDeclined: LooseDeclined[];
}

// ---------- Agent (lane C): POST /bap/agent/chat {message} → AgentReply | 503 {error: "agent_unavailable"} ----------

export type AgentEvent =
  | { type: "basket_updated" }
  | { type: "quote_ready"; quoteId: string; grandTotalPaise: number }
  | { type: "approval_requested"; basketId: string; quoteHash: string; grandTotalPaise: number }
  | { type: "loose_declined"; query: string; reason: string; alternative: LooseDeclined["alternative"] };

export interface AgentReply {
  text: string;
  events: AgentEvent[];
  /** Tool calls made this turn, for the "thinking…" steps. */
  steps: { tool: string; ok: boolean }[];
  /** Voice turns (UX-12): what the model heard, shown as the user's bubble. */
  transcript?: string;
}

// Voice input (UX-12): POST /bap/agent/chat {audio, turnId?} instead of {message}. The turn runs on a Gemini Live model
// (GEMINI_LIVE_MODEL) with the same tools; the reply carries `transcript`. Audio is raw 16-bit PCM, 16 kHz mono, base64,
// 0.3–30 s. Errors as for text turns (400 bad_request, 409 agent_busy, 429, 503 agent_unavailable).
export const VOICE_MIME_TYPE = "audio/pcm;rate=16000";
export const MAX_VOICE_SECONDS = 30;
export interface AgentVoiceAudio {
  mimeType: typeof VOICE_MIME_TYPE;
  /** base64 of little-endian Int16 samples. */
  data: string;
}

// Live progress (UX-01): POST /bap/agent/chat accepts an optional `turnId` (8-64 chars of [A-Za-z0-9_-]);
// GET /bap/agent/turns/:turnId → AgentTurnProgress (404 for an unknown turn or another customer's turn).
export interface AgentTurnStep {
  tool: string;
  /** null while the tool is running. */
  ok: boolean | null;
  startedAt: string;
  endedAt: string | null;
  /** Short data-derived text, e.g. "5 stores · 14 offers". null while running. */
  summary: string | null;
}

export interface AgentTurnProgress {
  steps: AgentTurnStep[];
  done: boolean;
}

// Agent transcript for page reloads (lane C): GET /bap/agent/history → { messages }; POST /bap/agent/reset clears it.
export interface AgentHistoryMessage {
  role: "user" | "model";
  text: string;
}

// Merchant earnings (UX-11): GET /bpp/merchant/:storeId/ledger (merchant token, own store only).
export interface MerchantLedgerEntry {
  id: string;
  subOrderId: string;
  basketId: string;
  grossPaise: number;
  commissionPaise: number;
  netPayablePaise: number;
  /** Platform top-up when this store was a reassignment pick at a higher price than approved. */
  platformSubsidyPaise: number;
  createdAt: string;
}
export interface MerchantLedger {
  storeId: string;
  entries: MerchantLedgerEntry[];
  totals: { grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number };
}

// ---------- Delivery address (UX-14) ----------
// GET   /bap/profile/address → AddressView (saved address + which stores deliver to it)
// PATCH /bap/profile/address {presetId} | {address, lat, lng} → AddressView
// Search, plan, quote and the agent all read the saved address, so changing it changes which stores serve you.
// No Google Places (no key): the UI offers ADDRESS_PRESETS.

export interface AddressPreset {
  id: string;
  /** Short area label, e.g. "Indiranagar, Bengaluru". */
  label: string;
  address: string;
  lat: number;
  lng: number;
  /** What changing to it demonstrates. */
  hint: string;
}

/** Demo addresses around the 5 seeded stores (distances checked in address.test.ts). */
export const ADDRESS_PRESETS: AddressPreset[] = [
  { id: "indiranagar", label: "Indiranagar, Bengaluru", address: "12, 7th Cross, Indiranagar, Bengaluru 560038", lat: 12.9719, lng: 77.6412, hint: "All 5 stores deliver here." },
  { id: "cv-raman-nagar", label: "CV Raman Nagar, Bengaluru", address: "45, 2nd Main, CV Raman Nagar, Bengaluru 560093", lat: 12.985, lng: 77.664, hint: "Lakshmi and Balaji are too far." },
  { id: "koramangala", label: "Koramangala, Bengaluru", address: "88, 5th Block, Koramangala, Bengaluru 560095", lat: 12.9352, lng: 77.6245, hint: "Only Annapurna delivers here." },
  { id: "whitefield", label: "Whitefield, Bengaluru", address: "7, ITPL Main Road, Whitefield, Bengaluru 560066", lat: 12.9698, lng: 77.75, hint: "No store delivers here." },
];

export interface StoreServiceability {
  storeId: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  distanceM: number;
  /** Within the delivery radius (ignores opening hours and stock). */
  delivers: boolean;
  /** Store switched off by the merchant or closed now. */
  open: boolean;
}

export interface AddressView {
  address: string;
  /** "Indiranagar, Bengaluru": the last two parts of the address, without the pincode. */
  label: string;
  lat: number;
  lng: number;
  /** Empty if the store list could not be loaded. */
  stores: StoreServiceability[];
  presets: AddressPreset[];
}

export type AddressPatch = { presetId: string } | { address: string; lat: number; lng: number };

// ---------- Small helpers ----------

export function packLabel(packSize: number, unit: string): string {
  return `${packSize} ${unit}`;
}
