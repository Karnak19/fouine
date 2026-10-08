"use client";

import type { Toolkit, ToolCallMessagePartComponent } from "@assistant-ui/react";
import type { CodemodeOutput } from "@fouine/shared";
import {
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/tool-fallback";
import { ChartCard } from "@/components/assistant-ui/chart-tool-ui";

function Block({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <pre className="bg-muted/50 text-foreground/90 mt-1 overflow-x-auto rounded-md p-2.5 font-mono text-xs whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}

const pretty = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

/**
 * The program behind an answer, collapsed under it — the whole point of this page
 * is that a fluent answer can be checked rather than trusted. Inside the
 * collapsible: the code, each tool call it made (with its SQL), console output,
 * and what it returned or how it failed. The charts it drew sit OUTSIDE the
 * collapsible, below it: a chart is part of the answer, not a trace of how it was
 * reached.
 */
const CodemodeToolUI: ToolCallMessagePartComponent<{ code?: string }, CodemodeOutput> = ({
  args,
  argsText,
  result,
  status,
}) => {
  const code = args?.code ?? argsText;
  // A thrown tool error (not a CodemodeOutput) arrives as a string.
  const output = result && typeof result === "object" ? result : undefined;

  return (
    <>
      <ToolFallbackRoot>
        <ToolFallbackTrigger toolName="codemode" status={status} />
        <ToolFallbackContent>
          <ToolFallbackError status={status} />
          {code && <Block label="Program">{code}</Block>}
          {output && output.calls.length > 0 && (
            <div>
              <p className="text-muted-foreground text-xs font-medium">Tool calls</p>
              <ul className="mt-1 flex flex-col gap-1.5">
                {output.calls.map((c, i) => {
                  const sql = (c.input as { sql?: unknown } | null)?.sql;
                  return (
                    <li key={i} className="bg-muted/50 rounded-md p-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="font-mono font-medium">{c.name}</span>
                        <span
                          className={
                            c.outcome === "success"
                              ? "text-muted-foreground"
                              : "text-destructive/90"
                          }
                        >
                          {c.outcome} · {c.durationMs}ms
                        </span>
                      </div>
                      {typeof sql === "string" && (
                        <pre className="text-foreground/90 mt-1 overflow-x-auto font-mono whitespace-pre-wrap">
                          {sql}
                        </pre>
                      )}
                      {c.message && <p className="text-destructive/90 mt-1">{c.message}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {output && output.logs.length > 0 && <Block label="Logs">{output.logs.join("\n")}</Block>}
          {output?.ok && <Block label="Result">{pretty(output.value)}</Block>}
          {output && !output.ok && (
            <Block label="Error">{`${output.error.kind}: ${output.error.message}`}</Block>
          )}
          {output?.truncated && (
            <p className="text-destructive/90 text-xs">The result was cut to fit the size limit.</p>
          )}
          {typeof result === "string" && <Block label="Error">{result}</Block>}
        </ToolFallbackContent>
      </ToolFallbackRoot>
      {output?.charts.map((chart, i) => <ChartCard key={i} chart={chart} />)}
    </>
  );
};

/**
 * The renderer for the chat's one tool, keyed by the name the model calls.
 *
 * The tool is DEFINED AND EXECUTED on our own Elysia server (see
 * `apps/server/src/chat/codemode.ts`), so the client's only job is to draw its
 * calls. In toolkit terms that is `externalTool()` — "backend, defined
 * elsewhere" — whose compiled shape is exactly `{ type: "backend", render }`:
 * no schema, no executor. It is written out here rather than authored with the
 * `"use generative"` directive because that directive exists to SPLIT a file
 * that holds both an `execute` and a `render`, and this one has no `execute` to
 * split. It also could not work: dev bundles through Bun's fullstack server,
 * not Vite, so the Vite-only compiler would never run.
 *
 * `standalone`: the charts must be visible without opening anything. Inline (the
 * default) folds the call into the collapsed "1 tool call" chain-of-thought
 * group, where a picture drawn for the user would sit behind a disclosure
 * triangle nobody opens.
 *
 * Nothing here is sent to the model — the server owns the schema — so a change
 * to the tool's arguments must be made there, not here.
 */
export const chatToolkit = {
  codemode: { type: "backend", display: "standalone", render: CodemodeToolUI },
} satisfies Toolkit;
