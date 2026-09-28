import { readFileSync, watch } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode/plugin";
import { setupCommandcode, type CommandcodeCatalog } from "./_commandcode";

// Command Code (https://commandcode.ai) is an OpenAI-compatible gateway that
// models.dev does not list, so opencode has no native knowledge of it. This
// plugin is how it becomes real inside opencode: the community
// `@brainervirus/opencode-commandcode` package is V1-only (its sole entry is
// the old `config` hook), and opencode v2 refuses to load it — so fouine
// registers the provider, its model catalog and the integration key method
// itself. Shipped in the config dir, it is auto-discovered from
// `${OPENCODE_CONFIG_DIR}/plugins/` (see _ctx.ts for the plugin conventions).
//
// The catalog comes from the sibling `commandcode-models.json`, which fouine
// materialises ONLY while a Command Code key is configured
// (skills/materialize writeCommandcodeCatalog). Its absence is this plugin's
// gate: no key, nothing registered, so a fresh deployment never advertises a
// gateway it cannot authenticate. The file is watched, and a change reloads
// the provider registry (see setupCommandcode), so a key saved in the dashboard
// reaches a server that is already running.
//
// The key never appears in the catalog or in opencode.json: fouine pushes it to
// the running server as a stored credential (effect/opencode.ts
// ensureProviderKey → integration.connect.key), which is why the "key" method
// must exist — opencode resolves the credential through it.
//
// This file must export nothing but the plugin (opencode loads every export),
// and it must not import anything from @opencode/* at runtime — the runtime
// config dir has no node_modules (see _commandcode.ts). Hence a plain object
// with the Plugin.define shape instead of calling Plugin.define.
const CATALOG = "commandcode-models.json";
const catalogUrl = new URL(`./${CATALOG}`, import.meta.url);

function readCatalog(): CommandcodeCatalog | undefined {
  try {
    return JSON.parse(readFileSync(catalogUrl, "utf8")) as CommandcodeCatalog;
  } catch {
    // No catalog file = no Command Code key configured (fouine only writes it
    // then). Register nothing — see the gate note above.
    return undefined;
  }
}

// Watch the directory, not the file: the file may not exist yet (no key), and
// fouine replaces it rather than editing it in place.
function watchCatalog(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const watcher = watch(dirname(fileURLToPath(catalogUrl)), (_event, filename) => {
      if (filename && String(filename) !== CATALOG) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, 100);
    });
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch {
    // No watch support: the catalog is still read at every location load and on
    // restart, which is what fouine's key-change path relied on before.
    return () => {};
  }
}

export default {
  id: "fouine.commandcode",
  async setup(ctx) {
    return setupCommandcode(ctx, readCatalog, watchCatalog);
  },
} satisfies Plugin.Plugin;
