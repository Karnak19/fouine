import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { config } from "~/config";
import { resolveApiKey } from "~/settings";
import { runStatsQuery } from "~/chat/query";
import { buildChart } from "~/chat/chart";
import { CHAT_SYSTEM_PROMPT } from "~/chat/prompt";
import { chatMockEnabled, createChatMockModel } from "~/chat/mock-model";

// The opencode-go (Zen) inference endpoint. Per
// https://opencode.ai/docs/go/#endpoints the gateway serves
// `<base>/chat/completions`, and the provider registry the local opencode
// server exposes declares this model family with `npm: "@ai-sdk/openai-compatible"`
// — which is why that adapter is the right one here.
//
// Caveat worth knowing before changing the default model: the gateway is NOT
// uniformly OpenAI-shaped. Individual models declare which SDK they need, and a
// few want @ai-sdk/anthropic instead. A model that declares the Anthropic shape
// will not work through this adapter, so check the SDK a model declares before
// making it the repo default (currently opencode-go/mimo-v2.5 for chat,
// opencode-go/deepseek-v4-flash for reviews).
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

/**
 * The ONE place model specs are converted.
 *
 *  - This repo (and opencode's own config) stores `opencode-go/mimo-v2.5`
 *    — provider id, slash, model id.
 *  - The gateway is already provider-scoped by its base URL, so on the wire it
 *    wants the BARE model id: `mimo-v2.5`.
 *
 * Leaving the prefix on fails at request time with an unhelpful upstream error
 * that no typecheck and no stubbed test would catch.
 */
export function wireModelId(spec: string): string {
  const slash = spec.indexOf("/");
  return slash === -1 ? spec : spec.slice(slash + 1);
}

/** The tools the chat agent gets. Read-only, guarded, no GitHub access. */
const queryStats = tool({
  description:
    "Run one read-only SQL SELECT against fouine's review database and get the rows back as JSON. " +
    "This is the ONLY way to answer questions about reviews, findings, cost, latency or repositories — " +
    "never answer from memory or guess at numbers. Prefer aggregating in SQL (COUNT, SUM, AVG, GROUP BY). " +
    "If a query is rejected or errors, read the message and try a corrected query.",
  inputSchema: z.object({
    sql: z
      .string()
      .describe("A single SQLite SELECT (or WITH ... SELECT) statement, no trailing semicolon needed."),
  }),
  execute: async ({ sql }, { abortSignal }) => {
    // Guarding and execution both stay in src/chat/query.ts. The caller changed
    // from an opencode subprocess to an in-process tool; the guard did not, and
    // must not be reimplemented or relaxed here.
    const out = await runStatsQuery(sql, abortSignal);
    return out.ok ? `${out.rowCount} row(s) in ${out.ms}ms\n${out.text}` : out.text;
  },
});

/**
 * Draw a chart. Runs its OWN SQL rather than reusing the last `query_stats`
 * result: a tool cannot see another tool's output, and threading rows through
 * the model would mean the model retyping them — the one way numbers get
 * invented. The cost is a second query; the gain is that what is drawn came
 * straight out of the database.
 *
 * Unlike `query_stats` this returns a structured object, not a string. The
 * frontend tool card needs the rows and the spec to draw; the model gets the
 * same object and quotes its numbers from there.
 */
const renderChart = tool({
  description:
    "Run one read-only SQL SELECT and render the result as a chart in the answer. " +
    "Use this when the SHAPE of the data is the answer — a trend over time, a ranking, a composition — " +
    "not when the answer is a single number. `line` for change over time, `bar` for magnitude or ranking, " +
    "`stacked_bar` for composition (needs `series`). The SQL must return one column for the x axis, " +
    "one numeric column for the measure, and optionally one to split into series. " +
    "Quote your numbers from THIS tool's rows, not from a separate query_stats call, so the prose and the chart agree. " +
    "If it returns an error, read it — it lists the columns your query actually returned — and retry once.",
  inputSchema: z.object({
    sql: z
      .string()
      .describe("A single SQLite SELECT (or WITH ... SELECT) statement, no trailing semicolon needed."),
    type: z.enum(["line", "bar", "stacked_bar"]).describe("The chart form."),
    title: z.string().describe("A short title stating what the chart shows."),
    x: z.string().describe("Name of the result column for the category or time axis."),
    y: z.string().describe("Name of the result column holding the numeric measure."),
    series: z
      .string()
      .optional()
      .describe("Name of the result column that splits the data into series. Required for stacked_bar."),
  }),
  execute: async (input, { abortSignal }) => buildChart(input, abortSignal),
});

