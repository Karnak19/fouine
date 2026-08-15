"use client";

import type { Toolkit, ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/tool-fallback";
import { ChartToolUI } from "@/components/assistant-ui/chart-tool-ui";

/**
 * The SQL behind an answer, collapsed under it — the whole point of this page is
 * that a fluent answer can be checked rather than trusted. The generic fallback
 * would show the arguments as a JSON blob; the query is the interesting part, so
 * it gets rendered as the statement it is.
 */
const QueryStatsToolUI: ToolCallMessagePartComponent<{ sql?: string }, string> = ({
  args,
  argsText,
  result,
  status,
}) => {
  const sql = args?.sql ?? argsText;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName="query_stats" status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        {sql && (
          <div>
            <p className="text-muted-foreground text-xs font-medium">Query</p>
            <pre className="bg-muted/50 text-foreground/90 mt-1 overflow-x-auto rounded-md p-2.5 font-mono text-xs whitespace-pre-wrap">
              {sql}
            </pre>
          </div>
        )}
        {result !== undefined && (
          <div>
            <p className="text-muted-foreground text-xs font-medium">Rows</p>
            <pre className="bg-muted/50 text-foreground/90 mt-1 overflow-x-auto rounded-md p-2.5 text-xs whitespace-pre-wrap tabular-nums">
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

/**
 * The renderers for the chat's tools, keyed by the name the model calls.
 *
 * Both tools are DEFINED AND EXECUTED on our own Elysia server (see
 * `apps/server/src/chat/index.ts`), so the client's only job is to draw their
 * calls. In toolkit terms that is `externalTool()` — "backend, defined
 * elsewhere" — whose compiled shape is exactly `{ type: "backend", render }`:
 * no schema, no executor. It is written out here rather than authored with the
 * `"use generative"` directive because that directive exists to SPLIT a file
 * that holds both an `execute` and a `render`, and this one has no `execute` to
 * split. It also could not work: dev bundles through Bun's fullstack server,
 * not Vite, so the Vite-only compiler would never run.
 *
 * Nothing here is sent to the model — the server owns the schemas — so a change
 * to a tool's arguments must be made there, not here.
 */
export const chatToolkit = {
  query_stats: { type: "backend", render: QueryStatsToolUI },
  // `standalone`, unlike the query: a chart is part of the ANSWER, not a trace
  // of how it was reached. Inline (the default) folds it into the collapsed
  // "1 tool call" chain-of-thought group, where a picture drawn for the user
  // would sit behind a disclosure triangle nobody opens.
  render_chart: { type: "backend", display: "standalone", render: ChartToolUI },
} satisfies Toolkit;
