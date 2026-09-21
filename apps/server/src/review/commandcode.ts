import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Command Code (https://commandcode.ai) is an OpenAI-compatible gateway that
// models.dev does not list, so opencode has no native knowledge of it. fouine
// declares the provider itself in the generated opencode.json (see
// buildOpencodeConfig in skills/materialize) and lets the community plugin
// @brainervirus/opencode-commandcode fill in the model list: its `config` hook
// populates `provider.commandcode.models` from the models.json it bundles (ids,
// names, cost, limits, reasoning variants) whenever the provider block has no
// `models` key of its own. The same models.json feeds the picker below, so what
// the dashboard offers and what opencode accepts come from one file.
export const COMMANDCODE_PROVIDER = "commandcode";
export const COMMANDCODE_PROVIDER_NAME = "Command Code";
export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider/v1";

// The plugin's `/server` export is the opencode plugin entry. It is the only
// exported subpath, so everything else the package ships (models.json,
// package.json) is reached relative to it rather than imported by name.
const PLUGIN_PACKAGE = "@brainervirus/opencode-commandcode";
const pluginDir = dirname(fileURLToPath(import.meta.resolve(`${PLUGIN_PACKAGE}/server`)));

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(pluginDir, file), "utf8")) as T;
}

// ponytail: the catalog is whatever the installed plugin bundles, so bumping the
// dependency in apps/server/package.json IS the catalog refresh (upstream CI
// re-syncs models.json from `GET ${COMMANDCODE_BASE_URL}/models` every 6h and
// publishes a patch release). The spec is derived from the installed version so
// the plugin opencode fetches from npm and the models.json fouine reads for the
// picker can never drift apart. Upgrade path: fetch that endpoint live with the
// resolved key at catalog-load time and fall back to the bundled file.
//
// Deliberately NO `/server` suffix and NO version-less form: opencode 1.18.30
// hands the string straight to an npm install and then picks the package's
// `./server` export itself. npm-package-arg reads `pkg@x.y.z/server` as a git
// spec and `@scope/pkg/server` as a directory, so either suffix breaks the
// install. (The upstream README's `/server` form targets the older loader.)
export const COMMANDCODE_PLUGIN_VERSION = readJson<{ version: string }>("package.json").version;
export const COMMANDCODE_PLUGIN = `${PLUGIN_PACKAGE}@${COMMANDCODE_PLUGIN_VERSION}`;

// The subset of the plugin's ModelEntry the picker needs.
interface CatalogEntry {
  id: string;
  name: string;
}

// Mirror of the plugin's `toConfigKey` (src/catalog.ts): the org prefix is
// dropped and the rest lowercased, so `deepseek/deepseek-v4-flash` becomes
// `deepseek-v4-flash` and `zai-org/GLM-5.2` becomes `glm-5.2`. That key is what
// opencode addresses the model by, hence what follows `commandcode/` in a fouine
// model spec; the upstream id stays inside the entry the plugin emits, so the
// gateway still receives the full name. Kept in sync by a test that runs the
// real plugin hook and compares key sets.
export function toConfigKey(id: string): string {
  const slash = id.indexOf("/");
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase();
}

let catalog: readonly { id: string; name: string }[] | undefined;

// Picker options: `id` is the opencode config key (what a model spec carries),
// `name` the display name from the catalog. Read once; the file only changes
// with the dependency.
export function commandcodeModels(): readonly { id: string; name: string }[] {
  if (!catalog) {
    catalog = readJson<CatalogEntry[]>("models.json").map((m) => ({
      id: toConfigKey(m.id),
      name: m.name,
    }));
  }
  return catalog;
}
