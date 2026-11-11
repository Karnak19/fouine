import type { UIMessage } from "ai";
import { resolveApiKey } from "~/settings";
import { chatMockEnabled } from "~/chat/mock-model";
import { streamChatViaAgent } from "~/mastra/chat";

// Kept here because `~/build` and `~/merge/assess` import them from `~/chat`;
// the definitions moved to `~/chat/model.ts` so the Mastra agent could use them
// without a circular import.
export { OPENCODE_GO_BASE_URL, wireModelId } from "~/chat/model";

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
  } else if (!resolveApiKey()) {
    // Surfaced as a normal assistant-side error rather than a 500, so the UI
    // renders it as a message in the thread.
    throw new Error("No opencode API key configured — set one in Settings.");
  }

  // OpenCode Go requires one stable x-opencode-session per conversation
  // (requests without it may error from 2026-09-06). useChat's thread id is
  // exactly that; the first message id is the fallback for older clients.
  const session = chatId ?? rawMessages[0]?.id ?? crypto.randomUUID();

  return streamChatViaAgent(messages, session, signal);
}
