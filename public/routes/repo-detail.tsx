import { useState, useEffect, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ReviewRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Trash2, ExternalLink, ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { timeAgo } from "@/lib/format";

export default function RepoDetailPage() {
  const { owner, name } = useParams({ from: "/repos/$owner/$name" });
  const queryClient = useQueryClient();

  const { data: repo } = useQuery({
    queryKey: ["repos", owner, name],
    queryFn: () => api.repos.get(owner, name),
  });

  const { data: reviews = [] as ReviewRow[] } = useQuery({
    queryKey: ["repos", owner, name, "reviews"],
    queryFn: () => api.repos.reviews(owner, name),
  });

  // Group reviews by PR — reviews come newest-first, so each group's head is the
  // latest run; groups sort by that latest run, newest PR activity first.
  const prGroups = useMemo(() => {
    const map = new Map<number, ReviewRow[]>();
    for (const r of reviews) {
      const arr = map.get(r.pr_number);
      if (arr) arr.push(r);
      else map.set(r.pr_number, [r]);
    }
    return [...map.values()].sort((a, b) => b[0].id - a[0].id);
  }, [reviews]);

  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (repo) {
      setModel(repo.model ?? "");
      setPrompt(repo.prompt ?? "");
      setEnabled(repo.enabled !== 0);
    }
  }, [repo]);

  const updateMut = useMutation({
    mutationFn: () =>
      api.repos.update(owner, name, {
        model: model.trim() || undefined,
        prompt: prompt.trim() || undefined,
        enabled: enabled ? 1 : 0,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos", owner, name] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.repos.delete(owner, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      window.location.href = "/";
    },
  });

  if (!repo) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="h-4 w-32 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-8 w-64 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-64 rounded-lg bg-zinc-900/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        to="/repos"
        className="text-sm text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
      >
        <ArrowLeft size={14} /> Repositories
      </Link>

      <div>
        <h1 className="text-2xl font-bold font-mono">{repo.full_name}</h1>
        <p className="text-sm text-zinc-400">Installation ID: {repo.installation_id}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMut.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="model">Model override</Label>
              <Input
                id="model"
                placeholder="provider/model (leave empty for default)"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt">Review prompt override</Label>
              <Textarea
                id="prompt"
                rows={8}
                placeholder="Custom review instructions for this repo..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
              <input
                id="enabled"
                type="checkbox"
                className="h-4 w-4 accent-zinc-200"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Auto-review new PRs on this repo
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={updateMut.isPending}>
                Save
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (confirm("Delete this repository?")) deleteMut.mutate();
                }}
              >
                <Trash2 size={14} />
                Delete
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviews by PR</CardTitle>
        </CardHeader>
        <CardContent>
          {prGroups.length === 0 ? (
            <p className="text-sm text-zinc-500">No reviews yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PR</TableHead>
                  <TableHead className="text-right">Reviews</TableHead>
                  <TableHead>Latest</TableHead>
                  <TableHead className="text-right">Last run</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {prGroups.map((group) => {
                  const latest = group[0];
                  return (
                    <TableRow key={latest.pr_number}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Link
                            to="/repos/$owner/$name/pr/$number"
                            params={{ owner, name, number: String(latest.pr_number) }}
                            className="text-sm text-zinc-300 hover:text-zinc-100 tabular-nums"
                          >
                            #{latest.pr_number}
                          </Link>
                          <a
                            href={`https://github.com/${owner}/${name}/pull/${latest.pr_number}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-zinc-500 hover:text-zinc-300"
                          >
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      </TableCell>
                      <TableCell className="text-zinc-400 text-sm text-right tabular-nums">
                        {group.length}
                      </TableCell>
                      <TableCell>
                        <Badge status={latest.status} />
                      </TableCell>
                      <TableCell
                        className="text-zinc-500 text-sm text-right"
                        title={new Date(latest.created_at * 1000).toLocaleString()}
                      >
                        {timeAgo(latest.created_at)}
                      </TableCell>
                      <TableCell className="text-zinc-600">
                        <Link
                          to="/repos/$owner/$name/pr/$number"
                          params={{ owner, name, number: String(latest.pr_number) }}
                        >
                          <ChevronRight size={16} />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
