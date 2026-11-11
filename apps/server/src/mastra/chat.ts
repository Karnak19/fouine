import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { toAISdkStream } from "@mastra/ai-sdk";
import { CHAT_SYSTEM_PROMPT } from "~/chat/prompt";
import { buildChatModel } from "~/chat/model";
import { log } from "~/server/log";
import { queryStatsTool, renderChartTool } from "./tools";

// Request-context keys, private to this module. The model resolver below reads
// them; `streamChatViaAgent` writes the session before the run starts.
const MODEL_KEY = "fouine.chat.model";
const SESSION_KEY = "fouine.chat.session";

/**
 * The fouine chat agent.
 *
 * A single instance, exactly like the old single `streamText` call site: chat
 * has no memory (the thread lives in the browser) and no per-request state
 * beyond the model and the session header, both carried in the request context.
 *
 * `model` is a FUNCTION on purpose. `resolveChatModel()` must be re-read on
 * every request so a dashboard model change needs no restart, and the
 * `x-opencode-session` header is per conversation. Building the model here (and
 * memoising it on the request context, since Mastra may ask once per step)
 * keeps both. With `CHAT_MOCK=1` the same resolver returns the scripted model.
 */
export const chatAgent = new Agent({
  id: "chat",
  name: "fouine chat",
  instructions: CHAT_SYSTEM_PROMPT,
  model: ({ requestContext }) => {
    const cached = requestContext.getRaw(MODEL_KEY) as MastraModelConfig | undefined;
    if (cached) return cached;
    const model = buildChatModel(String(requestContext.getRaw(SESSION_KEY) ?? ""));
    // The spike's evidence for check #4: this line is re-emitted per request,
    // with the model id `resolveChatModel()` returned for THIS request. The
    // gateway path is a config object, so its router id is the thing to log;
    // the mock is an instance and carries `modelId`.
    log.debug("chat model resolved", {
      model:
        (model as { id?: string }).id ??
        (model as { modelId?: string }).modelId ??
        "unknown",
    });
    requestContext.setRaw(MODEL_KEY, model);
    return model;
  },
  tools: { query_stats: queryStatsTool, render_chart: renderChartTool },
});

/**
 * Stream one sanitised chat turn through the Mastra agent, as the same AI SDK
 * v7 UI message stream the browser already consumes.
 *
 * The caller (`~/chat/index.ts`) has already applied `textOnly` and the
 * per-message limits; this function only owns the run.
 */
export async function streamChatViaAgent(
  messages: UIMessage[],
  session: string,
  signal?: AbortSignal,
): Promise<Response> {
  const requestContext = new RequestContext();
  requestContext.setRaw(SESSION_KEY, session);

  const stream = await chatAgent.stream(messages, {
    requestContext,
    abortSignal: signal,
    // Same budget as the AI SDK version's `stepCountIs(6)`: query, chart,
    // prose is three steps, leaving three retries for a rejected query.
    // `maxSteps` rather than `stopWhen`: Mastra's stop-condition type is tied
    // to its vendored AI SDK copy and does not accept ours structurally.
    maxSteps: 6,
  });

  const uiMessageStream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      for await (const part of toAISdkStream(stream, {
        from: "agent",
        // The client is assistant-ui on AI SDK v7; without this the emitted
        // chunk contract is the v5 one and `useChatRuntime` cannot read it.
        version: "v7",
        // The mock model streams reasoning and the real one may; the old route
        // surfaced it, and the thread renders those parts.
        sendReasoning: true,
      })) {
        // Mastra's vendored AI SDK copy types `finishReason` with one extra
        // member ("interrupted") than the app's `ai`. Same chunk on the wire;
        // the cast is the type-level consequence of two package instances.
        await writer.write(part as Parameters<typeof writer.write>[0]);
      }
    },
    // Without this the client sees a generic "An error occurred"; the whole
    // point is that a rejected query or a model failure reads as a message.
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });

  return createUIMessageStreamResponse({ stream: uiMessageStream });
}
