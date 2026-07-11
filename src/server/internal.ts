import { config } from "~/config";

// Shared secret for the loopback write-back channel the opencode post_* tools
// use to persist findings (POST /internal/reviews/:id/findings). The tools run
// in a subprocess this same process spawns, so a per-boot random token — passed
// down via FOUINE_INTERNAL_SECRET — is enough: it never leaves the host and
// needs no operator configuration. Regenerated each start; that's fine because
// no long-lived client holds it.
export const internalSecret = crypto.randomUUID();

// Where the subprocess reaches this server. Loopback only — the write-back is
// never meant to cross the machine boundary.
export const internalBaseUrl = `http://127.0.0.1:${config.port}`;

export const INTERNAL_SECRET_HEADER = "x-fouine-internal";
