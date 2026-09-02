"use client";

import type { Toolkit, ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackRoot,
  ToolFallbackTrigger
} from "@/components/assistant-ui/tool-fallback";
import { ChartToolUI } from "@/components/assistant-ui/chart-tool-ui";
import * as stylex from "@stylexjs/stylex";
import { color, font, radius, space, text } from "@/tokens.stylex";

const s = stylex.create({
  label: {
    color: color.mutedForeground,
    fontSize: text.xs,
    lineHeight: "calc(1 / 0.75)",
    fontWeight: 500
  },
  block: {
    backgroundColor: `color-mix(in oklab, ${color.muted} 50%, transparent)`,
    color: `color-mix(in oklab, ${color.foreground} 90%, transparent)`,
    marginTop: space.x4,
    overflowX: "auto",
    borderRadius: radius.md,
    padding: space.x10,
    fontSize: text.xs,
    lineHeight: "calc(1 / 0.75)",
    whiteSpace: "pre-wrap"
  },
  mono: { fontFamily: font.mono },
  tabular: { fontVariantNumeric: "tabular-nums" }
});

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
  status
}) => {
  const sql = args?.sql ?? argsText;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName="query_stats" status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        {sql && (
          <div>
            <p {...stylex.props(s.label)}>Query</p>
            <pre {...stylex.props(s.block, s.mono)}>
              {sql}
            </pre>
          </div>
        )}
        {result !== undefined && (
          <div>
            <p {...stylex.props(s.label)}>Rows</p>
            <pre {...stylex.props(s.block, s.tabular)}>
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
  render_chart: { type: "backend", display: "standalone", render: ChartToolUI }
} satisfies Toolkit;
