import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "~/config";
import { log } from "~/server/log";
import { normalizeModelSpec } from "~/review/opencode";

// The file the model-fallback plugin reads (opencode-config/plugins/
// model-fallback.ts, #185). It sits next to the plugin in the runtime config
// dir, like the Command Code catalog.
//
// Why it is keyed by session id: one opencode server runs every review, but
// each repo can have its own fallback list. The plugin's retry hook only knows
// the session that failed, so the file maps each live session to the chain
// fouine resolved for it when it created that session:
//
//   { "sessions": { "<session id>": ["provider/model", ...] } }
//
// Keying by repo or by worktree path would need the plugin to work out which
// repo a session belongs to; the session id is already in hand, and it can
// never point at another repo's chain. A session that is not in the file (the
// dashboard's Test button, a session fouine did not start) gets no fallback.
// Subagent sessions are found through their parent, on the plugin side.
//
// fouine is one process and this map is the source of truth, so the file is
// simply rewritten from it on every change. Entries are added in onSession
// (before the first prompt, so before any retry can fire) and removed when the
// run is torn down. The runtime config dir is rebuilt on boot, so a crash never
// leaves stale entries behind.
export const FALLBACK_FILE = "fallback-models.json";

const chains = new Map<string, string[]>();

export function fallbackFilePath(): string {
  return join(config.opencode.runtimeDir, "plugins", FALLBACK_FILE);
}

// Write to a temp name and rename over the real one, so the plugin never reads
// a half-written file. A failed write is logged, never thrown: losing the
// fallback must not fail the review it was meant to rescue.
function writeFallbackFile(): void {
  const path = fallbackFilePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sessions: Object.fromEntries(chains) }));
    renameSync(tmp, path);
  } catch (cause) {
    log.warn("could not write the fallback models file", { path, cause: String(cause) });
  }
}

// Each entry goes through the same rewrite as the run's own model (parseModel),
// so an old-shape Command Code spec still matches what opencode reports.
export function registerFallbackChain(sessionId: string, chain: readonly string[]): void {
  if (chain.length === 0) return;
  chains.set(sessionId, [...new Set(chain.map(normalizeModelSpec))]);
  writeFallbackFile();
}

export function forgetFallbackChain(sessionId: string): void {
  if (!chains.delete(sessionId)) return;
  writeFallbackFile();
}
