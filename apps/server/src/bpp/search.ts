import type pg from "pg";
import {
  deliveryChargePaise, getTag, gpsOf, KTAG, paiseToRupees, parseGps, priceOf, tag, type CatalogItem, type LatLng,
  type Provider, type Tag,
} from "@kiranaai/shared";
import { distanceToStoreM, isTakingOrders, STORE_COLS, type StoreRow } from "./common.js";

/** Pack sizes as stored: integer amount in `unit`. */
export interface ProductRow {
  id: string;
  brand: string;
  name: string;
  variant: string | null;
  pack_size: number;
  unit: "g" | "kg" | "ml" | "l" | "pcs";
  category: string;
  score: number;
}

const STOPWORDS = new Set(["of", "ka", "ki", "ke", "aur", "and", "the", "a", "an", "some", "pack", "packet", "please", "chahiye", "do", "mujhe"]);
const AMOUNT_RE = /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|g|gm|gms|grams?|ml|l|ltr|ltrs|litres?|liters?)(?![\p{L}\p{N}])/giu;

/** Splits on anything that is not a letter, digit or combining mark (keeps Devanagari intact). */
const tokenize = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);

export interface Amount {
  /** Dimension: grams for mass, millilitres for volume. */
  dim: "mass" | "volume";
  base: number;
  label: string;
}

export function parseAmount(query: string): { amount: Amount | null; rest: string } {
  const found: { amount: Amount | null } = { amount: null };
  const rest = query.toLowerCase().replace(AMOUNT_RE, (whole, num: string, unit: string) => {
    if (found.amount) return whole;
    const u = unit.toLowerCase();
    const bigUnit = u.startsWith("k") || u.startsWith("l"); // kg / litre
    const isVolume = u.startsWith("l") || u === "ml";
    found.amount = {
      dim: isVolume ? "volume" : "mass",
      base: Math.round(Number(num) * (bigUnit ? 1000 : 1)),
      label: `${num} ${isVolume ? (bigUnit ? "l" : "ml") : bigUnit ? "kg" : "g"}`,
    };
    return " ";
  });
  return { amount: found.amount, rest };
}

/** Base amount (g or ml) of a pack, or null for counted packs. */
export function packAmount(p: Pick<ProductRow, "pack_size" | "unit">): Amount | null {
  switch (p.unit) {
    case "g": return { dim: "mass", base: p.pack_size, label: `${p.pack_size} g` };
    case "kg": return { dim: "mass", base: p.pack_size * 1000, label: `${p.pack_size} kg` };
    case "ml": return { dim: "volume", base: p.pack_size, label: `${p.pack_size} ml` };
    case "l": return { dim: "volume", base: p.pack_size * 1000, label: `${p.pack_size} l` };
    default: return null;
  }
}

export const packLabel = (p: Pick<ProductRow, "pack_size" | "unit">): string => `${p.pack_size} ${p.unit}`;

export interface ParsedQuery {
  /** Search words after synonym expansion (lower-case). */
  words: string[];
  amount: Amount | null;
  /** Hint of the first loose term found in the query, if any. */
  looseHint: string | null;
}

/**
 * Lower-cases, pulls out a "250 g" style amount, flags loose terms, and expands synonyms.
 * Multi-word terms win over shorter ones ("gehun ka aata" → "atta" before "aata").
 */
export async function parseQuery(db: pg.Pool, text: string): Promise<ParsedQuery> {
  const [syn, loose] = await Promise.all([
    db.query<{ term: string; normalized: string }>("SELECT term, normalized FROM bpp.synonym"),
    db.query<{ term: string; hint: string }>("SELECT term, hint FROM bpp.loose_term"),
  ]);
  const synonyms = new Map(syn.rows.map((r) => [tokenize(r.term).join(" "), r.normalized.toLowerCase()]));
  const maxN = Math.max(1, ...[...synonyms.keys()].map((k) => k.split(" ").length));

  const { amount, rest } = parseAmount(text);
  const tokens = tokenize(rest);
  const joined = ` ${tokens.join(" ")} `;
  const looseHit = loose.rows.find((r) => joined.includes(` ${tokenize(r.term).join(" ")} `));
  const looseTerms = new Set(loose.rows.flatMap((r) => tokenize(r.term)));

  const words: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    let hit: string | undefined;
    let n = Math.min(maxN, tokens.length - i);
    for (; n >= 1; n--) {
      hit = synonyms.get(tokens.slice(i, i + n).join(" "));
      if (hit) break;
    }
    if (hit) {
      words.push(...tokenize(hit));
      i += n;
    } else {
      const t = tokens[i]!;
      // Loose markers ("khula", "loose") and filler words say nothing about the product.
      if (!looseTerms.has(t) && !STOPWORDS.has(t) && !/^\d+$/.test(t)) words.push(t);
      i++;
    }
  }
  return { words: [...new Set(words)], amount, looseHint: looseHit?.hint ?? null };
}

