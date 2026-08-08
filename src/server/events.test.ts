import { test, expect } from "bun:test";
import {
  subscribeEvents,
  publishEvent,
  publishReviewEvent,
  publishWebhook,
  upsertRepoAndPublish,
  subscriberCount,
  type ServerEvent,
} from "~/server/events";
import { repos, reviews } from "~/db";
import { createServer } from "~/server/app";

function seedRepo(full: string) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
}

function seedReview(full: string, pr: number) {
  seedRepo(full);
  return reviews.insert.get({
    $repo: full,
    $pr: pr,
    $title: "Test PR",
    $session: null,
    $status: "pending",
    $trigger: "opened",
  })!;
}

test("delivers a typed event to subscribers", () => {
  const got: ServerEvent[] = [];
  const unsub = subscribeEvents(null, (e) => got.push(e));
  publishEvent({ type: "repo:updated", repo: "a/b", row: { full_name: "a/b", installation_id: 1, prompt: null, model: null, enabled: 1, triggers: null, created_at: 0 } });
  unsub();
  expect(got).toHaveLength(1);
  expect(got[0].type).toBe("repo:updated");
  expect(got[0].repo).toBe("a/b");
});

test("repo-scoped subscribers only get their repo's events", () => {
  const mine: ServerEvent[] = [];
  const all: ServerEvent[] = [];
  const unsubMine = subscribeEvents("a/b", (e) => mine.push(e));
  const unsubAll = subscribeEvents(null, (e) => all.push(e));
  publishEvent({ type: "repo:removed", repo: "a/b" });
  publishEvent({ type: "repo:removed", repo: "c/d" });
  unsubMine();
  unsubAll();
  expect(mine.map((e) => e.repo)).toEqual(["a/b"]);
  expect(all.map((e) => e.repo)).toEqual(["a/b", "c/d"]);
});

test("unsubscribe stops delivery (teardown)", () => {
  const got: ServerEvent[] = [];
  const unsub = subscribeEvents(null, (e) => got.push(e));
  publishEvent({ type: "webhook:received", repo: null, name: "ping", delivery: "1" });
  unsub();
  publishEvent({ type: "webhook:received", repo: null, name: "ping", delivery: "2" });
  expect(got).toHaveLength(1);
});

test("no replay before subscribe; in-order delivery after (reconnect property)", () => {
  const got: ServerEvent[] = [];
  publishEvent({ type: "webhook:received", repo: null, name: "ping", delivery: "before" });
  const unsub = subscribeEvents(null, (e) => got.push(e));
  publishEvent({ type: "webhook:received", repo: null, name: "ping", delivery: "1" });
  publishEvent({ type: "webhook:received", repo: null, name: "ping", delivery: "2" });
  unsub();
  // What was published while disconnected is NOT replayed on subscribe —
  // clients recover via their REST snapshot/refetch instead.
  expect(got).toHaveLength(2);
  expect(got.map((e) => (e as { delivery: string }).delivery)).toEqual(["1", "2"]);
});

test("publishReviewEvent carries the fresh row for created and updated", () => {
  const got: ServerEvent[] = [];
  const unsub = subscribeEvents("a/b", (e) => got.push(e));
  const row = seedReview("a/b", 42);
  publishReviewEvent("created", row.id);
  reviews.updateStatus.run({ $status: "running", $done: 0, $id: row.id });
  publishReviewEvent("updated", row.id);
  unsub();
  expect(got.map((e) => e.type)).toEqual(["review:created", "review:updated"]);
  const created = got[0] as Extract<ServerEvent, { type: "review:created" }>;
  expect(created.review).toMatchObject({ id: row.id, repo_full_name: "a/b", pr_number: 42, status: "pending" });
  const updated = got[1] as Extract<ServerEvent, { type: "review:updated" }>;
  expect(updated.review.status).toBe("running");
});

