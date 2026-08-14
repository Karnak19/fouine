import * as z from "zod";

//#region src/utils/redirect-uri.d.ts
/**
 * Zod schema for OAuth redirect URIs and other developer-supplied URLs that the
 * server stores and later hands back to a browser.
 *
 * - Rejects dangerous schemes (`javascript:`, `data:`, `vbscript:`).
 * - Rejects URIs with a fragment component (`#...`) per RFC 6749 §3.1.2.
 * - Requires HTTPS, except for loopback hosts (`127.0.0.0/8`, `[::1]`,
 *   `*.localhost` per RFC 6761), where HTTP is allowed for local development.
 * - Allows custom schemes for mobile apps (e.g. `myapp://callback`).
 *
 * This is the single source of truth for redirect-URI validation across the
 * OAuth provider plugins. Consume it from `@better-auth/core/utils/redirect-uri`
 * rather than re-implementing the scheme policy per plugin.
 */
declare const SafeUrlSchema: z.ZodURL;
//#endregion
export { SafeUrlSchema };