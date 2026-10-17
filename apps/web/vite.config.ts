import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(["/bap", "/bpp", "/gw", "/admin/api", "/auth", "/health", "/test"].map((p) => [p, api])),
  },
});
