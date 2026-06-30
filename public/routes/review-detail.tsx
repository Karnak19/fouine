import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { timeAgo, duration } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, CircleAlert, Terminal } from "lucide-react";

interface LoosePart {
  type?: string;
  tool?: string;
  text?: string;
  state?: { status?: string; title?: string; output?: string; error?: string };
}

function extractParts(data: unknown): LoosePart[] {
  if (Array.isArray(data)) return data as LoosePart[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.parts)) return o.parts as LoosePart[];
    if (Array.isArray(o.messages)) return o.messages as LoosePart[];
  }
  return [];
}

export default function ReviewDetailPage() {
  const { id } = useParams({ from: "/reviews/$id" });
  const numId = Number(id);

  const { data: review } = useQuery({
    queryKey: ["reviews", numId],
    queryFn: () => api.reviews.get(numId),
  });
  const { data: session } = useQuery({
    queryKey: ["reviews", numId, "session"],
    queryFn: () => api.reviews.session(numId),
    retry: false,
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
  const parts = extractParts(session);
  const noShape = parts.length === 0 && session != null;

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
          <div className="mt-1 flex items-center gap-3 text-sm text-zinc-500">
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
      </div>

      {review.status === "failed" && review.error && (
        <div className="flex items-start gap-2 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{review.error}</pre>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Session</h2>
        {session == null ? (
          <p className="text-sm text-zinc-600">Loading transcript…</p>
        ) : noShape ? (
          <details className="rounded-md border border-zinc-800 bg-zinc-950">
            <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-500">
              Raw session JSON (renderer refines once shape is confirmed)
            </summary>
            <pre className="overflow-auto px-3 pb-3 text-xs text-zinc-400">
              {JSON.stringify(session, null, 2)}
            </pre>
          </details>
        ) : (
          <div className="space-y-2">
            {parts.map((p, i) => (
              <PartView key={i} p={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PartView({ p }: { p: LoosePart }) {
  switch (p.type) {
    case "text":
      return (
        <div className="rounded-md bg-zinc-900/60 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 whitespace-pre-wrap">
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
            <pre className="overflow-auto px-3 pb-2 text-xs text-zinc-400">{p.state.output}</pre>
          )}
          {p.state?.error && <pre className="px-3 pb-2 text-xs text-red-300">{p.state.error}</pre>}
        </details>
      );
    default:
      return null;
  }
}
