import type pg from "pg";
import {
  deliveryChargePaise, getTag, KTAG, paiseOf, paiseToRupees, parseGps, priceOf, tag,
  type BecknError, type LatLng, type Order, type Quote,
} from "@kiranaai/shared";
import { DOMAIN_ERROR, distanceToStoreM, getStore, isTakingOrders, type StoreRow } from "./common.js";
import { productTitle } from "./search.js";

interface QuoteListing {
  id: string;
  canonical_product_id: string;
  price_paise: number;
  stock_qty: number;
  active: boolean;
  brand: string;
  name: string;
  pack_size: number;
  unit: "g" | "kg" | "ml" | "l" | "pcs";
}

export interface QuotedItem {
  listingId: string;
  canonicalProductId: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  stock: number;
  previousPricePaise?: number;
}

export interface StoreQuote {
  store: StoreRow;
  customer: LatLng | null;
  distanceM: number | null;
  items: QuotedItem[];
  itemsTotalPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  error?: BecknError;
}

const err = (code: string, message: string): BecknError => ({ type: DOMAIN_ERROR, code, message });

/**
 * Re-reads price and stock and prices one store's part of a basket (select, init and confirm all use it).
 * Items that are missing, inactive or short on stock are left out and reported via `error` 40002
 * (message = comma-separated listing ids). Precedence: 30001 store closed, 30009 not serviceable, 40002.
 * Pass `db` as a client inside a transaction to lock the listing rows (`forUpdate`).
 */
export async function quoteStore(
  db: pg.Pool | pg.PoolClient,
  o: { order: Order; at?: Date; forUpdate?: boolean },
): Promise<StoreQuote | { missingStore: true }> {
  const store = await getStore(db, o.order.provider.id);
  if (!store) return { missingStore: true };

  const gps = o.order.fulfillments?.[0]?.end?.location.gps;
  let customer: LatLng | null = null;
  try {
    customer = gps ? parseGps(gps) : null;
  } catch {
    customer = null;
  }
  const distanceM = customer ? distanceToStoreM(store, customer) : null;

  const wanted = new Map<string, { qty: number; seen?: number }>();
  for (const it of o.order.items) {
    const seen = getTag(it.tags, KTAG.group, "seen_price");
    const prev = wanted.get(it.id);
    wanted.set(it.id, { qty: (prev?.qty ?? 0) + it.quantity.count, seen: seen ? paiseOf({ value: seen }) : prev?.seen });
  }
  const { rows } = await db.query<QuoteListing>(
    `SELECT l.id, l.canonical_product_id, l.price_paise, l.stock_qty, l.active, cp.brand, cp.name, cp.pack_size, cp.unit
       FROM bpp.listing l JOIN bpp.canonical_product cp ON cp.id = l.canonical_product_id
      WHERE l.store_id = $1 AND l.id = ANY($2::text[]) ${o.forUpdate ? "FOR UPDATE OF l" : ""}`,
    [store.id, [...wanted.keys()]],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const items: QuotedItem[] = [];
  const unavailable: string[] = [];
  for (const [id, w] of wanted) {
    const l = byId.get(id);
    if (!l || !l.active || w.qty <= 0 || l.stock_qty < w.qty) {
      unavailable.push(id);
      continue;
    }
    items.push({
      listingId: id,
      canonicalProductId: l.canonical_product_id,
      name: productTitle(l),
      qty: w.qty,
      unitPricePaise: l.price_paise,
      lineTotalPaise: l.price_paise * w.qty,
      stock: l.stock_qty,
      ...(w.seen !== undefined && w.seen !== l.price_paise ? { previousPricePaise: w.seen } : {}),
    });
  }
  const itemsTotalPaise = items.reduce((s, i) => s + i.lineTotalPaise, 0);

  let error: BecknError | undefined;
  let deliveryPaise = 0;
  if (!isTakingOrders(store, o.at)) {
    error = err("30001", `${store.name} is offline or closed`);
  }
  const charge = distanceM === null ? null : deliveryChargePaise(store.delivery_rule, distanceM, itemsTotalPaise);
  if (charge !== null) deliveryPaise = charge;
  if (!error && (distanceM === null || distanceM > store.delivery_radius_m || charge === null)) {
    error = err("30009", `Delivery address is outside ${store.name}'s delivery area`);
  }
  if (!error && unavailable.length > 0) error = err("40002", unavailable.join(","));

  return { store, customer, distanceM, items, itemsTotalPaise, deliveryPaise, totalPaise: itemsTotalPaise + deliveryPaise, error };
}

/** Contract quote: one `item` row per item and one `delivery` row (`@ondc/org/item_id: "f1"`). */
export function toBecknQuote(q: StoreQuote, ttl?: string): Quote {
  const fulfilmentId = "f1";
  return {
    price: priceOf(q.totalPaise),
    breakup: [
      ...q.items.map((i) => ({
        "@ondc/org/item_id": i.listingId,
        "@ondc/org/item_quantity": { count: i.qty },
        "@ondc/org/title_type": "item" as const,
        title: i.name,
        price: priceOf(i.lineTotalPaise),
        item: {
          price: priceOf(i.unitPricePaise),
          quantity: { available: { count: String(i.stock) } },
          ...(i.previousPricePaise !== undefined
            ? { tags: [tag(KTAG.group, { price_changed: "true", previous_price: paiseToRupees(i.previousPricePaise) })] }
            : {}),
        },
      })),
      {
        "@ondc/org/item_id": fulfilmentId,
        "@ondc/org/title_type": "delivery" as const,
        title: "Delivery charge",
        price: priceOf(q.deliveryPaise),
      },
    ],
    ...(ttl ? { ttl } : {}),
  };
}
