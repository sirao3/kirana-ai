import { ulid } from "ulid";
import { paiseToRupees, rupeesToPaise, type Paise } from "../money.js";
import type { AckResponse, BecknAction, BecknError, Context, Price, Tag } from "./schemas.js";

export const DOMAIN = "ONDC:RET10";
export const COUNTRY = "IND";
export const CITY = "std:080"; // Bengaluru
export const CORE_VERSION = "1.2.0";

/**
 * KiranaAI tag group (documented ONDC deviations).
 * - search intent: canonical_ids = comma-separated canonical product ids (reassignment search);
 *   customer_id = BAP customer (lets the BPP compute distance/serviceability).
 * - catalog item: loose_declined = "true" with reason/alternative_item_id when a loose request was declined;
 *   canonical_id = canonical product id of the listing.
 * - confirm order: offer_window_seconds (platform config lives in the BAP; the BPP owns the timer).
 */
export const KTAG = {
  group: "kiranaai",
  canonicalIds: "canonical_ids",
  canonicalId: "canonical_id",
  customerId: "customer_id",
  looseDeclined: "loose_declined",
  reason: "reason",
  alternativeItemId: "alternative_item_id",
  /** confirm order tag: offer window chosen by the platform (bap.config); BPP sets expires_at from it. */
  offerWindowSeconds: "offer_window_seconds",
  /** on_search provider tag (optional): the store's DeliveryRule as JSON, so the BAP optimiser can price delivery for any subtotal. */
  deliveryRule: "delivery_rule",
} as const;

export interface ContextInput {
  action: BecknAction;
  transactionId: string;
  messageId?: string;
  bapId: string;
  bapUri: string;
  bppId?: string;
  bppUri?: string;
  ttl?: string;
}

export function newMessageId(): string {
  return `msg_${ulid()}`;
}

export function makeContext(i: ContextInput): Context {
  return {
    domain: DOMAIN,
    country: COUNTRY,
    city: CITY,
    action: i.action,
    core_version: CORE_VERSION,
    bap_id: i.bapId,
    bap_uri: i.bapUri,
    ...(i.bppId ? { bpp_id: i.bppId } : {}),
    ...(i.bppUri ? { bpp_uri: i.bppUri } : {}),
    transaction_id: i.transactionId,
    message_id: i.messageId ?? newMessageId(),
    timestamp: new Date().toISOString(),
    ttl: i.ttl ?? "PT30S",
  };
}

/** Context for a callback: same transaction/message ids and participants, on_<action>. */
export function callbackContext(req: Context, bpp?: { bppId: string; bppUri: string }): Context {
  const action = (req.action.startsWith("on_") ? req.action : `on_${req.action}`) as BecknAction;
  return {
    ...req,
    action,
    ...(bpp ? { bpp_id: bpp.bppId, bpp_uri: bpp.bppUri } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function ack(): AckResponse {
  return { message: { ack: { status: "ACK" } } };
}

export function nack(code: string, message: string, type = "DOMAIN-ERROR"): AckResponse {
  return { message: { ack: { status: "NACK" } }, error: { type, code, message } satisfies BecknError };
}

export function priceOf(paise: Paise): Price {
  return { currency: "INR", value: paiseToRupees(paise) };
}

export function paiseOf(price: Pick<Price, "value">): Paise {
  return rupeesToPaise(price.value);
}

export function gpsOf(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function parseGps(gps: string): { lat: number; lng: number } {
  const [lat, lng] = gps.split(",").map((s) => Number(s.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`bad gps: ${gps}`);
  return { lat: lat!, lng: lng! };
}

export function tag(group: string, values: Record<string, string>): Tag {
  return { code: group, list: Object.entries(values).map(([code, value]) => ({ code, value })) };
}

export function getTag(tags: Tag[] | undefined, group: string, code: string): string | undefined {
  return tags?.find((t) => t.code === group)?.list.find((l) => l.code === code)?.value;
}
