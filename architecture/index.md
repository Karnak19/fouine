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
- **Static assets** — the React SPA (built with Vite, served as static files)
- **`/health`** — health check endpoint
- **Basic Auth** — optional, protects dashboard and API (webhook and health exempt)
