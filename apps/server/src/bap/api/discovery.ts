import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { SearchResponse } from "@kiranaai/shared";
import { groupOffers, searchOffers } from "../offers.js";
import { loadCustomer } from "../util.js";

const Query = z.object({ q: z.string().trim().min(1).max(200) });

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  // GET /bap/search?q=
  app.get("/search", async (req): Promise<SearchResponse> => {
    const started = Date.now();
    const { q } = Query.parse(req.query);
    const customer = await loadCustomer(app.ctx.pool, req.auth!.sub);
    const { offers, looseDeclined } = await searchOffers(app.ctx, customer, { query: q });
    return { query: q, groups: groupOffers(offers), looseDeclined, tookMs: Date.now() - started };
  });
};
