# Migrations

Plain SQL files applied in filename order on boot (and by tests), once each, tracked in
`public.schema_migrations`. See `src/db/migrate.ts`.

To change the schema:
1. Edit the table in `src/db/schema/*.ts` (keeps the Drizzle types right).
2. Add a **new** file `NNNN_<area>_<what>.sql`, e.g. `0101_bpp_listing_sku.sql`, with the DDL.
   Never edit a file that has already been applied anywhere.
3. Optional: `pnpm --filter @kiranaai/server db:draft` writes the DDL drizzle-kit would produce
   to `drizzle-draft/` (git-ignored) so you can copy it.

Number ranges keep parallel branches apart: `00xx` core, `01xx` seller/BPP, `02xx` buyer/BAP,
`03xx` agent/UI/admin.
