import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { basketView, getOpenBasket, patchBasketItem, removeBasketItem, replaceBasket, setBasketItem } from "../basket.js";
import { createQuote } from "../quote.js";
import { ApiError } from "../util.js";

const Qty = z.number().int().min(1).max(999);
const Item = z.object({ listingId: z.string().min(1), qty: Qty });

export const basketRoutes: FastifyPluginAsync = async (app) => {
  const { pool } = app.ctx;
  const customerId = (req: { auth?: { sub: string } }) => req.auth!.sub;

  app.get("/basket", async (req) => basketView(pool, (await getOpenBasket(pool, customerId(req))).id));

  app.put("/basket", async (req) => {
    const body = z.object({ items: z.array(Item).max(100) }).parse(req.body);
    if (new Set(body.items.map((i) => i.listingId)).size !== body.items.length) {
      throw new ApiError(400, "duplicate_listing", "Each listingId may appear once.");
    }
    return replaceBasket(pool, customerId(req), body.items);
  });

  app.put("/basket/items", async (req) => setBasketItem(pool, customerId(req), Item.parse(req.body)));

  app.patch("/basket/items/:listingId", async (req) => {
    const { listingId } = z.object({ listingId: z.string() }).parse(req.params);
    const { qty } = z.object({ qty: Qty }).parse(req.body);
    return patchBasketItem(pool, customerId(req), { listingId, qty });
  });

  app.delete("/basket/items/:listingId", async (req) => {
    const { listingId } = z.object({ listingId: z.string() }).parse(req.params);
    return removeBasketItem(pool, customerId(req), listingId);
  });

  app.post("/basket/quote", async (req) => createQuote(app.ctx, customerId(req)));
};
