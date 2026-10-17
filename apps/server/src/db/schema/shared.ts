import { bigserial, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Every Beckn message in/out and every state change (PRD §5, §13 Auditability). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    transactionId: text("transaction_id"),
    messageId: text("message_id"),
    /** "beckn" for protocol messages, "state" for state transitions. */
    kind: text("kind").$type<"beckn" | "state">().notNull(),
    /** Beckn action (search, on_select…) or a transition like "attempt.ACCEPTED". */
    action: text("action").notNull(),
    direction: text("direction").$type<"in" | "out">(),
    /** Module that wrote the row: bap | bpp | gw | admin. */
    actor: text("actor").notNull(),
    storeId: text("store_id"),
    entityId: text("entity_id"),
    payload: jsonb("payload"),
  },
  (t) => [index("audit_log_txn_idx").on(t.transactionId, t.at)],
);

/** Inbound Beckn message dedupe: a repeat (message_id, action, sender) is ACKed and ignored. */
export const becknMessage = pgTable(
  "beckn_message",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    messageId: text("message_id").notNull(),
    action: text("action").notNull(),
    sender: text("sender").notNull(),
    transactionId: text("transaction_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("beckn_message_dedupe").on(t.messageId, t.action, t.sender)],
);
