import {
  gpsOf, KTAG, paiseOf, paiseToRupees, priceOf, tag,
  type BecknError, type Order, type StoreQuoteError,
} from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { BecknSendError } from "../beckn/send.js";
import { BecknTimeoutError } from "../beckn/waiters.js";
import { becknCall } from "./beckn-client.js";
import type { QuoteLine } from "../db/schema/bap.js";
import type { CustomerRow } from "./util.js";

export interface StoreRef {
  storeId: string;
  storeName: string;
  bppId: string;
  bppUri: string;
}

export interface WantedLine {
  listingId: string;
  canonicalProductId: string;
  name: string;
  qty: number;
  seenPricePaise: number;
}

export interface StoreQuote {
  lines: QuoteLine[];
  itemsTotalPaise: number;
  deliveryPaise: number;
  totalPaise: number;
}

// ---------- request builders ----------

function fulfillment(customer: CustomerRow, withContact: boolean) {
  const location: { gps: string; address?: string } = { gps: gpsOf(customer.lat, customer.lng) };
  if (!withContact) return { id: "f1", type: "Delivery", end: { location } };
  return {
    id: "f1",
    type: "Delivery",
    end: { location: { ...location, address: customer.address }, contact: { phone: customer.phone }, person: { name: customer.name } },
  };
}

function orderBase(store: StoreRef, lines: WantedLine[], customer: CustomerRow, withContact: boolean) {
  return {
    provider: { id: store.storeId },
    items: lines.map((l) => ({
      id: l.listingId,
      quantity: { count: l.qty },
      tags: [tag(KTAG.group, { seen_price: paiseToRupees(l.seenPricePaise) })],
    })),
    fulfillments: [fulfillment(customer, withContact)],
    ...(withContact ? { billing: { name: customer.name, phone: customer.phone, address: customer.address } } : {}),
  };
}

export const selectMessage = (store: StoreRef, lines: WantedLine[], customer: CustomerRow) => ({ order: orderBase(store, lines, customer, false) });
export const initMessage = (store: StoreRef, lines: WantedLine[], customer: CustomerRow) => ({ order: orderBase(store, lines, customer, true) });

/** Beckn quote object for a store's totals (breakup rows per LANES.md). */
export function quoteObject(lines: QuoteLine[], deliveryPaise: number, totalPaise: number) {
  return {
    price: priceOf(totalPaise),
    breakup: [
      ...lines.map((l) => ({
        "@ondc/org/item_id": l.listingId,
        "@ondc/org/item_quantity": { count: l.qty },
        "@ondc/org/title_type": "item" as const,
        title: l.name,
        price: priceOf(l.lineTotalPaise),
        item: { price: priceOf(l.unitPricePaise) },
      })),
      {
        "@ondc/org/item_id": "f1",
        "@ondc/org/title_type": "delivery" as const,
        title: "Delivery charges",
        price: priceOf(deliveryPaise),
      },
    ],
  };
}

export function confirmMessage(o: {
  attemptId: string;
  store: StoreRef;
  lines: QuoteLine[];
  deliveryPaise: number;
  totalPaise: number;
  customer: CustomerRow;
  offerWindowSeconds: number;
}) {
  const wanted: WantedLine[] = o.lines.map((l) => ({
    listingId: l.listingId, canonicalProductId: l.canonicalProductId, name: l.name, qty: l.qty, seenPricePaise: l.unitPricePaise,
  }));
  return {
    order: {
      id: o.attemptId,
      ...orderBase(o.store, wanted, o.customer, true),
      quote: quoteObject(o.lines, o.deliveryPaise, o.totalPaise),
      payment: {
        type: "ON-ORDER",
        status: "PAID" as const,
        params: { amount: paiseToRupees(o.totalPaise), currency: "INR" as const },
      },
      tags: [tag(KTAG.group, { [KTAG.offerWindowSeconds]: String(o.offerWindowSeconds) })],
    },
  };
}

// ---------- response parsing ----------

export function mapBecknError(store: StoreRef, err: BecknError, fallbackListingIds?: string[]): StoreQuoteError {
  const base = { storeId: store.storeId, storeName: store.storeName, message: err.message ?? `error ${err.code}` };
  switch (err.code) {
    case "40002": {
      const ids = (err.message ?? "").split(",").map((s) => s.trim()).filter((s) => s.startsWith("lst_") || fallbackListingIds?.includes(s));
      return { ...base, code: "OUT_OF_STOCK", listingIds: ids.length ? ids : fallbackListingIds };
    }
    case "30009":
      return { ...base, code: "NOT_SERVICEABLE" };
    case "30001":
      return { ...base, code: "STORE_OFFLINE" };
    default:
      return { ...base, code: "ERROR" };
  }
}

function stockOf(item: unknown): number | null {
  const count = (item as { quantity?: { available?: { count?: unknown } } } | undefined)?.quantity?.available?.count;
  return count === undefined ? null : Number(count);
}