test("upsertRepoAndPublish announces new repos and real changes only", () => {
  const got: ServerEvent[] = [];
  const unsub = subscribeEvents(null, (e) => got.push(e));

  // First sight — this is the webhook auto-registration path.
  const created = upsertRepoAndPublish("fresh/repo", 1);
  expect(created).toMatchObject({ full_name: "fresh/repo", installation_id: 1 });
  // Same install id again (every subsequent PR webhook) must stay quiet.
  upsertRepoAndPublish("fresh/repo", 1);
  // A moved installation is a real change.
  const moved = upsertRepoAndPublish("fresh/repo", 2);
  expect(moved.installation_id).toBe(2);

  unsub();
  expect(got.map((e) => e.type)).toEqual(["repo:updated", "repo:updated"]);
});

test("upsertRepoAndPublish keeps settings an operator already set", () => {
  upsertRepoAndPublish("keep/settings", 1);
  repos.update.run({ $full_name: "keep/settings", $prompt: "custom", $model: "m", $enabled: 1 });
  const row = upsertRepoAndPublish("keep/settings", 1);
  expect(row).toMatchObject({ prompt: "custom", model: "m", enabled: 1 });
});

test("publishWebhook extracts the repo from the payload", () => {
  const got: ServerEvent[] = [];
  const unsub = subscribeEvents("a/b", (e) => got.push(e));
  publishWebhook("pull_request", "d-1", JSON.stringify({ repository: { full_name: "a/b" } }));
  publishWebhook("ping", "d-2", JSON.stringify({ zen: "no repo here" }));
  unsub();
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ type: "webhook:received", repo: "a/b", delivery: "d-1" });
});

// The stream opens with a heartbeat frame (Elysia awaits the first yield before
// it hands back the Response), so read frames until a data event shows up.
const decode = (chunk: unknown) =>
  typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as Uint8Array);

async function readUntilData(reader: ReadableStreamDefaultReader<unknown>) {
  let seen = "";
  for (let i = 0; i < 5; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decode(value);
    seen += text;
    if (text.includes("data: {")) return { frame: text, seen };
  }
  return { frame: "", seen };
}

test("GET /api/events streams published events as SSE", async () => {
  const app = await createServer();
  const res = await app.handle(new Request("http://localhost/api/events"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  expect(res.headers.get("cache-control")).toBe("no-cache");

  const reader = res.body!.getReader();
  const row = seedReview("a/b", 7);
  publishEvent({ type: "review:created", repo: "a/b", review: row });

  const { frame } = await readUntilData(reader);
  expect(frame).toContain("id: ");
  expect(frame).toContain('"type":"review:created"');
  expect(frame).toContain('"repo":"a/b"');
  await reader.cancel();
});

test("GET /api/events?repo= scopes the stream to that repo", async () => {
  const app = await createServer();
  const res = await app.handle(new Request("http://localhost/api/events?repo=a%2Fb"));
  const reader = res.body!.getReader();

  publishEvent({ type: "repo:removed", repo: "c/d" });
  const row = seedReview("a/b", 8);
  publishEvent({ type: "review:created", repo: "a/b", review: row });

  const { frame, seen } = await readUntilData(reader);
  expect(frame).toContain('"type":"review:created"');
  expect(seen).not.toContain("repo:removed");
  await reader.cancel();
});

test("disconnecting at the opening frame still unsubscribes", async () => {
  const app = await createServer();
  const before = subscriberCount();
  const ac = new AbortController();
  const res = await app.handle(
    new Request("http://localhost/api/events", { signal: ac.signal }),
  );
  // Deliberately do NOT read: Elysia has pulled the opening heartbeat, so the
  // generator is suspended at its very first yield and nothing has resumed it.
  // Reading first would move it into the loop and miss the window entirely.
  expect(subscriberCount()).toBe(before + 1);

  ac.abort();
  await res.body!.cancel().catch(() => {});
  for (let i = 0; i < 20 && subscriberCount() > before; i++) await Bun.sleep(5);
  expect(subscriberCount()).toBe(before);
});

test("the stream opens before any event is published", async () => {
  const app = await createServer();
  // Would hang if the generator parked on the queue before its first yield.
  const res = await app.handle(new Request("http://localhost/api/events"));
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  expect(decode(value)).toContain("event: heartbeat");
  await reader.cancel();
});
