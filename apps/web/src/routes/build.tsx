import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { JSONUIProvider, Renderer, useJsonRenderMessage } from "@json-render/react";
import { AlertTriangle, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sanitizeSpec, type BuildDataset, type LooseSpec } from "@/build/catalog";
import { BuildDataProvider, registry } from "@/build/registry";

// One sentence in, a whole dashboard out.
//
// What arrives on the wire, in this order: every dataset as its query returns
// (`data-build-dataset`), then json-render's own spec patches as the layout
// model writes YAML. So the page has its numbers before it has the shape that
// arranges them, and a chart never lands looking for rows that are not there.
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

/** One built dashboard: the datasets, the spec they fill, and the queries. */
function Dashboard({ message, streaming }: { message: UIMessage; streaming: boolean }) {
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

  const list = Object.values(datasets);
  const empty = !hasSpec || Object.keys(safe.spec.elements).length === 0;

  return (
    <div className="min-w-0">
      {empty ? (
        <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
          {streaming ? (
            <>
              <Loader2 size={15} className="animate-spin motion-reduce:hidden" />
              {list.length === 0 ? "Querying the database…" : `Laying out ${list.length} dataset(s)…`}
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

export default function BuildPage() {
  const [draft, setDraft] = React.useState("");
  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/build",
      // The route takes one prompt, not a thread: a build is a single shot and
      // there is no history for the model to misread.
      prepareSendMessagesRequest: ({ messages: msgs, id }) => {
        const last = msgs[msgs.length - 1];
        const text = (last?.parts ?? [])
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        return { body: { prompt: text, id } };
      },
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const answer = messages.filter((m) => m.role === "assistant").at(-1);
  const asked = messages.filter((m) => m.role === "user").at(-1);

  const submit = (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    // One dashboard at a time: a new prompt replaces the last one rather than
    // stacking, which is the whole difference from the chat page.
    setMessages([]);
    setDraft("");
    void sendMessage({ text: prompt });
  };

  return (
    <div className="mx-auto w-full max-w-5xl min-w-0">
      <h1 className="text-2xl font-bold tracking-tight">Build</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Describe a dashboard and it is composed from your review data. Every number comes from a SQL query
        you can read underneath.
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
          placeholder="Reviews per day this month and the five most expensive PRs"
          className="min-h-[4.5rem] resize-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || draft.trim() === ""} className="gap-1.5">
            {busy ? <Loader2 size={15} className="animate-spin motion-reduce:hidden" /> : <Sparkles size={15} />}
            {busy ? "Building…" : "Build"}
          </Button>
          {!answer &&
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
          <span className="min-w-0 break-words">{error.message}</span>
        </div>
      )}

      {asked && (
        <div className="mt-8 border-t border-border pt-6">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            {asked.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join(" ")}
          </p>
          <div className="mt-4">
            {answer ? (
              <Dashboard message={answer} streaming={busy} />
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
