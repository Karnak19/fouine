import { Elysia, t } from "elysia";
import { staticPlugin } from "@elysia/static";
import { config } from "~/config";
import { reviews, findings } from "~/db";
import { verifyAndDispatch, VerificationError } from "~/server/webhook";
import { apiRoutes } from "~/server/api";
import { auth, migrateAuth } from "~/server/auth";
import { internalSecret, INTERNAL_SECRET_HEADER } from "~/server/internal";
import { errName, log } from "~/server/log";
import { seedOpencodeConfig, reconcileSkills } from "~/skills";
import { runImproverSweep } from "~/review";

const isProd = process.env.NODE_ENV === "production";
const assetsDir = isProd ? "dist" : "public";

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
      const path = pathname(request.url);
      if (!path.startsWith("/api/")) return;
      if (path.startsWith("/api/auth/") || path === "/api/auth-status") return;
      const session = await auth.api.getSession({ headers: request.headers });
      if (session) return;
      set.status = 401;
      return "Unauthorized";
    })
    .get("/api/auth-status", () => ({ enabled: config.auth.enabled }))
    .use(apiRoutes)
    .use(
      await staticPlugin({
        assets: assetsDir,
        prefix: "/",
        indexHTML: true,
      }),
    )
    .get("/health", () => ({ ok: true }))
    // Loopback write-back: the opencode post_* tools call this right after they
    // post to GitHub, so we keep a structured record of every finding. Off the
    // /api OAuth gate (it's not a browser caller); guarded by the per-boot shared
    // secret instead. Best-effort by design — the tool must not fail a review if
    // this write fails, so it swallows errors and we just log here.
    .post(
      "/internal/reviews/:id/findings",
      ({ params, headers, body, set }) => {
        if (headers[INTERNAL_SECRET_HEADER] !== internalSecret) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const reviewId = Number(params.id);
        const review = reviews.byId.get({ $id: reviewId });
        if (!review) {
          set.status = 404;
          return { error: "unknown review" };
        }
        for (const f of body.findings) {
          findings.insert.run({
            $review: reviewId,
            $repo: review.repo_full_name,
            $pr: review.pr_number,
            $kind: f.kind,
            $severity: f.severity ?? null,
            $event: f.event ?? null,
            $path: f.path ?? null,
            $line: f.line ?? null,
            $body: f.body,
            $github_review_id: f.githubReviewId ?? null,
            $github_comment_id: f.githubCommentId ?? null,
          });
        }
        return { ok: true, stored: body.findings.length };
      },
      {
        body: t.Object({
          findings: t.Array(
            t.Object({
              kind: t.Union([
                t.Literal("inline"),
                t.Literal("summary"),
                t.Literal("comment"),
              ]),
              severity: t.Optional(
                t.Union([t.Literal("blocking"), t.Literal("nit"), t.Literal("question")]),
              ),
              event: t.Optional(t.String()),
              path: t.Optional(t.String()),
              line: t.Optional(t.Number()),
              body: t.String(),
              githubReviewId: t.Optional(t.Number()),
              githubCommentId: t.Optional(t.Number()),
            }),
          ),
        }),
      },
    )
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
        return new Response(Bun.file(`${assetsDir}/index.html`), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
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
}
