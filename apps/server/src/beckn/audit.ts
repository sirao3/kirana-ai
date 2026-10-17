import type pg from "pg";

export interface AuditRow {
  kind: "beckn" | "state";
  action: string;
  actor: "bap" | "bpp" | "gw" | "admin" | "test";
  direction?: "in" | "out";
  transactionId?: string | null;
  messageId?: string | null;
  storeId?: string | null;
  entityId?: string | null;
  payload?: unknown;
}

/** Appends to audit_log. Never throws: auditing must not break the flow it records. */
export async function audit(db: pg.Pool | pg.PoolClient, row: AuditRow): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_log (kind, action, actor, direction, transaction_id, message_id, store_id, entity_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.kind, row.action, row.actor, row.direction ?? null, row.transactionId ?? null, row.messageId ?? null,
        row.storeId ?? null, row.entityId ?? null, row.payload === undefined ? null : JSON.stringify(row.payload),
      ],
    );
  } catch {
    // swallow; see doc comment
  }
}

/** Shorthand for state transitions, e.g. auditState(pool, "bpp", "attempt.ACCEPTED", { entityId, transactionId }). */
export function auditState(
  db: pg.Pool | pg.PoolClient,
  actor: AuditRow["actor"],
  action: string,
  extra: Omit<AuditRow, "kind" | "action" | "actor"> = {},
): Promise<void> {
  return audit(db, { kind: "state", action, actor, ...extra });
}
