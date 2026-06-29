import { useQuery } from "@tanstack/react-query";
import { api, type ReviewRow } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ReviewsPage() {
  const { data: reviews = [] as ReviewRow[] } = useQuery({
    queryKey: ["reviews"],
    queryFn: api.reviews.list,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Reviews</h1>

      {reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">No reviews yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>PR</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-zinc-400">{r.id}</TableCell>
                <TableCell className="font-mono text-sm">{r.repo_full_name}</TableCell>
                <TableCell>#{r.pr_number}</TableCell>
                <TableCell>
                  <Badge status={r.status} />
                </TableCell>
                <TableCell className="text-zinc-500 text-sm">
                  {new Date(r.created_at * 1000).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
