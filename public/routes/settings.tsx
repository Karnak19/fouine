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

  useEffect(() => {
    if (settings) {
      setModel(settings.opencode_model ?? "");
      setPrompt(settings.default_prompt ?? "");
    }
  }, [settings]);

  const updateMut = useMutation({
    mutationFn: () => {
      const data: Settings = {};
      if (apiKey.trim()) data.opencode_api_key = apiKey.trim();
      if (model.trim()) data.opencode_model = model.trim();
      if (prompt.trim()) data.default_prompt = prompt.trim();
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
    </div>
  );
}
