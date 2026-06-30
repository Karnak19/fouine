import { useQuery } from "@tanstack/react-query";
import { api, type ReviewRow } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, GitPullRequest } from "lucide-react";

export default function ReviewsPage() {
  const { data: reviews, isLoading } = useQuery({
    queryKey: ["reviews"],
    queryFn: api.reviews.list,
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>
        <p className="text-sm text-zinc-500 mt-1">Every review fouine has run, newest first.</p>
      </div>

      {isLoading ? (
        <ReviewSkeleton />
      ) : !reviews?.length ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>PR</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.map((r) => (
              <ReviewRow key={r.id} r={r} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ReviewRow({ r }: { r: ReviewRow }) {
  const [owner, name] = r.repo_full_name.split("/");
  return (
    <TableRow>
      <TableCell className="text-zinc-500 tabular-nums">{r.id}</TableCell>
      <TableCell className="font-mono text-sm text-zinc-200">{r.repo_full_name}</TableCell>
      <TableCell>
        <a
          href={`https://github.com/${owner}/${name}/pull/${r.pr_number}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-zinc-300 hover:text-zinc-100 tabular-nums"
        >
          #{r.pr_number}
          <ExternalLink size={12} className="opacity-50" />
        </a>
      </TableCell>
      <TableCell>
        <Badge status={r.status} />
      </TableCell>
      <TableCell
        className="text-zinc-500 text-sm text-right"
        title={new Date(r.created_at * 1000).toLocaleString()}
      >
        {timeAgo(r.created_at)}
      </TableCell>
    </TableRow>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-10 rounded-md bg-zinc-900/60 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
      <GitPullRequest size={28} className="text-zinc-700" />
      <p className="mt-3 text-sm text-zinc-400">No reviews yet</p>
      <p className="text-xs text-zinc-600 mt-1">
        Comment <code className="text-zinc-500">/review</code> on a PR to kick one off.
      </p>
    </div>
  );
}
