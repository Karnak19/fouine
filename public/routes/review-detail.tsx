import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
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

export default function ReviewDetailPage() {
  const { id } = useParams({ from: "/reviews/$id" });
  const numId = Number(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const retryMut = useMutation({
    mutationFn: () => api.reviews.retry(numId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      navigate({ to: "/reviews" });
    },
  });

  const { data: review } = useQuery({
    queryKey: ["reviews", numId],
    queryFn: () => api.reviews.get(numId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "running" || s === "pending" ? 2000 : false;
    },
  });
  const { data: session } = useQuery({
    queryKey: ["reviews", numId, "session"],
    queryFn: () => api.reviews.session(numId) as Promise<Session>,
    retry: false,
    refetchInterval: () =>
      review?.status === "running" || review?.status === "pending" ? 2000 : false,
  });

  if (!review) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-32 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-24 rounded-lg bg-zinc-900/60 animate-pulse" />
      </div>
    );
  }

  const [owner, name] = review.repo_full_name.split("/");
  const messages = session?.messages ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
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
            <a
              href={`https://github.com/${owner}/${name}/pull/${review.pr_number}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-zinc-400 hover:text-zinc-200"
            >
              {review.repo_full_name}#{review.pr_number}
              <ExternalLink size={12} className="opacity-50" />
            </a>
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
        <Badge status={review.status} />
        <Button
          variant="outline"
          size="sm"
          disabled={
            retryMut.isPending || review.status === "running" || review.status === "pending"
          }
          onClick={() => retryMut.mutate()}
        >
          <RotateCw size={14} />
          Retry
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-400">Session</h2>
          {(review?.status === "running" || review?.status === "pending") && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="relative grid place-items-center">
                <Radio size={12} />
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" />
              </span>
              live · polling every 2s
            </span>
          )}
        </div>
        {session == null ? (
          <p className="text-sm text-zinc-600">Loading transcript…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-zinc-600">No transcript available for this review.</p>
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
            {p.state?.status && <span className="ml-auto text-zinc-600">{p.state.status}</span>}
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
