import type { FastifyPluginAsync } from "fastify";
import { ZodError } from "zod";
import { requireAuth } from "../../lib/auth.js";
import { ApiError } from "../util.js";
import { discoveryRoutes } from "./discovery.js";
import { basketRoutes } from "./basket.js";
import { checkoutRoutes } from "./checkout.js";
import { orderRoutes } from "./orders.js";

/** Customer BAP API (/bap/*), lane B: search, basket, quote (T06), approve/pay (T07), orders (T08), plan (T09). Contract: packages/shared/src/api.ts */
export const bapApiRoutes: FastifyPluginAsync = async (app) => {
  // Encapsulated: applies only to the routes registered here, not to the Beckn callback endpoints or the agent.
  app.addHook("preHandler", requireAuth("customer"));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err instanceof ZodError) return reply.code(400).send({ error: "bad_request", message: err.issues[0]?.message, details: err.issues });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: "bad_request", message: (err as Error).message });
    req.log.error({ err }, "bap api error");
    return reply.code(500).send({ error: "internal_error" });
  });

  await app.register(discoveryRoutes);
  await app.register(basketRoutes);
  await app.register(checkoutRoutes);
  await app.register(orderRoutes);
};
