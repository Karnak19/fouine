import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

// The stream-part union (`text-delta`, `tool-call`, `finish`, …) as the
// installed provider spec defines it. Read off the mock's own `doStream` rather
// than imported from @ai-sdk/provider: that package is a transitive dependency
// here, not a declared one, and this keeps the shapes pinned to whatever
// version `ai` actually resolves.
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;

/**
 * A fake model that streams a scripted answer, for developing the chat UI.
 *
 * The chat page cannot be worked on without an opencode API key: `streamChat`
 * refuses the turn and the thread never renders a single token. That makes the
 * parts of the UI that only exist DURING a stream — auto-scroll, the
 * scroll-to-bottom button, the sticky composer once the thread is non-empty,
 * reasoning blocks, the tool card — impossible to look at, let alone verify.
 *
 * So: same `streamText` call, same system prompt, same `query_stats` and
 * `render_chart` tools, same multi-step loop — only the model is swapped. The
 * tool calls it emits are real and run against the real SQLite database, so
 * what you see on screen is the actual pipeline with a scripted brain rather
 * than a mocked-out pipeline.
 *
 * Off unless `CHAT_MOCK=1`, and refused outright in production (see
 * `chatMockEnabled`).
 */

/** The dev flag, deliberately unavailable in production whatever the env says. */
export function chatMockEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.CHAT_MOCK === "1";
}

// An aggregate that returns exactly one row on any database, empty or not, so
// the tool card always has real rows to render. It is also a fair question to
// ask the real agent, which keeps the script honest.
const MOCK_SQL =
  "SELECT COUNT(*) AS reviews, COUNT(DISTINCT repo_full_name) AS repos, " +
  "SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed, " +
  "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM reviews";

const FIRST_REASONING =
  "The question is about review volume, and the rule is that no number may come " +
  "from memory — it has to come out of SQL. The reviews table has one row per " +
  "run with a status column, so a single aggregate over it gives the total, the " +
  "number of distinct repositories and the completed/failed split in one pass. " +
  "No GROUP BY: I want one row back, not one per status.";

// The chart the mock draws, and the one constraint that shaped it: a local dev
// database is usually EMPTY, and a `GROUP BY status` over an empty table
// returns zero rows — which `render_chart` correctly refuses to plot, leaving
// the chart card unverifiable exactly when you most need to look at it. So the
// status breakdown is built as one row per status with `COUNT(CASE ...)`, which
// is 0 rather than NULL on an empty table (`SUM` would give NULL and be
// refused). Three bars at zero on a fresh DB, real counts once reviews exist.
const MOCK_CHART_SQL =
  "SELECT 'completed' AS status, COUNT(CASE WHEN status = 'completed' THEN 1 END) AS reviews FROM reviews " +
  "UNION ALL SELECT 'failed', COUNT(CASE WHEN status = 'failed' THEN 1 END) FROM reviews " +
  "UNION ALL SELECT 'running', COUNT(CASE WHEN status = 'running' THEN 1 END) FROM reviews";

const CHART_REASONING =
  "The totals are back, but a completed/failed split is a shape rather than a " +
  "single number, so it reads better as a chart than as a sentence. A bar per " +
  "status, counted in the same pass — and the numbers I quote afterwards come " +
  "from the chart's own rows, so the prose and the picture cannot disagree.";

const SECOND_REASONING =
  "The rows are back. Now I read them off rather than restating what I expected " +
  "to find, and I say plainly where the numbers came from so the answer can be " +
  "checked against the query above it.";

// Long on purpose: the answer has to be taller than a phone screen for
// auto-scroll and the sticky composer to actually be exercised, and it carries
// a fenced code block so the markdown/Shiki path runs too.
const ANSWER = `Here is what the database actually says, straight from the aggregate above — and the chart shows the same split, drawn from its own query so the two cannot drift apart.

### Review volume

The \`reviews\` table is the single source of truth for run counts — one row per
review, written when the webhook accepts the pull request and updated when the
run finishes. The aggregate returns four numbers in one pass:

- **reviews** — every run ever recorded, whatever its outcome.
- **repos** — how many distinct repositories those runs are spread across.
- **completed** — runs that reached the end and posted a review to GitHub.
- **failed** — runs that ended in an error and posted nothing.

### How to read the split

A completed run is not the same thing as a run that found something. A review
can finish cleanly and post an approval with zero inline findings; that still
counts as completed. If you want the findings side of the picture, that lives in
a different table (\`findings\`, one row per posted comment) and needs its own
query — joining the two is the usual way to ask "how many findings per review".

The failure count is worth watching over time rather than in absolute terms. A
handful of failures on a busy day is normal — a clone timing out, a rate limit,
a pull request that closed mid-run. A failure rate that climbs steadily is the
signal that something structural broke.

### The query behind these numbers

\`\`\`sql
SELECT
  COUNT(*)                                              AS reviews,
  COUNT(DISTINCT repo_full_name)                        AS repos,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
  SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed
FROM reviews;
\`\`\`

Everything is aggregated in SQL rather than pulled back row by row and counted
here — that is deliberate. Reviews accumulate forever, and a query that returns
every row would eventually return tens of thousands of them, all of which would
have to fit in the model's context before a single number could be reported.

### What to ask next

A few follow-ups that stay within the same table and are cheap to answer:

1. **Per repository** — add \`GROUP BY repo_full_name\` and order by the count to
   see which repositories actually keep the reviewer busy.
2. **Over time** — bucket \`created_at\` by day with
   \`date(created_at, 'unixepoch')\` and you get a trend rather than a total.
3. **Latency** — \`completed_at - created_at\` on completed rows is the wall-clock
   duration of a run; averaging it says whether reviews are getting slower.
4. **Cost** — the per-run token and cost columns live on the same table, so the
   same shape of aggregate answers "what did last week cost".

### One caveat

Rows are only ever written by the webhook path. A review triggered by hand
outside the app, or one from before the column you are aggregating on existed,
will either be missing or carry a NULL. \`SUM\` skips NULLs silently and \`COUNT(*)\`
does not, which is exactly the kind of quiet mismatch that makes two numbers on
the same dashboard disagree. When a total looks off by a little, that is the
first thing to check.
`;

