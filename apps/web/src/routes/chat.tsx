import { AssistantRuntimeProvider, AuiConfig, Suggestions, Tools, useAui } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import { chatToolkit } from "@/components/assistant-ui/toolkit";

// Questions worth asking that no panel answers, so an empty thread suggests
// something better than a blank box.
const SUGGESTIONS = [
  "Which repository cost the most in the last 7 days?",
  "What's the failure rate per model?",
  "Which files attract the most blocking findings?",
];

// Config is plain data, so it is built once rather than per render.
const CHAT_CONFIG = AuiConfig({ suggestions: Suggestions(SUGGESTIONS) });

export default function ChatPage() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/chat" }),
  });

  // The tool renderers, registered by name so the thread draws a query and a
  // chart instead of the generic tool fallback. `aui` and `config` are separate
  // props on the provider — the client carries the tools scope, the config the
  // suggestions — and neither replaces the other.
  const aui = useAui({ tools: Tools({ toolkit: chatToolkit }) });

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl min-w-0 flex-col">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ask about the review history. Every answer is computed by a SQL query you can inspect.
        </p>
      </div>

      <AssistantRuntimeProvider runtime={runtime} aui={aui} config={CHAT_CONFIG}>
        <div className="mt-6 min-h-0 flex-1">
          <Thread />
        </div>
      </AssistantRuntimeProvider>
    </div>
  );
}
