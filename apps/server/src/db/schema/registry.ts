import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const registry = pgSchema("registry");

/** Beckn network participants. subscriber_url is absolute (built from SELF_BASE_URL at seed time). */
export const participant = registry.table("participant", {
  subscriberId: text("subscriber_id").primaryKey(),
  type: text("type").$type<"BAP" | "BPP" | "BG">().notNull(),
  subscriberUrl: text("subscriber_url").notNull(),
  domain: text("domain").notNull().default("ONDC:RET10"),
  city: text("city").notNull().default("std:080"),
  status: text("status").$type<"SUBSCRIBED" | "INACTIVE">().notNull().default("SUBSCRIBED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