/** Split a string into small chunks so the stream is visibly incremental. */
function deltas(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const USAGE = {
  inputTokens: { total: 1_200, noCache: 1_200, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 600, text: 500, reasoning: 100 },
};

/** Step one: think, then call the real tool. */
function toolCallStep(): StreamPart[] {
  const input = JSON.stringify({ sql: MOCK_SQL });
  return [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "mock-1", modelId: "chat-mock", timestamp: new Date() },
    { type: "reasoning-start", id: "r1" },
    ...deltas(FIRST_REASONING, 24).map(
      (delta): StreamPart => ({ type: "reasoning-delta", id: "r1", delta }),
    ),
    { type: "reasoning-end", id: "r1" },
    { type: "tool-input-start", id: "call-1", toolName: "query_stats" },
    ...deltas(input, 32).map(
      (delta): StreamPart => ({ type: "tool-input-delta", id: "call-1", delta }),
    ),
    { type: "tool-input-end", id: "call-1" },
    { type: "tool-call", toolCallId: "call-1", toolName: "query_stats", input },
    { type: "finish", finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: USAGE },
  ];
}

/** Step two: think, then draw the chart from its own query. */
function chartStep(): StreamPart[] {
  const input = JSON.stringify({
    sql: MOCK_CHART_SQL,
    type: "bar",
    title: "Reviews by status",
    x: "status",
    y: "reviews",
  });
  return [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "mock-2", modelId: "chat-mock", timestamp: new Date() },
    { type: "reasoning-start", id: "rc" },
    ...deltas(CHART_REASONING, 24).map(
      (delta): StreamPart => ({ type: "reasoning-delta", id: "rc", delta }),
    ),
    { type: "reasoning-end", id: "rc" },
    { type: "tool-input-start", id: "call-2", toolName: "render_chart" },
    ...deltas(input, 32).map(
      (delta): StreamPart => ({ type: "tool-input-delta", id: "call-2", delta }),
    ),
    { type: "tool-input-end", id: "call-2" },
    { type: "tool-call", toolCallId: "call-2", toolName: "render_chart", input },
    { type: "finish", finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: USAGE },
  ];
}

/** Step three: think again, then the long answer. Ends the run. */
function answerStep(): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "mock-2", modelId: "chat-mock", timestamp: new Date() },
    { type: "reasoning-start", id: "r2" },
    ...deltas(SECOND_REASONING, 24).map(
      (delta): StreamPart => ({ type: "reasoning-delta", id: "r2", delta }),
    ),
    { type: "reasoning-end", id: "r2" },
    { type: "text-start", id: "t1" },
    ...deltas(ANSWER, 18).map(
      (delta): StreamPart => ({ type: "text-delta", id: "t1", delta }),
    ),
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop" as const, raw: "stop" }, usage: USAGE },
  ];
}

/**
 * Build the mock model for ONE request.
 *
 * `stopWhen: stepCountIs(6)` means the model is called again after each tool
 * result comes back, so the script is per-call: query, then chart, then the
 * answer — and every later call answers and finishes. Without that the run
 * would ask for the same query over and over until the step budget ran out.
 */
export function createChatMockModel(): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    provider: "chat-mock",
    modelId: "chat-mock",
    doStream: async () => {
      const n = call++;
      const step = n === 0 ? toolCallStep() : n === 1 ? chartStep() : answerStep();
      return {
        stream: simulateReadableStream({
          chunks: step,
          initialDelayInMs: 250,
          chunkDelayInMs: 12,
        }),
      };
    },
  });
}
