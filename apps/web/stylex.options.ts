import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Shared by vite.config.ts (prod build) and stylex.bun.ts (dev server). The two
// bundlers are different — vite for `bun run build`, Bun's own bundler for
// `bun run dev` — and if only one of them runs the StyleX transform you get a
// fully styled prod app and a completely unstyled dev app. One options object
// so they cannot drift.
const root = dirname(fileURLToPath(import.meta.url));

export const stylexOptions = {
  useCSSLayers: true,
  // StyleX resolves imports in its own Babel pass and knows nothing about
  // tsconfig paths or a bundler's alias config, so `@/tokens.stylex` has to be
  // spelled out here or every token import fails the transform.
  aliases: { "@/*": [resolve(root, "src", "*")] },
  unstable_moduleResolution: { type: "commonJS" as const, rootDir: root },
  // Bun's dev bundler does not append StyleX's output to the stylesheet it
  // emits, it writes it to this file instead (default: <cwd>/dist/stylex.dev.css,
  // which lands in apps/server and is served by nothing). Putting it in src/
  // means Bun's static handler serves it at /stylex.dev.css; index.tsx links it
  // at runtime in dev only. Vite needs none of this — it appends StyleX's CSS
  // straight into the hashed prod bundle.
  bunDevCssOutput: resolve(root, "src", "stylex.dev.css"),
};
