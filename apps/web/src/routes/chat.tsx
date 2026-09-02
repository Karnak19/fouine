import { AssistantRuntimeProvider, AuiConfig, Suggestions, Tools, useAui } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import * as stylex from "@stylexjs/stylex";
import { Thread } from "@/components/assistant-ui/thread";
import { chatToolkit } from "@/components/assistant-ui/toolkit";
import { color, leading, space, text, tracking } from "@/tokens.stylex";

// Questions worth asking that no panel answers, so an empty thread suggests
// something better than a blank box.
const SUGGESTIONS = [
  "Which repository cost the most in the last 7 days?",
  "What's the failure rate per model?",
  "Which files attract the most blocking findings?",
];

// Config is plain data, so it is built once rather than per render.
const CHAT_CONFIG = AuiConfig({ suggestions: Suggestions(SUGGESTIONS) });

const s = stylex.create({
  page: {
    marginInline: "auto",
    display: "flex",
    height: "100%",
    width: "100%",
    maxWidth: space.x768,
    minWidth: 0,
    flexDirection: "column"
  },
  head: { flexShrink: 0 },
  title: { fontSize: text.xl2, lineHeight: leading.xl2, fontWeight: 700, letterSpacing: tracking.tight },
  subtitle: { marginTop: space.x4, fontSize: text.sm, lineHeight: leading.sm, color: color.zinc500 },
  thread: { marginTop: space.x24, minHeight: 0, flexGrow: 1, flexBasis: 0 }
});

export default function ChatPage() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/chat" })
  });

  // The tool renderers, registered by name so the thread draws a query and a
  // chart instead of the generic tool fallback. `aui` and `config` are separate
  // props on the provider — the client carries the tools scope, the config the
  // suggestions — and neither replaces the other.
  const aui = useAui({ tools: Tools({ toolkit: chatToolkit }) });

  return (
    <div {...stylex.props(s.page)}>
      <div {...stylex.props(s.head)}>
        <h1 {...stylex.props(s.title)}>Chat</h1>
        <p {...stylex.props(s.subtitle)}>
          Ask about the review history. Every answer is computed by a SQL query you can inspect.
        </p>
      </div>

      <AssistantRuntimeProvider runtime={runtime} aui={aui} config={CHAT_CONFIG}>
        <div {...stylex.props(s.thread)}>
          <Thread />
        </div>
      </AssistantRuntimeProvider>
    </div>
  );
}
