# fouine

Self-hosted AI code reviewer. GitHub App + configurable agent. Runs on your server, reviews on your terms.

## How it works

```
┌─────────────┐     pull_request webhook     ┌─────────────────┐
│   GitHub     │ ────────────────────────────▶│  fouine (Elysia) │
│              │                              │                  │
│              │◀── inline comments + ──────│  OpenCode agent  │
│              │     review summary           │  + custom prompt │
└─────────────┘                              └────────┬────────┘
                                                      │
                                               bare repo + worktree
                                               (per-PR checkout)
```

1. **GitHub App** receives `pull_request` webhooks (opened, synchronize, reopened)
2. **Elysia** server processes the event
3. **Bare repo + worktree** — first PR from a repo triggers a `git clone --bare`, cached on disk. Each review gets a lightweight `git worktree add` at the PR ref, removed after review
4. **OpenCode agent** runs programmatically on the worktree, with a configurable review prompt. The agent sees the full codebase, reads the diff, explores context as needed
5. **GitHub API** (octokit) — the agent posts its review as a PR comment (summary) + inline comments on specific lines

## Key decisions

- **Full codebase access** via worktree, not just diff. The agent decides what context matters
- **GitHub App** over personal tokens — clean per-repo install, no token juggling
- **One LLM call** — models today are smart enough to produce a thorough review in one pass
- **Agent posts comments directly** — simpler than having the server parse structured output and post them itself
- **Configurable prompt** via dashboard — review style, focus areas, language, strictness
- **Check run per review** — fouine opens a `fouine` check (in_progress → completed) on each PR head SHA, so reviews show up in the PR checks panel and can be required as a merge status. Needs the `checks:write` App permission

## Review behaviour

