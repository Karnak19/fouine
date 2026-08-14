import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { resolveApiKey, resolveDefaultModel } from "~/settings";
import { runStatsQuery } from "~/chat/query";
import { CHAT_SYSTEM_PROMPT } from "~/chat/prompt";

// The opencode-go (Zen) inference endpoint. Per
// https://opencode.ai/docs/go/#endpoints the gateway serves
// `<base>/chat/completions`, and the provider registry the local opencode
// server exposes declares this model family with `npm: "@ai-sdk/openai-compatible"`
// — which is why that adapter is the right one here.
//
// Caveat worth knowing before changing the default model: the gateway is NOT
// uniformly OpenAI-shaped. Individual models declare which SDK they need, and a
// few want @ai-sdk/anthropic instead. A model that declares the Anthropic shape
// will not work through this adapter. The repo default (opencode-go/glm-5.2)
// declares openai-compatible.
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

/**
 * The ONE place model specs are converted.
 *
 *  - This repo (and opencode's own config) stores `opencode-go/glm-5.2` —
 *    provider id, slash, model id.
 *  - The gateway is already provider-scoped by its base URL, so on the wire it
 *    wants the BARE model id: `glm-5.2`.
 *
 * Leaving the prefix on fails at request time with an unhelpful upstream error
 * that no typecheck and no stubbed test would catch.
 */
export function wireModelId(spec: string): string {
  const slash = spec.indexOf("/");
  return slash === -1 ? spec : spec.slice(slash + 1);
}

/** The single tool the chat agent gets. Read-only, guarded, no GitHub access. */
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
  execute: async ({ sql }) => {
    // Guarding and execution both stay in src/chat/query.ts. The caller changed
    // from an opencode subprocess to an in-process tool; the guard did not, and
    // must not be reimplemented or relaxed here.
    const out = runStatsQuery(sql);
    return out.ok ? `${out.rowCount} row(s) in ${out.ms}ms\n${out.text}` : out.text;
  },
});

/**
 * Stream one chat turn as an AI SDK UI message stream.
 *
 * Deliberately does NOT touch the reviews table: chat runs are not reviews, and
 * writing them there would fold chat cost and tokens into every stat on the
 * dashboard. Nothing is persisted — the thread lives in the browser.
 */
export async function streamChat(messages: UIMessage[]): Promise<Response> {
  const apiKey = resolveApiKey();
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
    model: gateway(wireModelId(resolveDefaultModel())),
    system: CHAT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { query_stats: queryStats },
    // The model needs at least two steps for the normal shape of an answer:
    // one to run the query, one to read the rows and reply. A few more allow it
    // to correct a rejected or malformed query without giving up.
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse({
    // Without this the client sees a generic "An error occurred"; the whole
    // point is that a rejected query or a model failure reads as a message.
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
