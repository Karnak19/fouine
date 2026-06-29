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
import { Plus } from "lucide-react";

export default function ReposPage() {
  const queryClient = useQueryClient();
  const { data: repos = [] as RepoRow[] } = useQuery({
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
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Repositories</h1>

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

      {repos.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Repository</TableHead>
              <TableHead>Installation</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Registered</TableHead>
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
  return (
    <TableRow>
      <TableCell>
        <Link
          to="/repos/$owner/$name"
          params={{ owner, name }}
          className="text-zinc-100 hover:underline font-mono text-sm"
        >
          {repo.full_name}
        </Link>
      </TableCell>
      <TableCell className="text-zinc-400 text-sm">{repo.installation_id}</TableCell>
      <TableCell className="text-zinc-400 text-sm font-mono">{repo.model ?? "default"}</TableCell>
      <TableCell className="text-zinc-500 text-sm">
        {new Date(repo.created_at * 1000).toLocaleDateString()}
      </TableCell>
    </TableRow>
  );
}
