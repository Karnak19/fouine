import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { resolveApiKey, resolveChatModel } from "~/settings";
import { codemodeTool } from "~/chat/codemode";
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
// making it the repo default (currently opencode-go/deepseek-v4.1-flash for chat,
// opencode-go/deepseek-v4-flash for reviews). The same caveat applies to the
// Chat model the dashboard's /settings page stores (`chat_model`, resolved by
// resolveChatModel: setting → OPENCODE_CHAT_MODEL → default).
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

/**
 * The ONE place model specs are converted.
 *
 *  - This repo (and opencode's own config) stores `opencode-go/deepseek-v4.1-flash`
 *    — provider id, slash, model id.
 *  - The gateway is already provider-scoped by its base URL, so on the wire it
 *    wants the BARE model id: `deepseek-v4.1-flash`.
 *
 * Leaving the prefix on fails at request time with an unhelpful upstream error
 * that no typecheck and no stubbed test would catch.
 */
export function wireModelId(spec: string): string {
  const slash = spec.indexOf("/");
  return slash === -1 ? spec : spec.slice(slash + 1);
}

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
  chatId?: string,
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

  // OpenCode Go requires one stable x-opencode-session per conversation
  // (requests without it may error from 2026-09-06). useChat's thread id is
  // exactly that; the first message id is the fallback for older clients.
  const session = chatId ?? rawMessages[0]?.id ?? crypto.randomUUID();
  const gateway = createOpenAICompatible({
    name: "opencode-go",
    baseURL: OPENCODE_GO_BASE_URL,
    apiKey,
    headers: { "x-opencode-session": session },
  });

  const result = streamText({
    // Chat deliberately does NOT follow the dashboard's `opencode_model` setting —
    // it's a cheap high-volume workload on its own env-only knob.
    model: mock ? createChatMockModel() : gateway(wireModelId(resolveChatModel())),
    system: CHAT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { codemode: codemodeTool },
    // One tool now, and a whole program per call: the normal answer is one
    // codemode step (query + chart + aggregation together) and one to write the
    // prose. The rest is room to fix a program that errored or a query that was
    // rejected. Four covers that; a model that needs more is looping.
    stopWhen: stepCountIs(4),
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
