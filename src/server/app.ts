import { Elysia } from "elysia";
import { staticPlugin } from "@elysia/static";
import { config } from "~/config";
import { verifyAndDispatch, VerificationError } from "~/server/webhook";
import { apiRoutes } from "~/server/api";

const isProd = process.env.NODE_ENV === "production";
const assetsDir = isProd ? "dist" : "public";

export async function createServer() {
  return new Elysia()
    .use(apiRoutes)
    .use(
      await staticPlugin({
        prefix: "/",
        assets: assetsDir,
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
    .onError(({ error, set }) => {
      console.error("[server] error:", error);
      set.status = 500;
      return { error: "internal error" };
    });
}

export async function boot(): Promise<void> {
  const app = await createServer();
  app.listen(config.port, () => {
    console.log(
      `fouine listening on http://localhost:${config.port} (${isProd ? "production" : "development"})`,
    );
  });
}
