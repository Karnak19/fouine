import type { MastraModelConfig, OpenAICompatibleConfig } from "@mastra/core/llm";
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
 * `/build` and chat share the same gateway and the same model knob.
 *
 * Returned as Mastra's `OpenAICompatibleConfig` rather than an AI SDK model
 * instance: `url` is the BASE url (Mastra appends the chat-completions path
 * itself), `id` is the router id `provider/model`, and the resolver passes the
 * bare model id to the adapter — the same `wireModelId` rule the AI SDK path
 * applied. Passing the config is also why the real model needs no cast: it is
 * already one of Mastra's own resolved model inputs.
 *
 * `headers` ride on every request, which is how `x-opencode-session` still
 * reaches the gateway (one stable value per conversation).
 */
export function openAICompatibleConfig(session: string): OpenAICompatibleConfig {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error("No opencode API key configured — set one in Settings.");
  }
  const spec = resolveChatModel();
  // Mastra's config id is `provider/model`; a bare spec (a dashboard value
  // someone stripped the prefix off) is scoped to the gateway provider here so
  // the router still parses it, and only the model id reaches the wire.
  const id = (spec.includes("/") ? spec : `opencode-go/${spec}`) as `${string}/${string}`;
  return {
    id,
    url: OPENCODE_GO_BASE_URL,
    apiKey,
    headers: { "x-opencode-session": session },
  };
}

/**
 * Build the model for ONE chat request.
 *
 * Called from the Mastra agent's model resolver, so `resolveChatModel()` runs
 * per request and a dashboard model change needs no restart. `session` is the
 * conversation's `x-opencode-session`; the gateway wants one stable value per
 * conversation. With `CHAT_MOCK=1` the scripted model replaces the gateway and
 * no key is read at all.
 */
export function buildChatModel(session: string, mock = chatMockEnabled()): MastraModelConfig {
  // The mock is a plain AI SDK model, not a gateway config. Mastra wraps AI SDK
  // model instances itself, but the two `LanguageModelV4` declarations come
  // from different @ai-sdk/provider copies, so the object needs a cast at the
  // type level only. `ponytail:` this is the one remaining model cast; the
  // upgrade path is a Mastra mock model or a shared provider type, neither of
  // which exists in 1.82.0.
  if (mock) return createChatMockModel() as unknown as MastraModelConfig;

  return openAICompatibleConfig(session);
}
