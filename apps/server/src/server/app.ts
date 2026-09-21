import { Elysia } from "elysia";
import { staticPlugin } from "@elysia/static";
import { resolve } from "node:path";
import { config } from "~/config";
import { verifyAndDispatch, VerificationError } from "~/server/webhook";
import { apiRoutes } from "~/server/api";
import { auth, migrateAuth } from "~/server/auth";
import { internalRoutes } from "~/server/internal";
import { errName, log } from "~/server/log";
import { seedOpencodeConfig, reconcileSkills, reloadOpencodeConfig } from "~/skills";
import { reapOrphanReviews, reapStaleArms, runImproverSweep, reconcileReviewChecks } from "~/review";

// Resolved from import.meta.dir, not cwd: turbo runs tasks with cwd = the
// package dir and Docker runs from /app, so a cwd-relative path points somewhere
// different depending on how the server was started. Dev serves the web app's
// sources through Bun's fullstack dev server (see `bunFullstack` below); prod
// serves the vite build from apps/web/dist.
const isProd = process.env.NODE_ENV === "production";
const assetsDir = resolve(import.meta.dir, "../../../web", isProd ? "dist" : "src");

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// ponytail: SPA fallback heuristic — last path segment with a dot looks like a
// file (asset), so let it 404 normally; everything else is a client route.
function isAssetPath(p: string): boolean {
  const seg = p.slice(p.lastIndexOf("/") + 1);
  return seg.includes(".");
}

