// Table objects, grouped by Postgres schema. Each module touches only its own schema
// (PRD §4: BAP never reads bpp.*, BPP never reads bap.*); shared tables are audit + dedupe.
export * from "./shared.js";
export * as reg from "./registry.js";
export * as bpp from "./bpp.js";
export * as bap from "./bap.js";
