# fouine review guidelines

## Findings that land

### Dead data
If a field is fetched/computed, typed, and returned — but nothing reads it — flag it for removal. Trace the full pipeline: SQL → API response → frontend type → component render. If any stage has no consumer, the upstream stages are dead weight. (PR #35: `latency.max`)

### No-op conditions
If a filter/guard always evaluates to truthy (e.g. `|| r.state` where `state` is never missing), it's a no-op. Remove it — the condition is misleading and the code is clearer without it. (PR #22: review state filter)

### Documentation accuracy
Env var names, config keys, and behavioral descriptions in AGENTS.md / README / docs must match the actual code. A wrong name means agents (and humans) set the wrong vars and things silently fail. Cross-check against `config.ts`, `.env.example`, and the Dockerfile. (PR #33: `GITHUB_CLIENT_ID` vs `GITHUB_APP_CLIENT_ID`)

### Grid layout half-width bugs
When using `lg:grid-cols-2` (or similar responsive grids), a single child in a two-column grid sits in the left column with the right empty. If the grid wraps content that may be conditionally absent, ensure the remaining child spans full width (`lg:col-span-2`) or split the guard so the grid only renders when both sides have content. (PR #39: Running Now section)

### Service worker offline fallback
When hand-rolling a service worker, verify the offline navigation fallback actually works: (1) navigations must be cached (not just fetched), (2) the fallback cache key must match how the server serves the file (e.g. `/` not `/index.html` if the server uses `indexHTML: true`). Dead fallback code is worse than no fallback — it gives false confidence. (PR #31)

## Patterns to catch

### Conditional initialization
If a service is guarded at all usage sites by a config check (e.g. `config.auth.enabled`), the construction itself must also be guarded. Unconditional construction at module top-level can throw during boot if the service validates its own config (e.g. `betterAuth()` throwing `BetterAuthError` when no secret is set). Guard the constructor, not just the call-sites. (PR #33)

### Single-caller functions
If a function has exactly one caller and its body is short, inline it. The indirection adds a lookup and a test that verifies JS equality — no value. Exception: if the function is a named boundary for testing or documentation, keep it. (PR #27: `idsForKey`)

### Test updates with refactoring
When moving code between files or extracting a new module, check that existing tests still assert the right thing. Tests that assert on the old location's content (e.g. "DEFAULT_PROMPT contains X") break silently when the content moves. Either update the test to point at the new location, or delete it if the contract is now owned by a different artifact (e.g. an agent file). Also: if a new wiring field is added (e.g. `agent: "fouine"`), add a test that captures the mock args and asserts the field is passed. (PR #21)

### Whitespace churn
Don't mix formatting changes (array reformatting, indentation) with functional changes. If the repo has no formatter configured, the original formatting stands. A ~25-line whitespace diff obscures the ~5 lines that matter. Revert formatting-only hunks. (PR #29: tsconfig.json)

## Edge cases

### Marker / state advancement on failure
If a pipeline advances a "last processed" marker after a step that could fail (e.g. a GitHub API call), the failure is silent and the user is stuck — re-running skips the same threads. Either don't advance the marker on failure, or provide a force/reset path that ignores the marker. (PR #43: improve pipeline marker)

### Abort signal reason
When handling `AbortSignal.aborted`, check `signal.reason` to distinguish "superseded by a newer run" from "stopped by user". Reporting the wrong message misleads the dashboard. Match the branching pattern already established in the sibling pipeline. (PR #43: improvePipeline vs reviewPipeline)

## Tool directory constraints

Files in `opencode-config/tools/` are auto-discovered as tools — only files whose default export is `tool(...)` are registered. Helper modules (like `_ctx.ts`) are fine as long as they don't have a default tool export. Don't suggest moving shared code into `tools/` as a non-tool file without verifying this constraint. (PR #36)
