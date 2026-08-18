# REST API

All dashboard endpoints are prefixed with `/api`. Three endpoints live outside that prefix: `/health`, `/webhook/github` and `/internal/reviews/:id/findings`.

## Authentication

When GitHub OAuth is configured (`BETTER_AUTH_SECRET`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` all set), every path under `/api/` requires an authenticated session cookie. Exactly two are exempt:

- `/api/auth/*` — better-auth's own endpoints
- `/api/auth-status`

An unauthenticated request to any other `/api` path gets `401` with the plain-text body `Unauthorized`. When OAuth is not configured the gate is off and the whole API is open — see [Architecture](/architecture/).

## Errors

Two different error bodies exist, depending on where the failure happens.

Handlers that reject a request themselves mostly return a plain-text body:

```
404 Not found
```

Anything that falls through to the global error handler returns JSON:

```json
{ "error": "not found" }
```

with `{ "error": "internal error" }` for `5xx`. A request body that violates a route's schema is rejected by Elysia with `422` and Elysia's own validation error body, before the handler runs.

Per-endpoint bodies that differ from these are documented below.

## Conventions

- Row shapes come from `@fouine/shared` and are listed in the [type appendix](#type-appendix). This page names them (`200 → ReviewRow[]`) rather than repeating columns.
- Timestamps (`created_at`, `completed_at`) are **integer Unix epoch seconds**, not ISO strings.
- `enabled` on a repo or a skill row is a SQLite integer, `0` or `1` — not a JSON boolean. The one place a real boolean is accepted is the `PUT /api/skills/:name` body.
- Review `status` is one of `pending`, `running`, `completed`, `failed`, `skipped`.
- Route params match a single path segment. `:owner` and `:name` are joined back into `owner/name` server-side.

## Repos

### List repos

```
GET /api/repos
```

`200 → RepoRow[]`, newest `created_at` first.

### Get repo

```
GET /api/repos/:owner/:name
```

`200 → RepoRow`. `404` if the repo is not registered.

### Register repo

```
POST /api/repos
Content-Type: application/json

{
  "full_name": "owner/repo",
  "installation_id": 12345
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `full_name` | string | yes | `owner/repo` |
| `installation_id` | number | yes | GitHub App installation ID |

`200 → RepoRow`. Upsert: a new repo is inserted with `enabled = 0`, and re-posting an existing one updates only `installation_id` — `enabled`, `prompt` and `model` are left alone.

### Update repo

```
PUT /api/repos/:owner/:name
Content-Type: application/json

{
  "prompt": "Review this code for...",
  "model": "opencode-go/deepseek-v4-flash",
  "enabled": 1
}
```

| Field | Type | Omitted means | Description |
|---|---|---|---|
| `prompt` | string | **cleared to null** | Per-repo review prompt |
| `model` | string | **cleared to null** | Per-repo model override |
| `enabled` | number | unchanged | `1` active, `0` disabled |

All three fields are optional in the schema, but `prompt` and `model` are written unconditionally: omitting either **clears** it. Send the current value to keep it. Only `enabled` falls back to what is already stored.

`200 → RepoRow` (the row after the write). `404` if the repo is not registered.

### Delete repo

```
DELETE /api/repos/:owner/:name
```

`204`, no body. Deleting a repo that does not exist is not an error — it also returns `204`.

### Trigger the improver

```
POST /api/repos/:owner/:name/improve
```

Queues an out-of-band run of the prompt improver for this repo. Fire-and-forget: the run happens after the response.

`202 → { "ok": true }`. `404` if the repo is not registered. The improver may still decline to run (too soon, no new completed reviews); that decision is logged server-side and is not visible in the response.

### List repo reviews

```
GET /api/repos/:owner/:name/reviews
```

`200 → ReviewRow[]` — the last 200 reviews for the repo, newest `id` first. No query params; the limit is fixed.

### List reviews for one PR

```
GET /api/repos/:owner/:name/pr/:number
```

`200 → ReviewRow[]` — the last 200 reviews for that PR number, newest `id` first.

## Reviews

### List reviews

```
GET /api/reviews
```

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `100` | Clamped to `1…1000`; a non-numeric or non-positive value falls back to `100` |
| `status` | string | none | Exact match on `status`, `skipped` included |
| `range` | string | none | See [Stats filters](#stats-filters) |
| `from`, `to` | `YYYY-MM-DD` | none | See [Stats filters](#stats-filters) |
| `repo` | string | none | Exact `owner/name` |
| `model` | string | none | Exact model spec |

`200 → ReviewRow[]`, newest `id` first. `skipped` rows appear in this list on purpose — the timeline records that fouine looked and found nothing new.

### Get review

```
GET /api/reviews/:id
```

`200 → ReviewRow`. `404` if there is no review with that id.

### Get review findings

```
GET /api/reviews/:id/findings
```

`200 → FindingRow[]`, ordered by `id`. An unknown review id returns `200 []`, not a `404`.

### Get review session

```
GET /api/reviews/:id/session
```

Shells out to `opencode export <session_id>` and returns the transcript.

- `200 →` the parsed OpenCode session JSON (shape defined by opencode, not by fouine).
- `404` if the review does not exist, or has no `session_id`.
- `200 → { "error": "session-unavailable", "detail": "<stderr>" }` if the export command fails or prints nothing.
- `200 → { "error": "session-unparseable", "raw": "<first 1000 chars>" }` if the output is not JSON.

The two error cases are `200` responses, not error statuses — check for the `error` key.

### Retry review

```
POST /api/reviews/:id/retry
```

Re-fetches the PR from GitHub and starts a fresh review of it, tagged with trigger `retry`. The original row is left as it is; the retry creates a new one.

- `202 → { "ok": true }` — queued.
- `404` if the review does not exist (`Not found`) or its repo is no longer registered (`repo not found`).
- `502 → { "ok": false, "error": "..." }` if GitHub cannot be reached or the PR cannot be fetched.

### Stop review

```
POST /api/reviews/:id/stop
```

Aborts a live run. If no live run is found but the row is still `pending`/`running`, the row is marked `failed` with the error `Stopped by user`.

- `200 → { "ok": true, "live": true|false }` — `live` says whether an in-process run was actually aborted.
- `200 → { "ok": false, "reason": "already completed" }` if the review already reached a terminal status.
- `404` if there is no review with that id.

## Stats

### Stats filters

`GET /api/stats`, `GET /api/stats/charts` and `GET /api/reviews` share one filter parser.

| Param | Type | Default | Description |
|---|---|---|---|
| `range` | `24h` \| `7d` \| `30d` \| `90d` \| `all` | none | Rolling window ending now. `all` = no cutoff |
| `from` | `YYYY-MM-DD` | none | Inclusive lower bound, UTC |
| `to` | `YYYY-MM-DD` | none | Inclusive upper bound, UTC (compared as `< to + 1 day`) |
| `repo` | string | none | Exact `owner/name` |
| `model` | string | none | Exact model spec |

Rules the handler actually applies:

- Omitting `range`, `from` and `to` means **no date filter at all** — all-time.
- If either `from` or `to` parses as a real date, the pair wins and `range` is ignored.
- A `from`/`to` window where `from >= to` drops the upper bound rather than erroring.
- An `from`/`to` value that is not a valid `YYYY-MM-DD` date (`2026-13-45`, `2026-02-30`) is treated as absent.
- An **explicit** `range` that is not one of the five listed values falls back to `30d`.
- An empty query string (`?repo=`) is "no filter", not a filter on the empty string.

Days are bucketed in UTC, matching how the daily aggregates are grouped.

### Stats summary

```
GET /api/stats
```

Accepts the filter params above. `200 →`

| Key | Type |
|---|---|
| `projects` | `ProjectStatsRow[]` |
| `models` | `ModelStatsRow[]` |
| `daily` | `DailyStatsRow[]` |
| `triggers` | `TriggerStatsRow[]` |
| `latency` | `{ avg: number \| null, count: number, p95: number \| null }` — seconds |
| `topCost` | `TopCostRow[]` — top 5 by cost |
| `severity` | `SeverityStatsRow[]` |
| `allModels` | `string[]` |

`allModels` is deliberately unfiltered: it lists every model ever recorded so a filter dropdown never loses its own options.

Every aggregate here excludes `skipped` reviews. `latency` is computed over `completed` reviews only.

### Chart panels

```
GET /api/stats/charts
```

Same filter params. Split out from `/api/stats` because the latency trend reads one row per completed review. `200 →`

| Key | Type |
|---|---|
| `reliability` | `ReliabilityRow[]` |
| `latency` | `{ day: string, count: number, p50: number \| null, p95: number \| null }[]` |
| `latencyTruncated` | boolean |
| `findingsDaily` | `FindingsDailyRow[]` |
| `topFiles` | `TopFileRow[]` — top 10 |

`latency` percentiles are nearest-rank, computed per UTC day. The underlying sample query is capped at 5000 rows; `latencyTruncated` is `true` when that cap was hit, meaning the trend was drawn from a partial population.

## Models

### Search models

```
GET /api/models?q=glm
```

Backs the model autocompletes in the dashboard. `q` filters on the
`provider/model` spec (case-insensitive); results are capped at 100.

Only models from **configured providers** are returned — see `configured` below.
Add `all=1` to search the whole models.dev catalog instead, for picking a model
on a provider whose key you haven't added yet.

```json
{
  "total": 112,
  "providers": ["opencode", "opencode-go", "zai-coding-plan"],
  "models": [
    {
      "id": "zai-coding-plan/glm-5.2",
      "provider": "zai-coding-plan",
      "providerName": "Z.AI Coding Plan",
      "model": "glm-5.2",
      "modelName": "GLM-5.2",
      "configured": true
    }
  ]
}
```

A provider is **configured** when fouine holds a key that reaches it:

- `zai-coding-plan` when the GLM Coding Plan key is set
- `opencode` and `opencode-go` when the OpenCode key is set
- any provider already named by the default model, the improver model, or a
  per-repo override — a live config never disappears from its own picker, even
  if its key is missing

`providers` lists that set. Without `all=1` the response contains only these,
which is ~112 models rather than the 5,755 models.dev knows about.

The catalog comes from [models.dev](https://models.dev) via
`@opencode-ai/models` and is cached in-process for 30 minutes; add `?refresh=1`
to rebuild it. If models.dev is unreachable, the snapshot bundled in that package
(at most ~24h stale) is used instead, so the picker still works with no egress.

## Settings

### Get settings

```
GET /api/settings
```

`200 →` a flat key-value object of every stored setting, values as strings. Keys written by the dashboard are `opencode_api_key`, `zai_api_key`, `opencode_model`, `default_prompt` and `improver_model`. A key that has never been set is absent from the object.

```json
{
  "opencode_api_key": "sk-...",
  "zai_api_key": "sk-...",
  "opencode_model": "opencode-go/deepseek-v4-flash",
  "default_prompt": "Review this PR..."
}
```

The API key is returned as stored, unredacted.

### Update settings

```
PUT /api/settings
Content-Type: application/json

{
  "opencode_api_key": "your-key",
  "zai_api_key": "your-z-ai-key",
  "opencode_model": "opencode-go/deepseek-v4-flash",
  "default_prompt": "Review this PR...",
  "improver_model": "opencode-go/deepseek-v4-flash"
}
```

All five fields are optional; an absent field keeps its stored value. The two key fields accept an explicit `""` to **delete** the stored value, letting the env var take over again. For the non-key fields `""` is still a no-op.

`200 →` the full settings object, as `GET /api/settings`.

### Test connection

```
GET /api/settings/test
```

Sends one small real prompt through the configured key and model. Costs roughly one request against the provider.

`200 → { "ok": true, "text": "OK" }` (`text` is the reply, truncated to 200 chars), or `200 → { "ok": false, "error": "..." }`. Failures are reported in the body, not by status code.

## Skills

Global reviewer skills fetched from skills.sh or GitHub. Enabled skills are materialised into the opencode config directory and picked up by subsequent reviews.

### List skills

```
GET /api/skills
```

`200 → SkillMetaRow[]`, newest `created_at` first. The stored file blob is never returned.

### Install skill

```
POST /api/skills
Content-Type: application/json

{ "url": "https://github.com/owner/repo/tree/main/skills/my-skill" }
```

Fetches the skill, pins it to the commit SHA it was fetched at, stores it **enabled**, and writes it to disk. Re-installing an existing skill by name updates it in place and re-enables it.

`200 → SkillMetaRow`. `422 → { "error": "..." }` if the URL cannot be parsed or the fetch fails.

### Enable / disable skill

```
PUT /api/skills/:name
Content-Type: application/json

{ "enabled": true }
```

`enabled` is a real JSON boolean here and is required. It is stored as `0`/`1`.

`200 → SkillMetaRow`. `404 → { "error": "not found" }`.

### Delete skill

```
DELETE /api/skills/:name
```

`204`, no body. Deleting an unknown skill also returns `204`.

## Chat

```
POST /api/chat
Content-Type: application/json

{
  "messages": [
    { "role": "user", "parts": [{ "type": "text", "text": "What did reviews cost last week?" }] }
  ]
}
```

Not a JSON endpoint. On success the response is an **AI SDK UI message stream** — the format `useChat` consumes directly. Read it as a stream, not with `response.json()`.

Request body:

| Field | Type | Constraint |
|---|---|---|
| `messages` | array | 1–40 items |
| `messages[].id` | string | optional, ≤ 128 chars |
| `messages[].role` | `user` \| `assistant` \| `system` | required |
| `messages[].parts` | array | ≤ 64 items |
| `messages[].parts[].type` | string | ≤ 64 chars |
| `messages[].parts[].text` | string | optional, ≤ 4000 chars |

Extra keys on a part are accepted and ignored.

Behaviour worth knowing before scripting against it:

- Only `user` messages with `text` parts survive server-side. Assistant and system turns sent by the client are discarded, and the model never sees its own prior replies — every answer is recomputed from a fresh query.
- The model has exactly one tool: a read-only SQLite `SELECT` against fouine's own database. It runs at most 6 steps per turn.
- Aborting the request aborts the upstream model run.
- Nothing is persisted. The thread lives entirely in the client.

Statuses:

- `200` with a stream on success.
- `400 → { "error": "..." }` for a configuration or input problem the handler can name — no API key set, no usable question, a question over the character limit.
- `422` if the body violates the schema above.

Model errors and rejected SQL are not statuses: they arrive inside the stream as text.

## Live events

```
GET /api/events
GET /api/events?repo=owner/name
```

An SSE stream (`text/event-stream`) under the same auth gate as the rest of `/api`. With `?repo=owner/name` the stream is filtered server-side to that repo; without it, all repos.

Each data frame carries a monotonic per-boot `id` and a JSON payload whose `type` field names the event:

```
id: 42
data: {"type":"review:updated","repo":"owner/name","review":{...}}
```

A named `heartbeat` event is sent immediately on connect and after every 25s of silence.

Events are nudges to refetch, not a replay log — `Last-Event-ID` is ignored and there is no buffered history. The event types, payloads and the reconnect model are documented in [Architecture](/architecture/).

## Endpoints outside `/api`

### Health

```
GET /health
```

`200 → { "ok": true }`. Never behind the auth gate.

### Auth status

```
GET /api/auth-status
```

`200 → { "enabled": true|false }` — whether OAuth is configured. Under `/api` but explicitly exempt from the gate, so the login page can ask before it has a session.

### GitHub webhook

```
POST /webhook/github
X-Hub-Signature-256: sha256=...
X-GitHub-Event: pull_request
X-GitHub-Delivery: <uuid>
```

The GitHub App's webhook receiver. The raw body is HMAC-verified against the configured webhook secret before anything is dispatched.

`200 → { "ok": true }` once the delivery has been verified and dispatched. `401 → { "error": "invalid signature" }` if verification fails. Not behind the OAuth gate — the signature is its authentication.

### Internal findings write-back

```
POST /internal/reviews/:id/findings
```

**Not for external callers.** This is a loopback surface: the opencode `post_comment` / `post_review` tools call it on the server itself, right after posting to GitHub, so fouine keeps a structured record of what was flagged. It sits outside the OAuth gate and is guarded instead by a shared secret regenerated on every boot and passed in a request header — a secret no client outside the process ever holds. Treat it as an implementation detail; it is not part of the API surface a self-hoster scripts against.

## Type appendix

The shapes below live in `packages/shared/src/index.ts` and are imported by both the server and the dashboard. All timestamps are Unix epoch seconds.

### RepoRow

| Field | Type |
|---|---|
| `full_name` | string — `owner/repo` |
| `installation_id` | number |
| `prompt` | string \| null |
| `model` | string \| null |
| `enabled` | number — `0` or `1` |
| `created_at` | number |

### ReviewRow

| Field | Type |
|---|---|
| `id` | number |
| `repo_full_name` | string |
| `pr_number` | number — `0` for improver runs |
| `title` | string \| null |
| `session_id` | string \| null |
| `status` | string — `pending` \| `running` \| `completed` \| `failed` \| `skipped` |
| `error` | string \| null |
| `trigger` | string \| null — `opened` \| `synchronize` \| `reopened` \| `command` \| `retry` |
| `cost` | number \| null — set at completion |
| `tokens` | number \| null — set at completion |
| `model` | string \| null — resolved spec, set at completion |
| `check_run_id` | number \| null |
| `patch_id` | string \| null — `git patch-id --stable` over `base...head`, success path only |
| `created_at` | number |
| `completed_at` | number \| null |

Nullable columns are also null on rows written before that column existed.

### FindingRow

| Field | Type |
|---|---|
| `id` | number |
| `review_id` | number |
| `repo_full_name` | string |
| `pr_number` | number |
| `kind` | string — `inline` \| `summary` \| `comment` |
| `severity` | string \| null — `blocking` \| `nit` \| `question`, inline rows only |
| `event` | string \| null — `COMMENT` \| `APPROVE` \| `REQUEST_CHANGES`, summary rows only |
| `path` | string \| null — inline rows only |
| `line` | number \| null |
| `body` | string |
| `github_review_id` | number \| null |
| `github_comment_id` | number \| null |
| `created_at` | number |

### SkillMetaRow

| Field | Type |
|---|---|
| `name` | string — primary key |
| `source_url` | string |
| `owner` | string |
| `repo` | string |
| `path` | string |
| `ref` | string — pinned commit SHA |
| `description` | string \| null |
| `enabled` | number — `0` or `1` |
| `created_at` | number |

### Aggregate rows

| Type | Fields |
|---|---|
| `ProjectStatsRow` | `repo_full_name`, `reviews`, `cost`, `tokens`, `avg_duration: number \| null` (seconds) |
| `ModelStatsRow` | `model`, `reviews`, `cost`, `tokens` |
| `DailyStatsRow` | `day` (`YYYY-MM-DD`, UTC), `reviews`, `cost`, `tokens` |
| `TriggerStatsRow` | `trigger` (`unknown` when null), `count` |
| `SeverityStatsRow` | `severity`, `count` |
| `TopCostRow` | `id`, `repo_full_name`, `pr_number`, `cost`, `tokens: number \| null`, `model: string \| null` |
| `ReliabilityRow` | `day`, `completed`, `failed`, `in_flight` (pending + running) |
| `FindingsDailyRow` | `day`, `severity`, `count` |
| `TopFileRow` | `path`, `count` |

`cost` is in the provider's billing units as reported by the opencode session; `COALESCE` keeps sums at `0` rather than null when every row in a group has a null cost.
