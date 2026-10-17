import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authSecret, safeEqual, signToken } from "../lib/auth.js";

/** Persona picker (/auth). Reads customer and store names only. */
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/personas", async () => {
    const [customers, stores] = await Promise.all([
      app.ctx.pool.query<{ id: string; name: string }>("SELECT id, name FROM bap.customer ORDER BY id"),
      app.ctx.pool.query<{ id: string; name: string }>("SELECT id, name FROM bpp.store ORDER BY name"),
    ]);
    return { customers: customers.rows, stores: stores.rows };
  });

  const Body = z.discriminatedUnion("role", [
    z.object({ role: z.literal("customer"), id: z.string() }),
    z.object({ role: z.literal("merchant"), id: z.string() }),
    z.object({ role: z.literal("admin"), passcode: z.string() }),
  ]);

  app.post("/persona", async (req, reply) => {
    const b = Body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request" });
    const secret = authSecret(app.ctx.config);
    if (b.data.role === "admin") {
      if (!safeEqual(b.data.passcode, app.ctx.config.ADMIN_PASSCODE)) return reply.code(401).send({ error: "bad_passcode" });
      return { token: signToken(secret, { role: "admin", sub: "admin" }), role: "admin", sub: "admin", name: "Admin" };
    }
    const table = b.data.role === "customer" ? "bap.customer" : "bpp.store";
    const { rows } = await app.ctx.pool.query<{ name: string }>(`SELECT name FROM ${table} WHERE id = $1`, [b.data.id]);
    if (!rows[0]) return reply.code(404).send({ error: "unknown_persona" });
    return { token: signToken(secret, { role: b.data.role, sub: b.data.id }), role: b.data.role, sub: b.data.id, name: rows[0].name };
  });
};
