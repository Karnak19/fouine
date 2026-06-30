import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type ReviewRow } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format";
import { GitPullRequest, Radio, CircleAlert, Inbox } from "lucide-react";

const DAY_S = 24 * 60 * 60;

export default function DashboardPage() {
  const { data: reviews } = useQuery({
    queryKey: ["reviews"],
    queryFn: api.reviews.list,
    refetchInterval: (q) => {
      const list = q.state.data;
      if (!list) return false;
      return list.some((r) => r.status === "running" || r.status === "pending") ? 5000 : false;
    },
  });

  const now = Date.now() / 1000;
  const inFlight = reviews?.filter((r) => r.status === "running" || r.status === "pending") ?? [];
  const failedToday =
    reviews?.filter((r) => r.status === "failed" && r.created_at >= now - DAY_S) ?? [];
  const last24h = reviews?.filter((r) => r.created_at >= now - DAY_S) ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">What fouine is doing, latest first.</p>
      </div>

      <Section
        icon={<Radio size={14} className="text-sky-400" />}
        title="In flight"
        count={inFlight.length}
      >
        {inFlight.length === 0 ? (
          <Empty>No reviews running.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {inFlight.map((r) => (
              <ReviewLink key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        icon={<CircleAlert size={14} className="text-red-400" />}
        title="Failed today"
        count={failedToday.length}
      >
        {failedToday.length === 0 ? (
          <Empty>Nothing failed in the last 24 hours.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {failedToday.map((r) => (
              <ReviewLink key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        icon={<GitPullRequest size={14} className="text-zinc-400" />}
        title="Last 24 hours"
        count={last24h.length}
      >
        {last24h.length === 0 ? (
          <Empty>No reviews in the last 24 hours.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {last24h.map((r) => (
              <ReviewLink key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-3 border-b border-zinc-900">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          {icon}
          <span>{title}</span>
          <span className="text-zinc-500 font-normal tabular-nums">· {count}</span>
        </CardTitle>
      </CardHeader>
      {children}
    </Card>
  );
}

function ReviewLink({ r }: { r: ReviewRow }) {
  return (
    <li>
      <Link
        to="/reviews/$id"
        params={{ id: String(r.id) }}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-900/60 transition-colors"
      >
        <Badge status={r.status} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm text-zinc-200 truncate">
            {r.repo_full_name}#{r.pr_number}
          </div>
          {r.title && <div className="text-xs text-zinc-500 truncate">{r.title}</div>}
        </div>
        <span
          className="text-xs text-zinc-500 tabular-nums shrink-0"
          title={new Date(r.created_at * 1000).toLocaleString()}
        >
          {timeAgo(r.created_at)}
        </span>
      </Link>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-sm text-zinc-500">
      <Inbox size={14} className="text-zinc-700" />
      {children}
    </div>
  );
}
