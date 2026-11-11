import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { resolve } from "node:path";
import { config } from "~/config";
import { buildAgent } from "./build";
import { chatAgent } from "./chat";

/**
 * Where Mastra keeps its own state.
 *
 * Same rule as every other fouine artefact: under `DATA_DIR`, so the Docker
 * volume carries it and the test preload's temp dir (`tests/setup.ts`) is the
 * only place a test ever writes. Exported so a test can assert the rule without
 * reaching into the store's private client.
 */
export function mastraStoragePath(dataDir: string = config.dataDir): string {
  return resolve(dataDir, "mastra.db");
}

/**
 * The one Mastra instance for the process lifetime.
 *
 * Agents are registered here so `/build` and chat both resolve through the same
 * registry (and so a future Studio mount has something to list). Storage is
 * local libsql at `${DATA_DIR}/mastra.db` — memory, traces and workflow
 * snapshots do not belong in the app's own `fouine.db`.
 *
 * No Studio mount: Mastra 1.82 serves the Studio UI from the `mastra` CLI, not
 * from `@mastra/server` (which exposes API routes only), so mounting it inside
 * Elysia would add a route that loses to the static catch-all anyway. See
 * SPIKE-167.md.
 */
export const mastra = new Mastra({
  agents: { chat: chatAgent, build: buildAgent },
  storage: new LibSQLStore({
    id: "fouine",
    url: `file:${mastraStoragePath()}`,
  }),
});
