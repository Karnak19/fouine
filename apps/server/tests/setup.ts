// Runs before any test module loads, so env-dependent singletons (config, db)
// capture a hermetic environment. Preserves real values if already set.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "fouine-test-"));
process.env.DATA_DIR = process.env.DATA_DIR ?? tmp;
process.env.DB_PATH = process.env.DB_PATH ?? join(tmp, "test.db");
process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID ?? "1";
process.env.GITHUB_APP_PRIVATE_KEY =
  process.env.GITHUB_APP_PRIVATE_KEY ?? "dummy-not-a-real-key";
process.env.GITHUB_WEBHOOK_SECRET =
  process.env.GITHUB_WEBHOOK_SECRET ?? "whsec-test";

// Provider keys are the exception to "preserve real values": with no DB row,
// settings.ts falls back to these, so a key in the developer's shell would flip
// assertions about which providers are configured.
delete process.env.OPENCODE_API_KEY;
delete process.env.ZAI_API_KEY;

process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
