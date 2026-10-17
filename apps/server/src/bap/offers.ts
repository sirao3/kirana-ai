import type pg from "pg";
import {
  DeliveryRule, getTag, gpsOf, KTAG, newId, paiseOf, rupeesToPaise, tag,
  type Envelope, type LooseDeclined, type SearchGroup, type SearchOffer,
} from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { searchViaGateway } from "./beckn-client.js";
import type { CustomerRow } from "./util.js";

/** An offer as seen in on_search. `deliveryRule` is optional extra data (KTAG.deliveryRule) for the optimiser. */
export interface SeenOffer extends SearchOffer {
  deliveryRule: DeliveryRule | null;
}

export interface ParsedCatalog {
  offers: SeenOffer[];
  loose: { reason: string; alternativeCanonicalId?: string; alternativeListingId?: string }[];
}

/** Turns on_search envelopes into offers (BPP provider/item tags per LANES.md). */
export function parseOnSearch(envs: Envelope<"on_search">[]): ParsedCatalog {
  const offers = new Map<string, SeenOffer>();
  const loose: ParsedCatalog["loose"] = [];
  for (const env of envs) {
    const bppId = env.context.bpp_id;
    const bppUri = env.context.bpp_uri;
    const catalog = env.message?.catalog;
    if (!bppId || !bppUri || !catalog) continue;

    const tags = (catalog as { tags?: Parameters<typeof getTag>[0] }).tags;
    if (getTag(tags, KTAG.group, KTAG.looseDeclined) === "true") {
      loose.push({
        reason: getTag(tags, KTAG.group, KTAG.reason) ?? "Loose items are not sold; choose a sealed pack.",
        alternativeCanonicalId: getTag(tags, KTAG.group, "alternative_canonical_id"),
        alternativeListingId: getTag(tags, KTAG.group, KTAG.alternativeItemId),
      });
    }

    for (const provider of catalog["bpp/providers"]) {
      const distanceM = Number(getTag(provider.tags, KTAG.group, "distance_m") ?? 0) || 0;
      const chargeStr = getTag(provider.tags, KTAG.group, "delivery_charge");
      const ruleStr = getTag(provider.tags, KTAG.group, KTAG.deliveryRule);
      let deliveryRule: DeliveryRule | null = null;
      if (ruleStr) {
        try {
          const parsed = DeliveryRule.safeParse(JSON.parse(ruleStr));
          if (parsed.success) deliveryRule = parsed.data;
        } catch {
          // ignore a malformed optional tag
        }
      }
      for (const item of provider.items) {
        const canonical = getTag(item.tags, KTAG.group, KTAG.canonicalId) ?? item.id;
        const unitized = item.quantity?.unitized?.measure;
        const price = paiseOf(item.price);
        offers.set(item.id, {
          listingId: item.id,
          storeId: provider.id,
          storeName: provider.descriptor.name ?? provider.id,
          bppId,
          bppUri,
          canonicalProductId: canonical,
          name: getTag(item.tags, KTAG.group, "product_name") ?? item.descriptor.name ?? item.id,
          brand: getTag(item.tags, KTAG.group, "brand") ?? "",
          packLabel: getTag(item.tags, KTAG.group, "pack_label") ?? (unitized ? `${unitized.value} ${unitized.unit}` : ""),
          pricePaise: price,
          mrpPaise: item.price.maximum_value ? rupeesToPaise(item.price.maximum_value) : price,
          stockQty: item.quantity?.available ? Number(item.quantity.available.count) : 0,
          distanceM,
          deliveryChargePaise: chargeStr ? rupeesToPaise(chargeStr) : null,
          badge: "catalogue",
          deliveryRule,
        });
      }
    }
  }
  return { offers: [...offers.values()], loose };
}

interface OfferRow {
  listing_id: string;
  store_id: string;
  store_name: string;
  bpp_id: string;
  bpp_uri: string;
  canonical_product_id: string;
  name: string;
  brand: string;
  pack_label: string;
  price_paise: number;
  mrp_paise: number;
  stock_qty: number;
  distance_m: number;
  delivery_charge_paise: number | null;
  delivery_rule: unknown;
}

function rowToOffer(r: OfferRow): SeenOffer {
  const rule = r.delivery_rule ? DeliveryRule.safeParse(r.delivery_rule) : null;
  return {
    listingId: r.listing_id,
    storeId: r.store_id,
    storeName: r.store_name,
    bppId: r.bpp_id,
    bppUri: r.bpp_uri,
    canonicalProductId: r.canonical_product_id,
    name: r.name,
    brand: r.brand,
    packLabel: r.pack_label,
    pricePaise: r.price_paise,
    mrpPaise: r.mrp_paise,
    stockQty: r.stock_qty,
    distanceM: r.distance_m,
    deliveryChargePaise: r.delivery_charge_paise,
    badge: "catalogue",
    deliveryRule: rule?.success ? rule.data : null,
  };
}

