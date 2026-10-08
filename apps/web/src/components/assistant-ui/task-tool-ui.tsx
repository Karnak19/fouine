"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon, ExternalLinkIcon } from "lucide-react";
import { api, type ReviewRow } from "@/lib/api";
import { useLiveEvents } from "@/lib/live";

// Mirrors `DelegateResult` in apps/server/src/task/delegate.ts. Duplicated, like
// the chart result, because the shape belongs to the chat tool and not to the
// app's domain (@fouine/shared carries row shapes only).
export type DelegateTaskArgs = { repo?: string; prompt?: string };
export type DelegateTaskResult =
  | { ok: true; id: number; repo: string; status: "queued" }
  | { ok: false; error: string };

type View = { label: string; tone: "muted" | "live" | "good" | "warn" | "bad" };

// queued -> running -> PR opened / no changes / needs input / failed. A row is
// 'completed' for all three clean endings; `outcome` says which.
function viewOf(row: ReviewRow | undefined): View {
  if (!row) return { label: "Queued", tone: "muted" };
  if (row.status === "pending") return { label: "Queued", tone: "muted" };
  if (row.status === "running") return { label: "Running", tone: "live" };
  if (row.status === "failed") return { label: "Failed", tone: "bad" };
  if (row.outcome === "pr_opened") return { label: "PR opened", tone: "good" };
  if (row.outcome === "no_changes") return { label: "No changes", tone: "muted" };
  if (row.outcome === "needs_input") return { label: "Needs input", tone: "warn" };
  return { label: row.status, tone: "muted" };
}

const TONES: Record<View["tone"], string> = {
  muted: "bg-muted text-muted-foreground",
  live: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  good: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  bad: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function TaskCard({ id, repo }: { id: number; repo: string }) {
  const queryClient = useQueryClient();
  // The same live channel the dashboard uses: every write to the row publishes
  // review:updated on /api/events, which we turn into a refetch of the REST row
  // (the row stays the source of truth). All cards share one connection.
  const { status: stream } = useLiveEvents(null, (e) => {
    if (e.type === "review:updated" && e.review.id === id) {
      queryClient.invalidateQueries({ queryKey: ["reviews", id] });
    }
  });
  const { data: row, isError } = useQuery({
    queryKey: ["reviews", id],
    queryFn: () => api.reviews.get(id),
    // Poll only while the stream is down and the task is still going.
    refetchInterval: (q) => {
      if (stream === "live") return false;
      const s = q.state.data?.status;
      return s === undefined || s === "pending" || s === "running" ? 3000 : false;
    },
  });
  const view = viewOf(row);

  return (
    <div className="border-border bg-card my-2 w-full max-w-xl rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-mono text-xs">{repo}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${TONES[view.tone]}`}>
          {view.label}
        </span>
      </div>
      {row?.outcome === "needs_input" && row.result_text && (
        <p className="mt-2 text-xs whitespace-pre-wrap">{row.result_text}</p>
      )}
      {row?.outcome === "no_changes" && (
        <p className="text-muted-foreground mt-2 text-xs">Nothing needed changing in this repo.</p>
      )}
      {row?.status === "failed" && row.error && (
        <p className="mt-2 line-clamp-3 text-xs text-red-600 dark:text-red-400">{row.error}</p>
      )}
      {isError && !row && (
        <p className="text-muted-foreground mt-2 text-xs">Couldn't read this task's status.</p>
      )}
      <div className="text-muted-foreground mt-2 flex items-center gap-3 text-xs">
        <Link to="/reviews/$id" params={{ id: String(id) }} className="hover:text-foreground underline">
          Run #{id}
        </Link>
        {row?.result_url && (
          <a
            href={row.result_url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground inline-flex items-center gap-1 underline"
          >
            Pull request <ExternalLinkIcon size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

export const DelegateTaskToolUI: ToolCallMessagePartComponent<DelegateTaskArgs, DelegateTaskResult> = ({
  args,
  result,
}) => {
  if (result === undefined) {
    return (
      <div className="border-border bg-card my-2 w-full max-w-xl rounded-lg border p-3 text-sm">
        <span className="font-mono text-xs">{args?.repo ?? "…"}</span>
        <span className="text-muted-foreground ml-2 text-xs">Handing off…</span>
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="my-2 flex w-full max-w-xl items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
        <AlertTriangleIcon size={14} className="mt-0.5 shrink-0 text-red-500" />
        <div className="min-w-0">
          <span className="font-mono text-xs">{args?.repo}</span>
          <p className="mt-1 text-xs">{result.error}</p>
        </div>
      </div>
    );
  }
  return <TaskCard id={result.id} repo={result.repo} />;
};
