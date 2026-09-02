import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import stylex from "@stylexjs/unplugin/vite";
import { stylexOptions } from "./stylex.options";
import { copyFileSync, existsSync } from "fs";
import { resolve } from "path";

// PWA files must sit at the served root at fixed paths (sw.js scope, manifest
// icon URLs). Vite hashes or drops root static files, so copy them verbatim into
// dist/ post-build. Source stays in src/, which Elysia serves as-is in dev.
// ponytail: 6 lines here instead of vite-plugin-pwa + Workbox.
const copyPwaAssets = {
  name: "copy-pwa-assets",
  closeBundle() {
    // ponytail: bail if the bundle produced nothing — otherwise this ENOENT
    // masks the real build error (a StyleX transform failure looks like a
    // missing sw.js, which sends you hunting in the wrong file).
    if (!existsSync(resolve(__dirname, "dist"))) return;
    for (const f of ["sw.js", "icon-192.png", "icon-512.png"]) {
      copyFileSync(resolve(__dirname, "src", f), resolve(__dirname, "dist", f));
    }
  },
};

export default defineConfig({
  root: "src",
  // StyleX must precede @vitejs/plugin-react to preserve Fast Refresh.
  plugins: [
    // StyleX resolves import paths in its own Babel pass and knows nothing
    // about Vite's `resolve.alias`, so `@/tokens.stylex` fails the transform
    // with "Could not resolve the path to the imported file". The alias has to
    // be repeated here.
    stylex(stylexOptions),
    react(),
    tailwindcss(),
    copyPwaAssets,
  ],
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
