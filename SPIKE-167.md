# SPIKE-167 — Mastra as the chat agent's runtime (phase 1, chat only)

Branch: `spike/167-phase1-mastra-chat`
Scope: the dashboard **chat** agent only. `/build` is untouched.

## What was built

The integration shape is deliberately the least-risk one:

- **No Hono mount, no route changes, no auth changes.** `POST /api/chat` in
  `apps/server/src/server/api.ts` is still the entry point and keeps its Elysia
  body schema.
- `streamChat()` in `apps/server/src/chat/index.ts` still does the trust-boundary
  work (`textOnly`, turn slice, question-length check, API-key/mock selection).
  It now delegates the run to `streamChatViaAgent()` in
  `apps/server/src/mastra/chat.ts`.
- The Mastra agent's stream is converted with `toAISdkStream(..., { version:
  "v7" })` and wrapped in `createUIMessageStream` /
  `createUIMessageStreamResponse`, i.e. the exact response type the previous
  `streamText(...).toUIMessageStreamResponse()` produced.
- `apps/web/` was not modified (`git diff --stat` shows no web changes).

Files added:

- `apps/server/src/chat/model.ts` — `OPENCODE_GO_BASE_URL` and `wireModelId`
  moved here from `chat/index.ts` so the Mastra model resolver can use them
  without a circular import; `buildChatModel(session)` builds the per-request
  model (gateway or mock).
- `apps/server/src/mastra/tools.ts` — `query_stats` and `render_chart` as
  `createTool()` definitions. Names, descriptions and zod schemas are copied
  verbatim from the old `tool()` definitions. They call `runStatsQuery` /
  `buildChart` unchanged; the SQL guard, readonly worker, row cap and deadline
  are not reimplemented.
- `apps/server/src/mastra/chat.ts` — the singleton `chatAgent` (same
  `CHAT_SYSTEM_PROMPT`, same two tools) and the stream adapter.

## Versions (pinned exactly, as requested)

| Package | Version |
| --- | --- |
| `@mastra/core` | `1.82.0` |
| `@mastra/ai-sdk` | `1.11.3` |
| `ai` (already present) | `^7.0.148` (lock resolves `7.0.148`) |
| `zod` (already present) | `^4.6.7` |
| Bun | `1.4.4` |

`@mastra/ai-sdk@1.11.3` peers: `@mastra/core >=1.5.0-0 <2.0.0-0`, `zod ^3.25 || ^4`.
`@mastra/core@1.82.0` vendors AI SDK provider v5/v6/v7 (`@ai-sdk/provider@4.0.35`
for v7).

## The five checks

### 1. Mastra works in this Bun + Elysia app with the AI SDK v7 message stream — **PASS (with type-level drift)**

`turbo run typecheck`, `bun test` (484 pass / 0 fail) and a live
`CHAT_MOCK=1` dev-server request all succeed on Bun 1.4.4 with Elysia 1.4.29.
The agent runs in-process; Elysia returns the `Response` from
`createUIMessageStreamResponse` as it did before.

The cost is **three type casts**, caused by Mastra shipping its own vendored
copies of the AI SDK types (`@mastra/core/dist/_types/...`) rather than importing
the app's `ai`:

- `MastraLanguageModel` declares a *unified* `doGenerate` that returns a stream
  result, while a stock AI SDK model returns a generate result. This is a type
  mismatch only for `agent.stream()` (which calls `doStream`). Both the real
  gateway model and `MockLanguageModelV4` need `as unknown as MastraLanguageModel`.
- `stopWhen: stepCountIs(6)` from the app's `ai` does not structurally match
  Mastra's stop-condition type (Mastra's `StepResult` has more fields). Used
  `maxSteps: 6` instead (documented and semantically the same budget).
- `toAISdkStream(version: "v7")` chunks type `finishReason` with one extra
  member (`"interrupted"`) vs the app's `ai`; the write loop casts the chunk.

A real phase-1 PR should either isolate these casts in one adapter module
(as done here) or pass Mastra an `OpenAICompatibleConfig` object
(`{ id, url, apiKey, headers }`) instead of an AI SDK model instance, which may
avoid the model cast entirely. It should verify that `url` means base URL before
switching.

### 2. The stream still drives `@assistant-ui/react-ai-sdk` unchanged — **PASS**

`apps/web/src/routes/chat.tsx` and the toolkit were not touched. A curl against
the running server with the SPA's wire body
(`{ id, messages: [{ id, role: "user", parts: [{ type: "text", text }] }] }`)
returned `200`, `content-type: text/event-stream`,
`x-vercel-ai-ui-message-stream: v1`, and this chunk inventory:

```
start, start-step, reasoning-start/delta/end, tool-input-start,
tool-input-delta, tool-input-available, tool-output-available,
finish-step, text-start/delta/end, finish
```

Two tool round-trips were present, with the names the toolkit registers:
`toolName: "query_stats"` and `toolName: "render_chart"` (both
`dynamic: false`), each followed by a `tool-output-available` carrying the real
result (`1 row(s) in 19ms ...` for the SQL; a chart object for the chart).
175 `text-delta` chunks and a final `finish` closed the run. That is the v7 UI
message protocol `AssistantChatTransport` consumes.

Not proven in this spike: an actual browser render of the chart/SQL cards. The
wire format and tool names are verified; a phase-1 PR should still click through
the three suggestion prompts once.

### 3. `CHAT_MOCK=1` still plugs in — **PASS**

`CHAT_MOCK=1` works through Mastra. The model resolver returns
`createChatMockModel()` per request (memoised on the request context so the
script does not restart mid-run), and the scripted stream drove the full
three-step loop: reasoning → real `query_stats` against the real SQLite DB →
reasoning → real `render_chart` → reasoning → long markdown answer. The dev log
showed only `[chat] CHAT_MOCK=1 — answering with the scripted mock model, no
upstream call`; no upstream request. `/build`'s mock is untouched.

The mock needed no Mastra-specific changes. It is a `MockLanguageModelV4`, i.e.
the same AI SDK v7 stream-part script the old route used.

### 4. `resolveChatModel` still picks the model, re-read per request — **PASS**

The agent's `model` is a function of the request context; it calls
`buildChatModel()`, which calls `resolveChatModel()` and returns the gateway
model for the current request. No module-level model is cached.

Evidence from a live server (run directly with
`OPENCODE_API_KEY=dummy-key LOG_LEVEL=debug bun src/index.ts`, because Turbo's
strict env mode strips those variables — see gotchas):

```
PUT /api/settings {"chat_model":"opencode-go/deepseek-v4-flash"}  -> 200
POST /api/chat ... -> chat model resolved  model:"deepseek-v4-flash"
PUT /api/settings {"chat_model":"opencode-go/some-other-model"}    -> 200
POST /api/chat ... -> chat model resolved  model:"some-other-model"
```

No restart between the two requests. The structured debug line
(`chat model resolved`) is emitted from the resolver itself, so this is the
model actually handed to the run, not just what the settings API stored.

`x-opencode-session` is still set: the session id reaches
`buildChatModel(session)` through the request context and is stored in the
provider headers exactly as before.

### 5. Existing limits still apply — **PASS**

- `MAX_TURNS = 40`: the Elysia body schema still caps `messages` at 40, and
  `streamChat` still slices the sanitised thread to the last 40.
- `MAX_QUESTION_CHARS = 4_000`: still enforced twice — the route's
  `text` `maxLength` and `streamChat`'s loop before the agent is called.
- `MAX_PARTS_PER_MESSAGE = 64`: still the route's `parts.maxItems`.
- The trust boundary is unchanged: `textOnly` still drops every assistant
  message and every non-text part, so forged tool results / prior answers never
  reach the model.
- `messages.test.ts` (empty thread, oversized question, assistant-only thread)
  still passes against the new `streamChat`, and the 400 path
  (`No opencode API key configured`) still comes back as a JSON error, not a
  stream.
- Step budget: Mastra `maxSteps: 6`, the same budget as `stepCountIs(6)`.

## Gotchas for the real phase-1 PR

1. **Two AI SDK type universes.** Mastra vendors its own copies (`provider@4.0.35`
   etc.) and its `MastraLanguageModel` is not the stock `LanguageModelV4`.
   Expect casts at the model boundary and at the stream-chunk boundary. Keep
   them in one adapter file and write down why, or use
   `OpenAICompatibleConfig`.
2. **`maxSteps`, not `stopWhen`.** Mastra's docs still show
   `stopWhen: stepCountIs(n)`; with the app's `ai@7` it does not typecheck.
   `maxSteps: n` is accepted and is the same budget. Confirm the step count on a
   real multi-tool answer in phase 1.
3. **`createTool()` needs `outputSchema` for a useful output type.** Without it,
   `execute`'s return is effectively unconstrained/void. `query_stats` uses
   `z.string()`, `render_chart` uses `z.unknown()` so the `ChartResult` object
   reaches the client untouched.
4. **Mock model is stateful per request.** If the model resolver is called more
   than once per run (Mastra may ask per step), constructing a new mock each
   time would replay step 0 forever. The resolver memoises the model on the
   `RequestContext`. Any future dynamic model must do the same.
5. **`originalMessages` is required** in `createUIMessageStream` (or the client
   can duplicate the assistant message). The adapter passes the sanitised
   `messages`.
6. **Reasoning is off by default** in `toAISdkStream`; pass `sendReasoning: true`
   to preserve the old behaviour (the mock streams reasoning blocks).
7. **No Mastra instance, no Studio, no traces in this spike.** A standalone
   `Agent` works, but registering it in `new Mastra({ agents })` is what gives
   Studio and tracing. Phase 1 must add that instance (dev-only Studio) and the
   `${DATA_DIR}/mastra.db` storage decision from #167.
8. **Turbo strips env vars.** `turbo.json`'s `dev` task has
   `passThroughEnv: ["CHAT_MOCK"]` and strict env mode, so
   `OPENCODE_API_KEY=... LOG_LEVEL=debug turbo run dev` silently drops both.
   For local verification run `bun src/index.ts` from `apps/server`, or add the
   variables to `passThroughEnv` (dev tooling only).
9. **Bun linker quirk in this worktree.** With Bun 1.4.4's default isolated
   linker, `@elysia/static` resolved `fast-decode-uri-component` against the
   global link cache and failed, which broke `events.test.ts` (and therefore the
   whole `bun test` run) before any Mastra code ran. `bun install
   --linker=hoisted` produced a working tree (484 pass / 0 fail). The repo pins
   `packageManager: bun@1.4.2`; align the Bun version or the linker in CI before
   blaming a dependency.
10. **No auth in dev** because `BETTER_AUTH_SECRET`/OAuth vars are unset, so
    `requiresSession` is never evaluated in `onBeforeHandle`. The curl worked
    unauthenticated. That is the existing dev behaviour, not something this
    spike changed.

## Recommendation: route-internal agent vs Hono mount

**Keep the agent route-internal, as done here.** For phase 1 it wins on every
axis that matters:

- `POST /api/chat` keeps its Elysia body validation, its existing auth gate
  (`onBeforeHandle`), its structured request log, and the static/SPA fallback in
  `app.ts` untouched. There is no prefix to get wrong and no second HTTP
  framework in the request path.
- The response is still a plain `Response`, so `AssistantChatTransport` needs
  zero changes.
- `/build` can be migrated on its own schedule without a route collision.

Mount Mastra's Hono handler **later, only where it earns its keep**: phase 2's
MCP endpoint, A2A, and Studio. Those are new route trees with their own
transports, and `MCPServer`/Studio are exactly what the Hono handler provides.
When that happens, mount it under a prefix and put fouine's auth in front of it
(the trap #167 names is real: Mastra publishes its own routes). Do not route the
dashboard chat through Hono to get Studio — run Studio against the same agent
registry without putting it in the chat request path.

## Diff footprint

- `apps/server/package.json`: +`@mastra/core@1.82.0`, +`@mastra/ai-sdk@1.11.3`.
- `apps/server/src/chat/index.ts`: tool definitions and model construction moved
  out; validation, limits and `textOnly` unchanged; delegates the run.
- `apps/server/src/chat/model.ts` (new): gateway/mock model builder.
- `apps/server/src/mastra/tools.ts`, `apps/server/src/mastra/chat.ts` (new).
- `apps/web/`: **no changes**.
- `/build`: **no changes**.
