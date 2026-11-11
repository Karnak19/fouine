# #167 phase 1 — Mastra for chat and `/build`

Branch: `spike/167-phase1-mastra-chat`
Base: the chat spike (`8ea967a4`) plus this PR's `/build`, instance, storage and
dev-verification work.

## What shipped

**Route-internal agents, no Hono mount, no client or auth changes.**
`POST /api/chat` and `POST /api/build` keep their Elysia schemas, their session
gate, their structured request log and the static/SPA fallback. Both return the
same AI SDK v7 UI message stream the browser already consumes. `apps/web/` is
untouched.

- **Chat** — `streamChat()` still owns `textOnly`, the 40-turn slice and the
  question-length check, then delegates to `streamChatViaAgent()`
  (`apps/server/src/mastra/chat.ts`). `query_stats` / `render_chart` are Mastra
  tools with the same names and zod schemas, still calling `runStatsQuery` /
  `buildChart`; the SQL guard, readonly worker, row cap and deadline are not
  reimplemented.
- **`/build`** — `validatePrevious()` and every bound stay in
  `apps/server/src/build/index.ts`. The two model steps now run through one
  `buildAgent` (`apps/server/src/mastra/build.ts`), with the data/layout prompt
  split preserved as a per-run instruction override. `add_dataset` is wrapped
  with `createTool()` around the existing `createDatasetStep().execute`, so the
  cap/duplicate/axis checks and `runDataset` are unchanged. Refines still re-run
  the previous SQL server-side before the model sees anything; dataset parts and
  notes are written before the layout starts, and the layout stream still goes
  through `pipeYamlRender`. `CHAT_MOCK=1` selects the same two scripted build
  models as before.
- **Mastra instance** — `apps/server/src/mastra/index.ts` registers
  `{ chat, build }` and stores state in `${DATA_DIR}/mastra.db` via
  `@mastra/libsql`. `boot()` initialises that storage before accepting requests.
  A test imports the instance and asserts the path follows `DATA_DIR`; the test
  preload's temp dir is the only place the suite writes.
- **Peripheral fixes** — root `bunfig.toml` now pins `[install] linker =
  "hoisted"` (Bun 1.4.4's isolated linker broke `@elysia/static` →
  `fast-decode-uri-component`), and `turbo.json`'s `dev.passThroughEnv` now
  passes `OPENCODE_API_KEY` and `LOG_LEVEL` as well as `CHAT_MOCK`.

## Versions (exact pins)

| Package | Version |
| --- | --- |
| `@mastra/core` | `1.82.0` |
| `@mastra/ai-sdk` | `1.11.3` |
| `@mastra/libsql` | `1.29.0` |
| `@libsql/client` (transitive) | `^0.18.0` |
| `ai` (already present) | `^7.0.148` (lock: `7.0.148`) |
| `zod` (already present) | `^4.6.7` |
| Bun (environment) | `1.4.4` |

`@mastra/libsql@1.29.0` peers `@mastra/core >=1.76.0-0 <2.0.0-0`.

## `OpenAICompatibleConfig`: adopted

The real gateway model is now Mastra's config object, not an AI SDK instance:

```ts
{ id: "opencode-go/deepseek-v4.1-flash",
  url: "https://opencode.ai/zen/go/v1",
  apiKey,
  headers: { "x-opencode-session": session } }
```

Verified against a local capture server (not committed): Mastra requested
`/v1/chat/completions`, sent `Authorization: Bearer <key>`, sent
`x-opencode-session`, and put the **bare** model id (`deepseek-v4.1-flash`) in
the body — so `url` is the base URL and `wireModelId`'s rule still holds.

Result: the gateway model cast is gone for both agents. Three type-level
frictions remain, all isolated:

1. **Mock models** — `MockLanguageModelV4` comes from the app's AI SDK, Mastra
   declares its own `LanguageModelV4`; the cast is in `~/chat/model.ts` and
   `project buildModels()` (build has two stateful scripts, so they stay
   instances). Upgrade path: a Mastra mock model or one shared provider type.
2. **Stream chunks** — `toAISdkStream(version: "v7")` types `finishReason` with
   `"interrupted"` absent from the app's `ai`; chat casts the write, build casts
   the `pipeYamlRender` → `writer.merge` boundary. Same wire shape.
3. **`maxSteps`, not `stopWhen`** — Mastra's stop-condition type is tied to its
   vendored AI SDK and rejects ours. `maxSteps` is the same budget
   (`DATA_STEPS = MAX_DATASETS + 3`, `LAYOUT_STEPS = 1`, chat `6`).

## Studio: omitted, with the blocker recorded