- **Auto-review gating** — reviews are opt-in. A repo the App can see is added disabled and won't be reviewed until you flip **Auto-review** on for it (the toggle in the dashboard repos list, or **Auto-review new PRs** on the repo's detail page). The `/review` comment and the dashboard Retry button still work on demand regardless
- **Draft PRs are skipped** — a review fires once the PR is marked ready for review
- **`REVIEW.md`** — drop a `REVIEW.md` at the repo root to give the reviewer repo-specific guidance (focus areas, conventions, files to care about). It's appended to whatever prompt is active (default or per-repo override)
- **Severity** — the reviewer uses `REQUEST_CHANGES` only for correctness/security/data-loss risks it's confident about; everything else is a non-blocking `COMMENT`. A re-review that clears its own earlier blockers posts `APPROVE`, since a `COMMENT` would leave the PR stuck in changes-requested
- **Self-improvement loop** — once a day (per repo, when there's new feedback), an outer-loop improver agent re-reads the review threads fouine participated in, distills how humans responded to its comments, and proposes an updated `REVIEW.md` as a PR on your repo. Merge it and every future review picks up the learning; close it to reject. Also triggerable on demand via `POST /api/repos/:owner/:name/improve`. Needs the `contents:write` App permission (branch + commit for the proposal PR)

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Server | Elysia |
| Code agent | OpenCode (programmatic) |
| GitHub | GitHub App + octokit |
| Dashboard | React + TanStack Router/Query (served by Elysia) |
| Self-hosting | Docker |

## v1 scope

- [x] GitHub App setup (webhook receiver)
- [x] Bare repo + worktree management (clone, checkout, cleanup)
- [x] OpenCode integration (programmatic call with custom prompt)
- [x] Agent tool: post inline comments + review summary to PR
- [x] Dashboard: register repos, configure API key + review prompt
- [x] Per-repo enable toggle, draft-PR skip, PR description + `REVIEW.md` in prompt
- [x] GitHub check run around each review (in_progress → completed)
- [x] Dashboard: retry failed reviews, test provider connection
- [x] Docker Compose for self-hosting

## Configuration

fouine reads configuration from environment variables (or, for the API key and
prompts, from the dashboard — which take precedence over env). To boot you need
the GitHub App credentials — `GITHUB_APP_ID`, a private key
(`GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH`), `GITHUB_WEBHOOK_SECRET` —
and an OpenCode provider key (`OPENCODE_API_KEY`, or set it on the dashboard).

Optional GitHub-OAuth login protects the dashboard once `BETTER_AUTH_SECRET`,
`GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` are set (with
`ALLOWED_GITHUB_USERS` gating who may sign in); leave them empty for local dev
with no login.

See [`.env.example`](.env.example) for the annotated list, or the
[Configuration guide](https://karnak19.github.io/fouine/guide/configuration) for
the full reference (login setup, log levels, timeouts, data paths).

### AI observability (PostHog, optional)

Off by default. Set `POSTHOG_API_KEY` and fouine adds the
[`@posthog/opencode`](https://posthog.com/docs/ai-observability/installation/opencode)
plugin to the opencode config it generates, so every review reports:

- `$ai_generation` — one per LLM roundtrip: model, tokens, cost, stop reason
- `$ai_span` — one per tool execution, with real per-tool latency
- `$ai_trace` — one per prompt, emitted when the session goes idle

| Variable | Default | Notes |
| --- | --- | --- |
| `POSTHOG_API_KEY` | — | Project API key. **Unset = feature entirely absent**: the plugin is not declared, not downloaded, and makes no network calls. |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | Use `https://eu.i.posthog.com` or your self-hosted URL. |
| `POSTHOG_PRIVACY_MODE` | `false` | `true` drops prompts, completions and tool input/output; still reports tokens, cost, latency and model. |
| `POSTHOG_ENABLED` | `true` | Set to `false` to disable without removing the key. |
| `POSTHOG_DISTINCT_ID` | container hostname | Identifies this fouine instance. |
| `POSTHOG_PROJECT_NAME` | working directory name | Per-review this is the checked-out repo. |
| `POSTHOG_TAGS` | — | `k:v,k:v`, merged into every event. |
| `POSTHOG_MAX_ATTRIBUTE_LENGTH` | `12000` | Truncation limit for captured content. |

Two things worth knowing before you trust a dashboard built on this:

- **A hung tool call reports nothing.** Spans are emitted only when a tool
  reaches `completed`/`error`, and `$ai_trace` only on `session.idle`. A review
  that wedges shows its generations up to the hang and then simply stops — no
  error event. Missing trace means "wedged", not "never ran".
- The plugin is fetched from npm on the first review after you enable it and
  cached in `~/.cache/opencode/packages/`, so it costs one download, not one per
  review. That cache lives in the container's filesystem, so it is re-fetched
  after an image update unless you persist it.

### Runaway shell commands

opencode lets the model choose its own `bash` timeout and, on expiry, invites it
to retry with a bigger one — so a single wedged command can escalate until it
consumes the whole review budget. fouine ships a small opencode plugin
(`apps/server/opencode-config/plugin/cap-bash-timeout.ts`) that caps the model's value at
`OPENCODE_BASH_TIMEOUT_MAX_MS` (default `120000`). Raise it only if real reviews
legitimately need longer single commands.

## Development

The repo is a Bun-workspaces monorepo driven by Turborepo:

```
apps/server      # @fouine/server   — Bun + Elysia backend (webhooks, reviews, REST API)
apps/web         # @fouine/web      — React dashboard, built with Vite
apps/docs        # fouine-docs      — VitePress documentation site
packages/shared  # @fouine/shared   — row/response types shared by server and web
```

```bash
bun install
bun run dev          # start the server with --watch (it serves the dashboard too)
bun run typecheck    # tsc --noEmit across every workspace
bun run test         # run the test suite
bun run build        # build the dashboard into apps/web/dist
```

Each of those is `turbo run <task>` under the hood. There is no separate dev
server for the dashboard — everything is on **http://localhost:3000**. In
development Elysia serves `apps/web/src` through Bun's fullstack dev server,
which bundles the `.tsx` and the Tailwind CSS on the fly and gives you HMR; in
production (`NODE_ENV=production`) it serves the prebuilt `apps/web/dist` that
Vite produced.

## Self-hosting

Copy `.env.example` to `.env`, fill in the GitHub App credentials, then:

```bash
docker compose up -d
```

Register the GitHub App, point the webhook to your server, install on repos,
configure your prompt on the dashboard. That's it.

## License

MIT
