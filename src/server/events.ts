import { repos, reviews, type RepoRow, type ReviewRow } from "~/db";

// Typed live-event hub. The /api/events SSE endpoint streams from here; every
// real state change (review row writes, findings write-back, repo edits,
// verified webhooks) publishes through publishEvent, so the dashboard can
// invalidate its queries the moment something happens instead of polling.
//
// Scope: each event carries the repo it belongs to; subscribers with a repo
// scope only receive that repo's events (null scope = everything). The SSE
// endpoint derives its scope from ?repo=, so a client can only subscribe to
// the repo it's actually viewing. Note the app's authz model is global (any
// logged-in user sees all repos) — this scopes delivery, it doesn't hide
// repos.

export type ServerEvent =
  | { type: "review:created"; repo: string; review: ReviewRow }
  | { type: "review:updated"; repo: string; review: ReviewRow }
  // Payload deliberately carries only the review id — the client refetches
  // the findings list, so we never serialize findings twice or go stale.
  | { type: "review:findings"; repo: string; reviewId: number }
  | { type: "repo:updated"; repo: string; row: RepoRow }
  | { type: "repo:removed"; repo: string }
  | { type: "webhook:received"; repo: string | null; name: string; delivery: string };

interface Sub {
  scope: string | null;
  send: (e: ServerEvent) => void;
}

const subs = new Set<Sub>();

// Exported for the tests: a stream that fails to unsubscribe leaks silently —
// it keeps queueing events for a dead connection — so it needs to be countable.
export const subscriberCount = (): number => subs.size;

// Returns an unsubscribe function. No replay: events published before a
// subscription exist are not buffered — clients recover via their REST
// snapshot/refetch on (re)connect.
export function subscribeEvents(scope: string | null, send: (e: ServerEvent) => void): () => void {
  const sub: Sub = { scope, send };
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}

export function publishEvent(e: ServerEvent): void {
  // Copy so a send() that tears its own subscription down mid-loop is safe.
  // send() is guarded: a closed SSE controller throws on enqueue.
  for (const s of [...subs]) {
    try {
      if (s.scope === null || s.scope === e.repo) s.send(e);
    } catch {
      // subscriber gone (connection closed between enqueue and flush)
    }
  }
}

export function publishReviewEvent(kind: "created" | "updated", id: number): void {
  const review = reviews.byId.get({ $id: id });
  if (!review) return;
  publishEvent({
    type: kind === "created" ? "review:created" : "review:updated",
    repo: review.repo_full_name,
    review,
  });
}

export function publishRepoUpdated(row: RepoRow): void {
  publishEvent({ type: "repo:updated", repo: row.full_name, row });
}

// Repos get auto-registered from three places (the API create route and both
// webhook handlers). They all route through here so a repo first discovered by
// a webhook shows up in the list like any other — an upsert that publishes
// nothing is exactly how that page went stale.
//
// Only publishes on a real change: upsert's ON CONFLICT touches nothing but
// installation_id, so the common case (a PR webhook for a known repo) would
// otherwise broadcast a no-op invalidation on every single delivery.
export function upsertRepoAndPublish(fullName: string, installationId: number): RepoRow {
  const before = repos.get.get({ $full_name: fullName });
  repos.upsert.run({
    $full_name: fullName,
    $installation_id: installationId,
    $prompt: null,
    $model: null,
  });
  const row = repos.get.get({ $full_name: fullName })!;
  if (!before || before.installation_id !== row.installation_id) publishRepoUpdated(row);
  return row;
}

export function publishRepoRemoved(fullName: string): void {
  publishEvent({ type: "repo:removed", repo: fullName });
}

export function publishFindings(reviewId: number, repo: string): void {
  publishEvent({ type: "review:findings", repo, reviewId });
}

export function publishWebhook(name: string, delivery: string, payload: string): void {
  let repo: string | null = null;
  try {
    repo = (JSON.parse(payload) as { repository?: { full_name?: string } }).repository?.full_name ?? null;
  } catch {
    // not JSON (e.g. malformed ping) — repo stays null, everyone gets it
  }
  publishEvent({ type: "webhook:received", repo, name, delivery });
}
