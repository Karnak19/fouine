import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Command Code (https://commandcode.ai) is an OpenAI-compatible gateway that
// models.dev does not list, so opencode has no native knowledge of it. fouine
// declares the provider via its shipped plugin (opencode-config/plugins/
// commandcode.ts) and hands it the model catalog as a sibling JSON — shaped here
// from the models.json bundled with @brainervirus/opencode-commandcode. The same
// models.json feeds the picker below, so what the dashboard offers and what
// opencode accepts come from one file.
export const COMMANDCODE_PROVIDER = "commandcode";
export const COMMANDCODE_PROVIDER_NAME = "Command Code";

// The package is a BUILD-TIME dependency only: fouine never installs it as an
// opencode plugin. Its only exported subpath is `/server`, the V1 plugin entry,
// which opencode v2 refuses to load — so its `config` hook never runs and the
// catalog it would have injected must be written by fouine itself (see
// commandcodeModelCatalog). We still resolve that subpath to locate the package
// dir, then read models.json relative to it rather than importing it by name.
const PLUGIN_PACKAGE = "@brainervirus/opencode-commandcode";
const pluginDir = dirname(fileURLToPath(import.meta.resolve(`${PLUGIN_PACKAGE}/server`)));

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(pluginDir, file), "utf8")) as T;
}

// ponytail: the catalog is whatever the installed package bundles, so bumping
// the dependency in apps/server/package.json IS the catalog refresh (upstream CI
// re-syncs models.json from `GET https://api.commandcode.ai/provider/v1/models`
// every 6h and publishes a patch release). The picker and the plugin catalog both read that
// one file, so what the dashboard offers and what opencode accepts can never
// drift apart. Upgrade path: fetch that endpoint live with the resolved key at
// catalog-load time and fall back to the bundled file.

// The subset of models.json that fouine cares about — exactly what the shipped
// v2 plugin reads (opencode-config/plugins/_commandcode.ts CatalogModel); every
// other field models.json carries is dead weight here.
interface CatalogEntry {
  id: string;
  name: string;
  reasoningEfforts?: string[];
  tool_call: boolean;
  cost: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit: { context: number; output: number };
  modalities?: { input: string[]; output: string[] };
}

// Mirror of the plugin's `toConfigKey` (src/catalog.ts): the org prefix is
// dropped and the rest lowercased, so `deepseek/deepseek-v4-flash` becomes
// `deepseek-v4-flash` and `zai-org/GLM-5.2` becomes `glm-5.2`. That key is what
// opencode addresses the model by, hence what follows `commandcode/` in a fouine
// model spec; the upstream id stays inside the entry fouine emits, so the
// gateway still receives the full name. Kept in sync with the emitted catalog by
// a test that round-trips every key.
export function toConfigKey(id: string): string {
  const slash = id.indexOf("/");
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase();
}

// Read once; the file only changes with the dependency.
let entries: readonly CatalogEntry[] | undefined;
function loadEntries(): readonly CatalogEntry[] {
  if (!entries) entries = readJson<CatalogEntry[]>("models.json");
  return entries;
}

let options: readonly { id: string; name: string }[] | undefined;

// Picker options: `id` is the opencode config key (what a model spec carries),
// `name` the display name from the catalog.
export function commandcodeModels(): readonly { id: string; name: string }[] {
  if (!options) {
    options = loadEntries().map((m) => ({ id: toConfigKey(m.id), name: m.name }));
  }
  return options;
}

let catalog: Record<string, unknown> | undefined;

// The model catalog fouine serialises to `commandcode-models.json` next to the
// plugin (see skills/materialize writeCommandcodeCatalog), which the plugin
// maps onto opencode's native provider shape. JSON-serializable plain values:
// each key is `toConfigKey(id)` while `id` keeps the full upstream id the
// gateway receives.
export function commandcodeModelCatalog(): Record<string, unknown> {
  if (catalog) return catalog;
  const models: Record<string, unknown> = {};
  for (const entry of loadEntries()) {
    const cost: Record<string, number> = { input: entry.cost.input, output: entry.cost.output };
    if (entry.cost.cache_read !== undefined) cost.cache_read = entry.cost.cache_read;
    if (entry.cost.cache_write !== undefined) cost.cache_write = entry.cost.cache_write;
    const model: Record<string, unknown> = {
      id: entry.id,
      name: entry.name,
      tool_call: entry.tool_call,
      modalities: entry.modalities ?? { input: ["text"], output: ["text"] },
      cost,
      limit: entry.limit,
    };
    if (entry.reasoningEfforts?.length) {
      model.reasoningEfforts = entry.reasoningEfforts;
    }
    models[toConfigKey(entry.id)] = model;
  }
  catalog = models;
  return catalog;
}
