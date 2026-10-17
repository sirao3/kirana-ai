import type { FastifyPluginAsync } from "fastify";
import { callbackContext, priceOf, type BecknAction } from "@kiranaai/shared";
import { searchViaGateway } from "../bap/beckn-client.js";
import { registerBecknActions } from "../beckn/receiver.js";
import { clearRegistryCache } from "../beckn/registry.js";
import { becknSend } from "../beckn/send.js";
import { requireAuth } from "../lib/auth.js";

const STUB_BPP_ID = "kiranaai-stub-bpp";

/**
 * T03 smoke test, usable on the hosted URL (admin token required):
 * BAP search → gateway → stub BPP (/test/stub-bpp) → on_search → BAP waiter.
 * The stub is in the registry only for the duration of the call.
 */
export const testingRoutes: FastifyPluginAsync = async (app) => {
  await app.register(async (stub) => {
    registerBecknActions(stub, {
      actor: "test",
      actions: ["search"] as const,
      verify: "bap",
      handlers: {
        search: async (env, ctx) => {
          const bppUri = `${ctx.config.selfBaseUrl.replace(/\/$/, "")}/test/stub-bpp`;
          await becknSend(ctx, {
            url: env.context.bap_uri,
            action: "on_search" as BecknAction,
            context: callbackContext(env.context, { bppId: STUB_BPP_ID, bppUri }),
            message: {
              catalog: {
                "bpp/descriptor": { name: "Stub BPP" },
                "bpp/providers": [{ id: "stub_store", descriptor: { name: "Stub Store" }, items: [
                  { id: "stub_item", descriptor: { name: "Stub Atta 1 kg" }, price: priceOf(5000), quantity: { available: { count: "1" } } },
                ] }],
              },
            },
            actor: "test",
          });
        },
      },
    });
  }, { prefix: "/stub-bpp" });

  app.post("/beckn-roundtrip", { preHandler: requireAuth("admin") }, async () => {
    const { pool, config } = app.ctx;
    const stubUrl = `${config.selfBaseUrl.replace(/\/$/, "")}/test/stub-bpp`;
    await pool.query(
      `INSERT INTO registry.participant (subscriber_id, type, subscriber_url, status) VALUES ($1, 'BPP', $2, 'SUBSCRIBED')
       ON CONFLICT (subscriber_id) DO UPDATE SET subscriber_url = EXCLUDED.subscriber_url, status = 'SUBSCRIBED'`,
      [STUB_BPP_ID, stubUrl],
    );
    const started = Date.now();
    try {
      const replies = await searchViaGateway(app.ctx, {
        transactionId: `txn_test_${started}`,
        message: { intent: { item: { descriptor: { name: "atta" } } } },
        windowMs: 1000,
      });
      const stub = replies.find((r) => r.context.bpp_id === STUB_BPP_ID);
      return {
        ok: !!stub,
        ms: Date.now() - started,
        callbacks: replies.map((r) => ({ bpp_id: r.context.bpp_id, providers: r.message.catalog["bpp/providers"].length })),
      };
    } finally {
      await pool.query("DELETE FROM registry.participant WHERE subscriber_id = $1", [STUB_BPP_ID]);
      clearRegistryCache();
    }
  });
};
