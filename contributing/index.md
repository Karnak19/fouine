# Contributing

## Prerequisites

- [Bun](https://bun.sh) (latest)
- [OpenCode CLI](https://opencode.ai) (for running reviews locally)
- A GitHub App with webhook secret (for testing webhook handling)

## Setup

```bash
git clone https://github.com/basilevernouillet/fouine.git
cd fouine
bun install
cp .env.example .env
# edit .env with your credentials
```

## Development

```bash
bun run dev          # start the server with --watch (auto-reload)
bun run typecheck    # TypeScript type checking (tsc --noEmit)
bun test             # run the test suite
```

## Project structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Env-based configuration
├── db.ts                 # SQLite schema + queries
├── settings.ts           # Dashboard settings resolver
├── git/worktree.ts       # Bare repo + worktree management
├── github/index.ts       # Octokit App, installation tokens
├── review/
│   ├── runner.ts         # Review orchestrator
│   ├── opencode.ts       # OpenCode SDK client
│   ├── prompt.ts         # Prompt builder
│   └── types.ts          # Shared types
└── server/
    ├── app.ts            # Elysia server + static files
    ├── api.ts            # REST API routes
    ├── webhook.ts        # GitHub webhook handler
    └── log.ts            # Structured logger

public/                   # React dashboard (SPA)
├── index.tsx             # Entry point
├── components/ui/        # UI primitives
├── lib/                  # API client, utils, formatters
└── routes/               # TanStack Router routes

opencode-config/tools/    # Custom OpenCode agent tools
├── post_comment.ts       # PR summary comment
└── post_review.ts        # Inline review comments
```

## Testing

Tests are co-located with source files (`*.test.ts`). The test setup in `tests/setup.ts` creates a hermetic environment with temp directories and stubbed env vars.

```bash
bun test              # run all tests
bun test db.test.ts   # run a specific test file
```

## Guidelines

- Run `bun run typecheck` before submitting — strict mode is enabled
- Keep tests hermetic — no real network calls, no shared state
- Follow existing code style — the project uses Elysia conventions, SQLite prepared statements, and structured JSON logging
- One concern per PR — keep changes focused

## License

MIT
