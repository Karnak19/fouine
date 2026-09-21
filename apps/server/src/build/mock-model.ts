import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

// Same trick, and the same reason, as src/chat/mock-model.ts: without an
// opencode API key the /build page cannot render a single element, so the
// streaming states that only exist DURING a run — datasets landing before the
// layout, a chart sitting in its skeleton, the cap note — are unlookable-at.
//
// The tool calls below are real: they run `add_dataset` against the real
// readonly worker on the real database. Only the brain is scripted. And the
// same models drive the server tests, which is what keeps the script honest.

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;

const USAGE = {
  inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 400, text: 400, reasoning: 0 },
};

function deltas(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

// Two datasets that return rows on ANY database, empty or not — a fresh dev DB
// has no reviews, and a mock whose charts are all empty states teaches nothing.
// COUNT(CASE ...) is 0 rather than NULL on an empty table; SUM would be NULL
// and refused.
export const MOCK_TOTALS_SQL =
  "SELECT COUNT(*) AS reviews, COUNT(DISTINCT repo_full_name) AS repos FROM reviews";

export const MOCK_STATUS_SQL =
  "SELECT 'completed' AS status, COUNT(CASE WHEN status = 'completed' THEN 1 END) AS reviews FROM reviews " +
  "UNION ALL SELECT 'failed', COUNT(CASE WHEN status = 'failed' THEN 1 END) FROM reviews " +
  "UNION ALL SELECT 'running', COUNT(CASE WHEN status = 'running' THEN 1 END) FROM reviews";

const DATASETS = [
  {
    id: "ds-1",
    input: { key: "totals", title: "Review totals", sql: MOCK_TOTALS_SQL, shape: "value" as const },
  },
  {
    id: "ds-2",
    input: {
      key: "by_status",
      title: "Reviews by status",
      sql: MOCK_STATUS_SQL,
      shape: "bar" as const,
      x: "status",
      y: "reviews",
    },
  },
];

function toolCallStep(n: number): StreamPart[] {
  const { id, input } = DATASETS[n]!;
  const json = JSON.stringify(input);
  return [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: `mock-data-${n}`, modelId: "build-mock", timestamp: new Date() },
    { type: "tool-input-start", id, toolName: "add_dataset" },
    ...deltas(json, 32).map((delta): StreamPart => ({ type: "tool-input-delta", id, delta })),
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName: "add_dataset", input: json },
    { type: "finish", finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: USAGE },
  ];
}

function doneStep(): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "mock-data-done", modelId: "build-mock", timestamp: new Date() },
    { type: "text-start", id: "t0" },
    { type: "text-delta", id: "t0", delta: "Datasets fetched." },
    { type: "text-end", id: "t0" },
    { type: "finish", finishReason: { unified: "stop" as const, raw: "stop" }, usage: USAGE },
  ];
}

/** Step one's brain: two `add_dataset` calls, then stop. */
export function createBuildDataMockModel(): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    provider: "build-mock",
    modelId: "build-mock",
    doStream: async () => {
      const n = call++;
      return {
        stream: simulateReadableStream({
          chunks: n < DATASETS.length ? toolCallStep(n) : doneStep(),
          initialDelayInMs: 120,
          chunkDelayInMs: 8,
        }),
      };
    },
  });
}

// The layout the mock composes: a heading, two stat tiles and a bar chart, all
// referencing the two datasets above by key. Every prop is a name — there is
// not one number in here, which is exactly the property the real prompt asks
// the real model for.
export const MOCK_LAYOUT_YAML = `\`\`\`yaml-spec
root: page
elements:
  page:
    type: Stack
    props:
      gap: normal
    children:
      - heading
      - tiles
      - status_chart
  heading:
    type: Text
    props:
      content: Review activity
      variant: heading
    children: []
  tiles:
    type: Grid
    props:
      columns: 2
    children:
      - tile_reviews
      - tile_repos
  tile_reviews:
    type: StatTile
    props:
      label: Reviews
      data: totals
      column: reviews
      unit: count
    children: []
  tile_repos:
    type: StatTile
    props:
      label: Repositories
      data: totals
      column: repos
      unit: count
    children: []
  status_chart:
    type: BarChart
    props:
      title: Reviews by status
      data: by_status
      x: status
      y: reviews
    children: []
\`\`\`
`;

/** Step two's brain: one YAML spec fence, streamed line by line. */
export function createBuildLayoutMockModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "build-mock",
    modelId: "build-mock",
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "response-metadata",
            id: "mock-layout",
            modelId: "build-mock",
            timestamp: new Date(),
          },
          { type: "text-start", id: "spec" },
          // Chunked by LINE, not by character: the YAML compiler parses what it
          // has on every push, and a half-written key is the case it has to
          // tolerate — which is what makes this a real test of progressive
          // rendering rather than one big final parse.
          ...MOCK_LAYOUT_YAML.split("\n").map(
            (line): StreamPart => ({ type: "text-delta", id: "spec", delta: `${line}\n` }),
          ),
          { type: "text-end", id: "spec" },
          { type: "finish", finishReason: { unified: "stop" as const, raw: "stop" }, usage: USAGE },
        ] as StreamPart[],
        initialDelayInMs: 120,
        chunkDelayInMs: 8,
      }),
    }),
  });
}
