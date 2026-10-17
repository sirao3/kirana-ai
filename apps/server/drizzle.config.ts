import { defineConfig } from "drizzle-kit";

// Used only to draft SQL from the schema: `pnpm db:draft` writes to drizzle-draft/,
// then copy the statements into a new drizzle/NNNN_<name>.sql by hand (see drizzle/README.md).
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema/shared.ts", "./src/db/schema/registry.ts", "./src/db/schema/bpp.ts", "./src/db/schema/bap.ts"],
  out: "./drizzle-draft",
});
