import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const api = "http://localhost:8787";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: { outDir: path.resolve(import.meta.dirname, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: Object.fromEntries(["/api", "/mcp", "/covers", "/llms.txt", "/health"].map((p) => [p, api])),
  },
});
