import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routes/__root";
import { AuthGate } from "./lib/auth";
import "./global.css";
// Side-effect import, load-bearing in dev only. StyleX's transform strips the
// `@/tokens.stylex` import out of every consumer once the values are inlined,
// so nothing is left importing the token module — Bun's dev bundler therefore
// never resolves it, never calls the plugin's onLoad for it, and its
// defineVars output (the whole theme: 128 custom properties) never reaches the
// generated CSS. The result is a dev app with 341 var() uses and 0
// definitions, i.e. completely unstyled. This keeps the module in the graph.
import "./tokens.stylex";

// Dev only. `bun run dev` serves this app through Bun's bundler, not vite, and
// the StyleX bun plugin writes its collected CSS to src/stylex.dev.css rather
// than appending it to Bun's emitted stylesheet — so without this link every
// stylex.create() rule is missing and the dev app renders unstyled while prod
// looks fine. Vite appends the same CSS into the hashed prod bundle, so the
// guard keeps the link out of the build (NODE_ENV is inlined at build time,
// making this whole block dead code vite drops).
if (process.env.NODE_ENV !== "production") {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/stylex.dev.css";
  document.head.appendChild(link);
}

const router = createRouter({ routeTree });
const queryClient = new QueryClient();

const root = createRoot(document.getElementById("root")!);
root.render(
  <QueryClientProvider client={queryClient}>
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  </QueryClientProvider>,
);
