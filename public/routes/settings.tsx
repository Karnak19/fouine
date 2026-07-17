import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings.get,
  });

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [improverModel, setImproverModel] = useState("");

  useEffect(() => {
    if (settings) {
      setModel(settings.opencode_model ?? "");
      setPrompt(settings.default_prompt ?? "");
      setImproverModel(settings.improver_model ?? "");
    }
  }, [settings]);

  const updateMut = useMutation({
    mutationFn: () => {
      const data: Settings = {};
      if (apiKey.trim()) data.opencode_api_key = apiKey.trim();
      if (model.trim()) data.opencode_model = model.trim();
      if (prompt.trim()) data.default_prompt = prompt.trim();
      if (improverModel.trim()) data.improver_model = improverModel.trim();
      return api.settings.update(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setApiKey("");
    },
  });

  const testMut = useMutation({
    mutationFn: api.settings.test,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>OpenCode provider</CardTitle>
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
              <Label htmlFor="api_key">API key</Label>
              <Input
                id="api_key"
                type="password"
                placeholder="Set key to enable reviews"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-zinc-500">Leave blank to keep current value.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Default model</Label>
              <Input
                id="model"
                placeholder="opencode-go/glm-5.2"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="improver_model">Improver model</Label>
              <Input
                id="improver_model"
                placeholder="e.g. opencode-go/kimi-k3 — defaults to the review model"
                value={improverModel}
                onChange={(e) => setImproverModel(e.target.value)}
              />
              <p className="text-xs text-zinc-500">
                Used by the daily REVIEW.md improver. It runs rarely but its output shapes every
                future review — worth a stronger model than the reviewer.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt">Default review prompt</Label>
              <Textarea
                id="prompt"
                rows={10}
                placeholder="Reviewer instructions applied when a repo has no override..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={updateMut.isPending}>
              Save settings
            </Button>
          </form>
          <div className="border-t border-zinc-800 pt-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={testMut.isPending}
                onClick={() => {
                  testMut.reset();
                  testMut.mutate();
                }}
              >
                {testMut.isPending ? "Testing…" : "Test connection"}
              </Button>
              <span className="text-xs text-zinc-500">
                Sends one tiny request to the configured model.
              </span>
            </div>
            {testMut.data && (
              <p
                className={`mt-2 text-xs font-mono ${testMut.data.ok ? "text-emerald-400" : "text-red-400"}`}
              >
                {testMut.data.ok
                  ? `OK — model replied: ${testMut.data.text ?? ""}`
                  : `Failed: ${testMut.data.error ?? "unknown error"}`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <SkillsCard />
    </div>
  );
}

// Global reviewer skills, installed from a skills.sh / GitHub URL. They apply to
// every review; per-repo skills belong in the repo's own .claude/skills instead.
function SkillsCard() {
  const queryClient = useQueryClient();
  const { data: skills } = useQuery({ queryKey: ["skills"], queryFn: api.skills.list });
  const [url, setUrl] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["skills"] });

  const installMut = useMutation({
    mutationFn: () => api.skills.install(url.trim()),
    onSuccess: () => {
      invalidate();
      setUrl("");
    },
  });
  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.skills.setEnabled(name, enabled),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (name: string) => api.skills.remove(name),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reviewer skills</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) installMut.mutate();
          }}
          className="space-y-1.5"
        >
          <Label htmlFor="skill_url">Install a skill</Label>
          <div className="flex gap-2">
            <Input
              id="skill_url"
              placeholder="https://skills.sh/owner/repo/skill or a github.com URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button type="submit" disabled={installMut.isPending || !url.trim()}>
              {installMut.isPending ? "Installing…" : "Install"}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Global — applies to every review, live on the next one. For a single repo, commit a{" "}
            <code>.claude/skills/</code> folder to that repo instead.
          </p>
          {installMut.isError && (
            <p className="text-xs text-red-400">{String(installMut.error)}</p>
          )}
        </form>

        <div className="divide-y divide-zinc-800 border-t border-zinc-800">
          {skills?.length === 0 && (
            <p className="py-3 text-xs text-zinc-500">No skills installed yet.</p>
          )}
          {skills?.map((s) => (
            <div key={s.name} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-zinc-600"}`}
                  />
                  <span className="font-mono text-sm">{s.name}</span>
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    {s.owner}/{s.repo}@{s.ref.slice(0, 7)}
                  </a>
                </div>
                {s.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{s.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={toggleMut.isPending}
                  onClick={() => toggleMut.mutate({ name: s.name, enabled: !s.enabled })}
                >
                  {s.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(s.name)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
