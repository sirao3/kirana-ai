import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../lib/auth.js";

/** Admin console API (/admin): reset, config, faults, ledger, audit (T15). All routes need an admin token. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth("admin"));

  app.get("/whoami", async (req) => ({ role: req.auth?.role }));
};
