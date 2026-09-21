import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { JSONUIProvider, Renderer, useJsonRenderMessage } from "@json-render/react";
import { AlertTriangle, ChevronRight, Loader2, RotateCcw, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  referencedDatasetKeys,
  sanitizeSpec,
  type BuildDataset,
  type BuildPrevious,
  type LooseSpec,
  type SanitizedSpec,
} from "@/build/catalog";
import { BuildDataProvider, registry } from "@/build/registry";
import { errorText, previousFromDashboard } from "@/build/previous";

// One sentence in, a whole dashboard out — and the next sentence edits it.
//
// What arrives on the wire, in this order: every dataset as its query returns
// (`data-build-dataset`), then json-render's own spec patches as the layout
// model writes YAML. So the page has its numbers before it has the shape that
// arranges them, and a chart never lands looking for rows that are not there.
//
// A follow-up prompt, once a dashboard is on screen, is a REFINE: the request
// carries the sanitised spec and the datasets' SQL (never their rows) as
// `previous`, and the server streams back a complete dashboard again — the old
// datasets re-run, the new ones added, the whole edited spec. The page keeps the
// current dashboard visible until the new spec starts arriving, and falls back
// to it if the refinement comes back empty or is stopped. "Start over" is the
// old wipe.
//
// Nothing here is persisted. Reload and it is gone — saving a built dashboard
// is deliberately a later issue.

const DATASET_PART = "data-build-dataset";
const NOTE_PART = "data-build-note";

const EXAMPLES = [
  "Reviews per day this month and the five most expensive PRs",
  "Cost and failure rate per repository over the last 30 days",
  "Where the blocking findings are: by repo, by severity, by file",
];

/** Pull the datasets and the cap notes out of an assistant message's parts. */
function readParts(parts: UIMessage["parts"]): { datasets: Record<string, BuildDataset>; notes: string[] } {
  const datasets: Record<string, BuildDataset> = {};
  const notes: string[] = [];
  for (const p of parts) {
    const part = p as { type: string; data?: unknown };
    if (part.type === DATASET_PART && part.data) {
      const d = part.data as BuildDataset;
      if (d?.key) datasets[d.key] = d;
    } else if (part.type === NOTE_PART && part.data) {
      const n = (part.data as { notes?: unknown }).notes;
      if (Array.isArray(n)) notes.push(...n.filter((x): x is string => typeof x === "string"));
    }
  }
  return { datasets, notes };
}

