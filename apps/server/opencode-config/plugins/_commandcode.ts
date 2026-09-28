// Pure registration logic for the Command Code plugin, split out of
// commandcode.ts so the tests can drive it without running inside opencode (same
// `_`-prefixed split as _ctx.ts / _ci_format.ts). opencode discovers every .ts
// in plugins/ as a module but only registers files whose default export is a
// plugin, so a helper module like this one is skipped — and, because the plugin
// entry must export nothing but its factory, the helpers live here rather than
// beside it.
//
// No runtime import from @opencode/*: the runtime config dir has no
// node_modules, so `import { Provider } from "@opencode/plugin"` fails to
// resolve there (verified against a real 2.0.11 server: "Cannot find package
// '@opencode/plugin'") and the whole plugin fails to load. The values below are
// therefore spelled out as plain objects matching Provider.Info.empty /
// Model.Info.default — and the tests decode every one of them with opencode's
// own schema, so a drift in shape fails there instead of silently here.
export const COMMANDCODE_ID = "commandcode";
// The Command Code gateway endpoint (https://api.commandcode.ai/provider/v1).
// The shipped opencode-config dir has no runtime imports back into the app, so
// it is duplicated here rather than imported.
const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider/v1";
// opencode's built-in OpenAI-compatible implementation (what the docs' custom
// provider example uses; the `aisdk:@ai-sdk/openai-compatible` alias resolves
// to the same thing).
const OPENAI_COMPATIBLE = "@opencode/ai/providers/openai-compatible";
const KEY_LABEL = "Command Code API Key";
const ENV_NAMES = ["COMMANDCODE_API_KEY"] as const;

// The shape fouine writes into commandcode-models.json: commandcodeModelCatalog()
// in src/review/commandcode.ts, itself a mirror of the package's models.json.
interface CatalogCost {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}
export interface CatalogModel {
  id: string;
  name: string;
  tool_call: boolean;
  cost: CatalogCost;
  limit: { context: number; output: number };
  modalities?: { input: string[]; output: string[] };
  reasoningEfforts?: string[];
}
export type CommandcodeCatalog = Record<string, CatalogModel>;

// Structural mirrors of opencode's Provider.Info / Model.Info (the subset we
// set; every required field is present). Structural so a test can pass a
// recording fake and opencode's concrete editor stays assignable.
export interface ProviderInfo {
  id: string;
  integrationID?: string;
  name: string;
  activation: "auto" | "enabled" | "disabled";
  package: string;
  settings?: Record<string, unknown>;
}
export interface ModelInfo {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  capabilities: { tools: boolean; input: string[]; output: string[] };
  variants: Array<{ id: string; settings?: Record<string, unknown> }>;
  time: { released: number };
  cost: Array<{ input: number; output: number; cache: { read: number; write: number } }>;
  status: "alpha" | "beta" | "deprecated" | "active";
  enabled: boolean;
  limit: { context: number; output: number };
}
export interface ProviderEditorLike {
  add(input: { info: ProviderInfo; models: readonly ModelInfo[] }): void;
}

interface IntegrationMethodDraft {
  type: string;
  label?: string;
  names?: ReadonlyArray<string>;
}
export interface IntegrationEditorLike {
  method: {
    update(input: { integrationID: string; method: IntegrationMethodDraft }): void;
  };
}

