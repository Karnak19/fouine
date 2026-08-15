"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/tool-fallback";

type QueryStatsArgs = { sql?: string };

/**
 * The SQL behind an answer, collapsed under it — the whole point of this page is
 * that a fluent answer can be checked rather than trusted. The generic fallback
 * would show the arguments as a JSON blob; the query is the interesting part, so
 * it gets rendered as the statement it is.
 */
export const QueryStatsToolUI = makeAssistantToolUI<QueryStatsArgs, string>({
  toolName: "query_stats",
  render: ({ args, argsText, result, status }) => {
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
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </ToolFallbackContent>
      </ToolFallbackRoot>
    );
  },
});
