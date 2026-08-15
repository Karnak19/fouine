# AGENTS.md

fouine — self-hosted AI code reviewer. GitHub App webhook → bare-clone + worktree per PR → in-process OpenCode agent posts the review to GitHub. Bun + Elysia backend, React SPA dashboard.

## Workspace layout

Bun workspaces + Turborepo. Three workspaces under `apps/*`, shared code under `packages/*`:

- `apps/server` (`@fouine/server`) — Bun + Elysia backend. `src/`, `tests/`, `opencode-config/`.
- `apps/web` (`@fouine/web`) — React SPA dashboard, sources flat in `src/`, Vite build → `dist/`.
- `apps/docs` (`fouine-docs`) — VitePress site, own scripts (`docs:dev`, `docs:build`).
- `packages/shared` (`@fouine/shared`) — the row/response types both apps use, so the SPA stops hand-duplicating the backend's shapes. Import them with `import type`.

Turbo drives every task from the root; each workspace declares its own script. `turbo.json` marks `dev` persistent/uncached and `build` as producing `dist/**`.

## Commands

```bash
bun install
turbo run dev        # backend only, --watch. also serves the dashboard (see below)
turbo run typecheck  # tsc --noEmit in every workspace — there is NO lint script; this is the gate
turbo run test       # all tests
turbo run build      # builds the SPA (apps/web) into apps/web/dist
bun test             # still works bare from the root
bun test apps/server/src/db.test.ts   # one file
```

The root `package.json` scripts (`bun run dev` etc.) are thin wrappers over the same `turbo run` tasks.

## Typecheck is the only gate (and it's strict)

No ESLint/Prettier configured. `tsconfig.base.json` at the root is `strict` with `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`; each app extends it with its own `include` and `paths` (there is no root `tsconfig.json`):
- Use `import type` for type-only imports, or typecheck fails.
- Don't leave unused vars/params — they fail the build, not just a warning.
Run `turbo run typecheck` before considering any change done.

## Dashboard = served by the backend, no separate dev server

The React SPA lives in `apps/web/src` (TanStack Router/Query + Tailwind v4). `turbo run dev` starts **only** the backend — there is no Vite dev server, deliberately. Everything is on `:3000`. Elysia's static plugin serves the dashboard:
- dev → serves `apps/web/src` through **Bun's fullstack dev server**: `staticPlugin({ bunFullstack: true })` hands `index.html` to Bun's bundler, which transpiles the whole `.tsx` module graph, resolves the `@/*` tsconfig paths and runs `bun-plugin-tailwind` over `global.css` (registered in `apps/server/bunfig.toml` under `[serve.static]`). HMR included. The `await` on `staticPlugin(...)` is what installs the HMR hooks — don't drop it.
- Asset hrefs in `apps/web/src/index.html` must stay **relative** (`./index.tsx`, `./global.css`, …). Bun's HTML bundler can't resolve root-absolute `/…` hrefs and fails the build; it rewrites the relative ones to hashed `/_bun/asset/*` URLs anyway, so deep links are unaffected.
- prod → serves the prebuilt `apps/web/dist`, enabled when `NODE_ENV=production` (which also turns `bunFullstack` off). Build with `turbo run build` (Vite root is `apps/web/src`, output → `apps/web/dist`). Vite is still the production bundler; only dev goes through Bun.
- Both paths are resolved **absolutely from `import.meta.dir`** in `apps/server/src/server/app.ts`, not relative to the cwd — turbo and Docker both run with a cwd the old relative paths didn't survive. Don't "simplify" them back.
- SPA fallback: non-asset GET paths return `index.html` (see `isAssetPath`/`spaShell` in `apps/server/src/server/app.ts`). In dev `spaShell` re-requests our own `/` rather than reading the file — the bundled HTML only exists as the static plugin's `/` route, so `Bun.file(index.html)` there would serve raw source and blank every deep link.

## Path aliases

`~/*` → `apps/server/src/*` (server `tsconfig.json`), `@/*` → `apps/web/src/*` (web `tsconfig.json` + `vite.config.ts`). Each alias only resolves inside its own app; import backend code via `~/...`, SPA code via `@/...`.

