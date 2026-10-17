import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { rupeesToPaise } from "@kiranaai/shared";
import { auditState } from "../../beckn/audit.js";
import { csvCell, parseCsv } from "./csv.js";

const UNITS = ["g", "kg", "ml", "l", "pcs"] as const;
type Unit = (typeof UNITS)[number];

interface ProductSpec {
  brand: string;
  name: string;
  variant: string | null;
  packSize: number;
  unit: Unit;
  category: string;
  gtin: string | null;
}

/** Same recipe as the seed: lower-case brand + name + variant + pack + category (+ keywords). */
function searchTextOf(p: ProductSpec): string {
  return [p.brand, p.name, p.variant ?? "", `${p.packSize} ${p.unit} ${p.packSize}${p.unit}`, p.category]
    .join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const productIdOf = (p: ProductSpec) => `cp_${slug([p.brand, p.name, p.variant ?? ""].join(" "))}_${p.packSize}${p.unit}`;

/** Finds the canonical product for a spec (by its derived id) or creates it. */
async function ensureCanonical(db: pg.Pool | pg.PoolClient, p: ProductSpec): Promise<string> {
  const id = productIdOf(p);
  await db.query(
    `INSERT INTO bpp.canonical_product (id, gtin, brand, name, variant, pack_size, unit, category, search_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
    [id, p.gtin, p.brand, p.name, p.variant, p.packSize, p.unit, p.category, searchTextOf(p)],
  );
  return id;
}

const listingIdOf = (storeId: string, productId: string) => `lst_${storeId.replace(/^store_/, "")}_${productId.replace(/^cp_/, "")}`;

/** Creates or revives this store's listing for a canonical product. */
async function upsertListing(
  db: pg.Pool | pg.PoolClient,
  o: { storeId: string; productId: string; pricePaise: number; mrpPaise: number; stockQty: number },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bpp.listing (id, store_id, canonical_product_id, price_paise, mrp_paise, stock_qty, active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (store_id, canonical_product_id)
     DO UPDATE SET price_paise = EXCLUDED.price_paise, mrp_paise = EXCLUDED.mrp_paise, stock_qty = EXCLUDED.stock_qty, active = true, updated_at = now()
     RETURNING id`,
    [listingIdOf(o.storeId, o.productId), o.storeId, o.productId, o.pricePaise, o.mrpPaise, o.stockQty],
  );
  return rows[0]!.id;
}

const Pos = z.number().int().positive();
const Money = Pos.max(100_000_00);
const Stock = z.number().int().min(0).max(1_000_000);
const Text = z.string().trim().min(1).max(120);

const NewProduct = z.object({
  brand: Text,
  name: Text,
  variant: z.string().trim().max(120).nullish().transform((v) => v || null),
  packSize: Pos.max(100_000),
  unit: z.enum(UNITS),
  category: Text,
  gtin: z.string().trim().max(32).nullish().transform((v) => v || null),
});

const AddBody = z
  .object({
    canonicalProductId: z.string().optional(),
    newProduct: NewProduct.optional(),
    pricePaise: Money,
    mrpPaise: Money.optional(),
    stockQty: Stock,
  })
  .refine((b) => !!b.canonicalProductId !== !!b.newProduct, { message: "give canonicalProductId or newProduct" })
  .refine((b) => b.mrpPaise === undefined || b.mrpPaise >= b.pricePaise, { message: "mrp must be at least the price" });

const PatchBody = z
  .object({ pricePaise: Money.optional(), mrpPaise: Money.optional(), stockQty: Stock.optional(), active: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to update" });

// --- CSV import (MER-05) ---

export const CSV_COLUMNS = [
  "canonical_product_id", "brand", "name", "variant", "pack_size", "unit", "category", "gtin", "price_rupees", "mrp_rupees", "stock",
] as const;

export const csvTemplate = (): string =>
  [
    CSV_COLUMNS.join(","),
    // existing catalogue product: only the id, price and stock are needed
    ["cp_salt_tata_1kg", "", "", "", "", "", "", "", "28.00", "30.00", "40"].map(csvCell).join(","),
    // new product: describe the pack
    ["", "Brooke Bond", "Taj Mahal Tea", "", "250", "g", "Tea & Coffee", "", "145.00", "160.00", "12"].map(csvCell).join(","),
  ].join("\r\n") + "\r\n";

interface RowResult {
  line: number;
  errors: string[];
  raw: Record<string, string>;
  spec?: { productId?: string; product?: ProductSpec; pricePaise: number; mrpPaise: number; stockQty: number };
}

function validateRow(line: number, raw: Record<string, string>, known: Set<string>): RowResult {
  const errors: string[] = [];
  const get = (k: string) => (raw[k] ?? "").trim();

  let pricePaise = 0;
  let mrpPaise = 0;
  try {
    pricePaise = rupeesToPaise(get("price_rupees"));
    if (pricePaise <= 0) errors.push("price_rupees must be greater than 0");
  } catch {
    errors.push(`price_rupees "${get("price_rupees")}" is not an amount like 125.50`);
  }
  try {
    mrpPaise = get("mrp_rupees") ? rupeesToPaise(get("mrp_rupees")) : pricePaise;
    if (get("mrp_rupees") && mrpPaise < pricePaise) errors.push("mrp_rupees is lower than price_rupees");
  } catch {
    errors.push(`mrp_rupees "${get("mrp_rupees")}" is not an amount like 125.50`);
  }
  const stockQty = Number(get("stock"));
  if (pricePaise > 100_000_00 || mrpPaise > 100_000_00) errors.push("price_rupees / mrp_rupees must be at most 100000");
  if (!/^\d+$/.test(get("stock")) || stockQty > 1_000_000) errors.push(`stock "${get("stock")}" must be a whole number, 0 or more`);

  let productId: string | undefined;
  let product: ProductSpec | undefined;
  if (get("canonical_product_id")) {
    productId = get("canonical_product_id");
    if (!known.has(productId)) errors.push(`unknown canonical_product_id "${productId}"`);
  } else {
    const p = NewProduct.safeParse({
      brand: get("brand"), name: get("name"), variant: get("variant"), packSize: /^\d+$/.test(get("pack_size")) ? Number(get("pack_size")) : NaN,
      unit: get("unit").toLowerCase(), category: get("category"), gtin: get("gtin"),
    });
    if (p.success) product = p.data;
    else {
      for (const i of p.error.issues) {
        const col = ({ packSize: "pack_size" } as Record<string, string>)[String(i.path[0])] ?? String(i.path[0]);
        errors.push(col === "unit" ? `unit must be one of ${UNITS.join(", ")}` : `${col}: ${i.message === "Required" ? "required (or give canonical_product_id)" : i.message}`);
      }
    }
  }
  return { line, errors, raw, spec: errors.length ? undefined : { productId, product, pricePaise, mrpPaise, stockQty } };
}

export interface ImportReport {
  total: number;
  applied: number;
  rejected: { line: number; errors: string[]; row: Record<string, string> }[];
  dryRun: boolean;
}

/** Validates every row; applies the valid ones in ONE transaction (dryRun only reports). Throws {code:"BAD_HEADER"} for a bad file. */
export async function importCatalogueCsv(pool: pg.Pool, storeId: string, csv: string, dryRun = false): Promise<ImportReport> {
  const table = parseCsv(csv);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = ["price_rupees", "stock"].filter((c) => !header.includes(c));
  if (!header.includes("canonical_product_id") && !["brand", "name", "pack_size", "unit", "category"].every((c) => header.includes(c))) {
    missing.push("canonical_product_id (or brand, name, pack_size, unit, category)");
  }
  if (missing.length) throw Object.assign(new Error(`missing column(s): ${missing.join(", ")}`), { code: "BAD_HEADER" });

  const known = new Set((await pool.query<{ id: string }>("SELECT id FROM bpp.canonical_product")).rows.map((r) => r.id));
  const results = table.slice(1).map((cells, i) => validateRow(i + 2, Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""])), known));
  const good = results.filter((r) => r.spec);

  if (!dryRun && good.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of good) {
        const s = r.spec!;
        const productId = s.productId ?? (await ensureCanonical(client, s.product!));
        await upsertListing(client, { storeId, productId, pricePaise: s.pricePaise, mrpPaise: s.mrpPaise, stockQty: s.stockQty });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    await auditState(pool, "bpp", "catalogue.csv_import", { storeId, entityId: storeId, payload: { applied: good.length } });
  }
  return {
    total: results.length,
    applied: dryRun ? 0 : good.length,
    rejected: results.filter((r) => !r.spec).map((r) => ({ line: r.line, errors: r.errors, row: r.raw })),
    dryRun,
  };
}