/** Upserts every offer seen so basket routes can resolve a listing id later. */
export async function persistSeenOffers(pool: pg.Pool, customerId: string, offers: SeenOffer[]): Promise<void> {
  if (!offers.length) return;
  const cols = 15;
  const values: unknown[] = [];
  const tuples = offers.map((o, i) => {
    values.push(
      customerId, o.listingId, o.storeId, o.storeName, o.bppId, o.bppUri, o.canonicalProductId, o.name, o.brand, o.packLabel,
      o.pricePaise, o.mrpPaise, o.stockQty, o.distanceM, o.deliveryChargePaise,
    );
    const p = (n: number) => `$${i * (cols + 1) + n}`;
    values.push(o.deliveryRule ? JSON.stringify(o.deliveryRule) : null);
    return `(${Array.from({ length: cols }, (_, k) => p(k + 1)).join(", ")}, ${p(cols + 1)}::jsonb, now())`;
  });
  await pool.query(
    `INSERT INTO bap.seen_offer (customer_id, listing_id, store_id, store_name, bpp_id, bpp_uri, canonical_product_id, name, brand,
       pack_label, price_paise, mrp_paise, stock_qty, distance_m, delivery_charge_paise, delivery_rule, seen_at)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (customer_id, listing_id) DO UPDATE SET
       store_id = EXCLUDED.store_id, store_name = EXCLUDED.store_name, bpp_id = EXCLUDED.bpp_id, bpp_uri = EXCLUDED.bpp_uri,
       canonical_product_id = EXCLUDED.canonical_product_id, name = EXCLUDED.name, brand = EXCLUDED.brand,
       pack_label = EXCLUDED.pack_label, price_paise = EXCLUDED.price_paise, mrp_paise = EXCLUDED.mrp_paise,
       stock_qty = EXCLUDED.stock_qty, distance_m = EXCLUDED.distance_m, delivery_charge_paise = EXCLUDED.delivery_charge_paise,
       delivery_rule = EXCLUDED.delivery_rule, seen_at = now()`,
    values,
  );
}

export async function getSeenOffers(pool: pg.Pool | pg.PoolClient, customerId: string, listingIds: string[]): Promise<Map<string, SeenOffer>> {
  if (!listingIds.length) return new Map();
  const { rows } = await pool.query<OfferRow>(
    `SELECT listing_id, store_id, store_name, bpp_id, bpp_uri, canonical_product_id, name, brand, pack_label, price_paise, mrp_paise,
            stock_qty, distance_m, delivery_charge_paise, delivery_rule
     FROM bap.seen_offer WHERE customer_id = $1 AND listing_id = ANY($2)`,
    [customerId, listingIds],
  );
  return new Map(rows.map((r) => [r.listing_id, rowToOffer(r)]));
}

export interface SearchResult {
  offers: SeenOffer[];
  looseDeclined: LooseDeclined[];
}

/** Beckn search through the gateway for one customer; every offer seen is persisted. */
export async function searchOffers(
  ctx: AppContext,
  customer: CustomerRow,
  o: { query: string; canonicalIds?: string[]; transactionId?: string; windowMs?: number },
): Promise<SearchResult> {
  const envs = await searchViaGateway(ctx, {
    transactionId: o.transactionId ?? newId("txn"),
    windowMs: o.windowMs ?? Number(process.env.BAP_SEARCH_WINDOW_MS ?? 1500),
    message: {
      intent: {
        item: { descriptor: { name: o.query } },
        fulfillment: { type: "Delivery", end: { location: { gps: gpsOf(customer.lat, customer.lng) } } },
        ...(o.canonicalIds?.length ? { tags: [tag(KTAG.group, { [KTAG.canonicalIds]: o.canonicalIds.join(",") })] } : {}),
      },
    },
  });
  const parsed = parseOnSearch(envs);
  await persistSeenOffers(ctx.pool, customer.id, parsed.offers);

  const looseDeclined: LooseDeclined[] = [];
  const seen = new Set<string>();
  for (const l of parsed.loose) {
    const alt =
      parsed.offers.find((x) => x.listingId === l.alternativeListingId) ??
      (l.alternativeCanonicalId ? cheapest(parsed.offers.filter((x) => x.canonicalProductId === l.alternativeCanonicalId)) : undefined);
    const key = `${l.reason}|${alt?.canonicalProductId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    looseDeclined.push({
      query: o.query,
      reason: l.reason,
      alternative: alt
        ? { canonicalProductId: alt.canonicalProductId, name: alt.name, packLabel: alt.packLabel, listingId: alt.listingId }
        : l.alternativeCanonicalId
          ? { canonicalProductId: l.alternativeCanonicalId, name: l.alternativeCanonicalId, packLabel: "" }
          : null,
    });
  }
  return { offers: parsed.offers, looseDeclined };
}

function cheapest(offers: SeenOffer[]): SeenOffer | undefined {
  return [...offers].sort((a, b) => a.pricePaise - b.pricePaise || a.distanceM - b.distanceM)[0];
}

/** Groups by canonical product; offers cheapest first, groups ordered by their cheapest offer. */
export function groupOffers(offers: SearchOffer[]): SearchGroup[] {
  const groups = new Map<string, SearchGroup>();
  for (const raw of offers) {
    const { deliveryRule: _drop, ...o } = raw as SeenOffer;
    let g = groups.get(o.canonicalProductId);
    if (!g) {
      g = { canonicalProductId: o.canonicalProductId, name: o.name, brand: o.brand, packLabel: o.packLabel, offers: [] };
      groups.set(o.canonicalProductId, g);
    }
    g.offers.push(o);
  }
  const out = [...groups.values()];
  for (const g of out) g.offers.sort((a, b) => a.pricePaise - b.pricePaise || a.distanceM - b.distanceM || a.storeId.localeCompare(b.storeId));
  out.sort((a, b) => a.offers[0]!.pricePaise - b.offers[0]!.pricePaise || a.name.localeCompare(b.name));
  return out;
}