const FTS = "to_tsvector('simple', cp.search_text) @@ to_tsquery('simple', w || ':*')";
/** Trigram only for longer words: 3-letter words match too much ("tea" ~ "teeth"). */
const TRGM = "(length(w) >= 4 AND word_similarity(w, cp.search_text) >= 0.6)";

/** Canonical products matching every word by full-text prefix OR trigram similarity, best first. */
export async function matchProducts(db: pg.Pool, words: string[], limit = 30): Promise<ProductRow[]> {
  if (words.length === 0) return [];
  const { rows } = await db.query<ProductRow>(
    `SELECT cp.id, cp.brand, cp.name, cp.variant, cp.pack_size, cp.unit, cp.category,
            (SELECT COALESCE(sum(GREATEST(word_similarity(w, cp.search_text), CASE WHEN ${FTS} THEN 1 ELSE 0 END)), 0)
               FROM unnest($1::text[]) w)::float AS score
       FROM bpp.canonical_product cp
      WHERE NOT EXISTS (SELECT 1 FROM unnest($1::text[]) w WHERE NOT (${FTS} OR ${TRGM}))
      ORDER BY score DESC, cp.id
      LIMIT $2`,
    [words.map((w) => w.replace(/[^\p{L}\p{N}\p{M}]/gu, "")).filter(Boolean), limit],
  );
  return rows;
}

