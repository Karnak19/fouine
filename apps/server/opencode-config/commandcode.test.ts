import { expect, test } from "bun:test";
import cmdPlugin from "./plugins/commandcode.ts";
import {
  registerProvider,
  registerIntegrationMethods,
  setupCommandcode,
  type CommandcodeCatalog,
  type IntegrationEditorLike,
  type ProviderEditorLike,
} from "./plugins/_commandcode.ts";

// Deliberately NOT in plugins/: opencode discovers plugins by globbing
// {plugin,plugins}/*.{ts,js} in this dir, so a test next to the plugin would be
// loaded as one — importing bun:test into the review runtime. One level up is
// outside the glob (same reasoning as cap-bash-timeout.test.ts).
//
// The transforms are pure helpers, so a recording fake editor stands in for
// opencode's builder and we assert exactly what the plugin registers.

interface CapturedProvider {
  id: string;
  fields: Record<string, unknown>;
}
interface CapturedModel {
  providerID: string;
  modelID: string;
  fields: Record<string, unknown>;
}

function recordingProviderEditor(captured: {
  providers: CapturedProvider[];
  models: CapturedModel[];
}): ProviderEditorLike {
  return {
    update(providerID, update) {
      const fields: Record<string, unknown> = {};
      update(fields as never);
      captured.providers.push({ id: providerID, fields });
    },
    models: {
      update(providerID, modelID, update) {
        const fields: Record<string, unknown> = {};
        update(fields as never);
        captured.models.push({ providerID, modelID, fields });
      },
    },
  };
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

test("registers the provider as enabled, openai-compatible, against the gateway", () => {
  const captured = { providers: [], models: [] };
  registerProvider(recordingProviderEditor(captured), catalog);
  expect(captured.providers).toEqual([
    {
      id: "commandcode",
      fields: {
        name: "Command Code",
        // Load-bearing: "auto" would hide the provider until a credential is
        // stored, failing every review that names a commandcode model.
        activation: "enabled",
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: "https://api.commandcode.ai/provider/v1" },
      },
    },
  ]);
});

test("each catalog entry becomes a model keyed by config key, carrying the full upstream id", () => {
  const captured: { providers: CapturedProvider[]; models: CapturedModel[] } = {
    providers: [],
    models: [],
  };
  registerProvider(recordingProviderEditor(captured), catalog);

  expect(captured.models.map((m) => [m.providerID, m.modelID])).toEqual([
    ["commandcode", "deepseek-v4-flash"],
    ["commandcode", "glm-5.2"],
  ]);

  // modelID is the override opencode sends upstream; the map key above is the
  // org-stripped config key.
  expect(captured.models[0]?.fields).toEqual({
    name: "DeepSeek V4 Flash",
    modelID: "deepseek/deepseek-v4-flash",
    limit: { context: 1000, output: 100 },
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
    variants: [
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "high", settings: { reasoningEffort: "high" } },
    ],
    status: "active",
    enabled: true,
  });
});

test("omitted optional fields fall back to text-only, no reasoning, zero cache cost", () => {
  const captured: { providers: CapturedProvider[]; models: CapturedModel[] } = {
    providers: [],
    models: [],
  };
  registerProvider(recordingProviderEditor(captured), catalog);

  expect(captured.models[1]?.fields).toEqual({
    name: "GLM 5.2",
    modelID: "zai-org/GLM-5.2",
    limit: { context: 2000, output: 200 },
    capabilities: { tools: false, input: ["text"], output: ["text"] },
    cost: [{ input: 3, output: 4, cache: { read: 0, write: 0 } }],
    variants: [],
    status: "active",
    enabled: true,
  });
});

test("an empty catalog registers the provider but no models, and never throws", () => {
  const captured = { providers: [], models: [] };
  expect(() => registerProvider(recordingProviderEditor(captured), {})).not.toThrow();
  expect(captured.providers).toHaveLength(1);
  expect(captured.models).toEqual([]);
});

test("registers the key and env methods the credential push resolves against", () => {
  const calls: Array<{ integrationID: string; method: Record<string, unknown> }> = [];
  registerIntegrationMethods(recordingIntegrationEditor(calls));
  expect(calls).toEqual([
    { integrationID: "commandcode", method: { type: "key", label: "Command Code API Key" } },
    { integrationID: "commandcode", method: { type: "env", names: ["COMMANDCODE_API_KEY"] } },
  ]);
});

test("setup registers nothing when the catalog reader comes up empty (no key configured)", async () => {
  // Absent catalog must mean "stay silent", not "throw" (a throwing transform
  // disables the plugin). The reader is injected so this holds regardless of
  // what the runtime dir happens to contain — the runtime copy of this very
  // test runs next to a live catalog when a key is configured.
  let transforms = 0;
  const ctx = {
    provider: {
      transform: async (cb: (editor: unknown) => void) => {
        transforms++;
        cb({});
      },
    },
    integration: {
      transform: async (cb: (editor: unknown) => void) => {
        transforms++;
        cb({});
      },
    },
  };
  await setupCommandcode(ctx as never, () => undefined);
  expect(cmdPlugin.id).toBe("fouine.commandcode");
  expect(transforms).toBe(0);
});

test("setup wires the catalog into both transforms when a key is configured", async () => {
  const captured = { providers: [], models: [] };
  const methods: Array<{ integrationID: string; method: Record<string, unknown> }> = [];
  await setupCommandcode(
    {
      provider: { transform: async (cb) => cb(recordingProviderEditor(captured)) },
      integration: { transform: async (cb) => cb(recordingIntegrationEditor(methods)) },
    },
    () => catalog,
  );
  expect(captured.providers).toHaveLength(1);
  expect(captured.models.map((m) => m.modelID)).toEqual([
    "deepseek-v4-flash",
    "glm-5.2",
  ]);
  expect(methods.map((m) => m.method.type)).toEqual(["key", "env"]);
});
