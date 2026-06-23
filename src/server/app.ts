import { Elysia } from "elysia";
import { config } from "~/config";
import { verifyAndDispatch, VerificationError } from "~/server/webhook";

export function createServer() {
  return new Elysia()
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

export function boot(): void {
  const app = createServer();
  app.listen(config.port, () => {
    console.log(`fouine listening on http://localhost:${config.port}`);
  });
}