// The SPA shell for a deep link (/chat, /reviews/12, …). In prod that's just the
// prebuilt file. In dev it must NOT be `Bun.file(index.html)`: the bundled HTML
// only exists as the "/" route the static plugin registered from Bun's HTML
// bundle, so reading the file off disk hands the browser the un-transpiled
// source and the page renders blank — the exact bug this replaced. Ask our own
// "/" for it instead; onRequest lets "/" through to the static plugin, so this
// costs one loopback request per deep link in dev and never recurses.
async function spaShell(request: Request): Promise<Response> {
  if (isProd) {
    return new Response(Bun.file(`${assetsDir}/index.html`), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const res = await fetch(new URL("/", request.url), { headers: request.headers });
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Does this path need a signed-in session?
 *
 * Pulled out of the gate below so it can be asserted on directly: the gate
 * itself only runs with auth configured, which no test environment has, so
 * "is /api/build behind the login" would otherwise be untestable and every new
 * /api route would be taking the gate on trust. Everything under /api/ is
 * protected except better-auth's own endpoints and the status probe the login
 * page reads before it can possibly have a session.
 */
export function requiresSession(path: string): boolean {
  if (!path.startsWith("/api/")) return false;
  if (path.startsWith("/api/auth/")) return false;
  if (path === "/api/auth-status") return false;
  return true;
}

const startedAt = new WeakMap<Request, number>();

export async function createServer() {
  return new Elysia()
    .onRequest(({ request }) => {
      startedAt.set(request, Date.now());
      // Delegate better-auth's own endpoints here, before routing — a route or
      // .mount loses to the static plugin's catch-all GET, so short-circuit
      // from onRequest instead (runs before static, all methods).
      if (config.auth.enabled && pathname(request.url).startsWith("/api/auth/")) {
        return auth.handler(request);
      }
      // SPA deep links, same escape hatch and same reason as better-auth above:
      // the static plugin's catch-all answers unknown GETs with a 404 *Response*
      // rather than throwing, so the onError fallback below never sees them and
      // every client route 404s on reload. Serve the shell from here instead.
      // "/" is left to the static plugin, which already serves index.html.
      if (request.method === "GET") {
        const p = pathname(request.url);
        if (
          p !== "/" &&
          !p.startsWith("/api") &&
          !p.startsWith("/webhook") &&
          !p.startsWith("/internal") &&
          p !== "/health" &&
          !isAssetPath(p)
        ) {
          return spaShell(request);
        }
      }
    })
    .onAfterHandle(({ request, set }) => {
      const ms = Date.now() - (startedAt.get(request) ?? Date.now());
      const status = typeof set.status === "number" ? set.status : 200;
      log.info("request", {
        method: request.method,
        path: pathname(request.url),
        status,
        ms,
      });
    })
    // GitHub-OAuth session gate. Only /api/* is protected; the SPA shell and its
    // assets stay public so the login page can load, and /api/auth/* (better-auth
    // itself) plus /api/auth-status must be reachable unauthenticated. Webhooks
    // and /health are not under /api and carry their own auth.
    .onBeforeHandle(async ({ request, set }) => {
      if (!config.auth.enabled) return;
      if (!requiresSession(pathname(request.url))) return;
      const session = await auth.api.getSession({ headers: request.headers });
      if (session) return;
      set.status = 401;
      return "Unauthorized";
    })
    .get("/api/auth-status", () => ({ enabled: config.auth.enabled }))
    .use(apiRoutes)
    // Loopback proxy for the review's custom tools (they hold no GitHub token;
    // fouine makes the calls). Registered before the static plugin so its GET
    // routes win over the catch-all, same reason better-auth is delegated in
    // onRequest.
    .use(internalRoutes)
    .use(
      await staticPlugin({
        assets: assetsDir,
        prefix: "/",
        indexHTML: true,
        // Dev only: hands index.html to Bun's bundler, which transpiles the
        // .tsx module graph, resolves the "@/" tsconfig paths and runs
        // bun-plugin-tailwind over global.css (see apps/server/bunfig.toml).
        // Without it the plugin serves apps/web/src verbatim and the browser
        // gets raw JSX — a blank page. The `await` on staticPlugin is what
        // installs the HMR hooks, so it has to stay.
        // In prod apps/web/dist is already built, so leave it off.
        bunFullstack: !isProd,
      }),
    )
    .get("/health", () => ({ ok: true }))
    .post("/webhook/github", async ({ request, set }) => {
      const payload = await request.text();
      const signature = request.headers.get("x-hub-signature-256");
      const name = request.headers.get("x-github-event") ?? "";
      const id = request.headers.get("x-github-delivery") ?? "";

      try {
        await verifyAndDispatch({ id, name, payload, signature });
      } catch (err) {
        if (err instanceof VerificationError) {
          set.status = 401;
          return { error: "invalid signature" };
        }
        throw err;
      }

      set.status = 200;
      return { ok: true };
    })
    .onError(({ request, error, set }) => {
      const status =
        error &&
        typeof error === "object" &&
        "status" in error &&
        typeof (error as { status: unknown }).status === "number"
          ? (error as { status: number }).status
          : 500;
      const p = pathname(request.url);
      if (
        status === 404 &&
        request.method === "GET" &&
        !p.startsWith("/api") &&
        !p.startsWith("/webhook") &&
        !isAssetPath(p)
      ) {
        return spaShell(request);
      }
      const ms = Date.now() - (startedAt.get(request) ?? Date.now());
      set.status = status;
      log.warn("request error", {
        method: request.method,
        path: pathname(request.url),
        status,
        ms,
        error: errName(error),
        message: String((error as Error)?.message ?? error),
      });
      return status >= 500 ? { error: "internal error" } : { error: "not found" };
    });
}

export async function boot(): Promise<void> {
  await migrateAuth();
  // Point opencode at a fouine-owned config dir and materialise enabled skills
  // before we accept requests, so the first review already sees them. Order
  // matters: seed creates the skills/ dir the reconcile writes into.
  seedOpencodeConfig();
  reconcileSkills();
  // seed rebuilt the runtime config dir on disk, but a warm sidecar still serves
  // the previous config from memory. Reload AFTER reconcile so it lands with the
  // skills materialised — reloading between seed and reconcile would ask the
  // sidecar to re-read a config with zero skills. Fire-and-forget; a no-op when
  // no server is running yet.
  reloadOpencodeConfig();
  // Nothing survives a restart mid-review, so reconcile the rows that still
  // claim to be in flight before the dashboard can show them (#60). Never
  // throws: a GitHub hiccup here must not stop the server from coming up.
  await reapOrphanReviews().catch((err) =>
    log.error("orphan reap failed", { error: String(err) }),
  );
  reapStaleArms();
  // Heals whatever is currently stuck: wedged rows past the watchdog ceiling
  // and terminal rows whose check run never closed (a hung finishCheck only
  // shows GitHub-side). Runs hourly too — the boot reaper alone can't catch a
  // close that fails after boot. Must not block boot, so it's fired and
  // forgotten: the hourly tick retries anything this run misses.
  void reconcileReviewChecks();
  const app = await createServer();
  app.listen(config.port, () => {
    log.info("server started", { port: config.port });
  });
  // Outer-loop improver: hourly tick, but each repo runs at most once a day and
  // only when it has new completed reviews (see runImproverForRepo) — so the
  // cadence survives restarts without a boot-time run.
  setInterval(
    () => runImproverSweep().catch((err) => log.error("improver sweep failed", { error: String(err) })),
    60 * 60 * 1000,
  );
  // Stale-check reconciler: same hourly cadence (two indexed reads, then one
  // checks.get per recent terminal row, capped at 100).
  setInterval(() => void reconcileReviewChecks(), 60 * 60 * 1000);
}
