# Contributing

## Prerequisites

- [Bun](https://bun.sh) (latest)
- [OpenCode CLI](https://opencode.ai) (for running reviews locally)
- A GitHub App with webhook secret (for testing webhook handling)

## Setup

```bash
git clone https://github.com/Karnak19/fouine.git
cd fouine
bun install
cp .env.example .env
# edit .env with your credentials
```

## Development

```bash
bun run dev          # start the server with --watch (auto-reload)
bun run typecheck    # TypeScript type checking (tsc --noEmit)
bun run test         # run the test suite
bun run build        # build the dashboard into apps/web/dist
```

Each of these is a `turbo run <task>` across the workspaces.

The dashboard has no dev server of its own. `bun run dev` starts only the
backend, and Elysia serves the SPA from `apps/web/src` with Bun transpiling the
`.tsx` on the fly. In production (`NODE_ENV=production`) it serves the prebuilt
`apps/web/dist` instead. Both paths are resolved from the server module's own
location rather than the working directory, so they survive turbo and Docker
running with a different cwd.

## Project structure

The repository is a Bun-workspaces monorepo driven by Turborepo. TypeScript
settings are shared through `tsconfig.base.json` at the root, which each
workspace extends.

```
apps/server/              # @fouine/server — Bun + Elysia backend
├── src/
│   ├── index.ts          # Entry point
│   ├── config.ts         # Env-based configuration
│   ├── db.ts             # SQLite schema + queries
│   ├── settings.ts       # Dashboard settings resolver
│   ├── git/worktree.ts   # Bare repo + worktree management
│   ├── github/index.ts   # Octokit App, installation tokens
│   ├── review/
│   │   ├── runner.ts     # Review orchestrator
│   │   ├── opencode.ts   # OpenCode SDK client
│   │   ├── prompt.ts     # Prompt builder
│   │   └── types.ts      # Review types
│   └── server/
│       ├── app.ts        # Elysia server + static files
│       ├── api.ts        # REST API routes
│       ├── webhook.ts    # GitHub webhook handler
│       ├── events.ts     # Server-sent event stream
│       └── log.ts        # Structured logger
├── tests/setup.ts        # Hermetic test environment
└── opencode-config/      # Custom OpenCode agent config
    ├── agent/            # Reviewer and improver agent definitions
    ├── plugin/           # bash-timeout cap
    └── tools/
        ├── post_comment.ts  # PR summary comment
        └── post_review.ts   # Inline review comments

apps/web/                 # @fouine/web — React dashboard (SPA)
└── src/
    ├── index.tsx         # Entry point
    ├── components/ui/    # UI primitives
    ├── lib/              # API client, utils, formatters
    └── routes/           # TanStack Router routes

apps/docs/                # fouine-docs — this VitePress site

packages/shared/          # @fouine/shared — row and response types used by
                          # both the backend and the dashboard
```

`packages/shared` holds the database-row and API-response shapes the dashboard
used to re-declare by hand. Import them with `import type` from either app so
the two stay in step.

Path aliases: `~/*` resolves to `apps/server/src/*` inside the backend, `@/*`
resolves to `apps/web/src/*` inside the dashboard. Each alias works only within
its own workspace.

## Testing

Tests are co-located with source files (`*.test.ts`). The test setup in `apps/server/tests/setup.ts` creates a hermetic environment with temp directories and stubbed env vars; `apps/server/bunfig.toml` preloads it, and a root `bunfig.toml` does the same so a bare `bun test` works from the repository root.

```bash
bun run test                        # run all tests through turbo
bun test apps/server/src/db.test.ts # run a specific test file
```

## Guidelines

- Run `bun run typecheck` before submitting — strict mode is enabled
- Keep tests hermetic — no real network calls, no shared state
- Follow existing code style — the project uses Elysia conventions, SQLite prepared statements, and structured JSON logging
- One concern per PR — keep changes focused

## License

MIT
