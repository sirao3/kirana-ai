import { sql } from "drizzle-orm";
import {
  boolean, doublePrecision, index, integer, jsonb, pgSchema, primaryKey, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

export const bap = pgSchema("bap");

export const customer = bap.table("customer", {
  id: text("id").primaryKey(), // e.g. cust_priya
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
});

/** PRD §7.1 */
export type BasketStatus =
  | "DRAFT" | "QUOTED" | "EXPIRED" | "APPROVED" | "PAYMENT_INITIATED" | "PAID" | "PAYMENT_FAILED"
  | "PARTIALLY_REFUNDED" | "REFUNDED" | "SETTLED";

export const basket = bap.table(
  "basket",
  {
    id: text("id").primaryKey(), // bsk_
    customerId: text("customer_id").notNull().references(() => customer.id),
    status: text("status").$type<BasketStatus>().notNull().default("DRAFT"),
    /** Beckn transaction_id: one per basket checkout, reused for reassignment. */
    transactionId: text("transaction_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("basket_customer").on(t.customerId, t.createdAt)],
);

export const basketItem = bap.table(
  "basket_item",
  {
    id: serial("id").primaryKey(),
    basketId: text("basket_id").notNull().references(() => basket.id, { onDelete: "cascade" }),
    listingId: text("listing_id").notNull(),
    storeId: text("store_id").notNull(),
    storeName: text("store_name").notNull(),
    bppId: text("bpp_id").notNull(),
    bppUri: text("bpp_uri").notNull(),
    canonicalProductId: text("canonical_product_id").notNull(),
    name: text("name").notNull(),
    qty: integer("qty").notNull(),
    /** Price seen at search time; the quote highlights changes against it. */
    seenPricePaise: integer("seen_price_paise").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("basket_item_listing").on(t.basketId, t.listingId)],
);

export interface QuoteLine {
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

export const quote = bap.table("quote", {
  id: text("id").primaryKey(), // qte_
  basketId: text("basket_id").notNull().references(() => basket.id, { onDelete: "cascade" }),
  quoteHash: text("quote_hash").notNull(),
  itemsTotalPaise: integer("items_total_paise").notNull(),
  deliveryTotalPaise: integer("delivery_total_paise").notNull(),
  platformFeePaise: integer("platform_fee_paise").notNull(),
  grandTotalPaise: integer("grand_total_paise").notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteStore = bap.table("quote_store", {
  id: serial("id").primaryKey(),
  quoteId: text("quote_id").notNull().references(() => quote.id, { onDelete: "cascade" }),
  storeId: text("store_id").notNull(),
  storeName: text("store_name").notNull(),
  bppId: text("bpp_id").notNull(),
  bppUri: text("bpp_uri").notNull(),
  lines: jsonb("lines").$type<QuoteLine[]>().notNull(),
  itemsTotalPaise: integer("items_total_paise").notNull(),
  deliveryPaise: integer("delivery_paise").notNull(),
  totalPaise: integer("total_paise").notNull(),
});

/** Offers seen in on_search per customer (T06): lets basket routes resolve store/bpp/price from a listing id. */
export const seenOffer = bap.table(
  "seen_offer",
  {
    customerId: text("customer_id").notNull(),
    listingId: text("listing_id").notNull(),
    storeId: text("store_id").notNull(),
    storeName: text("store_name").notNull(),
    bppId: text("bpp_id").notNull(),
    bppUri: text("bpp_uri").notNull(),
    canonicalProductId: text("canonical_product_id").notNull(),
    name: text("name").notNull(),
    brand: text("brand").notNull().default(""),
    packLabel: text("pack_label").notNull().default(""),
    pricePaise: integer("price_paise").notNull(),
    mrpPaise: integer("mrp_paise").notNull(),
    stockQty: integer("stock_qty").notNull(),
    distanceM: integer("distance_m").notNull(),
    deliveryChargePaise: integer("delivery_charge_paise"),
    deliveryRule: jsonb("delivery_rule"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.listingId], name: "seen_offer_pk" })],
);

/** Single-use token minted only by the UI Approve button (AGT-07). */
export const approval = bap.table("approval", {
  id: text("id").primaryKey(), // apv_
  basketId: text("basket_id").notNull().references(() => basket.id, { onDelete: "cascade" }),
  quoteId: text("quote_id").notNull().references(() => quote.id, { onDelete: "cascade" }),
  quoteHash: text("quote_hash").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payment = bap.table(
  "payment",
  {
    id: text("id").primaryKey(), // pay_
    basketId: text("basket_id").notNull().references(() => basket.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    amountPaise: integer("amount_paise").notNull(),
    status: text("status").$type<"INITIATED" | "PAID" | "FAILED">().notNull().default("INITIATED"),
    /** Customer ticked "simulate failure" (T07); settles as FAILED. */
    simulateFailure: boolean("simulate_failure").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  // At most one non-failed payment per basket; a failed one may be retried (§7.1).
  (t) => [uniqueIndex("payment_one_live_per_basket").on(t.basketId).where(sql`status <> 'FAILED'`)],
);

/** PRD §7.2 */
export type SubOrderStatus =
  | "DISPATCHING" | "ACCEPTED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED_NO_FULFILMENT";

export const subOrder = bap.table(
  "sub_order",
  {
    id: text("id").primaryKey(), // sub_
    basketId: text("basket_id").notNull().references(() => basket.id, { onDelete: "cascade" }),
    /** Store approved by the customer (attempt 1). */
    approvedStoreId: text("approved_store_id").notNull(),
    /** Store of the latest attempt. */
    currentStoreId: text("current_store_id"),
    status: text("status").$type<SubOrderStatus>().notNull().default("DISPATCHING"),
    /** Locked at payment: lines from the approved quote_store. */
    lockedLines: jsonb("locked_lines").$type<QuoteLine[]>().notNull(),
    approvedItemsPaise: integer("approved_items_paise").notNull(),
    approvedDeliveryPaise: integer("approved_delivery_paise").notNull(),
    /** approvedItems + approvedDelivery (platform fee excluded; a refund adds its share). */
    approvedAmountPaise: integer("approved_amount_paise").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    excludedStoreIds: text("excluded_store_ids").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sub_order_basket").on(t.basketId), index("sub_order_status").on(t.status)],
);

/** PRD §7.3 (BAP mirror). PENDING = select/init/confirm still in flight. */
export type AttemptStatus = "PENDING" | "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";

export const attempt = bap.table(
  "attempt",
  {
    id: text("id").primaryKey(), // att_ = Beckn order.id
    subOrderId: text("sub_order_id").notNull().references(() => subOrder.id, { onDelete: "cascade" }),
    storeId: text("store_id").notNull(),
    storeName: text("store_name").notNull(),
    bppId: text("bpp_id").notNull(),
    bppUri: text("bpp_uri").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    status: text("status").$type<AttemptStatus>().notNull().default("PENDING"),
    quotedItemsPaise: integer("quoted_items_paise").notNull(),
    quotedDeliveryPaise: integer("quoted_delivery_paise").notNull(),
    quotedTotalPaise: integer("quoted_total_paise").notNull(),
    /** The store's own quoted lines (its listing ids), used for confirm. */
    lines: jsonb("lines").$type<QuoteLine[]>().notNull().default(sql`'[]'::jsonb`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("attempt_sub_no").on(t.subOrderId, t.attemptNo)],
);

export const refund = bap.table("refund", {
  id: text("id").primaryKey(), // rfd_
  basketId: text("basket_id").notNull().references(() => basket.id, { onDelete: "cascade" }),
  subOrderId: text("sub_order_id").notNull().unique().references(() => subOrder.id, { onDelete: "cascade" }),
  amountPaise: integer("amount_paise").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** PRD §9: one row per delivered sub-order. */
export const ledgerEntry = bap.table("ledger_entry", {
  id: text("id").primaryKey(), // led_
  subOrderId: text("sub_order_id").notNull().unique().references(() => subOrder.id, { onDelete: "cascade" }),
  basketId: text("basket_id").notNull(),
  storeId: text("store_id").notNull(),
  grossPaise: integer("gross_paise").notNull(),
  commissionPaise: integer("commission_paise").notNull(),
  netPayablePaise: integer("net_payable_paise").notNull(),
  platformSubsidyPaise: integer("platform_subsidy_paise").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single row (id = 1). */
export const config = bap.table("config", {
  id: integer("id").primaryKey().default(1),
  offerWindowSeconds: integer("offer_window_seconds").notNull().default(45),
  platformFeePaise: integer("platform_fee_paise").notNull().default(0),
  /** Merchant commission in basis points (100 = 1%). */
  commissionBps: integer("commission_bps").notNull().default(0),
  failNextPayment: boolean("fail_next_payment").notNull().default(false),
});

export const agentMessage = bap.table(
  "agent_message",
  {
    id: serial("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    /** "user" | "model" — content is the Gemini Content object, stored unchanged. */
    role: text("role").notNull(),
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_message_customer").on(t.customerId, t.id)],
);
