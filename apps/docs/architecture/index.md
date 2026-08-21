# Architecture

## Review lifecycle

```
Webhook received
       │
       ▼
Verify HMAC signature
       │
       ▼
Extract PR info ──── Is repo registered? ──── No ──── Auto-register
       │                                              │
       │◄─────────────────────────────────────────────┘
       ▼
Is repo enabled? ──── No ──── Skip (log debug)
       │
       ▼
Clone bare repo (or use cached)
       │
       ▼
git worktree add at PR head SHA
       │
       ▼
Run OpenCode agent
  ├── Reads the diff
  ├── Explores the codebase
  ├── Posts summary comment
  └── Posts inline review comments
       │
       ▼
git worktree remove
       │
       ▼
Update review status (completed/failed)
```

## Bare repo caching

The first review from a repository triggers a `git clone --bare`. This bare clone is cached on disk at `${DATA_DIR}/repos/github.com/{owner}/{repo}.git`.

Subsequent reviews from the same repo:
1. `git fetch` in the bare repo (fast, only new objects)
2. `git worktree add` at the PR head SHA
3. Review runs on the worktree
4. `git worktree remove` after completion

This avoids re-cloning the full repo on every review.

## OpenCode integration

fouine runs the OpenCode agent programmatically via the `@opencode-ai/sdk`. It:

1. Creates a session in the worktree directory
2. Sends the review prompt (built from the default or per-repo prompt + PR context)
3. The agent has access to two custom tools:
   - `post_comment` — posts a markdown summary comment on the PR
   - `post_review` — posts a formal GitHub review with inline line-level comments
4. The agent reads the diff, explores files, and calls these tools directly

The server doesn't parse the agent's output — the agent posts to GitHub itself via the tools.

## Data model

### repos

| Column | Type | Description |
|---|---|---|
| `full_name` | text (PK) | `owner/repo` |
| `installation_id` | integer | GitHub App installation ID |
| `prompt` | text | Custom review prompt (nullable) |
| `model` | text | Custom model override (nullable) |
| `enabled` | integer | 1 = active, 0 = disabled |

### reviews

| Column | Type | Description |
|---|---|---|
| `id` | integer (PK) | Auto-increment |
| `repo_full_name` | text (FK) | References repos |
| `pr_number` | integer | PR number |
| `status` | text | `pending`, `running`, `completed`, `failed` |
| `session_id` | text | OpenCode session ID (for transcript) |
| `created_at` | text | ISO timestamp |
| `completed_at` | text | ISO timestamp (nullable) |
| `error` | text | Error message if failed (nullable) |

### settings

Key-value store for dashboard-configured settings (`opencode_api_key`, `opencode_model`, `default_prompt`).

## Server

The Elysia server handles:

- **`/webhook/github`** — webhook receiver (HMAC verification + event dispatch)
- **`/api/*`** — REST API for the dashboard
- **`/api/events`** — SSE live-event stream (see below)
- **Static assets** — the React SPA. In development it is served straight from `apps/web/src` with Bun transpiling on the fly; in production (`NODE_ENV=production`) from the Vite build in `apps/web/dist`. Either way there is no second dev server
- **`/health`** — health check endpoint
- **GitHub OAuth** — optional, protects `/api/*` (webhook, `/health` and the SPA shell exempt). Uses better-auth with the GitHub App's own OAuth credentials; enabled when `BETTER_AUTH_SECRET`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` are all set, and gated by `ALLOWED_GITHUB_USERS`

## Real-time events (SSE)

The dashboard updates live over **Server-Sent Events** — one-way, plain HTTP, no
new dependencies, and the browser's `EventSource` gives reconnect + backoff for
free. There is no buffered event history: every event is a *nudge* that tells
the client to refetch its REST queries, so the REST API stays the source of
truth and the initial snapshot. Clients that can't hold a connection open just
keep working from the REST queries (plus the existing while-in-flight polling)
— SSE is an enhancement, never a requirement.

### Protocol

`GET /api/events` (under the same OAuth gate as the rest of `/api`) returns a
`text/event-stream`. Each frame is:

```
id: <monotonic seq>
data: {"type": "<event>", ...}
```

The `type` field is part of the JSON payload (not the SSE `event:` field):

| type | payload | published when |
|---|---|---|
| `review:created` | `{ repo, review }` | a review row is inserted (webhook, `/fouine`, retry, improver) |
| `review:updated` | `{ repo, review }` | status/session/cost/tokens change on a review row |
| `review:findings` | `{ repo, reviewId }` | the opencode post_* tools write findings back (`/internal/reviews/:id/findings`) |
| `repo:updated` | `{ repo, row }` | repo added or edited via the dashboard, or auto-registered by a webhook |
| `repo:removed` | `{ repo }` | repo deleted via the dashboard |
| `webhook:received` | `{ repo, name, delivery }` | a verified webhook arrives (repo is null when the payload has no repository) |

Publication happens at the write sites themselves — the Effect `DbService`
wrappers (`insertReview`, `setRunning`, `setSession`, `complete`, `fail`) for
review rows, the findings write-back route, the repo CRUD routes, and
`verifyAndDispatch` for webhooks — so an emitted event always reflects a real
database state change (the row is re-read at publish time).

Repo registration has three entry points (the API create route and both webhook
handlers, which auto-register a repo on first sight). All three go through
`upsertRepoAndPublish`, which re-reads the row and emits `repo:updated` only
when something actually changed — `repos.upsert`'s `ON CONFLICT` touches nothing
but `installation_id`, so publishing unconditionally would fire a no-op
invalidation at every connected dashboard on every PR webhook.

The route is an async generator returning Elysia's `sse()` payloads, bridged to
the push-based hub by a small queue. It yields a `heartbeat` event immediately —
Elysia awaits the first yield before returning the `Response`, so this is what
opens the stream — and again after every 25s of silence, to keep proxies from
idling the connection. Heartbeats are a *named* event, so the browser routes
them away from `onmessage` and the client never sees keepalive traffic.

### Subscription scoping

`GET /api/events?repo=owner/name` filters the stream server-side to that repo
only (no query param = all repos). The repo page opens a scoped connection, the
dashboard/reviews pages open the unscoped one. Authorization is the same model
as the rest of the app: the `/api` OAuth gate (when enabled) admits the user,
and the repo filter guarantees a client only receives events for the repo it
asked for — it can't subscribe to another repository's events by guessing ids.

### Reconnects and idempotency

`EventSource` reconnects natively (sending `Last-Event-ID`, which the server
ignores — there is no replay buffer). Events are idempotent *by construction*:
they only invalidate react-query keys, and invalidation always refetches the
current state, so a reconnect can never produce duplicate events or miss a
final state. When the connection drops and comes back, the client refetches
its queries once (`resync` in `apps/web/src/lib/live.ts`) to cover anything that
happened while disconnected.

### Client

`apps/web/src/lib/live.ts` keeps one `EventSource` per scope, refcounted across
pages, and exposes `useLiveEvents(scope, onEvent)` returning the connection
status (`connecting | live | reconnecting | offline | error`) and a `resync`
counter. Pages pass an event handler that invalidates their react-query keys;
`apps/web/src/components/live-badge.tsx` renders the status so loading/offline/reconnecting
states are always visible. Existing query `refetchInterval`s remain as the
fallback when the stream is down.