interface CatalogueRow {
  listing_id: string;
  canonical_product_id: string;
  brand: string;
  name: string;
  variant: string | null;
  pack_size: number;
  unit: string;
  category: string;
  gtin: string | null;
  price_paise: number;
  mrp_paise: number;
  stock_qty: number;
  active: boolean;
}

const LISTING_SQL = `SELECT l.id AS listing_id, l.canonical_product_id, cp.brand, cp.name, cp.variant, cp.pack_size, cp.unit, cp.category, cp.gtin,
       l.price_paise, l.mrp_paise, l.stock_qty, l.active
  FROM bpp.listing l JOIN bpp.canonical_product cp ON cp.id = l.canonical_product_id`;

const listingDto = (r: CatalogueRow) => ({
  listingId: r.listing_id,
  canonicalProductId: r.canonical_product_id,
  brand: r.brand,
  name: r.name,
  variant: r.variant,
  packLabel: `${r.pack_size} ${r.unit}`,
  category: r.category,
  gtin: r.gtin,
  pricePaise: r.price_paise,
  mrpPaise: r.mrp_paise,
  stockQty: r.stock_qty,
  active: r.active,
});

/** Catalogue API (/bpp/merchant/:storeId/catalogue…). Auth and store scoping come from the parent plugin's hooks. */
export const catalogueRoutes: FastifyPluginAsync = async (app) => {
  const { pool } = app.ctx;
  type P = { Params: { storeId: string } };

  app.get<P>("/:storeId/catalogue", async (req) => {
    const [mine, all] = await Promise.all([
      pool.query<CatalogueRow>(`${LISTING_SQL} WHERE l.store_id = $1 ORDER BY cp.category, cp.brand, cp.name, cp.pack_size`, [req.params.storeId]),
      pool.query<{ id: string; brand: string; name: string; pack_size: number; unit: string; category: string }>(
        "SELECT id, brand, name, pack_size, unit, category FROM bpp.canonical_product ORDER BY category, brand, name",
      ),
    ]);
    return {
      items: mine.rows.map(listingDto),
      /** For the "add product" picker. */
      canonicalProducts: all.rows.map((p) => ({ id: p.id, label: `${p.brand} ${p.name} ${p.pack_size} ${p.unit}`, category: p.category })),
    };
  });

  app.post<P>("/:storeId/catalogue", async (req, reply) => {
    const b = AddBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request", message: b.error.issues.map((i) => i.message).join("; ") });
    const { storeId } = req.params;
    let productId = b.data.canonicalProductId;
    if (productId) {
      const r = await pool.query("SELECT 1 FROM bpp.canonical_product WHERE id = $1", [productId]);
      if (r.rowCount === 0) return reply.code(404).send({ error: "unknown_product" });
    } else {
      productId = await ensureCanonical(pool, b.data.newProduct!);
    }
    const listingId = await upsertListing(pool, {
      storeId, productId, pricePaise: b.data.pricePaise, mrpPaise: b.data.mrpPaise ?? b.data.pricePaise, stockQty: b.data.stockQty,
    });
    await auditState(pool, "bpp", "catalogue.add", { storeId, entityId: listingId });
    const { rows } = await pool.query<CatalogueRow>(`${LISTING_SQL} WHERE l.id = $1`, [listingId]);
    return reply.code(201).send(listingDto(rows[0]!));
  });

  app.patch<P & { Params: { listingId: string } }>("/:storeId/catalogue/:listingId", async (req, reply) => {
    const b = PatchBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request", message: b.error.issues.map((i) => i.message).join("; ") });
    const { storeId, listingId } = req.params;
    const d = b.data;
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE bpp.listing SET price_paise = COALESCE($3, price_paise), mrp_paise = COALESCE($4, mrp_paise),
              stock_qty = COALESCE($5, stock_qty), active = COALESCE($6, active), updated_at = now()
        WHERE id = $1 AND store_id = $2 RETURNING id`,
      [listingId, storeId, d.pricePaise ?? null, d.mrpPaise ?? null, d.stockQty ?? null, d.active ?? null],
    );
    if (!rows[0]) return reply.code(404).send({ error: "unknown_listing" });
    await auditState(pool, "bpp", "catalogue.edit", { storeId, entityId: listingId, payload: d });
    const out = await pool.query<CatalogueRow>(`${LISTING_SQL} WHERE l.id = $1`, [listingId]);
    return listingDto(out.rows[0]!);
  });

  app.get("/:storeId/catalogue/template.csv", async (_req, reply) =>
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="catalogue-template.csv"').send(csvTemplate()),
  );

  const ImportBody = z.object({ csv: z.string().max(2_000_000), dryRun: z.boolean().optional() });
  app.post<P>("/:storeId/catalogue/import", async (req, reply) => {
    const b = ImportBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad_request" });
    try {
      return await importCatalogueCsv(pool, req.params.storeId, b.data.csv, b.data.dryRun);
    } catch (err) {
      if ((err as { code?: string }).code === "BAD_HEADER") return reply.code(400).send({ error: "BAD_HEADER", message: (err as Error).message });
      throw err;
    }
  });
};
