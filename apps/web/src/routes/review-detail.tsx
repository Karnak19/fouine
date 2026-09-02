import { useState, useEffect, useRef } from "react";
import * as stylex from "@stylexjs/stylex";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "@tanstack/react-router";
import { color, font, leading, radius, space, text, tracking } from "@/tokens.stylex";
import { api, type FindingRow } from "@/lib/api";
import { useLiveEvents, type TranscriptDelta } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { timeAgo, duration } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ClipboardCheck
} from "lucide-react";

// Tailwind's `animate-pulse` (skeleton) and `animate-ping` (live dot).
// Restated locally because the @keyframes only exist while a className
// references the utility.
const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });
const ping = stylex.keyframes({ "75%, 100%": { transform: "scale(2)", opacity: 0 } });

const s = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.x24, maxWidth: space.x896 },
  stack2: { display: "flex", flexDirection: "column", gap: space.x8 },
  stack4: { display: "flex", flexDirection: "column", gap: space.x16 },

  skeletonBar: {
    height: space.x16,
    width: space.x128,
    borderRadius: radius.base,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 60%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },
  skeletonBlock: {
    height: space.x96,
    borderRadius: radius.lg,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 60%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },

  backLink: {
    display: "flex",
    alignItems: "center",
    gap: space.x4,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: { default: color.zinc400, ":hover": color.zinc100 }
  },

  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.x16 },
  headerMain: { minWidth: 0 },
  title: {
    fontSize: text.xl,
    lineHeight: leading.xl,
    fontWeight: 700,
    letterSpacing: tracking.tight,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  meta: {
    marginTop: space.x4,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.x12,
    rowGap: space.x4,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc500
  },
  metaLink: {
    fontFamily: font.mono,
    color: { default: color.zinc400, ":hover": color.zinc200 }
  },
  metaLinkInline: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x4,
    fontFamily: font.mono,
    color: { default: color.zinc400, ":hover": color.zinc200 }
  },
  dim50: { opacity: 0.5 },
  dim60: { opacity: 0.6 },
  tabular: { fontVariantNumeric: "tabular-nums" },
  badges: { display: "flex", alignItems: "center", gap: space.x8 },

  sessionBar: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: space.x20,
    rowGap: space.x4,
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: color.zinc950,
    paddingInline: space.x12,
    paddingBlock: space.x8,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500,
    fontVariantNumeric: "tabular-nums"
  },
  value: { color: color.zinc300 },

  errorBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.x8,
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `color-mix(in oklab, ${color.dangerSurface} 50%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${color.dangerSurfaceDeep} 30%, transparent)`,
    padding: space.x12,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.dangerText
  },
  errorIcon: { marginTop: space.x2, flexShrink: 0 },
  errorText: {
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    fontFamily: font.mono,
    fontSize: text.xs,
    lineHeight: leading.xs
  },

  tabRow: {
    marginBottom: space.x12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.x12
  },
  tabGroup: {
    display: "inline-flex",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: color.zinc950,
    padding: space.x2,
    fontSize: text.xs,
    lineHeight: leading.xs
  },
  hidden: { display: "none" },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x6,
    borderRadius: radius.base,
    paddingInline: space.x10,
    paddingBlock: space.x4,
    fontWeight: 500,
    transitionProperty: "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)"
  },
  tabActive: { backgroundColor: color.zinc800, color: color.zinc100 },
  tabIdle: { color: { default: color.zinc500, ":hover": color.zinc300 } },
  tabCount: { fontVariantNumeric: "tabular-nums", color: color.zinc500 },

  liveRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x6,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.okDot
  },
  pingWrap: { position: "relative", display: "grid", placeItems: "center" },
  ping: {
    position: "absolute",
    inset: 0,
    borderRadius: radius.full,
    backgroundColor: `color-mix(in oklab, ${color.okDot} 40%, transparent)`,
    animationName: ping,
    animationDuration: "1s",
    animationTimingFunction: "cubic-bezier(0, 0, 0.2, 1)",
    animationIterationCount: "infinite"
  },

  muted: { fontSize: text.sm, lineHeight: leading.sm, color: color.zinc600 },

  summaryCard: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: color.zinc950,
    padding: space.x16
  },
  summaryHead: {
    marginBottom: space.x8,
    display: "flex",
    alignItems: "center",
    gap: space.x8,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500
  },
  githubLink: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: space.x4,
    color: { default: color.zinc500, ":hover": color.zinc300 }
  },
  body: {
    whiteSpace: "pre-wrap",
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc200
  },

  findingCard: {
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: color.zinc950,
    padding: space.x12
  },
  findingHead: {
    marginBottom: space.x6,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.x8,
    fontSize: text.xs,
    lineHeight: leading.xs
  },
  severityPill: {
    borderRadius: radius.base,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingInline: space.x6,
    paddingBlock: space.x2,
    fontWeight: 500
  },
  pathLink: { fontFamily: font.mono, color: { default: color.zinc400, ":hover": color.zinc200 } },

  commentCard: {
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `color-mix(in oklab, ${color.zinc800} 70%, transparent)`,
    backgroundColor: color.zinc950,
    padding: space.x12
  },
  commentLabel: {
    marginBottom: space.x4,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500,
    color: color.zinc500
  },

  messageHead: {
    display: "flex",
    alignItems: "center",
    gap: space.x6,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500,
    color: color.zinc500
  },

  textPart: {
    maxHeight: space.x320,
    overflow: "auto",
    borderRadius: radius.md,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 60%, transparent)`,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    paddingInline: space.x12,
    paddingBlock: space.x8,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc200,
    whiteSpace: "pre-wrap"
  },
  details: {
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `color-mix(in oklab, ${color.zinc800} 60%, transparent)`,
    backgroundColor: color.zinc950
  },
  detailsSummary: {
    cursor: "pointer",
    paddingInline: space.x12,
    paddingBlock: space.x6,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500
  },
  // `display: flex` is what drops the disclosure triangle here — the original
  // markup relied on the same thing, so it has to stay flex, not list-item.
  toolSummary: {
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: space.x8,
    paddingInline: space.x12,
    paddingBlock: space.x6,
    fontSize: text.xs,
    lineHeight: leading.xs
  },
  reasoningText: {
    paddingInline: space.x12,
    paddingBottom: space.x8,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500,
    whiteSpace: "pre-wrap"
  },
  toolIcon: { color: color.zinc500 },
  toolName: { fontFamily: font.mono, color: color.zinc300 },
  toolTitle: { color: color.zinc500 },
  toolStatus: { marginLeft: "auto", color: color.zinc600 },
  toolOutput: {
    overflow: "auto",
    maxHeight: space.x240,
    paddingInline: space.x12,
    paddingBottom: space.x8,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc400
  },
  toolError: {
    paddingInline: space.x12,
    paddingBottom: space.x8,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.dangerText
  }
});

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
      messages: [...messages, { info: { id: delta.messageId, role: delta.role }, parts: [] }]
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
  const navigate = useNavigate();

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      navigate({ to: "/reviews" });
    }
  });

  const stopMut = useMutation({
    mutationFn: () => api.reviews.stop(numId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reviews", numId] })
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

  const { data: review } = useQuery({
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
    }
  });
  const inProgress = review?.status === "running" || review?.status === "pending";
  const [tab, setTab] = useState<"review" | "transcript">("review");

  const { data: session } = useQuery({
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
    refetchInterval: inProgress && tab === "transcript" && !streaming ? 20000 : false
  });
  const { data: findings } = useQuery({
    queryKey: ["reviews", numId, "findings"],
    queryFn: () => api.reviews.findings(numId),
    refetchOnWindowFocus: false,
    // Findings only render on the review tab, so don't poll them from behind
    // the transcript. The write-back route publishes review:findings, and the
    // running→done effect below refetches once, so switching tabs never lands
    // on a stale list.
    refetchInterval: inProgress && tab === "review" ? 2000 : false
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

  if (!review) {
    return (
      <div {...stylex.props(s.stack4)}>
        <div {...stylex.props(s.skeletonBar)} />
        <div {...stylex.props(s.skeletonBlock)} />
      </div>
    );
  }

  const [owner, name] = review.repo_full_name.split("/");
  const isImprover = review.trigger === "improve";
  const messages = session?.messages ?? [];

  return (
    <div {...stylex.props(s.page)}>
      <Link to="/reviews" {...stylex.props(s.backLink)}>
        <ArrowLeft size={14} /> Reviews
      </Link>

      <div {...stylex.props(s.header)}>
        <div {...stylex.props(s.headerMain)}>
          <h1 {...stylex.props(s.title)}>{review.title ?? `Review #${review.id}`}</h1>
          <div {...stylex.props(s.meta)}>
            {isImprover ? (
              <Link
                to="/repos/$owner/$name"
                params={{ owner, name }}
                {...stylex.props(s.metaLink)}
              >
                {review.repo_full_name}
              </Link>
            ) : (
              <a
                href={`https://github.com/${owner}/${name}/pull/${review.pr_number}`}
                target="_blank"
                rel="noreferrer"
                {...stylex.props(s.metaLinkInline)}
              >
                {review.repo_full_name}#{review.pr_number}
                <ExternalLink size={12} {...stylex.props(s.dim50)} />
              </a>
            )}
            <span title={new Date(review.created_at * 1000).toLocaleString()}>
              started {timeAgo(review.created_at)}
            </span>
            {review.completed_at && (
              <span {...stylex.props(s.tabular)}>
                · {duration(review.created_at, review.completed_at)}
              </span>
            )}
          </div>
        </div>
        <div {...stylex.props(s.badges)}>
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
        <div {...stylex.props(s.sessionBar)}>
          {session.info.model?.id && (
            <span>
              model: <span {...stylex.props(s.value)}>{session.info.model.id}</span>
            </span>
          )}
          {session.info.cost != null && (
            <span>
              cost: <span {...stylex.props(s.value)}>${session.info.cost.toFixed(4)}</span>
            </span>
          )}
          {session.info.tokens && (
            <span>
              tokens:{" "}
              <span {...stylex.props(s.value)}>
                {session.info.tokens.input ?? 0}→{session.info.tokens.output ?? 0}
              </span>
              {session.info.tokens.reasoning ? ` (r:${session.info.tokens.reasoning})` : ""}
            </span>
          )}
        </div>
      )}

      {review.status === "failed" && review.error && (
        <div {...stylex.props(s.errorBox)}>
          <CircleAlert size={16} {...stylex.props(s.errorIcon)} />
          <pre {...stylex.props(s.errorText)}>{review.error}</pre>
        </div>
      )}

      <div>
        <div {...stylex.props(s.tabRow)}>
          <div {...stylex.props(s.tabGroup, isImprover && s.hidden)}>
            <button
              type="button"
              onClick={() => setTab("review")}
              {...stylex.props(s.tab, tab === "review" ? s.tabActive : s.tabIdle)}
            >
              <ClipboardCheck size={13} /> Review
              {findings && findings.length > 0 && (
                <span {...stylex.props(s.tabCount)}>{findings.length}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("transcript")}
              {...stylex.props(s.tab, tab === "transcript" ? s.tabActive : s.tabIdle)}
            >
              <ScrollText size={13} /> Transcript
            </button>
          </div>
          {inProgress && (
            <span {...stylex.props(s.liveRow)}>
              <span {...stylex.props(s.pingWrap)}>
                <Radio size={12} />
                <span {...stylex.props(s.ping)} />
              </span>
              {streaming ? "live · streaming" : "live · polling"}
            </span>
          )}
        </div>

        {tab === "review" ? (
          <ReviewView
            findings={findings}
            owner={owner}
            name={name}
            pr={review.pr_number}
            pending={inProgress}
          />
        ) : session == null ? (
          <p {...stylex.props(s.muted)}>Loading transcript…</p>
        ) : messages.length === 0 ? (
          <p {...stylex.props(s.muted)}>No transcript available for this review.</p>
        ) : (
          <div {...stylex.props(s.stack4)}>
            {messages.map((m, i) => (
              <MessageView key={m.info?.id ?? `m-${i}`} m={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// The badge's border/surface/text triple, not the chart dot palette.
// `SEVERITY_COLORS` from @/components/charts is backgroundColor-only (the
// saturated -400 dot hue), so painting these badges with it would replace a
// dark tinted surface with a solid bright one — see the note in the report.
// The alpha suffixes are the Tailwind ones verbatim, over exact tokens:
// dangerSurface = red-900, dangerSurfaceDeep = red-950, warnSurface =
// amber-900, warnSurfaceDeep = amber-950.
const severity = stylex.create({
  blocking: {
    borderColor: `color-mix(in oklab, ${color.dangerSurface} 60%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${color.dangerSurfaceDeep} 40%, transparent)`,
    color: color.dangerText
  },
  question: {
    borderColor: `color-mix(in oklab, ${color.warnSurface} 60%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${color.warnSurfaceDeep} 40%, transparent)`,
    color: color.warnText
  },
  nit: {
    borderColor: color.zinc700,
    backgroundColor: color.zinc900,
    color: color.zinc400
  },
  unknown: {
    borderColor: color.zinc700,
    color: color.zinc400
  }
});

const SEVERITY: Record<string, { label: string; style: stylex.StyleXStyles }> = {
  blocking: { label: "blocking", style: severity.blocking },
  question: { label: "question", style: severity.question },
  nit: { label: "nit", style: severity.nit }
};

const event = stylex.create({
  REQUEST_CHANGES: { color: color.dangerText },
  APPROVE: { color: color.okText },
  COMMENT: { color: color.zinc300 }
});
const EVENT: Record<string, stylex.StyleXStyles> = {
  REQUEST_CHANGES: event.REQUEST_CHANGES,
  APPROVE: event.APPROVE,
  COMMENT: event.COMMENT
};

function ReviewView({
  findings,
  owner,
  name,
  pr,
  pending
}: {
  findings?: FindingRow[];
  owner: string;
  name: string;
  pr: number;
  pending: boolean;
}) {
  if (findings == null) return <p {...stylex.props(s.muted)}>Loading review…</p>;
  if (findings.length === 0)
    return (
      <p {...stylex.props(s.muted)}>
        {pending ? "No findings posted yet." : "This review posted no findings."}
      </p>
    );

  const summary = findings.find((f) => f.kind === "summary");
  const inline = findings.filter((f) => f.kind === "inline");
  const comments = findings.filter((f) => f.kind === "comment");
  const prUrl = `https://github.com/${owner}/${name}/pull/${pr}`;

  return (
    <div {...stylex.props(s.stack4)}>
      {summary && (
        <div {...stylex.props(s.summaryCard)}>
          <div {...stylex.props(s.summaryHead)}>
            <span {...stylex.props(EVENT[summary.event ?? "COMMENT"] ?? event.COMMENT)}>
              {summary.event ?? "COMMENT"}
            </span>
            {summary.github_review_id && (
              <a
                href={`${prUrl}#pullrequestreview-${summary.github_review_id}`}
                target="_blank"
                rel="noreferrer"
                {...stylex.props(s.githubLink)}
              >
                view on GitHub <ExternalLink size={11} {...stylex.props(s.dim60)} />
              </a>
            )}
          </div>
          <div {...stylex.props(s.body)}>{summary.body}</div>
        </div>
      )}

      {inline.length > 0 && (
        <div {...stylex.props(s.stack2)}>
          {inline.map((f) => (
            <div key={f.id} {...stylex.props(s.findingCard)}>
              <div {...stylex.props(s.findingHead)}>
                {f.severity && (
                  <span
                    {...stylex.props(
                      s.severityPill,
                      SEVERITY[f.severity]?.style ?? severity.unknown,
                    )}
                  >
                    {SEVERITY[f.severity]?.label ?? f.severity}
                  </span>
                )}
                <a
                  href={`${prUrl}/files`}
                  target="_blank"
                  rel="noreferrer"
                  {...stylex.props(s.pathLink)}
                >
                  {f.path}
                  {f.line != null ? `:${f.line}` : ""}
                </a>
              </div>
              <div {...stylex.props(s.body)}>{f.body}</div>
            </div>
          ))}
        </div>
      )}

      {comments.map((f) => (
        <div key={f.id} {...stylex.props(s.commentCard)}>
          <div {...stylex.props(s.commentLabel)}>PR comment</div>
          <div {...stylex.props(s.body)}>{f.body}</div>
        </div>
      ))}
    </div>
  );
}

function MessageView({ m }: { m: Message }) {
  const isUser = m.info?.role === "user";
  return (
    <div {...stylex.props(s.stack2)}>
      <div {...stylex.props(s.messageHead)}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
        {isUser ? "You" : "Assistant"}
      </div>
      <div {...stylex.props(s.stack2)}>
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
        <div {...stylex.props(s.textPart)}>{p.text}</div>
      );
    case "reasoning":
      return (
        <details {...stylex.props(s.details)}>
          <summary {...stylex.props(s.detailsSummary)}>reasoning</summary>
          <pre {...stylex.props(s.reasoningText)}>{p.text}</pre>
        </details>
      );
    case "tool":
      return (
        <details {...stylex.props(s.details)}>
          <summary {...stylex.props(s.toolSummary)}>
            <Terminal size={12} {...stylex.props(s.toolIcon)} />
            <span {...stylex.props(s.toolName)}>{p.tool}</span>
            {p.state?.title && <span {...stylex.props(s.toolTitle)}>— {p.state.title}</span>}
            {p.state?.status && <span {...stylex.props(s.toolStatus)}>{p.state.status}</span>}
          </summary>
          {p.state?.output && <pre {...stylex.props(s.toolOutput)}>{p.state.output}</pre>}
          {p.state?.error && <pre {...stylex.props(s.toolError)}>{p.state.error}</pre>}
        </details>
      );
    case "step-start":
    case "step-finish":
      return null;
    default:
      return null;
  }
}