/** The "SQL behind this" disclosure: one query per dataset, nothing hidden. */
function SqlDisclosure({ datasets }: { datasets: BuildDataset[] }) {
  const [open, setOpen] = React.useState(false);
  if (datasets.length === 0) return null;
  return (
    <div className="mt-8 rounded-lg border border-border bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs text-zinc-400 hover:text-zinc-200"
      >
        <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        The SQL behind this — {datasets.length} quer{datasets.length === 1 ? "y" : "ies"}
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-4 py-3">
          {datasets.map((d) => (
            <div key={d.key} className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium text-zinc-300">{d.title}</span>
                <code className="text-zinc-500">{d.key}</code>
                <span className="text-zinc-600 tabular-nums">
                  {d.rowCount} row{d.rowCount === 1 ? "" : "s"} · {d.ms}ms
                </span>
              </div>
              <pre className="mt-1.5 overflow-x-auto rounded bg-zinc-950/60 p-2.5 text-[0.7rem] leading-relaxed text-zinc-400">
                {d.sql}
              </pre>
              {d.note && <p className="text-destructive/90 mt-1 text-[0.7rem]">{d.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="border-destructive/40 bg-destructive/5 mt-6 space-y-1 rounded-lg border px-3 py-2">
      {notes.map((n) => (
        <p key={n} className="flex items-start gap-2 text-xs text-zinc-300">
          <AlertTriangle className="text-destructive mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{n}</span>
        </p>
      ))}
    </div>
  );
}

/** A dashboard the page has accepted: what the next prompt refines, and what to show while it does. */
interface Committed {
  /** The assistant message it was rendered from, kept so it can be drawn again. */
  answer: UIMessage;
  /** The thread as it stood — restored when a refine is stopped or rejected. */
  messages: UIMessage[];
  previous: BuildPrevious;
}

function PromptChips({ prompts, pending }: { prompts: readonly string[]; pending: string | null }) {
  if (prompts.length === 0 && !pending) return null;
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {prompts.map((p, i) => (
        <li
          key={`${i}-${p}`}
          className="max-w-full truncate rounded-full border border-border bg-card/60 px-2.5 py-0.5 text-xs text-zinc-300"
          title={p}
        >
          {p}
        </li>
      ))}
      {pending && (
        <li
          className="flex max-w-full items-center gap-1.5 truncate rounded-full border border-dashed border-zinc-600 px-2.5 py-0.5 text-xs text-zinc-400"
          title={pending}
        >
          <Loader2 size={11} className="shrink-0 animate-spin motion-reduce:hidden" />
          <span className="truncate">{pending}</span>
        </li>
      )}
    </ol>
  );
}

/**
 * One built dashboard: the datasets, the spec they fill, and the queries.
 *
 * `fallback` is the dashboard already accepted. While a refine streams and the
 * new spec has not started to arrive, the fallback is drawn instead of a
 * spinner; if the refine ends with nothing renderable, the fallback stays and a
 * note says so. `onSettled` fires once, when a streamed dashboard is complete
 * and renderable, with what the next refine should send back.
 */
function Dashboard({
  message,
  streaming,
  fallback,
  onSettled,
}: {
  message: UIMessage;
  streaming: boolean;
  fallback?: Committed | null;
  onSettled?: (answer: UIMessage, spec: SanitizedSpec["spec"], datasets: Record<string, BuildDataset>) => void;
}) {
  const { datasets, notes } = React.useMemo(() => readParts(message.parts), [message.parts]);
  // json-render's own helper folds the streamed patches back into a spec.
  const { spec, hasSpec } = useJsonRenderMessage(message.parts as never);

  const keys = React.useMemo(() => Object.keys(datasets), [datasets]);
  // Never hand the renderer what the model emitted. An unknown component, a
  // prop carrying rows, a layout past the node cap: each degrades in place and
  // leaves a note, and the rest of the page still draws.
  const safe = React.useMemo(
    () => sanitizeSpec(spec as LooseSpec | null, streaming ? undefined : keys),
    [spec, keys, streaming],
  );

  // Only what the page actually draws is disclosed and carried forward. A
  // dataset a refinement stopped referencing is dropped here, so it does not
  // ride along in every request after.
  const list = React.useMemo(() => {
    const used = referencedDatasetKeys(safe.spec);
    return used.flatMap((k) => (datasets[k] ? [datasets[k]!] : []));
  }, [safe.spec, datasets]);
  const empty = !hasSpec || Object.keys(safe.spec.elements).length === 0;

  React.useEffect(() => {
    if (streaming || empty || !onSettled) return;
    onSettled(message, safe.spec, datasets);
  }, [streaming, empty, onSettled, message, safe.spec, datasets]);

  if (empty && fallback) {
    // A partial model answer on a refine is not a dashboard: the accepted one
    // stays on screen, with the refine's own notes (a dropped query, a cap)
    // shown above it so nothing the server said is lost.
    return (
      <div className="min-w-0">
        <div className="text-muted-foreground mb-4 flex items-center gap-2 text-sm">
          {streaming ? (
            <>
              <Loader2 size={15} className="animate-spin motion-reduce:hidden" />
              {keys.length === 0 ? "Re-running the queries…" : `Laying out ${keys.length} dataset(s)…`}
            </>
          ) : (
            <>
              <AlertTriangle className="text-destructive size-3.5 shrink-0" />
              The refinement came back with nothing to draw, so the previous dashboard is still shown.
            </>
          )}
        </div>
        {notes.length > 0 && <Notes notes={notes} />}
        <Dashboard message={fallback.answer} streaming={false} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {empty ? (
        <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
          {streaming ? (
            <>
              <Loader2 size={15} className="animate-spin motion-reduce:hidden" />
              {keys.length === 0 ? "Querying the database…" : `Laying out ${keys.length} dataset(s)…`}
            </>
          ) : (
            "Nothing came back for that. Try naming the numbers you want to see."
          )}
        </div>
      ) : (
        <BuildDataProvider datasets={datasets} streaming={streaming}>
          {/* The spec is data, and `registry` is the only thing that can turn
              it into components — a type outside the catalog has nowhere to go. */}
          <JSONUIProvider registry={registry}>
            <Renderer spec={safe.spec as never} registry={registry} />
          </JSONUIProvider>
        </BuildDataProvider>
      )}
      <Notes notes={[...notes, ...safe.notes]} />
      <SqlDisclosure datasets={list} />
    </div>
  );
}

function userText(m: UIMessage | undefined): string {
  return (m?.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export default function BuildPage() {
  const [draft, setDraft] = React.useState("");
  const [committed, setCommitted] = React.useState<Committed | null>(null);
  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/build",
      // The route takes one prompt, not a thread: a build is a single shot and
      // there is no history for the model to misread. A refine adds `previous`
      // — the dashboard as it stands — which `submit` passes per request.
      prepareSendMessagesRequest: ({ messages: msgs, id, body }) => {
        const previous = body?.previous as BuildPrevious | undefined;
        return { body: { prompt: userText(msgs[msgs.length - 1]), id, ...(previous ? { previous } : {}) } };
      },
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const answer = messages.filter((m) => m.role === "assistant").at(-1);
  const asked = messages.filter((m) => m.role === "user").at(-1);
  const askedText = userText(asked);

  // Refs, so `onSettled` can stay referentially stable — it is an effect
  // dependency inside Dashboard, and a new function every render would fire it
  // every render.
  const committedRef = React.useRef(committed);
  committedRef.current = committed;
  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;
  const askedRef = React.useRef(askedText);
  askedRef.current = askedText;

  const onSettled = React.useCallback(
    (settled: UIMessage, spec: SanitizedSpec["spec"], datasets: Record<string, BuildDataset>) => {
      const current = committedRef.current;
      // Each answer is accepted once. Re-rendering the same one must not
      // append its prompt to the chips a second time.
      if (current?.answer.id === settled.id) return;
      const prompts = [...(current?.previous.prompts ?? []), askedRef.current].filter(Boolean);
      setCommitted({
        answer: settled,
        messages: messagesRef.current,
        previous: previousFromDashboard(spec, datasets, prompts),
      });
    },
    [],
  );

  const submit = (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    // With nothing on screen this is a build and the thread is wiped. With a
    // dashboard accepted, the thread is reset to it (dropping any refine that
    // was stopped or came back empty) and the new prompt refines it.
    setMessages(committed ? committed.messages : []);
    setDraft("");
    void sendMessage({ text: prompt }, committed ? { body: { previous: committed.previous } } : undefined);
  };

  const stopRun = () => {
    void stop();
    // The half-streamed answer is discarded: the accepted dashboard is what
    // stays, exactly as it was.
    if (committed) setMessages(committed.messages);
  };

  const startOver = () => {
    if (busy) void stop();
    setMessages([]);
    setCommitted(null);
    setDraft("");
  };

  const refining = committed !== null;
  const showing = answer ?? committed?.answer;
  // The prompts the dashboard on screen is the product of, plus the one in flight.
  const applied = committed?.previous.prompts ?? [];
  const pending = busy && askedText ? askedText : null;

  return (
    <div className="mx-auto w-full max-w-5xl min-w-0">
      <h1 className="text-2xl font-bold tracking-tight">Build</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Describe a dashboard and it is composed from your review data. Every number comes from a SQL query
        you can read underneath. Once it is on screen, the next sentence edits it.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter builds, shift+Enter is a newline — same as the composer.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
          rows={2}
          placeholder={refining ? "Refine this dashboard…" : "Reviews per day this month and the five most expensive PRs"}
          className="min-h-[4.5rem] resize-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || draft.trim() === ""} className="gap-1.5">
            {busy ? <Loader2 size={15} className="animate-spin motion-reduce:hidden" /> : <Sparkles size={15} />}
            {busy ? (refining ? "Refining…" : "Building…") : refining ? "Refine" : "Build"}
          </Button>
          {busy && (
            <Button type="button" variant="outline" onClick={stopRun} className="gap-1.5">
              <Square size={13} />
              Stop
            </Button>
          )}
          {(refining || answer) && (
            <Button
              type="button"
              variant="ghost"
              onClick={startOver}
              className="gap-1.5 text-zinc-400 hover:text-zinc-100"
            >
              <RotateCcw size={13} />
              Start over
            </Button>
          )}
          {!answer &&
            !refining &&
            EXAMPLES.map((e) => (
              <Button
                key={e}
                type="button"
                variant="ghost"
                onClick={() => submit(e)}
                disabled={busy}
                className="h-auto rounded-md px-2.5 py-1.5 text-xs font-normal text-zinc-400 hover:text-zinc-100"
              >
                {e}
              </Button>
            ))}
        </div>
      </form>

      {error && (
        <div className="border-destructive/40 bg-destructive/5 mt-6 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-zinc-300">
          <AlertTriangle className="text-destructive mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{errorText(error)}</span>
        </div>
      )}

      {(asked || showing) && (
        <div className="mt-8 border-t border-border pt-6">
          <PromptChips prompts={applied} pending={pending} />
          <div className="mt-4">
            {showing ? (
              <Dashboard
                key={showing.id}
                message={showing}
                streaming={busy && showing === answer}
                fallback={showing !== committed?.answer ? committed : null}
                onSettled={onSettled}
              />
            ) : (
              <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
                <Loader2 size={15} className="animate-spin motion-reduce:hidden" />
                Querying the database…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
