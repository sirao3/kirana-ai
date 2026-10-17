import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditState } from "../../beckn/audit.js";
import { canActForStore, requireAuth } from "../../lib/auth.js";
import {
  acceptOffer, advanceOrder, ATTEMPT_COLS, notifyBap, rejectOffer, StockError, type AttemptItemRow, type AttemptRow,
} from "../attempts.js";

/** "+919845000001" → "+91984•••••01" (PRD §13: merchants see the phone only after accepting). */
export function maskPhone(phone: string): string {
  return phone.length <= 5 ? "•".repeat(phone.length) : `${phone.slice(0, 5)}${"•".repeat(phone.length - 7)}${phone.slice(-2)}`;
}

interface OfferDto {
  id: string;
  status: AttemptRow["status"];
  offeredAt: string;
  expiresAt: string;
  totalPaise: number;
  itemsTotalPaise: number;
  deliveryPaise: number;
  distanceM: number;
  buyerName: string;
  buyerPhone: string;
  items: { name: string; qty: number; unitPricePaise: number }[];
}
type OrderDto = OfferDto & { fulfilmentStatus: "ACCEPTED" | NonNullable<AttemptRow["fulfilment_status"]>; buyerAddress: string };

const itemsOf = (rows: AttemptItemRow[]) => rows.map((i) => ({ name: i.name, qty: i.qty, unitPricePaise: i.unit_price_paise }));

function offerDto(a: AttemptRow, items: AttemptItemRow[]): OfferDto {
  return {
    id: a.id,
    status: a.status,
    offeredAt: a.offered_at.toISOString(),
    expiresAt: a.expires_at.toISOString(),
    totalPaise: a.total_paise,
    itemsTotalPaise: a.items_total_paise,
    deliveryPaise: a.delivery_paise,
    distanceM: a.distance_m,
    buyerName: a.buyer_name,
    buyerPhone: a.status === "ACCEPTED" ? a.buyer_phone : maskPhone(a.buyer_phone),
    items: itemsOf(items),
  };
}

/** Merchant API (/bpp/merchant/*): dashboard, offers, orders (T05); catalogue + CSV (T14) register in ./catalogue.ts. */
export const merchantRoutes: FastifyPluginAsync = async (app) => {
  const { pool } = app.ctx;
  app.addHook("preHandler", requireAuth("merchant", "admin"));
  app.addHook("preHandler", async (req, reply) => {
    const storeId = (req.params as { storeId?: string }).storeId;
    if (storeId && !canActForStore(req.auth, storeId)) return reply.code(403).send({ error: "forbidden" });
  });

  app.get<{ Params: { storeId: string } }>("/:storeId/dashboard", async (req, reply) => {
    const { storeId } = req.params;
    const { rows: stores } = await pool.query<{ id: string; name: string; is_online: boolean; auto_reject: boolean; never_answer: boolean }>(
      `SELECT s.id, s.name, s.is_online, COALESCE(f.auto_reject, false) AS auto_reject, COALESCE(f.never_answer, false) AS never_answer
         FROM bpp.store s LEFT JOIN bpp.fault f ON f.store_id = s.id WHERE s.id = $1`,
      [storeId],
    );
    const s = stores[0];
    if (!s) return reply.code(404).send({ error: "unknown_store" });

    const { rows } = await pool.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLS} FROM bpp.attempt_order
        WHERE store_id = $1 AND (
              (status = 'OFFERED' AND expires_at > now())
           OR (status = 'ACCEPTED' AND (fulfilment_status IS DISTINCT FROM 'DELIVERED'
                OR updated_at > now() - interval '30 minutes')))
        ORDER BY offered_at DESC LIMIT 100`,
      [storeId],
    );
    const { rows: itemRows } = rows.length
      ? await pool.query<AttemptItemRow & { attempt_order_id: string }>(
          `SELECT attempt_order_id, listing_id, canonical_product_id, name, qty, unit_price_paise, line_total_paise
             FROM bpp.attempt_order_item WHERE attempt_order_id = ANY($1::text[]) ORDER BY id`,
          [rows.map((r) => r.id)],
        )
      : { rows: [] };
    const itemsFor = (id: string) => itemRows.filter((i) => i.attempt_order_id === id);

    return {
      store: { id: s.id, name: s.name, isOnline: s.is_online, faults: { autoReject: s.auto_reject, neverAnswer: s.never_answer } },
      offers: rows.filter((r) => r.status === "OFFERED").map((r) => offerDto(r, itemsFor(r.id))),
      orders: rows
        .filter((r) => r.status === "ACCEPTED")
        .map((r): OrderDto => ({
          ...offerDto(r, itemsFor(r.id)),
          buyerAddress: r.buyer_address,
          fulfilmentStatus: r.fulfilment_status ?? "ACCEPTED",
        })),
    };
  });

  app.post<{ Params: { storeId: string; id: string } }>("/:storeId/offers/:id/accept", async (req, reply) => {
    const { storeId, id } = req.params;
    let a: AttemptRow | null;
    try {
      a = await acceptOffer(app.ctx, storeId, id);
    } catch (err) {
      if (err instanceof StockError) return reply.code(409).send({ error: "INSUFFICIENT_STOCK", message: `Not enough stock for ${err.listingId}; reject the offer instead.` });
      throw err;
    }
    if (!a) return reply.code(409).send({ error: "OFFER_NOT_AVAILABLE" });
    await notifyBap(app.ctx, a); // outside any transaction
    return { ok: true };
  });

  const RejectBody = z.object({ reason: z.string().trim().min(1).max(200).default("Store declined the order") });
  app.post<{ Params: { storeId: string; id: string } }>("/:storeId/offers/:id/reject", async (req, reply) => {
    const body = RejectBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const a = await rejectOffer(app.ctx, req.params.storeId, req.params.id, body.data.reason);
    if (!a) return reply.code(409).send({ error: "OFFER_NOT_AVAILABLE" });
    await notifyBap(app.ctx, a);
    return { ok: true };
  });

  app.post<{ Params: { storeId: string; id: string } }>("/:storeId/orders/:id/advance", async (req, reply) => {
    const a = await advanceOrder(app.ctx, req.params.storeId, req.params.id);
    if (a === null) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    if (a === "invalid") return reply.code(409).send({ error: "INVALID_TRANSITION" });
    await notifyBap(app.ctx, a);
    return { fulfilmentStatus: a.fulfilment_status };
  });

  const StoreBody = z.object({ isOnline: z.boolean() });
  app.patch<{ Params: { storeId: string } }>("/:storeId/store", async (req, reply) => {
    const body = StoreBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const { rows } = await pool.query<{ is_online: boolean }>("UPDATE bpp.store SET is_online = $2 WHERE id = $1 RETURNING is_online", [
      req.params.storeId, body.data.isOnline,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: "unknown_store" });
    await auditState(pool, "bpp", body.data.isOnline ? "store.ONLINE" : "store.OFFLINE", { storeId: req.params.storeId, entityId: req.params.storeId });
    return { isOnline: rows[0].is_online };
  });
};
