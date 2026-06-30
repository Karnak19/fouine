# What is fouine?

fouine is a self-hosted AI code reviewer for GitHub. It connects as a GitHub App, receives pull request webhooks, and runs an AI agent against the full codebase to post reviews with inline comments.

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

1. **GitHub sends a webhook** — `pull_request` (opened, synchronize, reopened) or an `issue_comment` containing `/review`
2. **Elysia server** verifies the HMAC signature, extracts PR info
3. **Bare repo + worktree** — first PR from a repo triggers `git clone --bare`, cached on disk. Each review gets a lightweight `git worktree add` at the PR head SHA
4. **OpenCode agent** runs programmatically on the worktree with a configurable review prompt. It reads the diff, explores context, and posts results
5. **GitHub API** — the agent posts a review summary as a PR comment + inline comments on specific lines via custom tools
6. **Cleanup** — the worktree is removed after review; the bare repo stays cached for next time

## Key design decisions

| Decision | Why |
|---|---|
| Full codebase via worktree | The agent decides what context matters, not a rigid diff parser |
| GitHub App over personal tokens | Clean per-repo install, no token juggling |
| One LLM call per review | Models are smart enough for a thorough review in one pass |
| Agent posts comments directly | Simpler than having the server parse structured output |
| Configurable prompt via dashboard | Review style, focus areas, language, strictness — per repo |

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Server | Elysia |
| Code agent | OpenCode (programmatic) |
| GitHub | GitHub App + octokit |
| Dashboard | React + TanStack Router + Tailwind |
| Database | SQLite (WAL mode) |
| Self-hosting | Docker |
