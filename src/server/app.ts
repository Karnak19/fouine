import { Elysia } from "elysia";
import { staticPlugin } from "@elysia/static";
import { config } from "~/config";
import { verifyAndDispatch, VerificationError } from "~/server/webhook";
import { apiRoutes } from "~/server/api";
import { errName, log } from "~/server/log";

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
    .use(apiRoutes)
    .use(
      await staticPlugin({
        assets: assetsDir,
        prefix: "/",
        indexHTML: true,
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
  const app = await createServer();
  app.listen(config.port, () => {
    log.info("server started", { port: config.port });
  });
}
