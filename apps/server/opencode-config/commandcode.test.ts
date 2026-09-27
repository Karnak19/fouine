import { expect, test } from "bun:test";
import cmdPlugin from "./plugins/commandcode.ts";
import {
  buildProvider,
  registerProvider,
  registerIntegrationMethods,
  setupCommandcode,
  type CommandcodeCatalog,
  type CommandcodeContext,
  type IntegrationEditorLike,
  type ModelInfo,
  type ProviderEditorLike,
  type ProviderInfo,
} from "./plugins/_commandcode.ts";

// Deliberately NOT in plugins/: opencode discovers plugins by globbing
// {plugin,plugins}/*.{ts,js} in this dir, so a test next to the plugin would be
// loaded as one — importing bun:test into the review runtime. One level up is
// outside the glob (same reasoning as cap-bash-timeout.test.ts).

// opencode's own schemas, decoded with the effect build @opencode/schema ships
// with (v4, not the app's v3). The plugin can't import them at runtime (the
// runtime config dir has no node_modules), so this is where its hand-written
// Provider.Info / Model.Info values get held to the real shape: #155's fake
// editor accepted anything, which is how an untested registration shipped.
const pluginEntry = import.meta.resolve("@opencode/plugin");
const modelEntry = import.meta.resolve("@opencode/schema/model", pluginEntry);
const providerEntry = import.meta.resolve("@opencode/schema/provider", pluginEntry);
const Schema = (await import(import.meta.resolve("effect/Schema", modelEntry))) as {
  decodeUnknownSync: (schema: unknown) => (value: unknown) => unknown;
};
const { Info: ModelSchema } = (await import(modelEntry)) as {
  Info: { default: (providerID: string, id: string) => Record<string, unknown> };
};
const { Info: ProviderSchema } = (await import(providerEntry)) as {
  Info: { empty: (id: string) => Record<string, unknown> };
};

const catalog: CommandcodeCatalog = {
  "deepseek-v4-flash": {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    tool_call: true,
    cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
    limit: { context: 1000, output: 100 },
    modalities: { input: ["text", "image"], output: ["text"] },
    reasoningEfforts: ["low", "high"],
  },
  "glm-5.2": {
    id: "zai-org/GLM-5.2",
    name: "GLM 5.2",
    tool_call: false,
    cost: { input: 3, output: 4 },
    limit: { context: 2000, output: 200 },
  },
};

function recordingProviderEditor(
  added: Array<{ info: ProviderInfo; models: readonly ModelInfo[] }>,
): ProviderEditorLike {
  return { add: (input) => added.push(input) };
}

function recordingIntegrationEditor(
  calls: Array<{ integrationID: string; method: Record<string, unknown> }>,
): IntegrationEditorLike {
  return {
    method: {
      update(input) {
        calls.push(input as { integrationID: string; method: Record<string, unknown> });
      },
    },
  };
}

test("the provider and every model decode against opencode's own Provider.Info / Model.Info", () => {
  const { info, models } = buildProvider(catalog);
  expect(() => Schema.decodeUnknownSync(ProviderSchema)(info)).not.toThrow();
  for (const model of models) {
    expect(() => Schema.decodeUnknownSync(ModelSchema)(model)).not.toThrow();
  }
  // Same key set as opencode's own constructors (the docs' pattern spreads
  // them), so nothing required is silently missing.
  for (const key of Object.keys(ProviderSchema.empty("x"))) expect(info).toHaveProperty(key);
  for (const key of Object.keys(ModelSchema.default("p", "m"))) expect(models[0]).toHaveProperty(key);
});

test("registers the provider with editor.add as enabled, openai-compatible, against the gateway", () => {
  const added: Array<{ info: ProviderInfo; models: readonly ModelInfo[] }> = [];
  registerProvider(recordingProviderEditor(added), catalog);
  expect(added).toHaveLength(1);
  expect(added[0]?.info).toEqual({
    id: "commandcode",
    integrationID: "commandcode",
    name: "Command Code",
    // Load-bearing: "auto" would hide the provider until a credential is
    // stored, failing every run that names a commandcode model.
    activation: "enabled",
    package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: "https://api.commandcode.ai/provider/v1" },
  });
});

test("each catalog entry becomes a model keyed by config key, carrying the full upstream id", () => {
  const { models } = buildProvider(catalog);
  expect(models.map((m) => [m.providerID, m.id, m.modelID])).toEqual([
    ["commandcode", "deepseek-v4-flash", "deepseek/deepseek-v4-flash"],
    ["commandcode", "glm-5.2", "zai-org/GLM-5.2"],
  ]);
  expect(models[0]).toEqual({
    id: "deepseek-v4-flash",
    modelID: "deepseek/deepseek-v4-flash",
    providerID: "commandcode",
    name: "DeepSeek V4 Flash",
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: [
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "high", settings: { reasoningEffort: "high" } },
    ],
    time: { released: 0 },
    cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
    status: "active",
    enabled: true,
    limit: { context: 1000, output: 100 },
  });
});

