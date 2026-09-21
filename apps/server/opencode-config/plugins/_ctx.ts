// Shared context for the fouine opencode tools. Not a tool itself: opencode v2
// only registers files in this directory whose default export is a plugin
// definition ({ id, setup }), and skips helper modules like this one. The
// leading underscore flags it as a non-plugin module.
//
// The tools no longer hold a GitHub token: they run in the opencode subprocess,
// which must never see a credential, and instead call fouine's own loopback
// internal API. The opencode session id handed to every executor is the only
// credential a tool carries; fouine resolves owner/repo/PR/kind from the review
// row behind it and makes the GitHub call in-process.

// Base URL of fouine's loopback internal API (e.g. http://127.0.0.1:3000). The
// only env var these tools read besides the optional shared secret.
export function internalUrl(): string {
  const url = process.env.FOUINE_INTERNAL_URL;
  if (!url) throw new Error("FOUINE_INTERNAL_URL is not set");
  return url;
}

interface CallOptions {
  method?: string;
  body?: unknown;
}

// Call `${internalUrl()}/internal/sessions/:sid/:path`. The per-boot shared
// secret is attached when present as defence-in-depth, but the session id is the
// boundary (see server/internal.ts), so its absence is fine. Non-2xx responses
// carry `{ error }`; surface that verbatim so the model sees why it failed.
export async function call<T>(
  sessionID: string,
  path: string,
  init: CallOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const secret = process.env.FOUINE_INTERNAL_SECRET;
  if (secret) headers["x-fouine-internal"] = secret;

  const res = await fetch(`${internalUrl()}/internal/sessions/${sessionID}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const detail = await res.text();
    let message = detail;
    try {
      message = (JSON.parse(detail) as { error?: string }).error ?? detail;
    } catch {
      // non-JSON error body; keep the raw text
    }
    throw new Error(`fouine internal ${res.status}: ${message}`);
  }
  return (await res.json()) as T;
}
