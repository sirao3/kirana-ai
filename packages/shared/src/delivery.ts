import { z } from "zod";
import type { Paise } from "./money.js";

/** Store delivery rules (PRD §10). Charges in paise. */
export const DeliveryRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flat"), charge_paise: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("distance_bands"),
    /** Ascending by max_m; customer beyond the last band is not serviceable by this rule. */
    bands: z.array(z.object({ max_m: z.number().int().positive(), charge_paise: z.number().int().nonnegative() })).min(1),
  }),
  z.object({
    type: z.literal("free_above"),
    /** Free when the store's items subtotal is >= threshold_paise. */
    threshold_paise: z.number().int().nonnegative(),
    charge_paise: z.number().int().nonnegative(),
  }),
]);
export type DeliveryRule = z.infer<typeof DeliveryRule>;

/**
 * Delivery charge for one store's part of a basket, or null if this rule cannot serve
 * that distance. (Radius is checked separately against store.delivery_radius_m.)
 */
export function deliveryChargePaise(rule: DeliveryRule, distanceM: number, itemsSubtotal: Paise): Paise | null {
  switch (rule.type) {
    case "flat":
      return rule.charge_paise;
    case "free_above":
      return itemsSubtotal >= rule.threshold_paise ? 0 : rule.charge_paise;
    case "distance_bands": {
      const band = rule.bands.find((b) => distanceM <= b.max_m);
      return band ? band.charge_paise : null;
    }
  }
}
