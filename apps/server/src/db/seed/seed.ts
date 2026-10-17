import type pg from "pg";
import { DeliveryRule } from "@kiranaai/shared";
import data from "./seed-data.json";

export const SEED = data;
export type SeedData = typeof data;
export type SeedProduct = SeedData["products"][number];

/** Beckn subscriber ids for this deployment. */
export const BAP_ID = "kiranaai-bap";
export const BPP_ID = "kiranaai-bpp";
export const GW_ID = "kiranaai-gw";

export function storeIdForKey(key: string): string {
  const s = data.stores.find((x) => x.key === key);
  if (!s) throw new Error(`unknown store key ${key}`);
  return s.id;
}

export function listingId(storeKey: string, productId: string): string {
  return `lst_${storeKey}_${productId.replace(/^cp_/, "")}`;
}

/** Lower-cased text that full-text + trigram search runs over. */
export function searchTextFor(p: SeedProduct): string {
  const unit = `${p.pack_size} ${p.unit} ${p.pack_size}${p.unit}`;
  return [p.brand, p.name, p.variant ?? "", unit, p.category, p.keywords].join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tables wiped by a reset: everything in bap/bpp/registry plus shared audit/dedupe. */
async function appTables(client: pg.PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ t: string }>(`
    SELECT format('%I.%I', table_schema, table_name) AS t FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND (table_schema IN ('bap', 'bpp', 'registry')
           OR (table_schema = 'public' AND table_name IN ('audit_log', 'beckn_message')))`);
  return rows.map((r) => r.t);
}

export interface SeedOptions {
  /** Absolute base URL the modules use to reach each other (SELF_BASE_URL). */
  selfBaseUrl: string;
  offerWindowSeconds?: number;
}

/** Wipes all app data and loads the demo seed in one transaction. */
export async function resetAndSeed(pool: pg.Pool, opts: SeedOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727002)");
    const tables = await appTables(client);
    if (tables.length) await client.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);

    const base = opts.selfBaseUrl.replace(/\/$/, "");
    for (const [id, type, path] of [[BAP_ID, "BAP", "/bap"], [BPP_ID, "BPP", "/bpp"], [GW_ID, "BG", "/gw"]] as const) {
      await client.query(
        "INSERT INTO registry.participant (subscriber_id, type, subscriber_url) VALUES ($1, $2, $3)",
        [id, type, base + path],
      );
    }

    for (const s of data.stores) {
      DeliveryRule.parse(s.delivery_rule);
      await client.query(
        `INSERT INTO bpp.store (id, name, address, lat, lng, phone, delivery_radius_m, delivery_rule, is_online)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [s.id, s.name, s.address, s.lat, s.lng, s.phone, s.delivery_radius_m, JSON.stringify(s.delivery_rule)],
      );
      await client.query("INSERT INTO bpp.fault (store_id) VALUES ($1)", [s.id]);
    }

    for (const p of data.products) {
      await client.query(
        `INSERT INTO bpp.canonical_product (id, gtin, brand, name, variant, pack_size, unit, category, search_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.id, p.gtin, p.brand, p.name, p.variant, p.pack_size, p.unit, p.category, searchTextFor(p)],
      );
      for (const [key, [price, stock]] of Object.entries(p.listings) as [string, [number, number]][]) {
        await client.query(
          `INSERT INTO bpp.listing (id, store_id, canonical_product_id, price_paise, mrp_paise, stock_qty)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [listingId(key, p.id), storeIdForKey(key), p.id, price, p.mrp_paise, stock],
        );
      }
    }

    for (const [term, normalized] of Object.entries(data.synonyms)) {
      await client.query("INSERT INTO bpp.synonym (term, normalized) VALUES ($1, $2)", [term, normalized]);
    }
    for (const [term, hint] of Object.entries(data.loose_terms)) {
      await client.query("INSERT INTO bpp.loose_term (term, hint) VALUES ($1, $2)", [term, hint]);
    }

    for (const c of data.customers) {
      await client.query(
        "INSERT INTO bap.customer (id, name, phone, address, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)",
        [c.id, c.name, c.phone, c.address, c.lat, c.lng],
      );
    }
    await client.query("INSERT INTO bap.config (id, offer_window_seconds) VALUES (1, $1)", [opts.offerWindowSeconds ?? 45]);

    await client.query(
      "INSERT INTO audit_log (kind, action, actor, payload) VALUES ('state', 'admin.reset', 'admin', $1)",
      [JSON.stringify({ stores: data.stores.length, products: data.products.length })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Seeds a fresh database (no stores yet). Returns true if it seeded. */
export async function seedIfEmpty(pool: pg.Pool, opts: SeedOptions): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM bpp.store");
  if ((rows[0]?.n ?? 0) > 0) return false;
  await resetAndSeed(pool, opts);
  return true;
}
