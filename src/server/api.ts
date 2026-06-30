import { Elysia, t } from "elysia";
import { $ } from "bun";
import { repos, reviews, settings } from "~/db";
import { SETTINGS } from "~/settings";

export const apiRoutes = new Elysia({ prefix: "/api" })
  .get("/repos", () => repos.list.all())

  .get("/repos/:owner/:name", ({ params }) => {
    const full = `${params.owner}/${params.name}`;
    const repo = repos.get.get({ $full_name: full });
    if (!repo) return new Response("Not found", { status: 404 });
    return repo;
  })

  .post(
    "/repos",
    ({ body }) => {
      repos.upsert.run({
        $full_name: body.full_name,
        $installation_id: body.installation_id,
        $prompt: null,
        $model: null,
      });
      return repos.get.get({ $full_name: body.full_name });
    },
    { body: t.Object({ full_name: t.String(), installation_id: t.Number() }) },
  )

  .put(
    "/repos/:owner/:name",
    ({ params, body }) => {
      const full = `${params.owner}/${params.name}`;
      const existing = repos.get.get({ $full_name: full });
      if (!existing) return new Response("Not found", { status: 404 });
      repos.update.run({
        $full_name: full,
        $prompt: body.prompt ?? null,
        $model: body.model ?? null,
      });
      return repos.get.get({ $full_name: full });
    },
    {
      body: t.Object({
        prompt: t.Optional(t.String()),
        model: t.Optional(t.String()),
      }),
    },
  )

  .delete("/repos/:owner/:name", ({ params, set }) => {
    const full = `${params.owner}/${params.name}`;
    repos.remove.run({ $full_name: full });
    set.status = 204;
  })

  .get("/repos/:owner/:name/reviews", ({ params }) => {
    const full = `${params.owner}/${params.name}`;
    return reviews.recent.all({ $limit: 999 }).filter((r) => r.repo_full_name === full);
  })

  .get("/reviews", () => reviews.recent.all({ $limit: 100 }))

  .get("/reviews/:id", ({ params }) => {
    const r = reviews.byId.get({ $id: Number(params.id) });
    if (!r) return new Response("Not found", { status: 404 });
    return r;
  })

  .get("/reviews/:id/session", async ({ params }) => {
    const r = reviews.byId.get({ $id: Number(params.id) });
    if (!r?.session_id) return new Response("Not found", { status: 404 });
    const res = await $`opencode export ${r.session_id}`.nothrow().quiet();
    const out = res.stdout.toString().trim();
    if (res.exitCode !== 0 || !out) {
      return { error: "session-unavailable", detail: res.stderr.toString().trim() };
    }
    try {
      return JSON.parse(out);
    } catch {
      return { error: "session-unparseable", raw: out.slice(0, 1000) };
    }
  })

  .get("/settings", () => {
    const all = settings.all.all();
    return Object.fromEntries(all.map((s) => [s.key, s.value]));
  })

  .put(
    "/settings",
    ({ body }) => {
      if (body.opencode_api_key) {
        settings.set.run({ $key: SETTINGS.API_KEY, $value: body.opencode_api_key });
      }
      if (body.opencode_model) {
        settings.set.run({ $key: SETTINGS.MODEL, $value: body.opencode_model });
      }
      if (body.default_prompt) {
        settings.set.run({ $key: SETTINGS.PROMPT, $value: body.default_prompt });
      }
      const all = settings.all.all();
      return Object.fromEntries(all.map((s) => [s.key, s.value]));
    },
    {
      body: t.Object({
        opencode_api_key: t.Optional(t.String()),
        opencode_model: t.Optional(t.String()),
        default_prompt: t.Optional(t.String()),
      }),
    },
  );
