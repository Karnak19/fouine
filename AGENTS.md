# AGENTS.md

fouine — self-hosted AI code reviewer. GitHub App webhook → bare-clone + worktree per PR → in-process OpenCode agent posts the review to GitHub. Bun + Elysia backend, React SPA dashboard.

## Commands

```bash
bun install
bun run dev          # backend only, --watch. also serves the dashboard (see below)
bun run typecheck    # tsc --noEmit  — there is NO lint script; this is the gate
bun test             # all tests
bun test src/db.test.ts   # one file
```

## Typecheck is the only gate (and it's strict)

No ESLint/Prettier configured. `tsconfig.json` is `strict` with `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`:
- Use `import type` for type-only imports, or typecheck fails.
- Don't leave unused vars/params — they fail the build, not just a warning.
Run `bun run typecheck` before considering any change done.

## Dashboard = served by the backend, no separate dev server

The React SPA lives in `public/` (TanStack Router/Query + Tailwind v4). `bun run dev` starts **only** the backend, but Elysia's static plugin serves the dashboard too:
- dev → serves `public/` directly (Bun transpiles `.tsx` on the fly).
- prod → serve prebuilt `dist/`, enabled when `NODE_ENV=production`. Build with `bunx vite build` (Vite root is `public/`, output → `dist/`). There is no `build` npm script.
- SPA fallback: non-asset GET paths return `index.html` (see `isAssetPath` in `src/server/app.ts`).

## Path aliases

`~/*` → `./src/*`, `@/*` → `./public/*` (configured in both `tsconfig.json` and `vite.config.ts`). Import backend code via `~/...`.

## Tests are hermetic — no env setup needed

`bunfig.toml` preloads `tests/setup.ts`, which points `DATA_DIR`/`DB_PATH` at a temp dir and stubs GitHub creds before any singleton loads. Tests are co-located (`*.test.ts`). No network, no real services.

## SQLite has no migration framework

Schema and all prepared statements live in `src/db.ts`. Add new columns via the idempotent `ALTER TABLE ... ADD COLUMN` wrapped in try/catch (`addColumn`) — append to those loops, don't add a migration tool. DB is WAL mode at `${DATA_DIR}/fouine.db`. Reuse the prepared-statement objects already exported (`repos`, `reviews`, `settings`); don't open ad-hoc queries.

## Review runtime requirements

A review spawns an in-process OpenCode server (via `@opencode-ai/sdk`) on an **ephemeral port** — never the SDK default 4096, concurrent reviews would collide. Requirements:
- `git` and the `opencode` CLI must be on `PATH` (Dockerfile installs both).
- Custom agent tools in `opencode-config/tools/` (`post_review`, `post_comment`) are loaded via `OPENCODE_CONFIG_DIR` (set in the Dockerfile; point it at `opencode-config/` locally).
- The runner sets per-review env (`FOUINE_GITHUB_TOKEN`, `FOUINE_REPO_OWNER`, `FOUINE_REPO_NAME`, `FOUINE_PR_NUMBER`) that those tools read — don't pass GitHub creds into the tools another way.
- Bare clones are cached at `${DATA_DIR}/repos/{full_name}.git`; worktrees at `${DATA_DIR}/worktrees/`. Both accumulate under `DATA_DIR` (the Docker volume `/data`).

## Config precedence

Dashboard-stored settings (SQLite `settings` table) **override** env vars; per-repo prompt/model override global. Always resolve via helpers in `src/settings.ts` (`resolveApiKey`, `resolveDefaultModel`, `resolvePrompt`) rather than reading `process.env` directly. `src/config.ts` un-escapes literal `\n` in `GITHUB_APP_PRIVATE_KEY`.

## Conventions

- `ponytail:` comments mark a **deliberate** shortcut with a named ceiling/upgrade path. Preserve them — don't "clean them up" into the longer form.
- Logging is structured JSON via `src/server/log.ts` (`log.info/debug/warn/error`); debug level is gated by `LOG_LEVEL` and explains why a handler early-returned.
- Optional Basic Auth (`BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`) protects dashboard + `/api`; `/webhook/*` and `/health` are always exempt.
- Docs site (VitePress) lives in `docs/` with its own `package.json`; architecture and data-model details are in `docs/architecture/index.md`.

## Flow pointers

- Entry: `src/index.ts` → `src/server/app.ts` (`boot`).
- Webhook: `src/server/webhook.ts` (HMAC verify → dispatch; handles `pull_request` opened/synchronize/reopened + `issue_comment` `/review`).
- Review orchestration: `src/review/runner.ts`. Abort-aware (`activeReviews` map backs the dashboard Stop button).
- REST API (dashboard backend): `src/server/api.ts`, prefix `/api`.
