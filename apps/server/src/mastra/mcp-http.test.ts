import { test, expect } from "bun:test";
import { createServer, isAuthorized, requiresSession } from "~/server/app";

test("every route under /api/mcp is refused without credentials", async () => {
  const app = await createServer();
  const cases: Array<[string, string]> = [
    ["GET", "/api/mcp"],
    ["POST", "/api/mcp"],
    ["GET", "/api/mcp/sse"],
    ["DELETE", "/api/mcp/session-1"],
  ];
  for (const [method, path] of cases) {
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      }),
    );
    expect(res.status).toBe(401);
  }
});

test("isAuthorized: no session is refused, a session is allowed, non-API paths stay public", async () => {
  const mcp = new Request("http://localhost/api/mcp");
  expect(await isAuthorized(mcp, { enabled: true, getSession: async () => null })).toBe(false);
  expect(
    await isAuthorized(mcp, { enabled: true, getSession: async () => ({ user: { id: "u" } }) }),
  ).toBe(true);
  // Login disabled: the whole app is open, MCP included at this layer (the MCP
  // handler still requires a Bearer token of its own).
  expect(await isAuthorized(mcp, { enabled: false, getSession: async () => null })).toBe(true);
  expect(
    await isAuthorized(new Request("http://localhost/health"), {
      enabled: true,
      getSession: async () => null,
    }),
  ).toBe(true);
});

test("/api/mcp is behind the session rule, like every other /api route", () => {
  expect(requiresSession("/api/mcp")).toBe(true);
  expect(requiresSession("/api/mcp/sse")).toBe(true);
});
