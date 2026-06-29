import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: "public",
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "public"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
