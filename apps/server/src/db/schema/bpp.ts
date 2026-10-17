import { sql } from "drizzle-orm";
import {
  boolean, check, doublePrecision, index, integer, jsonb, pgSchema, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { DeliveryRule } from "@kiranaai/shared";

export const bpp = pgSchema("bpp");

export const store = bpp.table("store", {
  id: text("id").primaryKey(), // e.g. store_sharma (also the Beckn provider id)
  name: text("name").notNull(),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  phone: text("phone").notNull(),
  /** "HH:MM" IST. open_time == close_time means open all day. */
  openTime: text("open_time").notNull().default("00:00"),
  closeTime: text("close_time").notNull().default("00:00"),
  deliveryRadiusM: integer("delivery_radius_m").notNull(),
  deliveryRule: jsonb("delivery_rule").$type<DeliveryRule>().notNull(),
  isOnline: boolean("is_online").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const canonicalProduct = bpp.table(
  "canonical_product",
  {
    id: text("id").primaryKey(), // e.g. cp_atta_aashirvaad_10kg
    gtin: text("gtin"),
    brand: text("brand").notNull(),
    name: text("name").notNull(),
    variant: text("variant"),
    /** Integer amount in `unit` (1.5 l is stored as 1500 ml). */
    packSize: integer("pack_size").notNull(),
    unit: text("unit").$type<"g" | "kg" | "ml" | "l" | "pcs">().notNull(),
    category: text("category").notNull(),
    /** Lower-case brand + name + variant + pack + keywords; indexed for full-text and trigram. */
    searchText: text("search_text").notNull(),
  },
  (t) => [
    index("canonical_product_search_trgm").using("gin", sql`${t.searchText} gin_trgm_ops`),
    index("canonical_product_search_fts").using("gin", sql`to_tsvector('simple', ${t.searchText})`),
  ],
);

export const listing = bpp.table(
  "listing",
  {
    id: text("id").primaryKey(), // lst_<store>_<product>
    storeId: text("store_id").notNull().references(() => store.id),
    canonicalProductId: text("canonical_product_id").notNull().references(() => canonicalProduct.id),
    pricePaise: integer("price_paise").notNull(),
    mrpPaise: integer("mrp_paise").notNull(),
    stockQty: integer("stock_qty").notNull(),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("listing_store_product").on(t.storeId, t.canonicalProductId),
    check("listing_stock_nonneg", sql`${t.stockQty} >= 0`),
    check("listing_price_pos", sql`${t.pricePaise} > 0`),
  ],
);

/** Search term → normalised term (Hinglish / Devanagari → catalogue words). */
export const synonym = bpp.table("synonym", {
  term: text("term").primaryKey(),
  normalized: text("normalized").notNull(),
});

/** Terms that signal a loose (non-packaged) request; hint explains the packaged alternative. */
export const looseTerm = bpp.table("loose_term", {
  term: text("term").primaryKey(),
  hint: text("hint").notNull(),
});

export type AttemptOrderStatus = "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
export type FulfilmentStatus = "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED";

/** One store offer = one Beckn order (id = att_… sent by the BAP in confirm). */
export const attemptOrder = bpp.table(
  "attempt_order",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id").notNull(),
    bapId: text("bap_id").notNull(),
    bapUri: text("bap_uri").notNull(),
    storeId: text("store_id").notNull().references(() => store.id),
    status: text("status").$type<AttemptOrderStatus>().notNull().default("OFFERED"),
    fulfilmentStatus: text("fulfilment_status").$type<FulfilmentStatus>(),
    itemsTotalPaise: integer("items_total_paise").notNull(),
    deliveryPaise: integer("delivery_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    buyerName: text("buyer_name").notNull(),
    buyerPhone: text("buyer_phone").notNull(),
    buyerAddress: text("buyer_address").notNull(),
    buyerLat: doublePrecision("buyer_lat").notNull(),
    buyerLng: doublePrecision("buyer_lng").notNull(),
    distanceM: integer("distance_m").notNull(),
    offeredAt: timestamp("offered_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attempt_order_open").on(t.status, t.expiresAt),
    index("attempt_order_store").on(t.storeId, t.status),
  ],
);

export const attemptOrderItem = bpp.table("attempt_order_item", {
  id: serial("id").primaryKey(),
  attemptOrderId: text("attempt_order_id").notNull().references(() => attemptOrder.id, { onDelete: "cascade" }),
  listingId: text("listing_id").notNull(),
  canonicalProductId: text("canonical_product_id").notNull(),
  name: text("name").notNull(),
  qty: integer("qty").notNull(),
  unitPricePaise: integer("unit_price_paise").notNull(),
  lineTotalPaise: integer("line_total_paise").notNull(),
});

/** Failure injection per store (PRD §8.11). */
export const fault = bpp.table("fault", {
  storeId: text("store_id").primaryKey().references(() => store.id),
  autoReject: boolean("auto_reject").notNull().default(false),
  neverAnswer: boolean("never_answer").notNull().default(false),
});
