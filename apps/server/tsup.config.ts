import { defineConfig } from "tsup";

// One self-contained CJS bundle so the runtime image needs no node_modules.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  outExtension: () => ({ js: ".cjs" }),
  noExternal: [/.*/],
  external: ["pg-native"],
  shims: true,
  clean: true,
  sourcemap: true,
});
