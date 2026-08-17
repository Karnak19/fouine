import { test, expect } from "bun:test";
import { searchModels, configuredProviders, SEARCH_LIMIT, type ModelOption } from "~/review/models";
import { settings } from "~/db";
import { SETTINGS, ZAI_PROVIDER, resolveDefaultModel } from "~/settings";

const opt = (id: string): ModelOption => {
  const [provider, model] = id.split("/") as [string, string];
  return { id, provider, providerName: provider, model, modelName: model, configured: false };
};

const CATALOG = [
  opt("zai-coding-plan/glm-5.2"),
  opt("zai-coding-plan/glm-4.7"),
  opt("opencode-go/glm-5.2"),
  opt("anthropic/claude-opus-5"),
];

test("matches on provider or model, case-insensitively", () => {
  expect(searchModels(CATALOG, "zai").map((m) => m.id)).toEqual([
    "zai-coding-plan/glm-5.2",
    "zai-coding-plan/glm-4.7",
  ]);
  expect(searchModels(CATALOG, "GLM-5.2").map((m) => m.id)).toEqual([
    "zai-coding-plan/glm-5.2",
    "opencode-go/glm-5.2",
  ]);
  expect(searchModels(CATALOG, "nope")).toEqual([]);
});

test("an empty query returns the head of the catalog, order preserved", () => {
  expect(searchModels(CATALOG, "   ").map((m) => m.id)).toEqual(CATALOG.map((m) => m.id));
});

test("the bundled snapshot covers the providers fouine documents", async () => {
  // listModels falls back to this when models.dev is unreachable, so a review
  // host with no egress must still be able to pick a GLM Coding Plan model.
  const { providers } = await import("@opencode-ai/models/snapshot");
  expect(Object.keys(providers["zai-coding-plan"]?.models ?? {})).toContain("glm-5.2");
  expect(providers["opencode-go"]?.models).toBeTruthy();
});

test("results are capped so the ~5.7k-entry catalog never ships whole", () => {
  const big = Array.from({ length: 500 }, (_, i) => opt(`p/m${i}`));
  expect(searchModels(big, "").length).toBe(SEARCH_LIMIT);
  expect(searchModels(big, "m").length).toBe(SEARCH_LIMIT);
});

test("configuredProviders keeps providers named by live settings, key or not", () => {
  // The default model always names a provider, so the picker is never empty —
  // otherwise a fresh install would have nothing to select.
  const provider = resolveDefaultModel().split("/")[0]!;
  expect(configuredProviders().has(provider)).toBe(true);
});

test("configuredProviders picks up the GLM plan once its key is set", () => {
  expect(configuredProviders().has(ZAI_PROVIDER)).toBe(false);
  settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "zai-key" });
  try {
    expect(configuredProviders().has(ZAI_PROVIDER)).toBe(true);
  } finally {
    settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "" });
  }
});
