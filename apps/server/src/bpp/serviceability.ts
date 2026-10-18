import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { StoreServiceability } from "@kiranaai/shared";
import { distanceToStoreM, isTakingOrders, STORE_COLS, type StoreRow } from "./common.js";

const Query = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

/**
 * GET /bpp/serviceability?lat=&lng= : kiranaai helper outside the Beckn actions (docs/ONDC_DEVIATIONS.md).
 * Public store facts (position, radius) plus distance to the given point; the BAP uses it for the address sheet only.
 * Search and select still decide serviceability on their own.
 */
export const serviceabilityRoutes: FastifyPluginAsync = async (app) => {
  app.get("/serviceability", async (req): Promise<{ stores: StoreServiceability[] }> => {
    const { lat, lng } = Query.parse(req.query);
    const { rows } = await app.ctx.pool.query<StoreRow>(`SELECT ${STORE_COLS} FROM bpp.store ORDER BY name`);
    return {
      stores: rows.map((s) => {
        const distanceM = distanceToStoreM(s, { lat, lng });
        return {
          storeId: s.id, name: s.name, lat: s.lat, lng: s.lng, radiusM: s.delivery_radius_m, distanceM,
          delivers: distanceM <= s.delivery_radius_m, open: isTakingOrders(s),
        };
      }),
    };
  });
};
