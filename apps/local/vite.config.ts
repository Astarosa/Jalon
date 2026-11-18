import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Ressources de pdf.js (polices standard, tables CMap, décodeurs wasm) copiées dans public/pdfjs
const pdfjsDir = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
for (const d of ["cmaps", "standard_fonts", "wasm"]) {
  const src = join(pdfjsDir, d);
  if (existsSync(src)) cpSync(src, join(__dirname, "public", "pdfjs", d), { recursive: true });
}

const dev = { target: "http://127.0.0.1:1421", changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // En développement navigateur, le moteur local est servi par crates/devserver
    proxy: { "/api": dev, "/bin": dev, "/asset": dev },
  },
  build: { target: "chrome110", chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ["@chantier/core", "@chantier/ui"] },
});
