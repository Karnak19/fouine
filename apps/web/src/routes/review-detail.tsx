import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { api, type FindingRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { useLiveEvents, type TranscriptDelta } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { timeAgo, duration } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ExternalLink,
  CircleAlert,
  Terminal,
  User,
  Bot,
  Radio,
  RotateCw,
  Square,
  ScrollText,
  ClipboardCheck,
} from "lucide-react";

interface Part {
  id?: string;
  type?: string;
  text?: string;
  tool?: string;
  state?: { status?: string; title?: string; output?: string; error?: string };
}
interface Message {
  info?: { id?: string; role?: string; modelID?: string };
  parts?: Part[];
}
interface Session {
  info?: {
    title?: string;
    model?: { id?: string; providerID?: string };
    cost?: number;
    tokens?: { input?: number; output?: number; reasoning?: number };
    time?: { created?: number; updated?: number };
  };
  messages?: Message[];
}

// Merge one delta into the cached session, immutably (react-query compares by
// reference). Returns null when the delta names a message the snapshot doesn't
// have and can't create — the caller then refetches rather than render a hole.
//
// A message-level delta (no `part`) legitimately introduces a new message, so
// it appends a shell. A part-level delta for an unknown message is the "we
// missed frames" case.
function mergeDelta(session: Session, delta: TranscriptDelta): Session | null {
  const messages = session.messages ?? [];
  const idx = messages.findIndex((m) => m.info?.id === delta.messageId);

  if (!delta.part) {
    if (idx >= 0) return session;
    return {
      ...session,
      messages: [...messages, { info: { id: delta.messageId, role: delta.role }, parts: [] }],
    };
  }
  if (idx < 0) return null;

  const target = messages[idx];
  const parts = target.parts ?? [];
  const pIdx = parts.findIndex((p) => p.id === delta.part!.id);
  // Parts are replaced wholesale, not deep-merged: opencode republishes the
  // full accumulated part on each update, so the newest frame is complete.
  const nextParts =
    pIdx >= 0
      ? parts.map((p, i) => (i === pIdx ? delta.part! : p))
      : [...parts, delta.part];
  const nextMessages = [...messages];
  nextMessages[idx] = { ...target, parts: nextParts };
  return { ...session, messages: nextMessages };
}

