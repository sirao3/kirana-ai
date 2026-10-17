import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getOrderView, listOrderViews } from "../orders.js";

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.get("/baskets/:id", async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    return getOrderView(app.ctx.pool, req.auth!.sub, id);
  });

  app.get("/orders", async (req) => listOrderViews(app.ctx.pool, req.auth!.sub));
};
