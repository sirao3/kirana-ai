import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditState } from "../beckn/audit.js";
import { clearRegistryCache } from "../beckn/registry.js";
import { resetAndSeed } from "../db/seed/seed.js";
import { requireAuth } from "../lib/auth.js";

interface ConfigRow {
  offer_window_seconds: number;
  fail_next_payment: boolean;
  platform_fee_paise: number;
  commission_bps: number;
}

const configDto = (r: ConfigRow) => ({
  offerWindowSeconds: r.offer_window_seconds,
  failNextPayment: r.fail_next_payment,
  platformFeePaise: r.platform_fee_paise,
  commissionBps: r.commission_bps,
});

const ConfigPatch = z
  .object({
    offerWindowSeconds: z.number().int().min(1).max(900),
    failNextPayment: z.boolean(),
    platformFeePaise: z.number().int().min(0).max(100_000_00),
    commissionBps: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to update" });

const FaultPatch = z
  .object({ autoReject: z.boolean(), neverAnswer: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to update" });

/** Admin console API (/admin/api; the /admin path itself is the web page): reset, config, faults, ledger, audit (T15). All routes need an admin token. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  const { pool, config } = app.ctx;
  app.addHook("preHandler", requireAuth("admin"));

  app.get("/whoami", async (req) => ({ role: req.auth?.role }));

  // --- reset & reseed (wipes every module's data, restores the demo seed) ---
  app.post("/reset", async () => {
    await resetAndSeed(pool, { selfBaseUrl: config.selfBaseUrl, offerWindowSeconds: config.OFFER_WINDOW_SECONDS });
    clearRegistryCache();
    return { ok: true };
  });

  // --- platform config (bap.config, single row) ---
  const readConfig = async () => {
    const { rows } = await pool.query<ConfigRow>("SELECT offer_window_seconds, fail_next_payment, platform_fee_paise, commission_bps FROM bap.config WHERE id = 1");
    return rows[0] ? configDto(rows[0]) : null;
  };
  app.get("/config", async (_req, reply) => (await readConfig()) ?? reply.code(404).send({ error: "no_config" }));

  app.patch("/config", async (req, reply) => {
    const b = ConfigPatch.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request", message: b.error.issues.map((i) => i.message).join("; ") });
    const d = b.data;
    await pool.query(
      `INSERT INTO bap.config (id, offer_window_seconds, platform_fee_paise, commission_bps, fail_next_payment)
       VALUES (1, COALESCE($1::int, $5::int), COALESCE($2::int, 0), COALESCE($3::int, 0), COALESCE($4::boolean, false))
       ON CONFLICT (id) DO UPDATE SET
         offer_window_seconds = COALESCE($1::int, bap.config.offer_window_seconds),
         platform_fee_paise = COALESCE($2::int, bap.config.platform_fee_paise),
         commission_bps = COALESCE($3::int, bap.config.commission_bps),
         fail_next_payment = COALESCE($4::boolean, bap.config.fail_next_payment)`,
      [d.offerWindowSeconds ?? null, d.platformFeePaise ?? null, d.commissionBps ?? null, d.failNextPayment ?? null, config.OFFER_WINDOW_SECONDS],
    );
    await auditState(pool, "admin", "admin.config", { payload: d });
    return readConfig();
  });

  // --- per-store fault injection (bpp.fault) ---
  type FaultRow = { store_id: string; store_name: string; auto_reject: boolean; never_answer: boolean };
  const faultDto = (r: FaultRow) => ({ storeId: r.store_id, storeName: r.store_name, autoReject: r.auto_reject, neverAnswer: r.never_answer });
  const FAULT_SQL = `SELECT s.id AS store_id, s.name AS store_name, COALESCE(f.auto_reject, false) AS auto_reject, COALESCE(f.never_answer, false) AS never_answer
                       FROM bpp.store s LEFT JOIN bpp.fault f ON f.store_id = s.id`;

  app.get("/faults", async () => ({ faults: (await pool.query<FaultRow>(`${FAULT_SQL} ORDER BY s.name`)).rows.map(faultDto) }));

  app.get<{ Params: { storeId: string } }>("/faults/:storeId", async (req, reply) => {
    const { rows } = await pool.query<FaultRow>(`${FAULT_SQL} WHERE s.id = $1`, [req.params.storeId]);
    return rows[0] ? faultDto(rows[0]) : reply.code(404).send({ error: "unknown_store" });
  });

  app.patch<{ Params: { storeId: string } }>("/faults/:storeId", async (req, reply) => {
    const b = FaultPatch.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request", message: b.error.issues.map((i) => i.message).join("; ") });
    const { storeId } = req.params;
    if ((await pool.query("SELECT 1 FROM bpp.store WHERE id = $1", [storeId])).rowCount === 0) return reply.code(404).send({ error: "unknown_store" });
    await pool.query(
      `INSERT INTO bpp.fault (store_id, auto_reject, never_answer) VALUES ($1, COALESCE($2, false), COALESCE($3, false))
       ON CONFLICT (store_id) DO UPDATE SET auto_reject = COALESCE($2, bpp.fault.auto_reject), never_answer = COALESCE($3, bpp.fault.never_answer)`,
      [storeId, b.data.autoReject ?? null, b.data.neverAnswer ?? null],
    );
    await auditState(pool, "admin", "admin.fault", { storeId, entityId: storeId, payload: b.data });
    const { rows } = await pool.query<FaultRow>(`${FAULT_SQL} WHERE s.id = $1`, [storeId]);
    return faultDto(rows[0]!);
  });

  // --- ledger (bap.ledger_entry per delivered sub-order, PRD §9) ---
  app.get("/ledger", async () => {
    const { rows } = await pool.query<{
      id: string; sub_order_id: string; basket_id: string; store_id: string; store_name: string | null;
      gross_paise: number; commission_paise: number; net_payable_paise: number; platform_subsidy_paise: number; created_at: Date;
    }>(
      `SELECT l.id, l.sub_order_id, l.basket_id, l.store_id, s.name AS store_name, l.gross_paise, l.commission_paise,
              l.net_payable_paise, l.platform_subsidy_paise, l.created_at
         FROM bap.ledger_entry l LEFT JOIN bpp.store s ON s.id = l.store_id ORDER BY l.created_at, l.id`,
    );
    const entries = rows.map((r) => ({
      id: r.id,
      subOrderId: r.sub_order_id,
      basketId: r.basket_id,
      storeId: r.store_id,
      storeName: r.store_name ?? r.store_id,
      grossPaise: r.gross_paise,
      commissionPaise: r.commission_paise,
      netPayablePaise: r.net_payable_paise,
      platformSubsidyPaise: r.platform_subsidy_paise,
      createdAt: r.created_at.toISOString(),
    }));
    const byStore = new Map<string, { storeId: string; storeName: string; grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number }>();
    for (const e of entries) {
      const s = byStore.get(e.storeId) ?? { storeId: e.storeId, storeName: e.storeName, grossPaise: 0, commissionPaise: 0, netPayablePaise: 0, platformSubsidyPaise: 0 };
      s.grossPaise += e.grossPaise;
      s.commissionPaise += e.commissionPaise;
      s.netPayablePaise += e.netPayablePaise;
      s.platformSubsidyPaise += e.platformSubsidyPaise;
      byStore.set(e.storeId, s);
    }
    return { entries, byStore: [...byStore.values()].sort((a, b) => a.storeName.localeCompare(b.storeName)) };
  });

  // --- audit viewer ---
  /** Recent transactions (for the viewer's picker): newest first. */
  app.get("/transactions", async () => {
    const { rows } = await pool.query<{ transaction_id: string; first_at: Date; last_at: Date; messages: number }>(
      `SELECT transaction_id, min(at) AS first_at, max(at) AS last_at, count(*)::int AS messages
         FROM audit_log WHERE transaction_id IS NOT NULL GROUP BY transaction_id ORDER BY max(at) DESC LIMIT 50`,
    );
    return { transactions: rows.map((r) => ({ transactionId: r.transaction_id, firstAt: r.first_at.toISOString(), lastAt: r.last_at.toISOString(), messages: r.messages })) };
  });

  const AuditQuery = z.object({ transactionId: z.string().min(1) });
  app.get("/audit", async (req, reply) => {
    const q = AuditQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "transactionId_required" });
    const { rows } = await pool.query<{
      id: number; at: Date; transaction_id: string | null; message_id: string | null; kind: string; action: string;
      direction: string | null; actor: string; store_id: string | null; entity_id: string | null; payload: unknown;
    }>(
      `SELECT id, at, transaction_id, message_id, kind, action, direction, actor, store_id, entity_id, payload
         FROM audit_log WHERE transaction_id = $1 ORDER BY at, id`,
      [q.data.transactionId],
    );
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      transactionId: r.transaction_id,
      messageId: r.message_id,
      kind: r.kind,
      action: r.action,
      direction: r.direction,
      actor: r.actor,
      storeId: r.store_id,
      entityId: r.entity_id,
      payload: r.payload,
    }));
  });
};
