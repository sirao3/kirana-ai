import type pg from "pg";
import { haversineM, type DeliveryRule, type LatLng } from "@kiranaai/shared";

/** Store row as the BPP handlers use it (snake_case columns read with raw SQL). */
export interface StoreRow {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  open_time: string;
  close_time: string;
  delivery_radius_m: number;
  delivery_rule: DeliveryRule;
  is_online: boolean;
}

export const STORE_COLS =
  "id, name, address, lat, lng, phone, open_time, close_time, delivery_radius_m, delivery_rule, is_online";

export async function getStore(db: pg.Pool | pg.PoolClient, id: string): Promise<StoreRow | null> {
  const { rows } = await db.query<StoreRow>(`SELECT ${STORE_COLS} FROM bpp.store WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Store hours are IST "HH:MM"; open == close means open all day; close < open wraps past midnight. */
export function isOpenAt(store: Pick<StoreRow, "open_time" | "close_time">, at = new Date()): boolean {
  const open = toMinutes(store.open_time);
  const close = toMinutes(store.close_time);
  if (open === close) return true;
  const ist = new Date(at.getTime() + 330 * 60_000);
  const now = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return open < close ? now >= open && now < close : now >= open || now < close;
}

export const isTakingOrders = (s: StoreRow, at = new Date()): boolean => s.is_online && isOpenAt(s, at);

export function distanceToStoreM(store: Pick<StoreRow, "lat" | "lng">, customer: LatLng): number {
  return haversineM({ lat: store.lat, lng: store.lng }, customer);
}

/** Beckn error type used for all BPP domain errors. */
export const DOMAIN_ERROR = "DOMAIN-ERROR";