Mastra 1.82 does **not** ship the Studio UI in `@mastra/core` or
`@mastra/server`; `@mastra/server` (and the `@mastra/hono` adapter) exposes API
routes only. Studio is served by the `mastra` CLI (`mastra dev`) as a separate
process/port, which would need a new CLI dependency and its own bundling of
`~/...` aliases. Mounting the Hono adapter under Elysia would add a route that
loses to the static plugin's catch-all GET and would not produce the Studio UI
anyway, i.e. it risks the dev SPA for no gain.

Decision: no Studio mount in `app.ts` this phase. The `Mastra` instance is in
place, so phase 2 can either add a pinned `mastra dev` script or mount the API
adapter behind the existing auth gate. `app.ts`'s static plugin /
`bunFullstack` / `await staticPlugin(...)` ordering is untouched.

## Gates and smoke evidence

| Gate | Result |
| --- | --- |
| `turbo run typecheck` | pass, exit 0 |
| `turbo run test` | pass, 462 tests / 0 fail, exit 0 |
| `turbo run build` | pass, exit 0 |
| `CHAT_MOCK=1` smoke, `/api/chat` | 200, 18.9 kB stream |
| `CHAT_MOCK=1` smoke, `/api/build` | 200, 7.3 kB stream |

Chat chunk inventory: `start`, `start-step`, `reasoning-start/delta/end`,
`tool-input-start/delta/available`, `tool-output-available` (×2),
`text-start/delta/end`, `finish-step`, `finish` — two real tool round-trips.

`/build` chunk inventory: `data-build-dataset` ×2 (rows included), then
`start`, `start-step`, `text-start/end`, 47 `data-spec` patches, `finish`. The
last dataset part precedes the first spec patch, which is the ordering the page
depends on. A smoke run with `DATA_DIR` at a temp dir created `mastra.db` there,
not in the repo's data dir.

`/build`'s existing tests (mock full build, refine re-run, guard-dropped
dataset, SSE ordering, 400 paths) all pass against the Mastra path.

## Gotchas that remain for phase 2

1. **Two AI SDK type universes.** Keep the remaining mock/stream casts in the
   adapter modules. If Mastra exposes a shared provider type, delete them.
2. **Mock models are per-request state machines.** `buildModels()` builds both
   per request; the chat resolver memoises on the request context. A new
   dynamic model must do the same or replay step 0.
3. **`originalMessages`** is still required in chat's `createUIMessageStream`.
   `/build` merges a second stream into an existing writer, as before.
4. **`sendReasoning: true`** must stay on `toAISdkStream`; reasoning is off by
   default and the thread renders those parts.
5. **Storage is initialised at boot.** A mounted-but-unwritable `DATA_DIR` now
   fails at startup rather than mid-review. The libsql native dependency must be
   present in the production image (it is installed via `@mastra/libsql`).
6. **`/build` store writes** — Mastra has no memory in this design; the libsql
   file currently only holds Mastra's own tables. Phase 2 decides whether traces
   / workflow snapshots are enabled or the store stays empty.
7. **Studio** — see above; it needs a separate decision (CLI vs API adapter).
8. **Turbo env mode** — `OPENCODE_API_KEY` and `LOG_LEVEL` now pass through
   `dev`; any new verification variable must be added there too.
9. **Bun linker** — the hoisted pin is repo-wide. `bun install` (not
   `--linker=isolated`) is the supported install in this workspace.
10. **No auth in dev** because `BETTER_AUTH_SECRET`/OAuth vars are unset; the
    curls were unauthenticated. That is existing behaviour, not this PR.

## Diff footprint

- `apps/server/package.json` / `bun.lock`: +`@mastra/core@1.82.0`,
  +`@mastra/ai-sdk@1.11.3`, +`@mastra/libsql@1.29.0`.
- `apps/server/src/chat/index.ts`: delegates the run; validation/limits unchanged.
- `apps/server/src/chat/model.ts`: `OpenAICompatibleConfig` builder + mock cast.
- `apps/server/src/mastra/{chat,build,index}.ts`: agents, adapter, instance.
- `apps/server/src/mastra/tools.ts`: chat tools.
- `apps/server/src/build/index.ts`: orchestration moved to the agent; validation
  and constants unchanged.
- `apps/server/src/build/datasets.ts`: schema/description/execute extracted for
  the Mastra tool wrapper; guards unchanged.
- `apps/server/src/server/app.ts`: boot initialises Mastra storage. Static/SPA
  ordering untouched.
- `apps/server/src/mastra/mastra.test.ts`: storage follows `DATA_DIR`.
- `bunfig.toml`, `turbo.json`: linker pin + dev env pass-through.
- `apps/web/`: **no changes**.
