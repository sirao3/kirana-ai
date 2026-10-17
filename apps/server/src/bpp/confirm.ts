import { getTag, KTAG, type BecknError, type Envelope } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { auditState } from "../beckn/audit.js";
import { ATTEMPT_COLS, loadAttempt, loadItems, orderOf, type AttemptRow } from "./attempts.js";
import { quoteStore } from "./quote.js";
import { reply } from "./reply.js";

const addressText = (a: unknown): string => {
  if (typeof a === "string") return a;
  if (a && typeof a === "object") return Object.values(a).filter((v) => typeof v === "string").join(", ");
  return "";
};

/** Offer window the platform chose (confirm tag), else the server default. */
function offerWindowSeconds(ctx: AppContext, tags: Parameters<typeof getTag>[0]): number {
  const n = Number(getTag(tags, KTAG.group, KTAG.offerWindowSeconds));
  return Number.isInteger(n) && n > 0 ? n : ctx.config.OFFER_WINDOW_SECONDS;
}

/**
 * confirm: idempotent on order.id (a repeat returns the stored order). Re-checks stock under row
 * locks, creates the attempt_order (OFFERED, expires_at = now + window) and its items in one
 * transaction, then replies on_confirm AFTER commit. If it can't take the order it replies with an error.
 */
export async function onConfirm(env: Envelope<"confirm">, ctx: AppContext): Promise<void> {
  const order = env.message.order;
  const id = order.id;
  const fail = (error: BecknError) => reply(ctx, env, "on_confirm", { order }, { error, storeId: order.provider.id });
  if (!id) return fail({ type: "JSON-SCHEMA-ERROR", code: "10000", message: "order.id is required" });

  let attempt = await loadAttempt(ctx.pool, id);
  if (!attempt) {
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      const q = await quoteStore(client, { order, forUpdate: true });
      if ("missingStore" in q) {
        await client.query("ROLLBACK");
        return fail({ type: "DOMAIN-ERROR", code: "30001", message: `unknown store ${order.provider.id}` });
      }
      if (q.error || !q.customer || q.items.length === 0) {
        await client.query("ROLLBACK");
        return fail(q.error ?? { type: "DOMAIN-ERROR", code: "40002", message: "no items" });
      }
      const end = order.fulfillments?.[0]?.end;
      const { rows } = await client.query<AttemptRow>(
        `INSERT INTO bpp.attempt_order
           (id, transaction_id, bap_id, bap_uri, store_id, items_total_paise, delivery_paise, total_paise,
            buyer_name, buyer_phone, buyer_address, buyer_lat, buyer_lng, distance_m, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now() + make_interval(secs => $15))
         ON CONFLICT (id) DO NOTHING
         RETURNING ${ATTEMPT_COLS}`,
        [
          id, env.context.transaction_id, env.context.bap_id, env.context.bap_uri, q.store.id,
          q.itemsTotalPaise, q.deliveryPaise, q.totalPaise,
          order.billing?.name ?? end?.person?.name ?? "Customer",
          end?.contact?.phone ?? order.billing?.phone ?? "",
          addressText(end?.location.address) || addressText(order.billing?.address),
          q.customer.lat, q.customer.lng, q.distanceM ?? 0,
          offerWindowSeconds(ctx, order.tags),
        ],
      );
      if (rows[0]) {
        for (const i of q.items) {
          await client.query(
            `INSERT INTO bpp.attempt_order_item (attempt_order_id, listing_id, canonical_product_id, name, qty, unit_price_paise, line_total_paise)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, i.listingId, i.canonicalProductId, i.name, i.qty, i.unitPricePaise, i.lineTotalPaise],
          );
        }
      }
      await client.query("COMMIT");
      attempt = rows[0] ?? (await loadAttempt(ctx.pool, id));
      if (rows[0]) {
        await auditState(ctx.pool, "bpp", "attempt.OFFERED", {
          transactionId: env.context.transaction_id, entityId: id, storeId: q.store.id,
          payload: { expiresAt: rows[0].expires_at, totalPaise: rows[0].total_paise },
        });
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  if (!attempt) return fail({ type: "CORE-ERROR", code: "50000", message: "could not create order" });
  await reply(ctx, env, "on_confirm", { order: orderOf(attempt, await loadItems(ctx.pool, id)) }, { storeId: attempt.store_id });
}

/** status: report the attempt's current state (used by the BAP reconciler). */
export async function onStatus(env: Envelope<"status">, ctx: AppContext): Promise<void> {
  const a = await loadAttempt(ctx.pool, env.message.order_id);
  if (!a) {
    return reply(ctx, env, "on_status", undefined, {
      error: { type: "DOMAIN-ERROR", code: "30004", message: `order ${env.message.order_id} not found` },
    });
  }
  await reply(ctx, env, "on_status", { order: orderOf(a, await loadItems(ctx.pool, a.id)) }, { storeId: a.store_id });
}
