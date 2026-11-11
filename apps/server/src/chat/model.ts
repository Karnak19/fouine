import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { MastraLanguageModel } from "@mastra/core/agent";
import { resolveApiKey, resolveChatModel } from "~/settings";
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
 * Build the language model for ONE chat request.
 *
 * Called from the Mastra agent's model resolver, so `resolveChatModel()` runs
 * per request and a dashboard model change needs no restart. `session` is the
 * conversation's `x-opencode-session`; the gateway wants one stable value per
 * conversation. With `CHAT_MOCK=1` the scripted model replaces the gateway and
 * no key is read at all.
 */
export function buildChatModel(session: string, mock = chatMockEnabled()): MastraLanguageModel {
  // Type drift, not a runtime gap: @mastra/core's `MastraLanguageModelV4`
  // declares `doGenerate` as returning a STREAM result (it unifies generate and
  // stream internally), while a stock AI SDK provider returns a generate result
  // and a stream separately. They are the same object at runtime, and
  // `agent.stream()` only ever calls `doStream`, so the cast is safe for chat.
  // A real phase-1 PR should pass an `OpenAICompatibleConfig` object instead.
  if (mock) return createChatMockModel() as unknown as MastraLanguageModel;

  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error("No opencode API key configured — set one in Settings.");
  }

  const gateway = createOpenAICompatible({
    name: "opencode-go",
    baseURL: OPENCODE_GO_BASE_URL,
    apiKey,
    headers: { "x-opencode-session": session },
  });

  // Chat deliberately does NOT follow the dashboard's `opencode_model` setting —
  // it's a cheap high-volume workload on its own env-only knob.
  return gateway(wireModelId(resolveChatModel())) as unknown as MastraLanguageModel;
}
