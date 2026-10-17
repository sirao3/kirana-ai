import { ulid } from "ulid";

export const ID_PREFIXES = ["bsk", "sub", "att", "pay", "rfd", "led", "msg", "txn", "apv", "qte"] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

/** Prefixed ULID, e.g. `bsk_01JABC…`. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
