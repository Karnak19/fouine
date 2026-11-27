import { readFileSync } from "node:fs";
import type { Plugin } from "@opencode/plugin";
import { parseFallbackFile, setupModelFallback, type FallbackFile } from "./_model_fallback";

// When a run's model hits a rate limit or a quota, continue the same session
// on the next model in the fallback list instead of failing (#185). The logic
// and its credits (adapted from vimtor's MIT opencode-fallback-model) are in
// _model_fallback.ts.
//
// The list comes from the sibling `fallback-models.json`, which fouine writes
// (apps/server/src/review/fallback.ts): one chain per live session, because one
// opencode server runs every repo's reviews and each repo can have its own
// list. The file is read again every time the hook fires — failures are rare
// and the file is tiny, so no watcher. No file, or no entry for the session,
// means nothing happens and opencode decides as usual.
//
// Same rules as the other plugins here: the default export is the only export,
// and it is a plain object with the Plugin shape rather than a Plugin.define
// call, so the file has no runtime import from @opencode/*.
const fileUrl = new URL("./fallback-models.json", import.meta.url);

function readFallbackFile(): FallbackFile | undefined {
  try {
    return parseFallbackFile(readFileSync(fileUrl, "utf8"));
  } catch {
    return undefined;
  }
}

export default {
  id: "fouine.model_fallback",
  async setup(ctx) {
    await setupModelFallback(
      {
        onRetry: (callback) => ctx.session.hook("retry", callback),
        switchModel: (sessionID, model) => ctx.session.switchModel({ sessionID, model }),
        parentOf: async (sessionID) => (await ctx.session.get({ sessionID })).parentID,
        listModels: async () => (await ctx.model.list()).data,
        // One JSON line on stderr. fouine forwards the child's stderr into its
        // own logs (review/opencode.ts pumpChildOutput), so the switch shows up
        // there in child mode; in sidecar mode it is in the sidecar's logs.
        log: (message, data, level = "info") =>
          console.error(
            JSON.stringify({ plugin: "fouine.model_fallback", level, message, ...data }),
          ),
      },
      readFallbackFile,
    );
  },
} satisfies Plugin.Plugin;
