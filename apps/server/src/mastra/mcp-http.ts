import type { MCPServer } from "@mastra/mcp";
import { withMcpAuth } from "better-auth/plugins";
import { config } from "~/config";
import { auth } from "~/server/auth";
import { log } from "~/server/log";
import { fouineMcp } from "./mcp";

// The web-standard MCP endpoint, mounted at `/api/mcp` from `server/app.ts`.
//
// Two things here are deliberate:
//
//  - the handler is REACHED through `@mastra/mcp`'s private web handler.
//    `MCPServer` exposes `startHTTP` (Node `req`/`res`) and nothing
//    fetch-shaped, and adapting a web `Request` to Node's `res` would buffer
//    the body — which breaks `events/stream`, the long-lived SSE response this
//    whole feature exists to deliver. `getNodeHandler()` is what builds the
//    internal `httpHandler`; we force it once and reuse its `fetch`. Pinned
//    exactly (`@mastra/mcp@2.8.0`), and a version bump that renames the field
//    fails loudly at boot instead of silently serving 500s.
//  - MCP is ALWAYS authenticated, even when dashboard login is disabled. It
//    spends the same model key as chat and has no CSRF-bearing browser in
//    front of it; an open endpoint there would be an open bank account. So a
//    deployment without OAuth gets a 401 with the reason, not a working MCP.
//    (`withMcpAuth` accepts the OAuth bearer token better-auth mints for MCP
//    clients; it does not accept a browser cookie session.)

type FetchHandler = (request: Request) => Promise<Response>;

interface McpHandlerInternals {
  /** Private in `@mastra/mcp`; builds `httpHandler` as a side effect. */
  getNodeHandler(): unknown;
  httpHandler?: { fetch(request: Request, options?: unknown): Promise<Response> };
}

/** The server's own fetch-shaped handler, created once. */
export function mcpFetchHandler(server: MCPServer = fouineMcp): FetchHandler {
  const internals = server as unknown as McpHandlerInternals;
  internals.getNodeHandler();
  const handler = internals.httpHandler;
  if (!handler || typeof handler.fetch !== "function") {
    throw new Error(
      "MCP: @mastra/mcp no longer exposes a web-standard fetch handler — re-check the private httpHandler field",
    );
  }
  return (request) => handler.fetch(request);
}

const unauthenticated: FetchHandler = async () =>
  new Response(
    "MCP requires GitHub login. Set BETTER_AUTH_SECRET, GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET, " +
      "then connect a client via OAuth.\n",
    { status: 401, headers: { "www-authenticate": "Bearer" } },
  );

/**
 * The `/api/mcp` request handler.
 *
 * Every method (POST for JSON-RPC, GET for `events/stream`, DELETE for session
 * teardown) goes through this one function, so there is no route a client can
 * reach without the bearer-token check.
 */
export function createMcpRoute(): FetchHandler {
  if (!config.auth.enabled) {
    log.info("mcp mounted closed: GitHub login is not configured", {
      reason: "MCP requires BETTER_AUTH_SECRET + GITHUB_APP_CLIENT_ID + GITHUB_APP_CLIENT_SECRET",
    });
    return unauthenticated;
  }
  const serve = mcpFetchHandler();
  return withMcpAuth(auth, (request) => serve(request));
}
