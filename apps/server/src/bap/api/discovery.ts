import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { SearchResponse, SuggestResponse } from "@kiranaai/shared";
import { groupOffers, searchOffers } from "../offers.js";
import { loadCustomer } from "../util.js";

const Query = z.object({ q: z.string().trim().min(1).max(200) });

const SUGGEST_TTL_MS = 60_000;
const SUGGEST_WINDOW_MS = 400;
const suggestCache = new Map<string, { at: number; value: SuggestResponse["suggestions"] }>();

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  // GET /bap/search?q=
  app.get("/search", async (req): Promise<SearchResponse> => {
    const started = Date.now();
    const { q } = Query.parse(req.query);
    const customer = await loadCustomer(app.ctx.pool, req.auth!.sub);
    const { offers, looseDeclined } = await searchOffers(app.ctx, customer, { query: q });
    return { query: q, groups: groupOffers(offers), looseDeclined, tookMs: Date.now() - started };
  });

  // GET /bap/suggest?q= : distinct canonical products for a partial query (a short gateway search; synonyms expand in the BPP).
  // Cached 60 s per normalised query. Offers seen are persisted like any search.
  app.get("/suggest", async (req): Promise<SuggestResponse> => {
    const { q } = Query.parse(req.query);
    const key = q.toLowerCase();
    const hit = suggestCache.get(key);
    if (hit && Date.now() - hit.at < SUGGEST_TTL_MS) return { query: q, suggestions: hit.value };
    const customer = await loadCustomer(app.ctx.pool, req.auth!.sub);
    const { offers } = await searchOffers(app.ctx, customer, { query: q, windowMs: Math.min(SUGGEST_WINDOW_MS, Number(process.env.BAP_SEARCH_WINDOW_MS ?? 1500)) });
    const suggestions = groupOffers(offers)
      .slice(0, 6)
      .map((g) => ({ canonicalProductId: g.canonicalProductId, name: g.name, packLabel: g.packLabel, fromPricePaise: g.offers[0]!.pricePaise }));
    if (suggestCache.size > 200) suggestCache.clear();
    suggestCache.set(key, { at: Date.now(), value: suggestions });
    return { query: q, suggestions };
  });
};
