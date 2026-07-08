import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type RepoRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, ChevronRight, FolderGit2 } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ReposPage() {
  const queryClient = useQueryClient();
  const { data: repos, isLoading } = useQuery({
    queryKey: ["repos"],
    queryFn: api.repos.list,
  });

  const [fullName, setFullName] = useState("");
  const [installId, setInstallId] = useState("");

  const createMut = useMutation({
    mutationFn: () => api.repos.create({ full_name: fullName, installation_id: Number(installId) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      setFullName("");
      setInstallId("");
    },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Repositories</h1>
        <p className="text-sm text-zinc-500 mt-1">Repos fouine watches for pull requests.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Register repository</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
            className="flex items-end gap-4"
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="full_name">Full name (owner/repo)</Label>
              <Input
                id="full_name"
                placeholder="acme/widgets"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                pattern="[^/]+/[^/]+"
              />
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor="installation_id">Installation ID</Label>
              <Input
                id="installation_id"
                type="number"
                placeholder="12345678"
                value={installId}
                onChange={(e) => setInstallId(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={createMut.isPending}>
              <Plus size={16} />
              Register
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 rounded-md bg-zinc-900/60 animate-pulse" />
          ))}
        </div>
      ) : !repos?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
          <FolderGit2 size={28} className="text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-400">No repositories registered</p>
          <p className="text-xs text-zinc-600 mt-1">Add one above to get started.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Repository</TableHead>
              <TableHead>Auto-review</TableHead>
              <TableHead>Installation</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Registered</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {repos.map((r) => (
              <RepoRow key={r.full_name} repo={r} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function RepoRow({ repo }: { repo: RepoRow }) {
  const [owner, name] = repo.full_name.split("/");
  const queryClient = useQueryClient();
  const enabled = repo.enabled === 1;

  const toggleMut = useMutation({
    // Resend the existing prompt/model — the PUT treats omitted fields as null,
    // so a bare { enabled } would wipe them.
    mutationFn: (next: boolean) =>
      api.repos.update(owner, name, {
        prompt: repo.prompt ?? undefined,
        model: repo.model ?? undefined,
        enabled: next ? 1 : 0,
      }),
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["repos"] });
      const prev = queryClient.getQueryData<RepoRow[]>(["repos"]);
      queryClient.setQueryData<RepoRow[]>(["repos"], (old) =>
        old?.map((r) => (r.full_name === repo.full_name ? { ...r, enabled: next ? 1 : 0 } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["repos"], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["repos"] }),
  });

  return (
    <TableRow>
      <TableCell>
        <Link
          to="/repos/$owner/$name"
          params={{ owner, name }}
          className={cn(
            "hover:underline font-mono text-sm",
            enabled ? "text-zinc-100" : "text-zinc-500",
          )}
        >
          {repo.full_name}
        </Link>
      </TableCell>
      <TableCell>
        <Switch
          checked={enabled}
          disabled={toggleMut.isPending}
          onChange={(v) => toggleMut.mutate(v)}
          label={`Auto-review ${repo.full_name}`}
        />
      </TableCell>
      <TableCell className="text-zinc-400 text-sm tabular-nums">{repo.installation_id}</TableCell>
      <TableCell className="text-zinc-400 text-sm font-mono">{repo.model ?? "default"}</TableCell>
      <TableCell className="text-zinc-500 text-sm text-right tabular-nums">
        {timeAgo(repo.created_at)}
      </TableCell>
      <TableCell className="text-zinc-600">
        <ChevronRight size={16} />
      </TableCell>
    </TableRow>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        checked ? "bg-primary" : "bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-zinc-950 transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}
