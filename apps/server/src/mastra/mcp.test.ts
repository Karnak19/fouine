import { test, expect } from "bun:test";
import { db, repos, reviews } from "~/db";
import { MAX_QUESTION_CHARS } from "~/chat";
import { fouineMcp } from "~/mastra/mcp";
import { mcpFetchHandler } from "~/mastra/mcp-http";

function seedRepo(full: string) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
}

test("the registry is read-only: only the four read tools exist", () => {
  expect(Object.keys(fouineMcp.tools()).sort()).toEqual([
    "ask_chat",
    "list_repos",
    "query_stats",
    "render_chart",
  ]);
});

test("a start-work style request has no tool to reach and is refused by name", async () => {
  // There is deliberately no mutating tool, so the refusal is the protocol's
  // own "Unknown tool" — plus the server instructions telling clients why.
  await expect(fouineMcp.executeTool("start_review", {})).rejects.toThrow(
    "Unknown tool: start_review",
  );
  await expect(fouineMcp.executeTool("post_comment", {})).rejects.toThrow("Unknown tool");
  await expect(fouineMcp.executeTool("merge_pr", {})).rejects.toThrow("Unknown tool");
});

test("ask_chat applies the dashboard's question bound before any model call", async () => {
  await expect(
    fouineMcp.executeTool("ask_chat", { message: "x".repeat(MAX_QUESTION_CHARS + 1) }),
  ).rejects.toThrow(`under ${MAX_QUESTION_CHARS} characters`);
});

test("list_repos reads the repos table and its most recent review", async () => {
  const full = "mcp/list-repos";
  seedRepo(full);
  db.prepare("UPDATE repos SET enabled = 1 WHERE full_name = ?").run(full);
  const first = reviews.insert.get({
    $repo: full,
    $pr: 3,
    $title: "older",
    $session: null,
    $status: "completed",
    $trigger: "opened",
    $attempt: 0,
  })!;
  const newest = reviews.insert.get({
    $repo: full,
    $pr: 9,
    $title: "newest",
    $session: null,
    $status: "running",
    $trigger: "opened",
    $attempt: 0,
  })!;

  const result = (await fouineMcp.executeTool("list_repos", {})) as {
    status: string;
    output: Array<{
      repo: string;
      enabled: boolean;
      last_review: { id: number; pr: number; status: string; created_at: number } | null;
    }>;
  };

  expect(result.status).toBe("completed");
  const row = result.output.find((r) => r.repo === full);
  expect(row).toBeDefined();
  expect(row!.enabled).toBe(true);
  // Newest by id, so the running one wins over the completed one.
  expect(row!.last_review).toEqual({
    id: newest.id,
    pr: 9,
    status: "running",
    created_at: newest.created_at,
  });
  expect(row!.last_review!.id).not.toBe(first.id);
});

test("list_repos reports a repo that has never been reviewed with a null last_review", async () => {
  const full = "mcp/never-reviewed";
  seedRepo(full);
  const result = (await fouineMcp.executeTool("list_repos", {})) as {
    output: Array<{ repo: string; enabled: boolean; last_review: unknown }>;
  };
  const row = result.output.find((r) => r.repo === full);
  expect(row).toEqual({ repo: full, enabled: false, last_review: null });
});

test("the review.completed event is declared on the MCP server", () => {
  const names = fouineMcp.getEventsInfo()?.events.map((e) => e.name);
  expect(names).toContain("review.completed");
});

test("a legacy MCP client can initialize against the fetch handler, offline", async () => {
  // The 2025-era handshake Claude Code and OpenCode use (legacy: stateless).
  const handler = mcpFetchHandler();
  const res = await handler(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('"serverInfo"');
  expect(body).toContain('"name":"fouine"');
  // The instructions are the read-only refusal surface the client sees first.
  expect(body).toContain("READ-ONLY");
});
