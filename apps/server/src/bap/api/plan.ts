import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { planForCustomer } from "../plan/index.js";
import { loadCustomer } from "../util.js";

const Body = z.object({
  needs: z.array(z.object({ query: z.string().trim().min(1).max(200), qty: z.number().int().min(1).max(999) })).min(1).max(12),
  budgetPaise: z.number().int().positive().optional(),
});

export const planRoutes: FastifyPluginAsync = async (app) => {
  // POST /bap/plan {needs:[{query, qty}], budgetPaise?} → PlanResult
  app.post("/plan", async (req) => {
    const body = Body.parse(req.body);
    const customer = await loadCustomer(app.ctx.pool, req.auth!.sub);
    return planForCustomer(app.ctx, customer, body);
  });
};