export default function ReviewDetailPage() {
  const { id } = useParams({ from: "/reviews/$id" });
  const numId = Number(id);
  const queryClient = useQueryClient();

  const retryMut = useMutation({
    // Improver runs aren't bound to a PR — retrying one re-runs the improver
    // for its repo, not the PR-review pipeline (which would fetch PR #0).
    mutationFn: () => {
      if (review?.trigger === "improve") {
        const [owner, name] = review.repo_full_name.split("/");
        return api.repos.improve(owner, name);
      }
      return api.reviews.retry(numId);
    },
    // The retry route is fire-and-forget and doesn't hand back the new
    // review's id (it queues an async re-run), so there's nothing to
    // navigate to — stay on this page and just invalidate.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["reviews", numId] });
    },
    onError: (e: Error) => toast.error("Couldn't retry review", { description: e.message }),
  });

  const stopMut = useMutation({
    mutationFn: () => api.reviews.stop(numId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reviews", numId] }),
    onError: (e: Error) => toast.error("Couldn't stop review", { description: e.message }),
  });

  // SSE: the instant the row, its findings, or its transcript change, react.
  // The polls above/below remain as the fallback when the stream is down.
  //
  // The hub has no replay, so anything published before this subscription
  // existed is simply gone. Reconciliation is therefore mandatory, and it has
  // three legs: the REST snapshot on mount, a refetch on `resync` (reconnect),
  // and a refetch whenever a part delta arrives for a message the snapshot has
  // never seen — that "unknown message" is exactly the shape a missed window
  // takes, and rendering a hole instead would be worse than one extra fetch.
  const refetchGuard = useRef(0);
  const { status, resync } = useLiveEvents(null, (e) => {
    if (e.type === "review:updated" && e.review.id === numId) {
      queryClient.invalidateQueries({ queryKey: ["reviews", numId] });
    }
    if (e.type === "review:findings" && e.reviewId === numId) {
      queryClient.invalidateQueries({ queryKey: ["reviews", numId, "findings"] });
    }
    if (e.type === "review:transcript" && e.reviewId === numId) {
      const key = ["reviews", numId, "session"];
      const current = queryClient.getQueryData<Session>(key);
      // No snapshot yet — the mount fetch is still in flight and will land
      // ahead of us. Dropping the delta is safe; the snapshot supersedes it.
      if (!current) return;
      const merged = mergeDelta(current, e.delta);
      if (merged) {
        queryClient.setQueryData(key, merged);
        return;
      }
      // Unknown message id: we missed frames. Refetch the snapshot, at most
      // once every 5s so a burst of orphan deltas can't become a fetch storm
      // (each fetch spawns an opencode server — the very cost this removes).
      const now = Date.now();
      if (now - refetchGuard.current < 5000) return;
      refetchGuard.current = now;
      queryClient.invalidateQueries({ queryKey: key });
    }
  });
  const streaming = status === "live";

  const {
    data: review,
    isError: reviewError,
    refetch: refetchReview,
  } = useQuery({
    queryKey: ["reviews", numId],
    queryFn: () => api.reviews.get(numId),
    refetchOnWindowFocus: false,
    // Every write to this row publishes review:updated (setRunning, setSession,
    // complete, skip, fail, the stop route, the boot reaper), so a healthy
    // stream already pushes us every transition — polling on top of it is pure
    // noise on a page that's just sitting open. Poll only while the stream is
    // down, and only while there's still something to wait for.
    refetchInterval: (q) => {
      if (streaming) return false;
      const s = q.state.data?.status;
      return s === "running" || s === "pending" ? 2000 : false;
    },
  });
  const inProgress = review?.status === "running" || review?.status === "pending";
  const [tab, setTab] = useState<"review" | "transcript">("review");

  const {
    data: session,
    isError: sessionError,
    refetch: refetchSession,
  } = useQuery({
    queryKey: ["reviews", numId, "session"],
    // The server returns 503 when the session can't be read; the api helper
    // throws on non-2xx, and retry:false keeps react-query showing the last
    // good transcript instead of flashing an empty one.
    queryFn: () => api.reviews.session(numId) as Promise<Session>,
    retry: false,
    // No session_id yet (pending) → nothing to export, don't poll a 404.
    enabled: !!review?.session_id,
    refetchOnWindowFocus: false,
    // The transcript is the heavy payload — the server spawns a whole opencode
    // instance per call — so this is the snapshot only: fetched on mount, then
    // kept current by review:transcript deltas below. What's left here is the
    // fallback for a dead stream, at 20s rather than the old 2s.
    refetchInterval: inProgress && tab === "transcript" && !streaming ? 20000 : false,
  });
  const {
    data: findings,
    isError: findingsError,
    refetch: refetchFindings,
  } = useQuery({
    queryKey: ["reviews", numId, "findings"],
    queryFn: () => api.reviews.findings(numId),
    refetchOnWindowFocus: false,
    // Findings only render on the review tab, so don't poll them from behind
    // the transcript. The write-back route publishes review:findings, and the
    // running→done effect below refetches once, so switching tabs never lands
    // on a stale list.
    refetchInterval: inProgress && tab === "review" ? 2000 : false,
  });

  useEffect(() => {
    if (resync > 0) {
      queryClient.invalidateQueries({ queryKey: ["reviews", numId] });
      queryClient.invalidateQueries({ queryKey: ["reviews", numId, "findings"] });
      queryClient.invalidateQueries({ queryKey: ["reviews", numId, "session"] });
    }
  }, [resync, numId, queryClient]);

  // Auto-select the tab when the review's progress state changes: transcript
  // while running, review once finished. Manual switching within a state is
  // preserved since this only fires on transitions. On the running→done
  // transition, refetch session/findings once — their polls stop when we
  // observe "completed", which can predate the runner's final writes.
  const wasInProgress = useRef(false);
  useEffect(() => {
    if (!review) return;
    // Improver runs post no findings — the transcript is the whole story.
    setTab(inProgress || review.trigger === "improve" ? "transcript" : "review");
    if (wasInProgress.current && !inProgress) {
      queryClient.invalidateQueries({ queryKey: ["reviews", numId, "session"] });
      queryClient.invalidateQueries({ queryKey: ["reviews", numId, "findings"] });
    }
    wasInProgress.current = inProgress;
  }, [inProgress, review?.id]);

  if (reviewError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
        <p className="text-sm text-zinc-500">Couldn't load this review.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchReview()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-32 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-24 rounded-lg bg-zinc-900/60 animate-pulse" />
      </div>
    );
  }

  const [owner, name] = review.repo_full_name.split("/");
  const isImprover = review.trigger === "improve";
  const messages = session?.messages ?? [];

  return (
    <div className="mx-auto space-y-6 max-w-5xl">
      <Link
        to="/reviews"
        className="text-sm text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
      >
        <ArrowLeft size={14} /> Reviews
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight truncate">
            {review.title ?? `Review #${review.id}`}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
            {isImprover ? (
              <Link
                to="/repos/$owner/$name"
                params={{ owner, name }}
                className="font-mono text-zinc-400 hover:text-zinc-200"
              >
                {review.repo_full_name}
              </Link>
            ) : (
              <a
                href={`https://github.com/${owner}/${name}/pull/${review.pr_number}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-zinc-400 hover:text-zinc-200"
              >
                {review.repo_full_name}#{review.pr_number}
                <ExternalLink size={12} className="opacity-50" />
              </a>
            )}
            <span title={new Date(review.created_at * 1000).toLocaleString()}>
              started {timeAgo(review.created_at)}
            </span>
            {review.completed_at && (
              <span className="tabular-nums">
                · {duration(review.created_at, review.completed_at)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge status={status} />
          <Badge status={review.status} />
        </div>
        {inProgress && (
          <Button
            variant="destructive"
            size="sm"
            disabled={stopMut.isPending}
            onClick={() => stopMut.mutate()}
          >
            <Square size={13} />
            Stop
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={retryMut.isPending || inProgress}
          onClick={() => retryMut.mutate()}
        >
          <RotateCw size={14} />
          {isImprover ? "Re-run" : "Retry"}
        </Button>
      </div>

      {session?.info && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500 tabular-nums">
          {session.info.model?.id && (
            <span>
              model: <span className="text-zinc-300">{session.info.model.id}</span>
            </span>
          )}
          {session.info.cost != null && (
            <span>
              cost: <span className="text-zinc-300">${session.info.cost.toFixed(4)}</span>
            </span>
          )}
          {session.info.tokens && (
            <span>
              tokens:{" "}
              <span className="text-zinc-300">
                {session.info.tokens.input ?? 0}→{session.info.tokens.output ?? 0}
              </span>
              {session.info.tokens.reasoning ? ` (r:${session.info.tokens.reasoning})` : ""}
            </span>
          )}
        </div>
      )}

      {review.status === "failed" && review.error && (
        <div className="flex items-start gap-2 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{review.error}</pre>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div
            role="tablist"
            className={`inline-flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs ${
              isImprover ? "hidden" : ""
            }`}
          >
            <Button
              type="button"
              variant="ghost"
              role="tab"
              aria-selected={tab === "review"}
              onClick={() => setTab("review")}
              className={`h-auto rounded px-2.5 py-1 text-xs font-medium ${
                tab === "review"
                  ? "bg-zinc-800 text-zinc-100 hover:bg-zinc-800"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <ClipboardCheck size={13} /> Review
              {findings && findings.length > 0 && (
                <span className="tabular-nums text-zinc-500">{findings.length}</span>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              role="tab"
              aria-selected={tab === "transcript"}
              onClick={() => setTab("transcript")}
              className={`h-auto rounded px-2.5 py-1 text-xs font-medium ${
                tab === "transcript"
                  ? "bg-zinc-800 text-zinc-100 hover:bg-zinc-800"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <ScrollText size={13} /> Transcript
            </Button>
          </div>
          {inProgress && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="relative grid place-items-center">
                <Radio size={12} />
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" />
              </span>
              {streaming ? "live · streaming" : "live · polling"}
            </span>
          )}
        </div>

        {tab === "review" ? (
          <ReviewView
            findings={findings}
            isError={findingsError}
            onRetry={refetchFindings}
            owner={owner}
            name={name}
            pr={review.pr_number}
            pending={inProgress}
          />
        ) : sessionError ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-8 text-center">
            <p className="text-sm text-zinc-500">Couldn't load transcript.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchSession()}>
              Retry
            </Button>
          </div>
        ) : session == null ? (
          <p className="text-sm text-zinc-500">Loading transcript…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-zinc-500">No transcript available for this review.</p>
        ) : (
          <div className="space-y-4">
            {messages.map((m, i) => (
              <MessageView key={m.info?.id ?? `m-${i}`} m={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const EVENT: Record<string, string> = {
  REQUEST_CHANGES: "text-red-300",
  APPROVE: "text-emerald-300",
  COMMENT: "text-zinc-300",
};
const SEVERITY_RANK: Record<string, number> = { blocking: 0, question: 1, nit: 2 };
function bySeverity(a: FindingRow, b: FindingRow): number {
  const r = (SEVERITY_RANK[a.severity ?? ""] ?? 3) - (SEVERITY_RANK[b.severity ?? ""] ?? 3);
  if (r !== 0) return r;
  const p = (a.path ?? "").localeCompare(b.path ?? "");
  if (p !== 0) return p;
  return (a.line ?? 0) - (b.line ?? 0);
}

function ReviewView({
  findings,
  isError,
  onRetry,
  owner,
  name,
  pr,
  pending,
}: {
  findings?: FindingRow[];
  isError?: boolean;
  onRetry: () => void;
  owner: string;
  name: string;
  pr: number;
  pending: boolean;
}) {
  if (isError)
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-8 text-center">
        <p className="text-sm text-zinc-500">Couldn't load findings.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  if (findings == null) return <p className="text-sm text-zinc-500">Loading review…</p>;
  if (findings.length === 0)
    return (
      <p className="text-sm text-zinc-500">
        {pending ? "No findings posted yet." : "This review posted no findings."}
      </p>
    );

  const summary = findings.find((f) => f.kind === "summary");
  const inline = findings.filter((f) => f.kind === "inline").sort(bySeverity);
  const comments = findings.filter((f) => f.kind === "comment");
  const prUrl = `https://github.com/${owner}/${name}/pull/${pr}`;

  return (
    <div className="space-y-4">
      {summary && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium">
            <span className={EVENT[summary.event ?? "COMMENT"] ?? "text-zinc-300"}>
              {summary.event ?? "COMMENT"}
            </span>
            {summary.github_review_id && (
              <a
                href={`${prUrl}#pullrequestreview-${summary.github_review_id}`}
                target="_blank"
                rel="noreferrer"
                title="Open review on GitHub"
                className="ml-auto inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300"
              >
                view on GitHub <ExternalLink size={11} className="opacity-60" />
              </a>
            )}
          </div>
          <Markdown>{summary.body}</Markdown>
        </div>
      )}

      {inline.length > 0 && (
        <div className="space-y-2">
          {inline.map((f) => (
            <div key={f.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                {f.severity && <Badge severity={f.severity} />}
                <a
                  href={
                    f.github_comment_id != null
                      ? `${prUrl}#discussion_r${f.github_comment_id}`
                      : `${prUrl}/files`
                  }
                  target="_blank"
                  rel="noreferrer"
                  title={f.github_comment_id != null ? "Open comment on GitHub" : undefined}
                  className="font-mono text-zinc-400 hover:text-zinc-200"
                >
                  {f.path}
                  {f.line != null ? `:${f.line}` : ""}
                </a>
              </div>
              <Markdown>{f.body}</Markdown>
            </div>
          ))}
        </div>
      )}

      {comments.map((f) => (
        <div key={f.id} className="rounded-md border border-zinc-800/70 bg-zinc-950 p-3">
          <div className="mb-1 text-xs font-medium text-zinc-500">PR comment</div>
          <Markdown>{f.body}</Markdown>
        </div>
      ))}
    </div>
  );
}

function MessageView({ m }: { m: Message }) {
  const isUser = m.info?.role === "user";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
        {isUser ? <User size={12} /> : <Bot size={12} />}
        {isUser ? "You" : "Assistant"}
      </div>
      <div className="space-y-2">
        {(m.parts ?? []).map((p, i) => (
          <PartView key={p.id ?? `${m.info?.id}-p-${i}`} p={p} />
        ))}
      </div>
    </div>
  );
}

function PartView({ p }: { p: Part }) {
  switch (p.type) {
    case "text":
      return (
        <div className="max-h-80 overflow-auto rounded-md bg-zinc-900/60 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 whitespace-pre-wrap">
          {p.text}
        </div>
      );
    case "reasoning":
      return (
        <details className="rounded-md border border-zinc-800/60 bg-zinc-950">
          <summary className="cursor-pointer px-3 py-1.5 text-xs text-zinc-500">reasoning</summary>
          <pre className="px-3 pb-2 text-xs text-zinc-500 whitespace-pre-wrap">{p.text}</pre>
        </details>
      );
    case "tool":
      return (
        <details className="rounded-md border border-zinc-800/60 bg-zinc-950">
          <summary className="cursor-pointer flex items-center gap-2 px-3 py-1.5 text-xs">
            <Terminal size={12} className="text-zinc-500" />
            <span className="font-mono text-zinc-300">{p.tool}</span>
            {p.state?.title && <span className="text-zinc-500">— {p.state.title}</span>}
            {p.state?.status && <span className="ml-auto text-zinc-500">{p.state.status}</span>}
          </summary>
          {p.state?.output && (
            <pre className="overflow-auto max-h-60 px-3 pb-2 text-xs text-zinc-400">
              {p.state.output}
            </pre>
          )}
          {p.state?.error && <pre className="px-3 pb-2 text-xs text-red-300">{p.state.error}</pre>}
        </details>
      );
    case "step-start":
    case "step-finish":
      return null;
    default:
      return null;
  }
}
