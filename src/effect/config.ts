import { Effect } from "effect";
import { config, type Config } from "~/config";

// Thin service that hands the existing config singleton to the pipeline through
// the Layer graph, so the pipeline depends on ConfigService rather than
// importing the module directly (swappable in a test Layer).
export class ConfigService extends Effect.Service<ConfigService>()("app/ConfigService", {
  sync: () => ({ config }) as { config: Config },
}) {}
