import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";

// Questions worth asking that no panel answers, so an empty thread suggests
// something better than a blank box.
const SUGGESTIONS = [
  "Which repository cost the most in the last 7 days?",
  "What's the failure rate per model?",
  "Which files attract the most blocking findings?",
];

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const busy = status === "submitted" || status === "streaming";

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    void sendMessage({ text: q });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl min-w-0 flex-col">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ask about the review history. Every answer is computed by a SQL query you can inspect.
        </p>
      </div>

      <Conversation className="mt-6 min-h-0 flex-1">
        <ConversationContent className="min-w-0">
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Nothing asked yet"
              description="Pick a question or write your own."
            >
              <div className="mt-4 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          )}

          {messages.map((m) => (
            <Message from={m.role} key={m.id} className="min-w-0">
              <MessageContent className="min-w-0">
                {m.parts.map((part, i) => {
                  const key = `${m.id}-${i}`;

                  if (part.type === "text") {
                    return <MessageResponse key={key}>{part.text}</MessageResponse>;
                  }

                  // Some models on this gateway emit reasoning; render it with
                  // the component built for it rather than dumping it inline.
                  if (part.type === "reasoning") {
                    return (
                      <Reasoning key={key} className="w-full" isStreaming={busy}>
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    );
                  }

                  // The SQL, collapsed under the answer — the whole point is
                  // that a fluent answer can be checked rather than trusted.
                  if (part.type === "tool-query_stats") {
                    return (
                      <Tool key={key} className="min-w-0">
                        <ToolHeader type="tool-query_stats" state={part.state} />
                        <ToolContent>
                          <ToolInput input={part.input} />
                          <ToolOutput output={part.output} errorText={part.errorText} />
                        </ToolContent>
                      </Tool>
                    );
                  }

                  return null;
                })}
              </MessageContent>
            </Message>
          ))}

          {/* Between submitting and the first token there is nothing to show,
              so say so rather than leaving an empty thread. */}
          {status === "submitted" && (
            <p className="px-1 text-xs text-zinc-500">Working out the query…</p>
          )}

          {/* Transport or model failure renders in the thread, not as a blank
              bubble and not as a thrown boundary. */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{error.message}</span>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        className="mt-4 shrink-0"
        onSubmit={(_, e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="Ask about reviews, cost, findings…"
            disabled={busy}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <span className="text-[0.7rem] text-zinc-600">
            Answers come from read-only SQL over the review database.
          </span>
          <PromptInputSubmit status={status} disabled={busy || !input.trim()} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