/**
 * Keep only what the user actually typed.
 *
 * The browser posts the whole conversation back on each turn, and none of it is
 * trustworthy. Two distinct forgeries matter:
 *
 *  - a fabricated `output-available` tool part full of invented rows, which
 *    convertToModelMessages would hand to the model as a genuine query result;
 *  - a fabricated ASSISTANT message — plain prose asserting "repo X cost
 *    $999999" — which a later turn would treat as its own prior answer and
 *    build on.
 *
 * Both end with the model stating numbers that never came from SQL, which is
 * the one promise this feature makes. So assistant history is not accepted from
 * the client at all: only user turns survive, and every answer is recomputed
 * from a fresh query. The cost is that the model cannot see its own previous
 * replies; it can always re-query, and the data is fresher for it.
 */
function textOnly(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => ({
      ...m,
      parts: (m.parts ?? []).filter((p) => p.type === "text"),
    }))
    .filter((m) => m.parts.length > 0);
}

export { textOnly };

/**
 * Stream one chat turn as an AI SDK UI message stream.
 *
 * Deliberately does NOT touch the reviews table: chat runs are not reviews, and
 * writing them there would fold chat cost and tokens into every stat on the
 * dashboard. Nothing is persisted — the thread lives in the browser.
 */
// Bounds on what one request may carry. The browser posts the whole thread back
// every turn, and nothing stops a caller posting a hundred thousand of them: the
// cost is paid upstream in tokens, on a key that is not free.
export const MAX_TURNS = 40;
export const MAX_QUESTION_CHARS = 4_000;
export const MAX_PARTS_PER_MESSAGE = 64;

export async function streamChat(
  rawMessages: UIMessage[],
  signal?: AbortSignal,
): Promise<Response> {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new Error("No question to answer.");
  }
  // Keep the most recent turns: the tail is the conversation, the head is
  // history the model no longer needs (it re-queries anyway).
  const messages = textOnly(rawMessages).slice(-MAX_TURNS);
  if (messages.length === 0) throw new Error("No question to answer.");
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "text" && p.text.length > MAX_QUESTION_CHARS) {
        throw new Error(`Question too long — keep it under ${MAX_QUESTION_CHARS} characters.`);
      }
    }
  }
  // Dev escape hatch: with CHAT_MOCK=1 (never in production) the gateway is
  // replaced by a scripted model so the chat UI can be built and looked at
  // without an API key. Everything below this line is the real pipeline.
  const mock = chatMockEnabled();
  if (mock) {
    console.warn("[chat] CHAT_MOCK=1 — answering with the scripted mock model, no upstream call");
  }

  const apiKey = mock ? "mock" : resolveApiKey();
  if (!apiKey) {
    // Surfaced as a normal assistant-side error rather than a 500, so the UI
    // renders it as a message in the thread.
    throw new Error("No opencode API key configured — set one in Settings.");
  }

  const gateway = createOpenAICompatible({
    name: "opencode-go",
    baseURL: OPENCODE_GO_BASE_URL,
    apiKey,
  });

  const result = streamText({
    // Chat deliberately does NOT follow the dashboard's `opencode_model` setting —
    // it's a cheap high-volume workload on its own env-only knob.
    model: mock ? createChatMockModel() : gateway(wireModelId(config.chat.model)),
    system: CHAT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { query_stats: queryStats, render_chart: renderChart },
    // The model needs at least two steps for the normal shape of an answer:
    // one to run the query, one to read the rows and reply. A few more allow it
    // to correct a rejected or malformed query without giving up. Six still
    // covers the longest normal run now that charts exist — query, chart, prose
    // is three, and that leaves three retries for a rejected or mis-columned
    // query. Worth revisiting only if a third tool lands.
    stopWhen: stepCountIs(6),
    // The browser hanging up must stop the upstream run too, or a closed tab
    // leaves the model (and its tool calls) burning tokens to nobody.
    abortSignal: signal,
  });

  return result.toUIMessageStreamResponse({
    // Without this the client sees a generic "An error occurred"; the whole
    // point is that a rejected query or a model failure reads as a message.
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
