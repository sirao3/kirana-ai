import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { approveBasket, payBasket } from "../checkout.js";
import { ApiError } from "../util.js";

/**
 * Approve + pay (T07). These are customer-token routes called by the UI buttons only; the agent's HTTP tool client
 * (lane C) uses an allowlist that excludes them, and nothing here is exposed as a tool.
 */
export const checkoutRoutes: FastifyPluginAsync = async (app) => {
  const Params = z.object({ id: z.string().min(1) });

  app.post("/baskets/:id/approve", async (req) => {
    const { id } = Params.parse(req.params);
    const { quoteHash } = z.object({ quoteHash: z.string().min(1) }).parse(req.body);
    return approveBasket(app.ctx, req.auth!.sub, id, quoteHash);
  });

  app.post("/baskets/:id/pay", async (req) => {
    const { id } = Params.parse(req.params);
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !key.trim() || key.length > 200) {
      throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header.");
    }
    const body = z.object({ approvalToken: z.string().min(1), simulateFailure: z.boolean().optional() }).parse(req.body);
    return payBasket(app.ctx, req.auth!.sub, id, body, key.trim());
  });
};