export async function productsByIds(db: pg.Pool, ids: string[]): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<ProductRow>(
    `SELECT id, brand, name, variant, pack_size, unit, category, 1::float AS score FROM bpp.canonical_product WHERE id = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  return rows;
}

export interface LooseVerdict {
  reason: string;
  alternative?: ProductRow;
}

/**
 * DIS-06: a loose-term match, or a g/kg/ml/l amount with no pack of that size among the matches.
 * The alternative is the matched pack nearest to the requested amount (same dimension), else the best match.
 */
export function detectLoose(q: ParsedQuery, matches: ProductRow[]): LooseVerdict | null {
  const nearest = (): ProductRow | undefined => {
    if (!q.amount) return matches[0];
    const same = matches.filter((m) => packAmount(m)?.dim === q.amount!.dim);
    return same.sort((a, b) => Math.abs(packAmount(a)!.base - q.amount!.base) - Math.abs(packAmount(b)!.base - q.amount!.base))[0];
  };
  const sizeLabel = (p: ProductRow) => `${p.brand} ${p.name} ${packLabel(p)}`;

  if (q.amount && matches.length > 0) {
    const exact = matches.some((m) => {
      const a = packAmount(m);
      return a?.dim === q.amount!.dim && a.base === q.amount!.base;
    });
    if (!exact) {
      const alt = nearest();
      return {
        reason: `No ${q.amount.label} pack is sold; items are sold in sealed packs only.${alt ? ` Nearest pack: ${sizeLabel(alt)}.` : ""}`,
        alternative: alt,
      };
    }
  }
  if (q.looseHint) {
    const alt = nearest();
    return { reason: q.looseHint + (alt ? ` Nearest pack: ${sizeLabel(alt)}.` : ""), alternative: alt };
  }
  return null;
}

interface ListingRow {
  id: string;
  store_id: string;
  canonical_product_id: string;
  price_paise: number;
  mrp_paise: number;
  stock_qty: number;
}

/** Item name as shown to buyers: "Aashirvaad Whole Wheat Atta 10 kg". */
export const productTitle = (p: Pick<ProductRow, "brand" | "name" | "pack_size" | "unit">): string =>
  `${p.brand} ${p.name} ${packLabel(p)}`;

export interface SearchInput {
  text: string;
  customer: LatLng | null;
  canonicalIds: string[] | null;
}

export interface SearchResult {
  providers: Provider[];
  catalogTags: Tag[];
}

export async function searchCatalog(db: pg.Pool, input: SearchInput, now = new Date()): Promise<SearchResult> {
  let products: ProductRow[];
  let verdict: LooseVerdict | null = null;
  if (input.canonicalIds) {
    products = await productsByIds(db, input.canonicalIds);
  } else {
    const q = await parseQuery(db, input.text);
    products = await matchProducts(db, q.words);
    verdict = detectLoose(q, products);
  }

  const catalogTags: Tag[] = verdict
    ? [tag(KTAG.group, {
        [KTAG.looseDeclined]: "true",
        [KTAG.reason]: verdict.reason,
        ...(verdict.alternative ? { alternative_canonical_id: verdict.alternative.id } : {}),
      })]
    : [];

  if (!input.customer || products.length === 0) return { providers: [], catalogTags };

  const [{ rows: stores }, { rows: listings }] = await Promise.all([
    db.query<StoreRow>(`SELECT ${STORE_COLS} FROM bpp.store ORDER BY name`),
    db.query<ListingRow>(
      `SELECT id, store_id, canonical_product_id, price_paise, mrp_paise, stock_qty FROM bpp.listing
        WHERE active AND stock_qty > 0 AND canonical_product_id = ANY($1::text[])`,
      [products.map((p) => p.id)],
    ),
  ]);
  const byId = new Map(products.map((p, i) => [p.id, { p, rank: i }]));

  const providers: Provider[] = [];
  for (const store of stores) {
    if (!isTakingOrders(store, now)) continue;
    const distance = distanceToStoreM(store, input.customer);
    if (distance > store.delivery_radius_m) continue;
    const charge = deliveryChargePaise(store.delivery_rule, distance, 0);
    if (charge === null) continue;
    const mine = listings
      .filter((l) => l.store_id === store.id)
      .sort((a, b) => byId.get(a.canonical_product_id)!.rank - byId.get(b.canonical_product_id)!.rank);
    if (mine.length === 0) continue;

    const items = mine.map((l) => {
      const p = byId.get(l.canonical_product_id)!.p;
      return {
        id: l.id,
        descriptor: { name: productTitle(p) },
        price: { ...priceOf(l.price_paise), maximum_value: paiseToRupees(l.mrp_paise) },
        quantity: {
          available: { count: String(l.stock_qty) },
          unitized: { measure: { unit: p.unit, value: String(p.pack_size) } },
        },
        category_id: p.category,
        location_id: `${store.id}_loc`,
        tags: [tag(KTAG.group, { canonical_id: p.id, brand: p.brand, product_name: p.name, pack_label: packLabel(p) })],
      };
    });
    providers.push({
      id: store.id,
      descriptor: { name: store.name },
      locations: [{ id: `${store.id}_loc`, gps: gpsOf(store.lat, store.lng) }],
      tags: [tag(KTAG.group, {
        distance_m: String(distance),
        delivery_charge: paiseToRupees(charge),
        // Full rule as JSON so the BAP optimiser can price delivery at any subtotal (free_above).
        [KTAG.deliveryRule]: JSON.stringify(store.delivery_rule),
      })],
      items: items as unknown as CatalogItem[], // ONDC counts are strings on the wire; the schema output type is number
    });
  }
  return { providers, catalogTags };
}

/** Reads the customer gps, query text and canonical id filter out of a search intent. */
export function readIntent(intent: {
  item?: { descriptor?: { name?: string } };
  fulfillment?: { end?: { location: { gps: string } } };
  tags?: Tag[];
}): SearchInput {
  let customer: LatLng | null = null;
  const gps = intent.fulfillment?.end?.location.gps;
  if (gps) {
    try {
      customer = parseGps(gps);
    } catch {
      customer = null;
    }
  }
  const ids = getTag(intent.tags, KTAG.group, KTAG.canonicalIds);
  return {
    text: intent.item?.descriptor?.name ?? "",
    customer,
    canonicalIds: ids ? ids.split(",").map((s) => s.trim()).filter(Boolean) : null,
  };
}