/**
 * Reads an on_select/on_init order into our own numbers (client numbers are never trusted;
 * line totals are recomputed as unit price x qty). Returns null lines as unavailable.
 */
export function parseStoreQuote(order: Order | undefined, wanted: WantedLine[]): { quote: StoreQuote; mismatch: boolean } | null {
  const q = order?.quote;
  if (!q) return null;
  const rows = new Map(q.breakup.filter((b) => b["@ondc/org/title_type"] === "item").map((b) => [b["@ondc/org/item_id"], b]));
  const deliveryRow = q.breakup.find((b) => b["@ondc/org/title_type"] === "delivery");
  let mismatch = false;
  const lines: QuoteLine[] = wanted.map((w) => {
    const row = rows.get(w.listingId);
    if (!row) {
      return { listingId: w.listingId, canonicalProductId: w.canonicalProductId, name: w.name, qty: w.qty, unitPricePaise: w.seenPricePaise,
        seenPricePaise: w.seenPricePaise, priceChanged: false, available: false, lineTotalPaise: w.seenPricePaise * w.qty };
    }
    const unit = row.item?.price ? paiseOf(row.item.price) : Math.round(paiseOf(row.price) / w.qty);
    const stock = stockOf(row.item);
    if (paiseOf(row.price) !== unit * w.qty) mismatch = true;
    return {
      listingId: w.listingId,
      canonicalProductId: w.canonicalProductId,
      name: w.name,
      qty: w.qty,
      unitPricePaise: unit,
      seenPricePaise: w.seenPricePaise,
      priceChanged: unit !== w.seenPricePaise,
      available: stock === null || stock >= w.qty,
      lineTotalPaise: unit * w.qty,
    };
  });
  const itemsTotalPaise = lines.reduce((a, l) => a + l.lineTotalPaise, 0);
  const deliveryPaise = deliveryRow ? paiseOf(deliveryRow.price) : 0;
  const totalPaise = itemsTotalPaise + deliveryPaise;
  if (paiseOf(q.price) !== totalPaise) mismatch = true;
  return { quote: { lines, itemsTotalPaise, deliveryPaise, totalPaise }, mismatch };
}

export type FetchStoreQuote = { ok: true; quote: StoreQuote; mismatch: boolean } | { ok: false; error: StoreQuoteError };

/**
 * select then init against one store (PRD §11). Used for the customer quote and for reassignment
 * candidates. Never throws: failures come back as a StoreQuoteError.
 */
export async function fetchStoreQuote(
  ctx: AppContext,
  o: { transactionId: string; customer: CustomerRow; store: StoreRef; lines: WantedLine[]; timeoutMs?: number },
): Promise<FetchStoreQuote> {
  const { store, lines } = o;
  const listingIds = lines.map((l) => l.listingId);
  const fail = (error: StoreQuoteError): FetchStoreQuote => ({ ok: false, error });
  const check = (env: { error?: BecknError; message?: { order?: Order } }) => {
    if (env.error) return mapBecknError(store, env.error, listingIds);
    const parsed = parseStoreQuote(env.message?.order, lines);
    if (!parsed) return { storeId: store.storeId, storeName: store.storeName, code: "ERROR" as const, message: "store returned no quote" };
    const gone = parsed.quote.lines.filter((l) => !l.available).map((l) => l.listingId);
    if (gone.length) {
      return { storeId: store.storeId, storeName: store.storeName, code: "OUT_OF_STOCK" as const, message: "insufficient stock", listingIds: gone };
    }
    return parsed;
  };
  try {
    const sel = await becknCall(ctx, {
      action: "select", bppId: store.bppId, bppUri: store.bppUri, transactionId: o.transactionId, storeId: store.storeId,
      message: selectMessage(store, lines, o.customer), timeoutMs: o.timeoutMs,
    });
    const selRes = check(sel);
    if ("code" in selRes) return fail(selRes);
    const ini = await becknCall(ctx, {
      action: "init", bppId: store.bppId, bppUri: store.bppUri, transactionId: o.transactionId, storeId: store.storeId,
      message: initMessage(store, lines, o.customer), timeoutMs: o.timeoutMs,
    });
    const iniRes = check(ini);
    if ("code" in iniRes) return fail(iniRes);
    return { ok: true, quote: iniRes.quote, mismatch: iniRes.mismatch || selRes.mismatch };
  } catch (err) {
    if (err instanceof BecknTimeoutError) {
      return fail({ storeId: store.storeId, storeName: store.storeName, code: "TIMEOUT", message: `${store.storeName} did not answer in time` });
    }
    if (err instanceof BecknSendError && err.error) return fail(mapBecknError(store, err.error, listingIds));
    return fail({ storeId: store.storeId, storeName: store.storeName, code: "ERROR", message: err instanceof Error ? err.message : String(err) });
  }
}
