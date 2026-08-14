import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Database, Loader2, TriangleAlert } from "lucide-react";

// Ask questions about fouine's review data. Deliberately not filter-driven:
// nothing here syncs to the URL, unlike /stats — a conversation isn't a view.

interface Turn {
  question: string;
  answer: string;
  sql: string[];
  error: string | null;
  streaming: boolean;
}

const SUGGESTIONS = [
  "Which repository costs the most per review?",
  "How many reviews failed in the last 7 days?",
  "What files get the most blocking findings?",
];

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const streaming = turns.length > 0 && turns[turns.length - 1]!.streaming;

  // Close the stream on unmount — a navigation away must not leave the
  // EventSource retrying against a route nobody is reading.
  useEffect(() => () => esRef.current?.close(), []);

  // Follow the tail while tokens arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  // Every handler patches the last turn — only one turn is ever in flight.
  const patch = (fn: (t: Turn) => Turn) =>
    setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? fn(t) : t)));

  const stop = () => {
    esRef.current?.close();
    esRef.current = null;
  };

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || streaming) return;
    setInput("");
    setTurns((prev) => [...prev, { question: q, answer: "", sql: [], error: null, streaming: true }]);

    const es = new EventSource(`/api/chat?q=${encodeURIComponent(q)}`);
    esRef.current = es;

    // Named events only: the server's heartbeats and any unnamed traffic land
    // on `message`, which we never listen to — same idiom as lib/live.ts.
    es.addEventListener("delta", (e) => {
      const { text } = JSON.parse((e as MessageEvent<string>).data) as { text: string };
      patch((t) => ({ ...t, answer: t.answer + text }));
    });
    es.addEventListener("sql", (e) => {
      const { sql } = JSON.parse((e as MessageEvent<string>).data) as { sql: string };
      patch((t) => ({ ...t, sql: [...t.sql, sql] }));
    });
    es.addEventListener("error", (e) => {
      // Two different failures arrive on the same event name: a payload from
      // the agent, and the browser's own transport error (no data at all).
      // Both end the turn, both must re-enable the input.
      const raw = (e as MessageEvent<string>).data;
      let message = "The connection to the server dropped.";
      if (raw) {
        try {
          message = (JSON.parse(raw) as { message: string }).message;
        } catch {
          message = raw;
        }
      }
      stop();
      patch((t) => ({ ...t, error: message, streaming: false }));
    });
    es.addEventListener("done", () => {
      stop();
      patch((t) => ({ ...t, streaming: false }));
    });
  };

  return (
    <div className="mx-auto flex min-w-0 max-w-3xl flex-col space-y-7">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ask about reviews, cost, findings and latency. Answers come from the same database as
          the stats page.
        </p>
      </div>

      {turns.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-8">
          <p className="text-sm text-zinc-400">Start with one of these.</p>
          <div className="mt-4 flex flex-col items-start gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="cursor-pointer rounded-md border border-zinc-800 px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800/60 hover:text-zinc-100"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="min-w-0 space-y-7">
          {turns.map((t, i) => (
            <Exchange key={i} turn={t} />
          ))}
        </div>
      )}

      <div ref={bottomRef} />

      {/* Sticky against the app's scroll container, so the input stays reachable
          on a long thread without a nested scroll area. On mobile it sits above
          the fixed bottom tab bar (min-h-14 + safe area), which is painted over
          that same container. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-4 bg-zinc-950/95 px-4 pb-2 pt-3 backdrop-blur md:-mx-8 md:bottom-0 md:px-8"
      >
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 focus-within:border-zinc-700">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming}
            placeholder={streaming ? "Waiting for the answer…" : "Ask about the review data…"}
            aria-label="Question"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:text-zinc-500"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            aria-label="Send question"
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md bg-ember-500 text-zinc-950 transition-colors hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {streaming ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
      </form>
    </div>
  );
}

function Exchange({ turn }: { turn: Turn }) {
  return (
    <div className="min-w-0 space-y-3">
      {/* The question reads as a heading on its own rule — no bubble, no avatar. */}
      <p className="border-l-2 border-ember-500/60 pl-3 text-base font-semibold text-zinc-100">
        {turn.question}
      </p>

      {turn.answer && (
        <p className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
          {turn.answer}
          {turn.streaming && (
            <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-ember-400" />
          )}
        </p>
      )}

      {turn.streaming && !turn.answer && (
        <Note icon={<Loader2 size={13} className="animate-spin text-zinc-500" />}>
          <span className="text-zinc-400">
            {turn.sql.length > 0 ? "Reading the results…" : "Working out the query…"}
          </span>
        </Note>
      )}

      {turn.sql.length > 0 && (
        <details className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/40">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200">
            <Database size={13} className="shrink-0 text-zinc-600" />
            {turn.sql.length} SQL {turn.sql.length === 1 ? "query" : "queries"}
          </summary>
          <div className="space-y-2 border-t border-zinc-800 px-3 py-2.5">
            {turn.sql.map((sql, i) => (
              // overflow-x-auto + min-w-0: a wide SELECT scrolls inside this box
              // instead of pushing the page sideways on a phone.
              <pre
                key={i}
                className="min-w-0 overflow-x-auto whitespace-pre font-mono text-[0.7rem] leading-relaxed text-zinc-400"
              >
                {sql}
              </pre>
            ))}
          </div>
        </details>
      )}

      {turn.error && (
        <Note icon={<TriangleAlert size={13} className="shrink-0 text-red-400" />}>
          <span className="min-w-0 text-red-300">{turn.error}</span>
        </Note>
      )}
    </div>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
      {icon}
      {children}
    </div>
  );
}
