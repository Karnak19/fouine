import { test, expect } from "bun:test";
import { repos, reviews, type ReviewRow } from "~/db";
import { internalRoutes } from "~/server/internal";

// The loopback proxy's authorization matrix. These hit the real Elysia routes
// through .handle() — no GitHub call is reached on any denied path, so the test
// stays hermetic (the allowed paths are exercised in the plugins/broker lane).

let repoSeq = 0;

function makeSession(opts: {
  pr: number;
  trigger: string | null;
  status?: string;
  sessionId?: string;
}): ReviewRow {
  // Unique repo per session so FK-required rows never collide across tests.
  const repo = `acme/widget-${repoSeq++}`;
  repos.upsert.run({
    $full_name: repo,
    $installation_id: 1,
    $prompt: null,
    $model: null,
  });
  const sessionId = opts.sessionId ?? `sess-${crypto.randomUUID()}`;
  return reviews.insert.get({
    $repo: repo,
    $pr: opts.pr,
    $title: "test",
    $session: sessionId,
    $status: opts.status ?? "running",
    $trigger: opts.trigger,
    $attempt: 0,
  })!;
}

const BASE = "http://localhost";

function request(path: string, init?: RequestInit): Promise<Response> {
  return internalRoutes.handle(new Request(`${BASE}${path}`, init));
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json" };
}

test("unknown session → 404", async () => {
  const res = await request("/internal/sessions/does-not-exist/context");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "unknown session" });
});

test("a non-running row → 403", async () => {
  const row = makeSession({ pr: 12, trigger: "opened", status: "completed" });
  const res = await request(`/internal/sessions/${row.session_id}/context`);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "session is not running (completed)" });
});

test("context resolves owner/repo/pr/kind from the row", async () => {
  const row = makeSession({ pr: 42, trigger: "opened" });
  const res = await request(`/internal/sessions/${row.session_id}/context`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  const [owner, repo] = row.repo_full_name.split("/");
  expect(body).toEqual({
    kind: "review",
    owner,
    repo,
    pr: 42,
    reviewId: row.id,
  });
});

test("an improve-kind row cannot post a review → 403", async () => {
  const row = makeSession({ pr: 0, trigger: "improve" });
  const res = await request(`/internal/sessions/${row.session_id}/review`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ summary: "hi" }),
  });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({
    error: "session kind 'improve' cannot post a review",
  });
});

test("a review-kind row cannot add the ready label or open a proposal → 403", async () => {
  const row = makeSession({ pr: 12, trigger: "opened" });
  const label = await request(`/internal/sessions/${row.session_id}/ready-label`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
  expect(label.status).toBe(403);
  expect(await label.json()).toEqual({
    error: "session kind 'review' cannot label issues ready",
  });

  const proposal = await request(`/internal/sessions/${row.session_id}/proposal`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ content: "x", summary: "y" }),
  });
  expect(proposal.status).toBe(403);
  expect(await proposal.json()).toEqual({
    error: "session kind 'review' cannot open a review-notes proposal",
  });
});

test("the request body cannot override the row's owner/repo/pr", async () => {
  // An improve row carries pr = 0. If the route trusted the body, this would
  // post to the spoofed PR; instead it refuses before any GitHub call.
  const row = makeSession({ pr: 0, trigger: "improve" });
  const res = await request(`/internal/sessions/${row.session_id}/comment`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ body: "hi", pr: 999, owner: "evil", repo: "spoof" }),
  });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({
    error: "session has no PR/issue number to comment on",
  });
});