test("omitted optional fields fall back to text-only, no reasoning, zero cache cost", () => {
  const { models } = buildProvider(catalog);
  expect(models[1]).toMatchObject({
    capabilities: { tools: false, input: ["text"], output: ["text"] },
    cost: [{ input: 3, output: 4, cache: { read: 0, write: 0 } }],
    variants: [],
  });
});

test("an empty catalog registers the provider but no models, and never throws", () => {
  const added: Array<{ info: ProviderInfo; models: readonly ModelInfo[] }> = [];
  expect(() => registerProvider(recordingProviderEditor(added), {})).not.toThrow();
  expect(added).toHaveLength(1);
  expect(added[0]?.models).toEqual([]);
});

test("registers the key and env methods the credential push resolves against", () => {
  const calls: Array<{ integrationID: string; method: Record<string, unknown> }> = [];
  registerIntegrationMethods(recordingIntegrationEditor(calls));
  expect(calls).toEqual([
    { integrationID: "commandcode", method: { type: "key", label: "Command Code API Key" } },
    { integrationID: "commandcode", method: { type: "env", names: ["COMMANDCODE_API_KEY"] } },
  ]);
});

// A fake context that behaves like opencode's: transforms are kept and
// replayed onto fresh state on every reload().
function replayingContext() {
  const providerTransforms: Array<(editor: ProviderEditorLike) => void> = [];
  const integrationTransforms: Array<(editor: IntegrationEditorLike) => void> = [];
  const state = {
    providers: [] as Array<{ info: ProviderInfo; models: readonly ModelInfo[] }>,
    methods: [] as Array<{ integrationID: string; method: Record<string, unknown> }>,
    reloads: 0,
  };
  const replayProviders = () => {
    state.providers = [];
    for (const t of providerTransforms) t(recordingProviderEditor(state.providers));
  };
  const replayIntegrations = () => {
    state.methods = [];
    for (const t of integrationTransforms) t(recordingIntegrationEditor(state.methods));
  };
  const ctx: CommandcodeContext = {
    provider: {
      transform: async (cb) => {
        providerTransforms.push(cb);
        replayProviders();
      },
      reload: async () => {
        state.reloads++;
        replayProviders();
      },
    },
    integration: {
      transform: async (cb) => {
        integrationTransforms.push(cb);
        replayIntegrations();
      },
      reload: async () => {
        replayIntegrations();
      },
    },
  };
  return { ctx, state };
}

test("setup registers nothing when the catalog reader comes up empty (no key configured)", async () => {
  // Absent catalog must mean "stay silent", not "throw" (a throwing transform
  // disables the plugin).
  const { ctx, state } = replayingContext();
  await setupCommandcode(ctx, () => undefined);
  expect(cmdPlugin.id).toBe("fouine.commandcode");
  expect(state.providers).toEqual([]);
  expect(state.methods).toEqual([]);
});

test("setup wires the catalog into both transforms when a key is configured", async () => {
  const { ctx, state } = replayingContext();
  await setupCommandcode(ctx, () => catalog);
  expect(state.providers).toHaveLength(1);
  expect(state.providers[0]?.models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "glm-5.2"]);
  expect(state.methods.map((m) => m.method.type)).toEqual(["key", "env"]);
});

test("a catalog written after setup (key saved on a running server) registers via reload", async () => {
  // The case that stayed broken until a restart: the location loaded before
  // the key existed, so its one-shot read saw no catalog.
  const { ctx, state } = replayingContext();
  let current: CommandcodeCatalog | undefined;
  let fire: () => void = () => {};
  let stopped = false;
  const stop = await setupCommandcode(
    ctx,
    () => current,
    (onChange) => {
      fire = onChange;
      return () => {
        stopped = true;
      };
    },
  );
  expect(state.providers).toEqual([]);

  current = catalog;
  fire();
  await Bun.sleep(0);
  await Bun.sleep(0);
  expect(state.reloads).toBe(1);
  expect(state.providers[0]?.models).toHaveLength(2);
  expect(state.methods).toHaveLength(2);

  // An unrelated change in plugins/ with the same catalog is not a reload.
  fire();
  await Bun.sleep(0);
  expect(state.reloads).toBe(1);

  // Key cleared → catalog removed → unregistered.
  current = undefined;
  fire();
  await Bun.sleep(0);
  await Bun.sleep(0);
  expect(state.reloads).toBe(2);
  expect(state.providers).toEqual([]);
  expect(state.methods).toEqual([]);

  stop();
  expect(stopped).toBe(true);
});
