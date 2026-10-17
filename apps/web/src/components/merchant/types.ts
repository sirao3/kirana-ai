/** Merchant API shapes (apps/server/src/bpp/merchant). Money is integer paise. */
export interface OfferItem {
  name: string;
  qty: number;
  unitPricePaise: number;
}

export interface Offer {
  id: string;
  status: "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  offeredAt: string;
  expiresAt: string;
  totalPaise: number;
  itemsTotalPaise: number;
  deliveryPaise: number;
  distanceM: number;
  buyerName: string;
  /** Masked until accepted. */
  buyerPhone: string;
  items: OfferItem[];
}

export type FulfilmentStatus = "ACCEPTED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED";

export interface Order extends Offer {
  fulfilmentStatus: FulfilmentStatus;
  buyerAddress: string;
}

export interface Dashboard {
  store: { id: string; name: string; isOnline: boolean; faults: { autoReject: boolean; neverAnswer: boolean } };
  offers: Offer[];
  orders: Order[];
}

export interface CatalogueItem {
  listingId: string;
  canonicalProductId: string;
  brand: string;
  name: string;
  variant: string | null;
  packLabel: string;
  category: string;
  gtin: string | null;
  pricePaise: number;
  mrpPaise: number;
  stockQty: number;
  active: boolean;
}

export interface CanonicalOption {
  id: string;
  label: string;
  category: string;
}

export interface Catalogue {
  items: CatalogueItem[];
  canonicalProducts: CanonicalOption[];
}

export interface ImportReport {
  total: number;
  applied: number;
  dryRun: boolean;
  rejected: { line: number; errors: string[]; row: Record<string, string> }[];
}
