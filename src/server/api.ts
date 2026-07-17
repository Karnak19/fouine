import { Elysia, t } from "elysia";
import { $ } from "bun";
import { repos, reviews, settings, findings } from "~/db";
import { SETTINGS, resolveDefaultModel } from "~/settings";
import { config } from "~/config";
import { getInstallationOctokit, fetchPRInfo } from "~/github";
import { runReviewForPR, abortReview, runImproverForRepo } from "~/review";
import { withOpencode, runReview } from "~/review/opencode";
import { installSkill, setSkillEnabled, removeSkill, listSkills } from "~/skills";
import { log } from "~/server/log";

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
        $enabled: body.enabled ?? existing.enabled,
      });
      return repos.get.get({ $full_name: full });
    },
    {
      body: t.Object({
        prompt: t.Optional(t.String()),
        model: t.Optional(t.String()),
        enabled: t.Optional(t.Number()),
      }),
    },
  )

  .delete("/repos/:owner/:name", ({ params, set }) => {
    const full = `${params.owner}/${params.name}`;
    repos.remove.run({ $full_name: full });
    set.status = 204;
  })

  // Manual trigger for the outer-loop improver (the hourly sweep is the
  // automatic path). Fire-and-forget like retry: 202 means "queued".
  .post("/repos/:owner/:name/improve", ({ params, set }) => {
    const full = `${params.owner}/${params.name}`;
    const repo = repos.get.get({ $full_name: full });
    if (!repo) return new Response("Not found", { status: 404 });
    runImproverForRepo(full, true)
      .then((out) => {
        if (!out.started) log.info("improver skipped", { repo: full, reason: out.reason });
      })
      .catch((err) => log.error("improver failed", { repo: full, error: String(err) }));
    set.status = 202;
    return { ok: true };
  })

  .get("/repos/:owner/:name/reviews", ({ params }) => {
    const full = `${params.owner}/${params.name}`;
    return reviews.byRepo.all({ $repo: full, $limit: 200 });
  })

  .get("/repos/:owner/:name/pr/:number", ({ params }) => {
    const full = `${params.owner}/${params.name}`;
    return reviews.byRepoPR.all({
      $repo: full,
      $pr: Number(params.number),
      $limit: 200,
    });
  })

  .get("/reviews", () => reviews.recent.all({ $limit: 100 }))

  .get("/stats", () => {
    const agg = reviews.latencyAgg.get();
    return {
      projects: reviews.byProject.all(),
      models: reviews.byModel.all(),
      daily: reviews.daily.all(),
      triggers: reviews.triggers.all(),
      latency: {
        avg: agg?.avg ?? null,
        count: agg?.count ?? 0,
        p95: reviews.latencyP95.get()?.d ?? null,
      },
      topCost: reviews.topCost.all(),
      severity: findings.bySeverity.all(),
    };
  })

  .get("/reviews/:id/findings", ({ params }) => findings.byReview.all({ $review: Number(params.id) }))

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

  .post("/reviews/:id/retry", async ({ params, set }) => {
    const r = reviews.byId.get({ $id: Number(params.id) });
    if (!r) return new Response("Not found", { status: 404 });
    const repo = repos.get.get({ $full_name: r.repo_full_name });
    if (!repo) return new Response("repo not found", { status: 404 });
    try {
      const octokit = await getInstallationOctokit(repo.installation_id);
      const pr = await fetchPRInfo(octokit, repo.installation_id, r.repo_full_name, r.pr_number);
      runReviewForPR(pr, "retry").catch((err) =>
        log.error("retry failed", { review: r.id, error: String(err) }),
      );
      set.status = 202;
      return { ok: true };
    } catch (err) {
      set.status = 502;
      return { ok: false, error: String((err as Error)?.message ?? err) };
    }
  })

  .post("/reviews/:id/stop", ({ params }) => {
    const id = Number(params.id);
    const r = reviews.byId.get({ $id: id });
    if (!r) return new Response("Not found", { status: 404 });
    if (r.status !== "running" && r.status !== "pending") {
      return { ok: false, reason: `already ${r.status}` };
    }
    // Abort any live opencode server; the runner's abort-aware catch will mark
    // it failed. abortReview returning false is ambiguous — zombie (dead process)
    // OR just-finished (runner's finally already removed the controller) — so
    // re-check status and only write for true zombies still stuck at
    // running/pending, never clobbering a review that beat the stop to completion.
    const live = abortReview(id);
    if (!live) {
      const cur = reviews.byId.get({ $id: id });
      if (cur && (cur.status === "running" || cur.status === "pending")) {
        reviews.fail.run({ $id: id, $error: "Stopped by user" });
      }
    }
    log.info("review stopped", { review: id, live });
    return { ok: true, live };
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
      if (body.improver_model) {
        settings.set.run({ $key: SETTINGS.IMPROVER_MODEL, $value: body.improver_model });
      }
      const all = settings.all.all();
      return Object.fromEntries(all.map((s) => [s.key, s.value]));
    },
    {
      body: t.Object({
        opencode_api_key: t.Optional(t.String()),
        opencode_model: t.Optional(t.String()),
        default_prompt: t.Optional(t.String()),
        improver_model: t.Optional(t.String()),
      }),
    },
  )

  // Global reviewer skills (skills.sh / GitHub). Installed disabled; enabling
  // one materialises it into the opencode config dir for subsequent reviews.
  .get("/skills", () => listSkills())

  .post(
    "/skills",
    async ({ body, set }) => {
      try {
        return await installSkill(body.url);
      } catch (err) {
        set.status = 422;
        return { error: String((err as Error)?.message ?? err) };
      }
    },
    { body: t.Object({ url: t.String() }) },
  )

  .put(
    "/skills/:name",
    ({ params, body, set }) => {
      const row = setSkillEnabled(params.name, body.enabled);
      if (!row) {
        set.status = 404;
        return { error: "not found" };
      }
      return row;
    },
    { body: t.Object({ enabled: t.Boolean() }) },
  )

  .delete("/skills/:name", ({ params, set }) => {
    removeSkill(params.name);
    set.status = 204;
  })

  // ponytail: sends one tiny real prompt through the configured model — only way
  // to actually verify the key + model resolve. Costs ~1 request.
  .get("/settings/test", async () => {
    try {
      const res = await withOpencode((client) =>
        runReview(client, {
          directory: config.dataDir,
          prompt: "Reply with exactly: OK",
          model: resolveDefaultModel(),
        }),
      );
      return { ok: true, text: res.text.slice(0, 200) };
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) };
    }
  });
