import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { routeTree } from "./routes/__root";
import { AuthGate } from "./lib/auth";
import "./global.css";

const router = createRouter({ routeTree });
const queryClient = new QueryClient({
  // SSE already keeps lists fresh (see lib/live.ts) — refetch-on-focus is just
  // extra chatter on top of that.
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const root = createRoot(document.getElementById("root")!);
root.render(
  <QueryClientProvider client={queryClient}>
    <AuthGate>
      <RouterProvider router={router} />
      <Toaster theme="dark" richColors position="bottom-right" />
    </AuthGate>
  </QueryClientProvider>,
);
