import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { routeTree } from "./routes/__root";
import { AuthGate } from "./lib/auth";
import "./global.css";

const router = createRouter({ routeTree });
// staleTime keeps same-page chatter down and the comment below carries the
// invariant; `refetchOnWindowFocus` is left at its default (true) on purpose —
// it is the recovery net, not noise. While a tab sleeps (or bfcaches), SSE
// events in the gap are lost for good — the server keeps no replay, and the
// socket can reconnect without ever firing onerror, so `resync` never fires
// either. Returning to a stale tab must refetch or it paints hours-old data
// until a manual reload. staleTime gates it: only queries older than 30s
// refetch.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
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
