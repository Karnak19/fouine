// Pure registration logic for the Command Code plugin, split out of
// commandcode.ts so the tests can drive it without running inside opencode (same
// `_`-prefixed split as _ctx.ts / _ci_format.ts). opencode discovers every .ts
// in plugins/ as a module but only registers files whose default export is a
// plugin, so a helper module like this one is skipped — and, because the plugin
// entry must export nothing but its factory, the helpers live here rather than
// beside it.
//
// The editor types below are structural on purpose: no opencode runtime import,
// so a test can pass a recording fake. They stay loose enough that opencode's
// concrete builder editor is assignable.
export const COMMANDCODE_ID = "commandcode";
// The Command Code gateway endpoint (https://api.commandcode.ai/provider/v1).
// The shipped opencode-config dir has no runtime imports back into the app, so
// it is duplicated here rather than imported.
const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider/v1";
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

interface ProviderDraft {
  name?: string;
  activation?: string;
  package?: string;
  settings?: Record<string, unknown>;
}
interface ModelDraft {
  name?: string;
  modelID?: string;
  limit?: { context: number; output: number };
  capabilities?: { tools: boolean; input: ReadonlyArray<string>; output: ReadonlyArray<string> };
  cost?: ReadonlyArray<{ input: number; output: number; cache: { read: number; write: number } }>;
  variants?: ReadonlyArray<{ id: string; settings?: { reasoningEffort?: string } }>;
  status?: string;
  enabled?: boolean;
}
export interface ProviderEditorLike {
  update(providerID: string, update: (provider: ProviderDraft) => void): void;
  models: {
    update(providerID: string, modelID: string, update: (model: ModelDraft) => void): void;
  };
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

// Upsert the provider and one model per catalog entry. `package` is the
// opencode-native alias opencode rewrites to its built-in openai-compatible
// implementation; `settings.baseURL` is the gateway endpoint.
export function registerProvider(editor: ProviderEditorLike, catalog: CommandcodeCatalog): void {
  editor.update(COMMANDCODE_ID, (p) => {
    p.name = "Command Code";
    p.activation = "enabled";
    p.package = "aisdk:@ai-sdk/openai-compatible";
    p.settings = { ...p.settings, baseURL: COMMANDCODE_BASE_URL };
  });
  for (const [key, entry] of Object.entries(catalog)) {
    editor.models.update(COMMANDCODE_ID, key, (m) => {
      m.name = entry.name;
      m.modelID = entry.id;
      m.limit = { context: entry.limit.context, output: entry.limit.output };
      // Model.Info has no reasoning/attachment/modalities flags of its own; the
      // former two fold into capabilities.tools and the input/output lists.
      m.capabilities = {
        tools: entry.tool_call,
        input: entry.modalities?.input ?? ["text"],
        output: entry.modalities?.output ?? ["text"],
      };
      m.cost = [
        {
          input: entry.cost.input,
          output: entry.cost.output,
          cache: { read: entry.cost.cache_read ?? 0, write: entry.cost.cache_write ?? 0 },
        },
      ];
      // Declaring variants means owning the list: every reasoningEffort becomes
      // a variant, and the default (no variant) stays the bare model id.
      m.variants = (entry.reasoningEfforts ?? []).map((effort) => ({
        id: effort,
        settings: { reasoningEffort: effort },
      }));
      m.status = "active";
      m.enabled = true;
    });
  }
}

// Register the key + env methods so `integration.connect.key` (fouine's
// credential push) resolves the provider, and so an operator with
// COMMANDCODE_API_KEY in the environment is picked up too.
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
  provider: { transform(callback: (editor: ProviderEditorLike) => void): Promise<void> };
  integration: { transform(callback: (editor: IntegrationEditorLike) => void): Promise<void> };
}

// Returns the catalog to register, or undefined when Command Code is not
// configured (the production reader resolves the sibling JSON; tests inject
// their own). Undefined must mean "register nothing": a throwing transform
// disables the WHOLE plugin silently, so this is the designed no-op path.
export type CatalogReader = () => CommandcodeCatalog | undefined;

export async function setupCommandcode(
  ctx: CommandcodeContext,
  readCatalog: CatalogReader,
): Promise<void> {
  const catalog = readCatalog();
  if (!catalog) return;
  await ctx.provider.transform((editor) => registerProvider(editor, catalog));
  await ctx.integration.transform((editor) => registerIntegrationMethods(editor));
}