// The provider definition, built the way opencode's docs register a custom
// provider (editor.add with Provider.Info.empty + Model.Info.default).
//
// Load-bearing details:
//  - `activation: "enabled"` (never "auto"): an "auto" provider that is also a
//    registered integration with no stored credential is filtered out of the
//    resolved model list, so a run speccing a commandcode model dies with
//    ModelUnavailableError instead of ever asking for the key.
//  - each model's `id` is the org-stripped config key (e.g. `deepseek-v4-flash`
//    — what follows `commandcode/` in a fouine model spec) while `modelID`
//    carries the FULL upstream id (`deepseek/deepseek-v4-flash`) the gateway
//    expects in the request body.
//  - `integrationID` ties the provider to the integration fouine pushes the key
//    into (effect/opencode.ts ensureProviderKey → integration.connect.key).
export function buildProvider(catalog: CommandcodeCatalog): {
  info: ProviderInfo;
  models: ModelInfo[];
} {
  const info: ProviderInfo = {
    id: COMMANDCODE_ID,
    integrationID: COMMANDCODE_ID,
    name: "Command Code",
    activation: "enabled",
    package: OPENAI_COMPATIBLE,
    settings: { baseURL: COMMANDCODE_BASE_URL },
  };
  const models = Object.entries(catalog).map(
    ([key, entry]): ModelInfo => ({
      id: key,
      modelID: entry.id,
      providerID: COMMANDCODE_ID,
      name: entry.name,
      // Model.Info has no reasoning/attachment flags of its own; those fold into
      // capabilities.tools and the input/output lists.
      capabilities: {
        tools: entry.tool_call,
        input: entry.modalities?.input ?? ["text"],
        output: entry.modalities?.output ?? ["text"],
      },
      // Declaring variants means owning the list: every reasoningEffort becomes
      // a variant, and the default (no variant) stays the bare model id.
      variants: (entry.reasoningEfforts ?? []).map((effort) => ({
        id: effort,
        settings: { reasoningEffort: effort },
      })),
      time: { released: 0 },
      cost: [
        {
          input: entry.cost.input,
          output: entry.cost.output,
          cache: { read: entry.cost.cache_read ?? 0, write: entry.cost.cache_write ?? 0 },
        },
      ],
      status: "active",
      enabled: true,
      limit: { context: entry.limit.context, output: entry.limit.output },
    }),
  );
  return { info, models };
}

// Register the key + env methods so `integration.connect.key` (fouine's
// credential push) resolves the integration, and so an operator with
// COMMANDCODE_API_KEY in opencode's environment is picked up too.
export function registerIntegrationMethods(editor: IntegrationEditorLike): void {
  editor.method.update({
    integrationID: COMMANDCODE_ID,
    method: { type: "key", label: KEY_LABEL },
  });
  editor.method.update({
    integrationID: COMMANDCODE_ID,
    method: { type: "env", names: ENV_NAMES },
  });
}

// The slice of the plugin context setupCommandcode touches, structural so the
// tests can pass a recording fake (see commandcode.test.ts).
export interface CommandcodeContext {
  provider: {
    transform(callback: (editor: ProviderEditorLike) => void): Promise<unknown>;
    reload(): Promise<void>;
  };
  integration: {
    transform(callback: (editor: IntegrationEditorLike) => void): Promise<unknown>;
    reload(): Promise<void>;
  };
}

// Returns the catalog to register, or undefined when Command Code is not
// configured (the production reader resolves the sibling JSON; tests inject
// their own). Undefined means "register nothing" — never a throw: a throwing
// transform disables the WHOLE plugin silently.
export type CatalogReader = () => CommandcodeCatalog | undefined;
// Calls onChange whenever the catalog file may have changed; returns a stop
// function. Injected so tests can fire it by hand.
export type CatalogWatcher = (onChange: () => void) => () => void;

// opencode's documented pattern for data that changes after setup: load it
// before registering, have the (synchronous, replayable) transform read the
// captured value, and call the domain's reload() when the data changes —
// opencode then replays every transform onto fresh state.
//
// That matters here because the catalog's presence is the gate: fouine writes
// it only while a Command Code key is configured, and a key saved in the
// dashboard lands on a server that is already running. Without the watch, every
// location opencode had already loaded (the dashboard's Test button reuses one)
// would keep answering "Model unavailable" until a restart.
export async function setupCommandcode(
  ctx: CommandcodeContext,
  readCatalog: CatalogReader,
  watchCatalog?: CatalogWatcher,
): Promise<() => void> {
  const source = { catalog: readCatalog(), json: "" };
  source.json = JSON.stringify(source.catalog ?? null);
  await ctx.provider.transform((editor) => {
    if (source.catalog) editor.add(buildProvider(source.catalog));
  });
  await ctx.integration.transform((editor) => {
    if (source.catalog) registerIntegrationMethods(editor);
  });
  if (!watchCatalog) return () => {};

  let refreshing = Promise.resolve();
  const refresh = () => {
    refreshing = refreshing.then(async () => {
      const next = readCatalog();
      const json = JSON.stringify(next ?? null);
      if (json === source.json) return; // an unrelated file in plugins/ changed
      source.catalog = next;
      source.json = json;
      await ctx.provider.reload();
      await ctx.integration.reload();
    }).catch(() => {
      // A failed reload keeps the previous registration; the next change retries.
    });
  };
  return watchCatalog(refresh);
}
