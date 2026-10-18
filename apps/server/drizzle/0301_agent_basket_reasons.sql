-- UX-02 / UX-03: optimiser reason + "suggested quantity" flag per basket line, plan-level reasons per basket.
ALTER TABLE "bap"."basket_item" ADD COLUMN "reason" text;
--> statement-breakpoint
ALTER TABLE "bap"."basket_item" ADD COLUMN "qty_inferred" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "bap"."basket" ADD COLUMN "plan_reasons" jsonb;
