import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync } from "fs";
import { resolve } from "path";

// PWA files must sit at the served root at fixed paths (sw.js scope, manifest
// icon URLs). Vite hashes or drops root static files, so copy them verbatim into
// dist/ post-build. Source stays in src/, which Elysia serves as-is in dev.
// ponytail: 6 lines here instead of vite-plugin-pwa + Workbox.
const copyPwaAssets = {
  name: "copy-pwa-assets",
  closeBundle() {
    for (const f of ["sw.js", "icon-192.png", "icon-512.png"]) {
      copyFileSync(resolve(__dirname, "src", f), resolve(__dirname, "dist", f));
    }
  },
};

export default defineConfig({
  root: "src",
  plugins: [react(), tailwindcss(), copyPwaAssets],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
