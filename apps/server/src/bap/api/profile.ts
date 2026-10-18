import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ADDRESS_PRESETS, type AddressView, type StoreServiceability } from "@kiranaai/shared";
import { ApiError, loadCustomer, type CustomerRow } from "../util.js";

const Patch = z.union([
  z.object({ presetId: z.string().min(1).max(40) }).strict(),
  z
    .object({
      address: z.string().trim().min(5).max(200),
      lat: z.number().min(6).max(37), // India
      lng: z.number().min(68).max(98),
    })
    .strict(),
]);

/** "12, 7th Cross, Indiranagar, Bengaluru 560038" → "Indiranagar, Bengaluru". */
export function addressLabel(address: string): string {
  const parts = address.split(",").map((p) => p.replace(/\b\d{6}\b/, "").trim()).filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join(", ") : parts.join(", ") || address;
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  // The BAP never reads bpp.*: store positions come from the BPP's own HTTP helper.
  async function stores(c: CustomerRow): Promise<StoreServiceability[]> {
    try {
      const res = await fetch(`${app.ctx.config.selfBaseUrl.replace(/\/$/, "")}/bpp/serviceability?lat=${c.lat}&lng=${c.lng}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      return ((await res.json()) as { stores: StoreServiceability[] }).stores;
    } catch (err) {
      app.log.warn({ err }, "serviceability lookup failed");
      return [];
    }
  }
  const view = async (c: CustomerRow): Promise<AddressView> => ({
    address: c.address, label: addressLabel(c.address), lat: c.lat, lng: c.lng, stores: await stores(c), presets: ADDRESS_PRESETS,
  });

  // GET /bap/profile/address
  app.get("/profile/address", async (req) => view(await loadCustomer(app.ctx.pool, req.auth!.sub)));

  // PATCH /bap/profile/address {presetId} | {address, lat, lng}
  app.patch("/profile/address", async (req) => {
    const body = Patch.parse(req.body);
    let next: { address: string; lat: number; lng: number };
    if ("presetId" in body) {
      const p = ADDRESS_PRESETS.find((x) => x.id === body.presetId);
      if (!p) throw new ApiError(400, "unknown_preset", "Unknown address preset");
      next = { address: p.address, lat: p.lat, lng: p.lng };
    } else next = body;
    const { rows } = await app.ctx.pool.query<CustomerRow>(
      "UPDATE bap.customer SET address = $2, lat = $3, lng = $4 WHERE id = $1 RETURNING id, name, phone, address, lat, lng",
      [req.auth!.sub, next.address, next.lat, next.lng],
    );
    if (!rows[0]) throw new ApiError(404, "unknown_customer");
    return view(rows[0]);
  });
};