## Tests are hermetic — no env setup needed

`apps/server/bunfig.toml` preloads `tests/setup.ts`, which points `DATA_DIR`/`DB_PATH` at a temp dir and stubs GitHub creds before any singleton loads. A second, root `bunfig.toml` exists purely so a bare `bun test` from the repo root preloads the same file. Tests are co-located (`*.test.ts`). No network, no real services.

## SQLite has no migration framework

Schema and all prepared statements live in `apps/server/src/db.ts`. Add new columns via the idempotent `ALTER TABLE ... ADD COLUMN` wrapped in try/catch (`addColumn`) — append to those loops, don't add a migration tool. DB is WAL mode at `${DATA_DIR}/fouine.db`. Reuse the prepared-statement objects already exported (`repos`, `reviews`, `settings`); don't open ad-hoc queries.

## Review runtime requirements

A review spawns an in-process OpenCode server (via `@opencode-ai/sdk`) on an **ephemeral port** — never the SDK default 4096, concurrent reviews would collide. Requirements:
- `git` and the `opencode` CLI must be on `PATH` (Dockerfile installs both).
- Custom agent tools in `apps/server/opencode-config/tools/` (`post_review`, `post_comment`) are loaded via `OPENCODE_CONFIG_DIR`. `apps/server/src/config.ts` falls back to resolving that dir from `import.meta.dir` (same cwd reason as the asset paths above), so it works unset; the Dockerfile still sets it explicitly.
- The runner sets per-review env (`FOUINE_GITHUB_TOKEN`, `FOUINE_REPO_OWNER`, `FOUINE_REPO_NAME`, `FOUINE_PR_NUMBER`) that those tools read — don't pass GitHub creds into the tools another way.
- Bare clones are cached at `${DATA_DIR}/repos/{full_name}.git`; worktrees at `${DATA_DIR}/worktrees/`. Both accumulate under `DATA_DIR` (the Docker volume `/data`).

## Config precedence

Dashboard-stored settings (SQLite `settings` table) **override** env vars; per-repo prompt/model override global. Always resolve via helpers in `apps/server/src/settings.ts` (`resolveApiKey`, `resolveDefaultModel`, `resolvePrompt`) rather than reading `process.env` directly. `apps/server/src/config.ts` un-escapes literal `\n` in `GITHUB_APP_PRIVATE_KEY`.

## Conventions

- `ponytail:` comments mark a **deliberate** shortcut with a named ceiling/upgrade path. Preserve them — don't "clean them up" into the longer form.
- Logging is structured JSON via `apps/server/src/server/log.ts` (`log.info/debug/warn/error`); debug level is gated by `LOG_LEVEL` and explains why a handler early-returned.
- Optional GitHub-OAuth login (better-auth, `apps/server/src/server/auth.ts`) protects `/api`; enabled when `BETTER_AUTH_SECRET`+`GITHUB_APP_CLIENT_ID`+`GITHUB_APP_CLIENT_SECRET` are set (the existing GitHub App's OAuth creds), gated by `ALLOWED_GITHUB_USERS`. `/api/auth/*` is delegated in `onRequest` (a route loses to the static catch-all GET); `/webhook/*`, `/health`, and the SPA shell stay public.
- Docs site (VitePress) lives in `apps/docs/` with its own `package.json` and its own scripts (`bun run docs:build` from that directory); architecture and data-model details are in `apps/docs/architecture/index.md`.

## Flow pointers

- Entry: `apps/server/src/index.ts` → `apps/server/src/server/app.ts` (`boot`).
- Webhook: `apps/server/src/server/webhook.ts` (HMAC verify → dispatch; handles `pull_request` opened/synchronize/reopened + `issue_comment` `/review`).
- Review orchestration: `apps/server/src/review/runner.ts`. Abort-aware (`activeReviews` map backs the dashboard Stop button).
- REST API (dashboard backend): `apps/server/src/server/api.ts`, prefix `/api`.
