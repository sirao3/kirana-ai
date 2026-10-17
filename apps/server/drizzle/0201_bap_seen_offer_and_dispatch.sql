-- Lane B (T06-T08): offers the BAP has seen in on_search (resolves store/price when a customer adds a listing),
-- payment simulate-failure flag, and per-attempt quoted lines.
CREATE TABLE "bap"."seen_offer" (
	"customer_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"store_id" text NOT NULL,
	"store_name" text NOT NULL,
	"bpp_id" text NOT NULL,
	"bpp_uri" text NOT NULL,
	"canonical_product_id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL DEFAULT '',
	"pack_label" text NOT NULL DEFAULT '',
	"price_paise" integer NOT NULL,
	"mrp_paise" integer NOT NULL,
	"stock_qty" integer NOT NULL,
	"distance_m" integer NOT NULL,
	"delivery_charge_paise" integer,
	"delivery_rule" jsonb,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seen_offer_pk" PRIMARY KEY ("customer_id", "listing_id")
);
--> statement-breakpoint
ALTER TABLE "bap"."payment" ADD COLUMN "simulate_failure" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "bap"."attempt" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;
