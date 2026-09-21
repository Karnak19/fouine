import { test, expect } from "bun:test";
import {
  searchModels,
  configuredProviders,
  flatten,
  SEARCH_LIMIT,
  type ModelOption,
} from "~/review/models";
import { settings } from "~/db";
import { SETTINGS, ZAI_PROVIDER, COMMANDCODE_PROVIDER, resolveDefaultModel } from "~/settings";
import { commandcodeModels, toConfigKey } from "~/review/commandcode";
import { parseModel } from "~/review/opencode";

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

test("configuredProviders picks up Command Code once its key is set", () => {
  expect(configuredProviders().has(COMMANDCODE_PROVIDER)).toBe(false);
  settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "cc-key" });
  try {
    expect(configuredProviders().has(COMMANDCODE_PROVIDER)).toBe(true);
  } finally {
    settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "" });
  }
});

test("Command Code models are appended to the catalog, honouring the configured filter", () => {
  // models.dev has no Command Code entry, so the options come from the catalog
  // bundled with the opencode plugin.
  type Providers = Parameters<typeof flatten>[0];
  const empty = {} as Providers;

  // No key, no `all`: hidden like any other unconfigured provider.
  expect(flatten(empty, false).filter((m) => m.provider === COMMANDCODE_PROVIDER)).toEqual([]);

  // `all` shows them, flagged as not configured.
  const shown = flatten(empty, true).filter((m) => m.provider === COMMANDCODE_PROVIDER);
  expect(shown.map((m) => m.id)).toEqual(
    commandcodeModels()
      .map((m) => `${COMMANDCODE_PROVIDER}/${m.id}`)
      .sort(),
  );
  // Specs carry the plugin's config key, never the org-prefixed upstream id.
  expect(shown.map((m) => m.id)).toContain(`${COMMANDCODE_PROVIDER}/deepseek-v4-flash`);
  expect(shown.every((m) => !m.model.includes("/"))).toBe(true);
  expect(shown.every((m) => m.configured === false)).toBe(true);
  expect(shown[0]?.providerName).toBe("Command Code");

  settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "cc-key" });
  try {
    const configured = flatten(empty, false).filter((m) => m.provider === COMMANDCODE_PROVIDER);
    expect(configured.length).toBe(commandcodeModels().length);
    expect(configured.every((m) => m.configured)).toBe(true);
  } finally {
    settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "" });
  }
});

test("Command Code picker ids are the plugin's config keys: org prefix dropped, lowercased", () => {
  expect(toConfigKey("deepseek/deepseek-v4-flash")).toBe("deepseek-v4-flash");
  expect(toConfigKey("zai-org/GLM-5.2")).toBe("glm-5.2");
  expect(toConfigKey("moonshotai/Kimi-K2.7-Code")).toBe("kimi-k2.7-code");
  expect(toConfigKey("gpt-5.5")).toBe("gpt-5.5");
  // No two catalog entries may collapse onto one key.
  const ids = commandcodeModels().map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("a spec splits on the first slash only — an org-prefixed model id keeps its own", () => {
  expect(parseModel("openrouter/deepseek/deepseek-v4-flash")).toEqual({
    providerID: "openrouter",
    modelID: "deepseek/deepseek-v4-flash",
  });
  expect(parseModel("commandcode/deepseek-v4-flash")).toEqual({
    providerID: "commandcode",
    modelID: "deepseek-v4-flash",
  });
  expect(parseModel("opencode-go/glm-5.2")).toEqual({
    providerID: "opencode-go",
    modelID: "glm-5.2",
  });
  expect(() => parseModel("no-slash")).toThrow();
  expect(() => parseModel("provider/")).toThrow();
});
