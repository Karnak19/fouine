import { Elysia, t, sse } from "elysia";
import { $ } from "bun";
import { repos, reviews, settings, findings } from "~/db";
import {
  publishRepoRemoved,
  publishRepoUpdated,
  publishReviewEvent,
  upsertRepoAndPublish,
  subscribeEvents,
  type ServerEvent,
} from "~/server/events";
import { SETTINGS, resolveDefaultModel } from "~/settings";
import { config } from "~/config";
import { getInstallationOctokit, fetchPRInfo } from "~/github";
import { runReviewForPR, abortReview, runImproverForRepo } from "~/review";
import { withOpencode, runReview } from "~/review/opencode";
import { installSkill, setSkillEnabled, removeSkill, listSkills } from "~/skills";
import { log } from "~/server/log";

// SSE event ids — monotonically increasing per boot, so reconnects can resume
// at a known point (we ignore Last-Event-ID; ids exist for the spec).
let eventSeq = 0;

const HEARTBEAT_MS = 25_000;

// Named event, so the browser routes it to a 'heartbeat' listener nobody
// registers instead of onmessage — the client never sees keepalive traffic.
const heartbeat = () => sse({ event: "heartbeat", data: "" });

// Date ranges for the stats page. null = no cutoff ("all").
const RANGE_SECONDS: Record<string, number | null> = {
  "24h": 86400,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
  "90d": 90 * 86400,
  all: null,
};

// Empty query strings are "no filter", not a filter on the empty string.
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

// A YYYY-MM-DD picker value as a UTC epoch, or null for anything that isn't one.
// UTC on purpose: created_at is epoch and reviews.daily buckets with
// date(created_at, 'unixepoch'), which is UTC, so interpreting the picked days
// as UTC keeps the picker, the guards and the chart bars describing the same
// days. A Europe/Paris user sees boundaries a couple of hours off local
// midnight, which is consistent; mixing local days with UTC bars would not be.
// Round-tripped through toISOString to reject real-looking nonsense like
// 2026-13-45 and 2026-02-30, which Date.UTC would happily roll over.
export function dayEpoch(raw: string | null): number | null {
  if (raw === null || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const ms = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === raw ? Math.floor(ms / 1000) : null;
}

const DAY_SECONDS = 86400;

// No range param at all means unfiltered, so the dashboard — which sends none —
// keeps the all-time totals it has always shown. The stats page always sends an
// explicit range (its 30d default included), even when the URL omits it for a
// clean link, so only an unrecognised *explicit* value falls back to 30d.
//
// from/to win over range when either is a valid date: one source of truth, so
// the page can never show a custom window while claiming a preset. `to` is
// inclusive of the day picked, so it becomes the START of the next day and the
// SQL compares with a strict `<` — otherwise the whole final day, the one most
// likely being looked at, silently disappears.
export function statsFilter(query: Record<string, unknown>) {
  const from = dayEpoch(str(query.from));
  const toDay = dayEpoch(str(query.to));
  const to = toDay === null ? null : toDay + DAY_SECONDS;
  if (from !== null || to !== null) {
    // An inverted window would just return nothing; drop the bound that makes
    // it impossible rather than erroring, and let the UI's min/max prevent it.
    const inverted = from !== null && to !== null && from >= to;
    return {
      $from: from,
      $to: inverted ? null : to,
      $repo: str(query.repo),
      $model: str(query.model),
    };
  }
  const key = str(query.range);
  if (key === null)
    return { $from: null, $to: null, $repo: str(query.repo), $model: str(query.model) };
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so ?range=toString
  // would resolve to a function and poison $from with NaN.
  const secs = Object.hasOwn(RANGE_SECONDS, key) ? RANGE_SECONDS[key]! : RANGE_SECONDS["30d"]!;
  return {
    $from: secs === null ? null : Math.floor(Date.now() / 1000) - secs,
    $to: null,
    $repo: str(query.repo),
    $model: str(query.model),
  };
}

export const apiRoutes = new Elysia({ prefix: "/api" })
  // Server-Sent Events stream. Scope = ?repo=owner/name (server-side filter,
  // so a client can only subscribe to the repo it's viewing); no scope = all
  // repos. Heartbeat comment every 25s keeps proxies from idling the
  // connection; the browser's EventSource reconnects natively (with
  // Last-Event-ID, which we ignore — clients refetch their REST queries on
  // reconnect, so there are no duplicate events and no missed final state).
  // Under the /api OAuth gate like the rest of the dashboard.
  .get("/events", async function* ({ query, request }) {
    const repo = (query.repo as string | undefined) ?? null;

    // The hub pushes; a generator pulls. Bridge with a queue the subscriber
    // fills and a `wake` the idle loop parks on.
    const queue: ServerEvent[] = [];
    let wake: (() => void) | undefined;
    const unsubscribe = subscribeEvents(repo, (e) => {
      queue.push(e);
      wake?.();
    });

    // Everything after subscribeEvents lives in the try, first yield included:
    // a client that disconnects while we're suspended right there closes the
    // generator, and a finally it never entered can't unsubscribe it.
    try {
      // Elysia awaits the first yield before returning the Response, so open
      // the stream immediately rather than after the first real event.
      yield heartbeat();

      while (!request.signal.aborted) {
        while (queue.length) yield sse({ id: eventSeq++, data: queue.shift()! });
        // Park until the next publish, the client disconnecting, or the
        // keepalive deadline. Listening for abort matters: without it a
        // disconnect would sit here for the rest of the heartbeat window
        // holding the subscription.
        await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const done = () => {
            clearTimeout(timer);
            request.signal.removeEventListener("abort", done);
            wake = undefined;
            resolve();
          };
          timer = setTimeout(done, HEARTBEAT_MS);
          wake = done;
          request.signal.addEventListener("abort", done, { once: true });
        });
        if (!queue.length && !request.signal.aborted) yield heartbeat();
      }
    } finally {
      unsubscribe();
    }
  })

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
      return upsertRepoAndPublish(body.full_name, body.installation_id);
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
      const row = repos.get.get({ $full_name: full })!;
      publishRepoUpdated(row);
      return row;
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
    publishRepoRemoved(full);
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

  .get("/reviews", ({ query }) => {
    const limit = Number(str(query.limit));
    return reviews.recent.all({
      ...statsFilter(query),
      $status: str(query.status),
      $limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 100,
    });
  })

  .get("/stats", ({ query }) => {
    const f = statsFilter(query);
    const agg = reviews.latencyAgg.get(f);
    return {
      projects: reviews.byProject.all(f),
      models: reviews.byModel.all(f),
      daily: reviews.daily.all(f),
      triggers: reviews.triggers.all(f),
      latency: {
        avg: agg?.avg ?? null,
        count: agg?.count ?? 0,
        p95: reviews.latencyP95.get(f)?.d ?? null,
      },
      topCost: reviews.topCost.all(f),
      severity: findings.bySeverity.all(f),
      // Unfiltered on purpose — the dropdown must keep every option.
      allModels: reviews.allModels.all().map((r) => r.model),
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
        publishReviewEvent("updated", id);
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
