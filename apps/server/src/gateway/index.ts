import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { registerBecknActions } from "../beckn/receiver.js";
import { listParticipants } from "../beckn/registry.js";
import { becknSend } from "../beckn/send.js";

/** Gateway + registry (/gw): lookup, and search fan-out to every subscribed BPP (BKN-03). */
export const gatewayRoutes: FastifyPluginAsync = async (app) => {
  const Lookup = z.object({ subscriber_id: z.string().optional(), type: z.enum(["BAP", "BPP", "BG"]).optional() }).default({});

  app.post("/lookup", async (req, reply) => {
    const q = Lookup.safeParse(req.body ?? {});
    if (!q.success) return reply.code(400).send({ error: "bad_request" });
    return listParticipants(app.ctx.pool, { type: q.data.type, subscriberId: q.data.subscriber_id });
  });

  registerBecknActions(app, {
    actor: "gw",
    actions: ["search"] as const,
    verify: "bap",
    handlers: {
      search: async (env, ctx) => {
        const bpps = await listParticipants(ctx.pool, { type: "BPP" });
        const results = await Promise.allSettled(
          bpps.map((p) => becknSend(ctx, { url: p.subscriber_url, action: "search", context: env.context, message: env.message, actor: "gw" })),
        );
        results.forEach((r, i) => {
          if (r.status === "rejected") app.log.warn({ bpp: bpps[i]!.subscriber_id, err: String(r.reason) }, "gateway forward failed");
        });
      },
    },
  });
};
