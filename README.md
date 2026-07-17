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
- **Severity** — the reviewer uses `REQUEST_CHANGES` only for correctness/security/data-loss risks it's confident about; everything else is a non-blocking `COMMENT`
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

## Development

```bash
bun install
bun run dev          # start the server with --watch
bun run typecheck    # tsc --noEmit
bun test             # run the test suite
```

## Self-hosting

Copy `.env.example` to `.env`, fill in the GitHub App credentials, then:

```bash
docker compose up -d
```

Register the GitHub App, point the webhook to your server, install on repos,
configure your prompt on the dashboard. That's it.

## License

MIT
