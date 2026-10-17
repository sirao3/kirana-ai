import type { FastifyInstance } from "fastify";
import {
  ack, Context, MessageSchemas, nack, BecknError, type AckResponse, type BecknAction, type Envelope,
} from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { audit, type AuditRow } from "./audit.js";
import { findParticipant } from "./registry.js";

export type BecknHandler<A extends BecknAction> = (env: Envelope<A>, ctx: AppContext) => Promise<void | AckResponse>;
export type BecknHandlers<A extends BecknAction> = { [K in A]?: BecknHandler<K> };

export interface ReceiverOptions<A extends BecknAction> {
  actor: AuditRow["actor"];
  actions: readonly A[];
  /** Read at request time, so modules can fill the map after registration. */
  handlers: BecknHandlers<A>;
  /**
   * Which context participant must match the registry (our stand-in for signature checks):
   * "bap" for requests (search/select…), "bpp" for callbacks (on_*).
   */
  verify: "bap" | "bpp";
}

/**
 * Registers POST /<action> for each action under the current prefix.
 *
 * Pipeline: validate → verify sender in registry → dedupe on (message_id, action, sender→receiver)
 * → audit in → run handler → ACK. Duplicates are ACKed without running the handler.
 *
 * Deviation (docs/ONDC_DEVIATIONS.md): the handler finishes BEFORE the ACK is returned,
 * because Cloud Run with request-based CPU may starve work done after a response.
 * A handler may return its own NACK; if it throws, the dedupe row is removed (so a retry
 * can succeed) and a NACK is returned.
 */
export function registerBecknActions<A extends BecknAction>(app: FastifyInstance, opts: ReceiverOptions<A>): void {
  for (const action of opts.actions) {
    app.post(`/${action}`, async (req, reply) => {
      const ctx = app.ctx;
      const body = (req.body ?? {}) as { context?: unknown; message?: unknown; error?: unknown };

      const c = Context.safeParse(body.context);
      if (!c.success || c.data.action !== action) {
        return reply.code(400).send(nack("10000", `invalid context for ${action}${c.success ? "" : ": " + c.error.issues[0]?.message}`, "JSON-SCHEMA-ERROR"));
      }
      const context = c.data;
      const error = body.error === undefined ? undefined : BecknError.safeParse(body.error).data;
      // on_* may carry only an error; requests must carry a valid message.
      let message: unknown = body.message;
      if (body.message !== undefined || !action.startsWith("on_") || !error) {
        const m = MessageSchemas[action].safeParse(body.message);
        if (!m.success) {
          const issue = m.error.issues[0];
          return reply.code(400).send(nack("10000", `invalid ${action} message at ${issue?.path.join(".")}: ${issue?.message}`, "JSON-SCHEMA-ERROR"));
        }
        message = m.data;
      }

      const senderId = opts.verify === "bap" ? context.bap_id : context.bpp_id;
      const senderUri = opts.verify === "bap" ? context.bap_uri : context.bpp_uri;
      const participant = senderId ? await findParticipant(ctx.pool, senderId) : null;
      if (!participant || participant.subscriber_url.replace(/\/$/, "") !== (senderUri ?? "").replace(/\/$/, "")) {
        return reply.code(401).send(nack("10002", `unknown ${opts.verify.toUpperCase()} ${senderId ?? "(none)"}`, "POLICY-ERROR"));
      }

      const sender = `${senderId}>${opts.actor}`;
      const fresh = await ctx.pool.query(
        `INSERT INTO beckn_message (message_id, action, sender, transaction_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (message_id, action, sender) DO NOTHING RETURNING id`,
        [context.message_id, action, sender, context.transaction_id],
      );
      await audit(ctx.pool, {
        kind: "beckn", action, actor: opts.actor, direction: "in", transactionId: context.transaction_id,
        messageId: context.message_id, payload: { ...body, duplicate: fresh.rowCount === 0 || undefined },
      });
      if (fresh.rowCount === 0) return ack();

      const handler = opts.handlers[action] as BecknHandler<A> | undefined;
      if (!handler) return reply.send(nack("30000", `${action} not implemented`));
      try {
        const env = { context, message, ...(error ? { error } : {}) } as Envelope<A>;
        const res = await handler(env, ctx);
        return res ?? ack();
      } catch (err) {
        req.log.error({ err, action, message_id: context.message_id, transaction_id: context.transaction_id }, "beckn handler failed");
        await ctx.pool.query("DELETE FROM beckn_message WHERE message_id = $1 AND action = $2 AND sender = $3", [context.message_id, action, sender]);
        return reply.code(500).send(nack("50000", `internal error handling ${action}`, "CORE-ERROR"));
      }
    });
  }
}
