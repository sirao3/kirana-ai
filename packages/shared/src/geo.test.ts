import { describe, expect, it } from "vitest";
import { haversineM } from "./geo.js";
import { deliveryChargePaise, type DeliveryRule } from "./delivery.js";

describe("geo + delivery", () => {
  it("haversine ~1.11 km per 0.01° latitude", () => {
    expect(haversineM({ lat: 12.97, lng: 77.64 }, { lat: 12.98, lng: 77.64 })).toBeGreaterThan(1100);
    expect(haversineM({ lat: 12.97, lng: 77.64 }, { lat: 12.98, lng: 77.64 })).toBeLessThan(1120);
  });
  it("applies each rule", () => {
    expect(deliveryChargePaise({ type: "flat", charge_paise: 2000 }, 9999, 0)).toBe(2000);
    const fa = { type: "free_above", threshold_paise: 30000, charge_paise: 3000 } as const;
    expect(deliveryChargePaise(fa, 0, 29999)).toBe(3000);
    expect(deliveryChargePaise(fa, 0, 30000)).toBe(0);
    const db: DeliveryRule = { type: "distance_bands", bands: [{ max_m: 1000, charge_paise: 1500 }, { max_m: 2000, charge_paise: 3000 }] };
    expect(deliveryChargePaise(db, 1500, 0)).toBe(3000);
    expect(deliveryChargePaise(db, 2500, 0)).toBeNull();
  });
});
