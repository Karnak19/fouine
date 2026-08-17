import { Models } from "@opencode-ai/models";
import {
  resolveDefaultModel,
  resolveImproverModel,
  hasZaiKey,
  hasOpencodeKey,
  ZAI_PROVIDER,
} from "~/settings";
import { repos } from "~/db";
import { log } from "~/server/log";

// One entry per selectable model, pre-joined into the "provider/model" spec the
// rest of fouine stores.
export interface ModelOption {
  id: string;
  provider: string;
  providerName: string;
  model: string;
  modelName: string;
  // True when this provider is one fouine can actually reach today — see
  // configuredProviders(). The UI sorts these first and flags the rest.
  configured: boolean;
}

// models.dev is the database opencode itself reads. Talking to it directly beats
// booting an `opencode serve` subprocess just to proxy the same catalog: no
// ~4s cold start, no process, and the package ships a snapshot so a sandboxed
// container with no egress still gets a full list.
const client = Models.make();

// The catalog only moves when models.dev publishes, so hold it in memory.
const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; providers: ProviderMap } | undefined;
let inflight: Promise<ProviderMap> | undefined;

type ProviderMap = Awaited<ReturnType<typeof client.providers>>;

async function fetchProviders(): Promise<ProviderMap> {
  try {
    return await client.providers({ signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    // Offline, blocked egress, or models.dev down: fall back to the copy bundled
    // in the package (at most ~24h stale) rather than showing an empty picker.
    log.warn("models.dev unreachable, using bundled snapshot", { error: String(e) });
    return (await import("@opencode-ai/models/snapshot")).providers as ProviderMap;
  }
}

// Providers fouine can actually reach. It has exactly two key slots — the Z.ai
// key (GLM Coding Plan only) and the OpenCode key — so the set is small and
// worth computing rather than showing all 172 providers models.dev knows.
//
// Providers already named by a setting are always included even if the matching
// key is missing: a config that's live must never vanish from its own picker,
// and dropping it would silently rewrite the field on the next save.
export function configuredProviders(): Set<string> {
  const out = new Set<string>();
  if (hasZaiKey()) out.add(ZAI_PROVIDER);
  if (hasOpencodeKey()) {
    // The OpenCode key authenticates opencode's own gateway providers.
    out.add("opencode");
    out.add("opencode-go");
  }
  const inUse = [resolveDefaultModel(), resolveImproverModel(), ...repoModels()];
  for (const spec of inUse) {
    const provider = spec?.split("/")[0];
    if (provider) out.add(provider);
  }
  return out;
}

function repoModels(): string[] {
  try {
    return repos.list.all().map((r) => r.model ?? "");
  } catch {
    return [];
  }
}

function flatten(providers: ProviderMap, all: boolean): ModelOption[] {
  const configured = configuredProviders();
  const out: ModelOption[] = [];
  for (const p of Object.values(providers)) {
    if (!all && !configured.has(p.id)) continue;
    for (const m of Object.values(p.models)) {
      out.push({
        id: `${p.id}/${m.id}`,
        provider: p.id,
        providerName: p.name,
        model: m.id,
        modelName: m.name,
        configured: configured.has(p.id),
      });
    }
  }
  // Configured first, then alphabetical. Only meaningful under `all`, where
  // unconfigured providers are present too.
  out.sort((a, b) => Number(b.configured) - Number(a.configured) || a.id.localeCompare(b.id));
  return out;
}

// The full catalog is ~5.7k models / ~1MB of JSON — far too much to ship to an
// autocomplete. Filter and cap server-side (it's an in-memory scan) and let the
// client re-query as the user types.
export const SEARCH_LIMIT = 100;

export function searchModels(models: ModelOption[], q: string): ModelOption[] {
  const needle = q.trim().toLowerCase();
  const hits = needle ? models.filter((m) => m.id.toLowerCase().includes(needle)) : models;
  return hits.slice(0, SEARCH_LIMIT);
}

// `all` opts out of the configured-provider filter, for picking a model on a
// provider whose key isn't set up yet.
export async function listModels(force = false, all = false): Promise<ModelOption[]> {
  // Only the models.dev payload is cached, not the flattened list — `configured`
  // is derived from settings the user can change between requests.
  if (!force && cache && Date.now() - cache.at < TTL_MS) return flatten(cache.providers, all);
  // Collapse concurrent callers onto a single fetch.
  if (!force && inflight) return flatten(await inflight, all);
  const p: Promise<ProviderMap> = fetchProviders()
    .then((providers) => {
      cache = { at: Date.now(), providers };
      log.info("model catalog loaded", { providers: Object.keys(providers).length });
      return providers;
    })
    // Only clear if we're still the current one — a concurrent ?refresh=1 may
    // have replaced it, and clearing then would drop a live fetch.
    .finally(() => {
      if (inflight === p) inflight = undefined;
    });
  inflight = p;
  return flatten(await p, all);
}
