-- Initial schema (PRD §5). Drafted with drizzle-kit from src/db/schema.
CREATE SCHEMA "registry";
--> statement-breakpoint
CREATE SCHEMA "bpp";
--> statement-breakpoint
CREATE SCHEMA "bap";
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_id" text,
	"message_id" text,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"direction" text,
	"actor" text NOT NULL,
	"store_id" text,
	"entity_id" text,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "beckn_message" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"action" text NOT NULL,
	"sender" text NOT NULL,
	"transaction_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."participant" (
	"subscriber_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"subscriber_url" text NOT NULL,
	"domain" text DEFAULT 'ONDC:RET10' NOT NULL,
	"city" text DEFAULT 'std:080' NOT NULL,
	"status" text DEFAULT 'SUBSCRIBED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bpp"."attempt_order" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"bap_id" text NOT NULL,
	"bap_uri" text NOT NULL,
	"store_id" text NOT NULL,
	"status" text DEFAULT 'OFFERED' NOT NULL,
	"fulfilment_status" text,
	"items_total_paise" integer NOT NULL,
	"delivery_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_phone" text NOT NULL,
	"buyer_address" text NOT NULL,
	"buyer_lat" double precision NOT NULL,
	"buyer_lng" double precision NOT NULL,
	"distance_m" integer NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bpp"."attempt_order_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"attempt_order_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"canonical_product_id" text NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"line_total_paise" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bpp"."canonical_product" (
	"id" text PRIMARY KEY NOT NULL,
	"gtin" text,
	"brand" text NOT NULL,
	"name" text NOT NULL,
	"variant" text,
	"pack_size" integer NOT NULL,
	"unit" text NOT NULL,
	"category" text NOT NULL,
	"search_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bpp"."fault" (
	"store_id" text PRIMARY KEY NOT NULL,
	"auto_reject" boolean DEFAULT false NOT NULL,
	"never_answer" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bpp"."listing" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"canonical_product_id" text NOT NULL,
	"price_paise" integer NOT NULL,
	"mrp_paise" integer NOT NULL,
	"stock_qty" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_stock_nonneg" CHECK ("bpp"."listing"."stock_qty" >= 0),
	CONSTRAINT "listing_price_pos" CHECK ("bpp"."listing"."price_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "bpp"."loose_term" (
	"term" text PRIMARY KEY NOT NULL,
	"hint" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bpp"."store" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"phone" text NOT NULL,
	"open_time" text DEFAULT '00:00' NOT NULL,
	"close_time" text DEFAULT '00:00' NOT NULL,
	"delivery_radius_m" integer NOT NULL,
	"delivery_rule" jsonb NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bpp"."synonym" (
	"term" text PRIMARY KEY NOT NULL,
	"normalized" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bap"."agent_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bap"."approval" (
	"id" text PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"quote_hash" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "bap"."attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"sub_order_id" text NOT NULL,
	"store_id" text NOT NULL,
	"store_name" text NOT NULL,
	"bpp_id" text NOT NULL,
	"bpp_uri" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"quoted_items_paise" integer NOT NULL,
	"quoted_delivery_paise" integer NOT NULL,
	"quoted_total_paise" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bap"."basket" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"transaction_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bap"."basket_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"store_id" text NOT NULL,
	"store_name" text NOT NULL,
	"bpp_id" text NOT NULL,
	"bpp_uri" text NOT NULL,
	"canonical_product_id" text NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"seen_price_paise" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bap"."config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"offer_window_seconds" integer DEFAULT 45 NOT NULL,
	"platform_fee_paise" integer DEFAULT 0 NOT NULL,
	"commission_bps" integer DEFAULT 0 NOT NULL,
	"fail_next_payment" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bap"."customer" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bap"."ledger_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"sub_order_id" text NOT NULL,
	"basket_id" text NOT NULL,
	"store_id" text NOT NULL,
	"gross_paise" integer NOT NULL,
	"commission_paise" integer NOT NULL,
	"net_payable_paise" integer NOT NULL,
	"platform_subsidy_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_sub_order_id_unique" UNIQUE("sub_order_id")
);
--> statement-breakpoint
CREATE TABLE "bap"."payment" (
	"id" text PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" text DEFAULT 'INITIATED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payment_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "bap"."quote" (
	"id" text PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"quote_hash" text NOT NULL,
	"items_total_paise" integer NOT NULL,
	"delivery_total_paise" integer NOT NULL,
	"platform_fee_paise" integer NOT NULL,
	"grand_total_paise" integer NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bap"."quote_store" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"store_id" text NOT NULL,
	"store_name" text NOT NULL,
	"bpp_id" text NOT NULL,
	"bpp_uri" text NOT NULL,
	"lines" jsonb NOT NULL,
	"items_total_paise" integer NOT NULL,
	"delivery_paise" integer NOT NULL,
	"total_paise" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bap"."refund" (
	"id" text PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"sub_order_id" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_sub_order_id_unique" UNIQUE("sub_order_id")
);
--> statement-breakpoint
CREATE TABLE "bap"."sub_order" (
	"id" text PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"approved_store_id" text NOT NULL,
	"current_store_id" text,
	"status" text DEFAULT 'DISPATCHING' NOT NULL,
	"locked_lines" jsonb NOT NULL,
	"approved_items_paise" integer NOT NULL,
	"approved_delivery_paise" integer NOT NULL,
	"approved_amount_paise" integer NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"excluded_store_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bpp"."attempt_order" ADD CONSTRAINT "attempt_order_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "bpp"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bpp"."attempt_order_item" ADD CONSTRAINT "attempt_order_item_attempt_order_id_attempt_order_id_fk" FOREIGN KEY ("attempt_order_id") REFERENCES "bpp"."attempt_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bpp"."fault" ADD CONSTRAINT "fault_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "bpp"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bpp"."listing" ADD CONSTRAINT "listing_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "bpp"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bpp"."listing" ADD CONSTRAINT "listing_canonical_product_id_canonical_product_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "bpp"."canonical_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."approval" ADD CONSTRAINT "approval_basket_id_basket_id_fk" FOREIGN KEY ("basket_id") REFERENCES "bap"."basket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."approval" ADD CONSTRAINT "approval_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "bap"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."attempt" ADD CONSTRAINT "attempt_sub_order_id_sub_order_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "bap"."sub_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."basket" ADD CONSTRAINT "basket_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "bap"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."basket_item" ADD CONSTRAINT "basket_item_basket_id_basket_id_fk" FOREIGN KEY ("basket_id") REFERENCES "bap"."basket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."ledger_entry" ADD CONSTRAINT "ledger_entry_sub_order_id_sub_order_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "bap"."sub_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."payment" ADD CONSTRAINT "payment_basket_id_basket_id_fk" FOREIGN KEY ("basket_id") REFERENCES "bap"."basket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."quote" ADD CONSTRAINT "quote_basket_id_basket_id_fk" FOREIGN KEY ("basket_id") REFERENCES "bap"."basket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."quote_store" ADD CONSTRAINT "quote_store_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "bap"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."refund" ADD CONSTRAINT "refund_basket_id_basket_id_fk" FOREIGN KEY ("basket_id") REFERENCES "bap"."basket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."refund" ADD CONSTRAINT "refund_sub_order_id_sub_order_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "bap"."sub_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bap"."sub_order" ADD CONSTRAINT "sub_order_basket_id_basket_id_fk" FOREIGN KEY ("basket_id") REFERENCES "bap"."basket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_txn_idx" ON "audit_log" USING btree ("transaction_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "beckn_message_dedupe" ON "beckn_message" USING btree ("message_id","action","sender");--> statement-breakpoint
CREATE INDEX "attempt_order_open" ON "bpp"."attempt_order" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "attempt_order_store" ON "bpp"."attempt_order" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "canonical_product_search_trgm" ON "bpp"."canonical_product" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "canonical_product_search_fts" ON "bpp"."canonical_product" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
CREATE UNIQUE INDEX "listing_store_product" ON "bpp"."listing" USING btree ("store_id","canonical_product_id");--> statement-breakpoint
CREATE INDEX "agent_message_customer" ON "bap"."agent_message" USING btree ("customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_sub_no" ON "bap"."attempt" USING btree ("sub_order_id","attempt_no");--> statement-breakpoint
CREATE INDEX "basket_customer" ON "bap"."basket" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "basket_item_listing" ON "bap"."basket_item" USING btree ("basket_id","listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_one_live_per_basket" ON "bap"."payment" USING btree ("basket_id") WHERE status <> 'FAILED';--> statement-breakpoint
CREATE INDEX "sub_order_basket" ON "bap"."sub_order" USING btree ("basket_id");--> statement-breakpoint
CREATE INDEX "sub_order_status" ON "bap"."sub_order" USING btree ("status");