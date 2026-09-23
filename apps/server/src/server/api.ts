import { Elysia, t, sse, status } from "elysia";
import { repos, reviews, settings, findings } from "~/db";
import {
  publishRepoRemoved,
  publishRepoUpdated,
  publishReviewEvent,
  upsertRepoAndPublish,
  subscribeEvents,
  type ServerEvent,
} from "~/server/events";
import {
  SETTINGS,
  resolveDefaultModel,
  ZAI_PROVIDER,
  COMMANDCODE_PROVIDER,
  opencodeKeySource,
  zaiKeySource,
  commandcodeKeySource,
} from "~/settings";
import { writeOpencodeConfig } from "~/skills";
import { config } from "~/config";
import { getInstallationOctokit, fetchPRInfo } from "~/github";
import { runReviewForPR, abortReview, runImproverForRepo, runRefine, runImplement } from "~/review";
import { withOpencode, runReview, parseModel, describeOpencodeError } from "~/review/opencode";
import { openCodeManager } from "~/effect/opencode";
import { listModels, searchModels, configuredProviders } from "~/review/models";
import { installSkill, setSkillEnabled, removeSkill, listSkills } from "~/skills";
import { log } from "~/server/log";
import { streamChat, MAX_TURNS, MAX_QUESTION_CHARS, MAX_PARTS_PER_MESSAGE } from "~/chat";
import { streamBuild, MAX_PROMPT_CHARS } from "~/build";
import {
  MAX_DATASETS,
  MAX_PREVIOUS_PROMPTS,
  MAX_PREVIOUS_SPEC_BYTES,
  MAX_SQL_CHARS,
} from "@fouine/shared/build-catalog";
import type { UIMessage } from "ai";

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

// Settings rows the dashboard must never see back: the raw key values. The
// table stores exactly what was PUT, so a plain dump of `settings.all.all()`
// leaked the opencode/zai/commandcode API keys into the GET /settings
// response (and the browser's react-query cache) even though the frontend
// never reads them back into its inputs. Callers get the key's *source*
// instead — enough to render "using dashboard key" / "using env var" / "not
// set" and to disable a provider's Test button, never the secret itself.
const SECRET_SETTINGS_KEYS = new Set<string>([
  SETTINGS.API_KEY,
  SETTINGS.ZAI_API_KEY,
  SETTINGS.COMMANDCODE_API_KEY,
]);

function settingsSnapshot() {
  const all = settings.all.all().filter((s) => !SECRET_SETTINGS_KEYS.has(s.key));
  return {
    ...Object.fromEntries(all.map((s) => [s.key, s.value])),
    opencode_key_source: opencodeKeySource(),
    zai_key_source: zaiKeySource(),
    commandcode_key_source: commandcodeKeySource(),
  };
}

// The three provider "slots" the dashboard's Test buttons cover. Each pushes
// its own key (task B's ensureProviderKey) and runs one real prompt through a
// model that provider actually serves — the default model when it already
// belongs to that provider, else a small known-cheap one, so the test never
// silently exercises the wrong provider.
const TEST_PROVIDERS = {
  opencode: { providerID: "opencode-go", fallbackModel: "opencode-go/deepseek-v4-flash" },
  zai: { providerID: ZAI_PROVIDER, fallbackModel: `${ZAI_PROVIDER}/glm-5.3` },
  commandcode: {
    providerID: COMMANDCODE_PROVIDER,
    fallbackModel: `${COMMANDCODE_PROVIDER}/deepseek-v4-flash`,
  },
} as const;
type TestProviderKey = keyof typeof TEST_PROVIDERS;

// Map a v2 opencode message onto the transcript shape the dashboard renders:
// { info: {id, role, modelID}, parts: [{id, type, text?, tool?, state?}] }.
// Part ids must match the live transcript fold's scheme
// (`${messageID}:${index}` for text/reasoning, the tool call id for tools) so
// streamed deltas merge into the fetched snapshot. Web consumes this via Eden.
function toUiMessage(m: {
  id: string;
  type: string;
  model?: { id?: string; providerID?: string };
  // Set on an assistant row whose run errored (finish:"error") — a provider
  // auth failure, rate limit, etc. v2's session.wait resolves normally even
  // then, so this is the only place the failure shows up (see
  // review/opencode.ts's assessTurnOutcome for the server-side counterpart).
  error?: { type?: string; message?: string; status?: number };
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    state?: {
      status?: string;
      input?: unknown;
      content?: Array<{ type?: string; text?: string }>;
      error?: { message?: string };
    };
  }>;
}) {
  const parts = (m.content ?? []).map((c, idx) => {
    if (c.type === "tool") {
      const output = (c.state?.content ?? [])
        .filter((t) => t.type === "text")
        .map((t) => t.text ?? "")
        .join("\n");
      return {
        id: c.id ?? `${m.id}:${idx}`,
        type: "tool",
        tool: c.name,
        state: {
          status: c.state?.status,
          title: c.state?.input === undefined ? undefined : JSON.stringify(c.state.input),
          output: output || undefined,
          error: c.state?.error?.message,
        },
      };
    }
    return { id: `${m.id}:${idx}`, type: c.type, text: c.text };
  });
  if (m.error) {
    parts.push({
      id: `${m.id}:error`,
      type: "error",
      text: [m.error.type, m.error.status, m.error.message].filter(Boolean).join(" "),
    });
  }
  return {
    info: { id: m.id, role: m.type, modelID: m.model?.id },
    parts,
  };
}

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

// Must match the LIMIT in reviews.latencySamples — it's how we detect that a
// window was truncated and the trend is drawn from a partial population.
const LATENCY_SAMPLE_LIMIT = 5000;

// Nearest-rank percentile over an ALREADY SORTED ascending array. Returns null
// for an empty array rather than NaN: an empty window is a normal outcome here,
// and a null renders as a dash instead of poisoning the chart's scale.
export function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

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

// Shared by every filterable GET below. `statsFilter` still does the calendar
// validity check on from/to (a schema pattern can't reject 2026-02-30) — this
// just rejects garbage shapes before the handler runs.
const statsQuery = t.Object({
  range: t.Optional(
    t.Union([t.Literal("24h"), t.Literal("7d"), t.Literal("30d"), t.Literal("90d"), t.Literal("all")]),
  ),
  from: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  to: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  repo: t.Optional(t.String()),
  model: t.Optional(t.String()),
});

const reviewsQuery = t.Composite([
  statsQuery,
  t.Object({
    status: t.Optional(
      t.Union([
        t.Literal("pending"),
        t.Literal("running"),
        t.Literal("completed"),
        t.Literal("failed"),
        t.Literal("skipped"),
      ]),
    ),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })),
  }),
]);

export const apiRoutes = new Elysia({ prefix: "/api" })
  // Server-Sent Events stream. Scope = ?repo=owner/name (server-side filter,
  // so a client can only subscribe to the repo it's viewing); no scope = all
  // repos. Heartbeat comment every 25s keeps proxies from idling the
  // connection; the browser's EventSource reconnects natively (with
  // Last-Event-ID, which we ignore — clients refetch their REST queries on
  // reconnect, so there are no duplicate events and no missed final state).
  // Under the /api OAuth gate like the rest of the dashboard.
  .get(
    "/events",
    async function* ({ query, request }) {
    const repo = query.repo ?? null;

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
    },
    { query: t.Object({ repo: t.Optional(t.String()) }) },
  )

  // Chat over the review data. The AI SDK produces a UI message stream and
  // Elysia can return that Response as-is, so there is no second transport and
  // no hand-rolled SSE here — useChat on the client speaks this natively.
  .post(
    "/chat",
    async ({ body, set, request }) => {
      try {
        return await streamChat(body.messages as UIMessage[], request.signal, body.id);
      } catch (err) {
        // Config problems (no API key) surface as a readable message rather
        // than an opaque 500 the UI would render as a blank bubble.
        set.status = 400;
        return { error: String((err as Error)?.message ?? err) };
      }
    },
    {
      // Real validation at the trust boundary, not a cast. The browser posts the
      // whole thread back every turn, and an oversized or endless payload is
      // paid for upstream in provider tokens — the exact cost this app exists
      // to measure. Elysia rejects anything outside these bounds with a 422
      // before a single token is spent.
      body: t.Object({
        // useChat's thread id — forwarded upstream as x-opencode-session.
        id: t.Optional(t.String({ maxLength: 128 })),
        messages: t.Array(
          t.Object({
            id: t.Optional(t.String({ maxLength: 128 })),
            role: t.Union([t.Literal("user"), t.Literal("assistant"), t.Literal("system")]),
            parts: t.Array(
              t.Object(
                {
                  type: t.String({ maxLength: 64 }),
                  text: t.Optional(t.String({ maxLength: MAX_QUESTION_CHARS })),
                },
                // Tool parts carry extra keys; they are stripped server-side
                // anyway (only user text survives), so tolerate them here
                // rather than 422-ing a legitimate client.
                { additionalProperties: true },
              ),
              { maxItems: MAX_PARTS_PER_MESSAGE },
            ),
          }),
          { minItems: 1, maxItems: MAX_TURNS },
        ),
      }),
    },
  )

  // Compose a whole dashboard from one sentence. Same transport as /chat — an
  // AI SDK UI message stream, returned as-is — and the same OAuth gate, which
  // it inherits from the /api/* rule in server/app.ts rather than declaring its
  // own. What comes down it: the datasets first, then json-render spec patches.
  .post(
    "/build",
    async ({ body, set, request }) => {
      try {
        return await streamBuild(body.prompt, request.signal, body.id, body.previous);
      } catch (err) {
        set.status = 400;
        return { error: String((err as Error)?.message ?? err) };
      }
    },
    {
      body: t.Object({
        id: t.Optional(t.String({ maxLength: 128 })),
        prompt: t.String({ minLength: 1, maxLength: MAX_PROMPT_CHARS }),
        // A follow-up: the dashboard as it stands, minus the rows. Sizes are
        // bounded here so `previous` cannot be a multi-megabyte body; what the
        // fields mean is checked in `validatePrevious`, which re-sanitises the
        // spec and re-runs every SQL through the guard.
        previous: t.Optional(
          t.Object({
            spec: t.Object(
              {
                root: t.String({ maxLength: 200 }),
                elements: t.Record(t.String({ maxLength: 200 }), t.Unknown()),
              },
              { additionalProperties: false },
            ),
            datasets: t.Array(
              t.Object(
                {
                  key: t.String({ maxLength: 64 }),
                  title: t.String({ maxLength: 500 }),
                  sql: t.String({ minLength: 1, maxLength: MAX_SQL_CHARS }),
                  shape: t.Optional(t.String({ maxLength: 16 })),
                },
                // Rows, ms or anything else the browser happens to have are
                // ignored downstream — validatePrevious copies named fields only.
                { additionalProperties: true },
              ),
              { maxItems: MAX_DATASETS },
            ),
            prompts: t.Array(t.String({ maxLength: MAX_PROMPT_CHARS }), { maxItems: MAX_PREVIOUS_PROMPTS }),
          }),
        ),
      }),
      // The whole body, spec included, must fit in the spec cap with room for
      // the datasets' SQL. A rough gate that fires before parsing does any work.
      beforeHandle: ({ request, set }) => {
        const len = Number(request.headers.get("content-length") ?? 0);
        if (len > MAX_PREVIOUS_SPEC_BYTES + MAX_DATASETS * MAX_SQL_CHARS + 64_000) {
          set.status = 413;
          return { error: "That request is too large to refine. Start over." };
        }
      },
      // A body outside the schema is a 400 with ONE sentence the page can show,
      // not Elysia's default 422 dump of the offending value — which for a
      // refine would be the whole spec echoed back at the reader.
      error: ({ code, error, set }) => {
        if (code !== "VALIDATION") return;
        set.status = 400;
        const first = (error as { all?: { summary?: string }[] }).all?.[0]?.summary;
        return {
          error:
            "That request does not fit the /build limits" +
            (first ? ` (${first.replace(/^Expected /, "expected ")})` : "") +
            ". Shorten the prompt, or start over if this is a refinement.",
        };
      },
    },
  )

  .get("/repos", () => repos.list.all())

  .get("/repos/:owner/:name", ({ params }) => {
    const full = `${params.owner}/${params.name}`;
    const repo = repos.get.get({ $full_name: full });
    if (!repo) return status(404, { error: "Not found" });
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
      if (!existing) return status(404, { error: "Not found" });
      repos.update.run({
        $full_name: full,
        $prompt: body.prompt ?? null,
        $model: body.model ?? null,
        $enabled: body.enabled ?? existing.enabled,
        // Absent keeps the stored override, explicit null clears it back to
        // inheriting the global default. `??` would collapse the two.
        $deny_test_commands:
          body.deny_test_commands === undefined
            ? existing.deny_test_commands
            : body.deny_test_commands,
        $auto_merge: body.auto_merge === undefined ? existing.auto_merge : body.auto_merge,
        $merge_method: body.merge_method === undefined ? existing.merge_method : body.merge_method,
        $refine_enabled:
          body.refine_enabled === undefined ? existing.refine_enabled : body.refine_enabled,
        $refine_prompt: body.refine_prompt === undefined ? existing.refine_prompt : body.refine_prompt,
        $implement_enabled:
          body.implement_enabled === undefined ? existing.implement_enabled : body.implement_enabled,
        $implement_label:
          body.implement_label === undefined ? existing.implement_label : body.implement_label,
        $implement_prompt:
          body.implement_prompt === undefined ? existing.implement_prompt : body.implement_prompt,
        $refine_model: body.refine_model === undefined ? existing.refine_model : body.refine_model,
        $implement_model:
          body.implement_model === undefined ? existing.implement_model : body.implement_model,
        $auto_ready: body.auto_ready === undefined ? existing.auto_ready : body.auto_ready,
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
        deny_test_commands: t.Optional(t.Union([t.Number(), t.Null()])),
        auto_merge: t.Optional(t.Union([t.Number(), t.Null()])),
        merge_method: t.Optional(
          t.Union([t.Literal("merge"), t.Literal("squash"), t.Literal("rebase"), t.Null()]),
        ),
        refine_enabled: t.Optional(t.Union([t.Number(), t.Null()])),
        refine_prompt: t.Optional(t.Union([t.String(), t.Null()])),
        implement_enabled: t.Optional(t.Union([t.Number(), t.Null()])),
        implement_label: t.Optional(t.Union([t.String(), t.Null()])),
        implement_prompt: t.Optional(t.Union([t.String(), t.Null()])),
        refine_model: t.Optional(t.Union([t.String(), t.Null()])),
        implement_model: t.Optional(t.Union([t.String(), t.Null()])),
        auto_ready: t.Optional(t.Union([t.Number(), t.Null()])),
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

  // Manual/dashboard re-run of the issue refiner. Fire-and-forget like improve:
  // 202 means "queued".
  .post("/repos/:owner/:name/refine/:issue", ({ params, set }) => {
    const full = `${params.owner}/${params.name}`;
    const repo = repos.get.get({ $full_name: full });
    if (!repo) return new Response("Not found", { status: 404 });
    runRefine({
      repoFullName: full,
      installationId: repo.installation_id,
      issueNumber: Number(params.issue),
      // No payload to read a real title from here — the refiner prompt itself
      // still sees the actual title via fetchIssueInfo; this is only the
      // reviews-row label.
      issueTitle: `Issue #${params.issue}`,
    }).catch((err) => log.error("refine failed", { repo: full, error: String(err) }));
    set.status = 202;
    return { ok: true };
  })

  // Manual/dashboard re-run of the issue implementer. Fire-and-forget like
  // refine: 202 means "queued".
  .post("/repos/:owner/:name/implement/:issue", ({ params, set }) => {
    const full = `${params.owner}/${params.name}`;
    const repo = repos.get.get({ $full_name: full });
    if (!repo) return new Response("Not found", { status: 404 });
    runImplement({
      repoFullName: full,
      installationId: repo.installation_id,
      issueNumber: Number(params.issue),
      issueTitle: `Issue #${params.issue}`,
    }).catch((err) => log.error("implement failed", { repo: full, error: String(err) }));
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

  .get(
    "/reviews",
    ({ query }) => {
      return reviews.recent.all({
        ...statsFilter(query),
        $status: query.status ?? null,
        $limit: query.limit ?? 100,
      });
    },
    { query: reviewsQuery },
  )

  .get(
    "/stats",
    ({ query }) => {
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
    },
    { query: statsQuery },
  )

  // The chart panels live on their own route rather than being folded into
  // /stats: the latency trend ships one row per completed review, and the
  // dashboard — which calls /stats on every load and renders none of this —
  // would pay for thousands of samples it never reads.
  .get(
    "/stats/charts",
    ({ query }) => {
    const f = statsFilter(query);
    const samples = reviews.latencySamples.all(f);

    // Bucket the raw durations by day, then take percentiles per bucket. An
    // empty window yields an empty array, never a NaN or a divide-by-zero.
    const byDay = new Map<string, number[]>();
    for (const s of samples) {
      const bucket = byDay.get(s.day);
      if (bucket) bucket.push(s.seconds);
      else byDay.set(s.day, [s.seconds]);
    }
    const latency = [...byDay.entries()]
      .map(([day, seconds]) => {
        const sorted = seconds.toSorted((a, b) => a - b);
        return { day, count: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
      })
      .sort((a, b) => a.day.localeCompare(b.day));

    return {
      reliability: reviews.reliabilityDaily.all(f),
      latency,
      // Truncated windows would trend on a partial population; say so rather
      // than drawing a quietly wrong line.
      latencyTruncated: samples.length === LATENCY_SAMPLE_LIMIT,
      findingsDaily: findings.dailyBySeverity.all(f),
      topFiles: findings.topFiles.all(f),
    };
    },
    { query: statsQuery },
  )

  .get("/reviews/:id/findings", ({ params }) => findings.byReview.all({ $review: Number(params.id) }))

  .get("/reviews/:id", ({ params }) => {
    const r = reviews.byId.get({ $id: Number(params.id) });
    if (!r) return status(404, { error: "Not found" });
    return r;
  })

  .get("/reviews/:id/session", async ({ params, set }) => {
    const r = reviews.byId.get({ $id: Number(params.id) });
    if (!r?.session_id) return new Response("Not found", { status: 404 });
    const sessionId = r.session_id;
    try {
      // Session lookup is global by id, no `directory` needed, and the shared
      // singleton client serves it — the manager owns one server for the whole
      // process rather than spawning one per request.
      return await withOpencode(async (client) => {
        const info = await client.session.get({ sessionID: sessionId });
        // order:"asc" so the transcript renders oldest-first (v2 defaults to
        // newest-first); "idle" rows are a run-outcome marker, not a message,
        // so they're dropped here rather than rendered as an empty turn.
        const msgs = (await client.message.list({ sessionID: sessionId, order: "asc" })).data;
        return { info, messages: msgs.filter((m) => m.type !== "idle").map(toUiMessage) };
      });
    } catch (err) {
      set.status = 503;
      return { error: "session-unavailable", detail: String(err) };
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

  // Catalog for the model autocompletes. Cached in-process; ?refresh=1 rebuilds.
  .get(
    "/models",
    async ({ query }) => {
      try {
        const list = await listModels(query.refresh === "1", query.all === "1");
        return {
          models: searchModels(list, query.q ?? ""),
          total: list.length,
          providers: [...configuredProviders()].sort(),
        };
      } catch (e) {
        // A missing/broken opencode install shouldn't blank the settings page —
        // the fields stay usable as free text.
        log.warn("model catalog unavailable", { error: String(e) });
        return { models: [], total: 0, providers: [], error: String(e) };
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        all: t.Optional(t.String()),
        refresh: t.Optional(t.String()),
      }),
    },
  )

  .get("/settings", () => settingsSnapshot())

  .put(
    "/settings",
    ({ body }) => {
      // Keys: an absent field keeps the stored value, an explicit "" (or, for
      // merge_method, null) deletes the row. Without the delete the row would
      // shadow the env var forever, so a rotated OPENCODE_API_KEY/ZAI_API_KEY/
      // COMMANDCODE_API_KEY could never take effect.
      const setKey = (key: string, value?: string | null) => {
        if (value) settings.set.run({ $key: key, $value: value });
        else if (value === "" || value === null) settings.del.run({ $key: key });
      };
      setKey(SETTINGS.API_KEY, body.opencode_api_key);
      setKey(SETTINGS.ZAI_API_KEY, body.zai_api_key);
      setKey(SETTINGS.COMMANDCODE_API_KEY, body.commandcode_api_key);
      // The generated opencode.json declares the Command Code provider + plugin
      // only while a key exists, so a saved or cleared key must re-write it.
      if (body.commandcode_api_key !== undefined) writeOpencodeConfig();
      // "1" turns it on, "" deletes the row -> back to off (the default).
      setKey(SETTINGS.DENY_TEST_COMMANDS, body.deny_test_commands);
      setKey(SETTINGS.AUTO_MERGE, body.auto_merge);
      setKey(SETTINGS.MERGE_METHOD, body.merge_method);
      setKey(SETTINGS.REFINE_ENABLED, body.refine_enabled);
      setKey(SETTINGS.DEFAULT_REFINE_PROMPT, body.default_refine_prompt);
      setKey(SETTINGS.IMPLEMENT_ENABLED, body.implement_enabled);
      setKey(SETTINGS.IMPLEMENT_LABEL, body.implement_label);
      setKey(SETTINGS.DEFAULT_IMPLEMENT_PROMPT, body.default_implement_prompt);
      setKey(SETTINGS.AUTO_READY, body.auto_ready);
      // Models: blank clears the row so the field falls back to its cascade
      // (per-repo override → this → review model). Always sent by the
      // dashboard, unlike the secrets above where blank means "keep".
      setKey(SETTINGS.MODEL, body.opencode_model);
      setKey(SETTINGS.IMPROVER_MODEL, body.improver_model);
      setKey(SETTINGS.REFINE_MODEL, body.refine_model);
      setKey(SETTINGS.IMPLEMENT_MODEL, body.implement_model);
      setKey(SETTINGS.CHAT_MODEL, body.chat_model);
      if (body.default_prompt) {
        settings.set.run({ $key: SETTINGS.PROMPT, $value: body.default_prompt });
      }
      return settingsSnapshot();
    },
    {
      body: t.Object({
        opencode_api_key: t.Optional(t.String()),
        zai_api_key: t.Optional(t.String()),
        commandcode_api_key: t.Optional(t.String()),
        opencode_model: t.Optional(t.String()),
        default_prompt: t.Optional(t.String()),
        improver_model: t.Optional(t.String()),
        refine_model: t.Optional(t.String()),
        implement_model: t.Optional(t.String()),
        chat_model: t.Optional(t.String()),
        deny_test_commands: t.Optional(t.String()),
        auto_merge: t.Optional(t.String()),
        refine_enabled: t.Optional(t.String()),
        default_refine_prompt: t.Optional(t.String()),
        implement_enabled: t.Optional(t.String()),
        implement_label: t.Optional(t.String()),
        default_implement_prompt: t.Optional(t.String()),
        auto_ready: t.Optional(t.String()),
        merge_method: t.Optional(
          t.Union([t.Literal("merge"), t.Literal("squash"), t.Literal("rebase"), t.Null()]),
        ),
      }),
    },
  )

  // Global reviewer skills (skills.sh / GitHub). Installed disabled; enabling
  // one materialises it into the opencode config dir for subsequent reviews.
  .get("/skills", () => listSkills())

  .post(
    "/skills",
    async ({ body }) => {
      try {
        return await installSkill(body.url);
      } catch (err) {
        return status(422, { error: String((err as Error)?.message ?? err) });
      }
    },
    { body: t.Object({ url: t.String() }) },
  )

  .put(
    "/skills/:name",
    ({ params, body }) => {
      const row = setSkillEnabled(params.name, body.enabled);
      if (!row) return status(404, { error: "not found" });
      return row;
    },
    { body: t.Object({ enabled: t.Boolean() }) },
  )

  .delete("/skills/:name", ({ params, set }) => {
    removeSkill(params.name);
    set.status = 204;
  })

  // ponytail: sends one tiny real prompt through the given provider — only way
  // to actually verify the key + model resolve. Costs ~1 request. Pushes the
  // provider's key first (task B's warmed-up ensureProviderKey) so a fresh
  // server's first-ever test isn't a false negative from the catalog-load
  // race; runReview's own failure detection (task A) turns a provider auth
  // error or an empty run into a real `error` instead of a silent ok:true.
  .get(
    "/settings/test/:provider",
    async ({ params, set }) => {
      const cfg = TEST_PROVIDERS[params.provider as TestProviderKey];
      if (!cfg) {
        set.status = 400;
        return { ok: false, error: `unknown provider "${params.provider}"` };
      }
      const defaultModel = resolveDefaultModel();
      let model: string = cfg.fallbackModel;
      try {
        if (parseModel(defaultModel).providerID === cfg.providerID) model = defaultModel;
      } catch {
        // an unparseable default model just means "use the fallback"
      }
      try {
        // withOpencode first: it's what actually spawns/acquires the singleton
        // server on a cold start. Calling ensureProviderKey before that is a
        // silent no-op (it bails when there's no server yet), which is
        // exactly how the real push attempt used to get skipped here and the
        // test would go on to run the prompt against whatever credential
        // (real auth.json, none at all, …) opencode already had. Push and run
        // in the same acquired-server callback, and let a push failure stop
        // the test cold — never fall through to the prompt on an unproven key.
        const res = await withOpencode(async (client) => {
          await openCodeManager.ensureProviderKey(cfg.providerID);
          return runReview(client, { directory: config.dataDir, prompt: "Reply with exactly: OK", model });
        });
        return { ok: true, model, text: res.text.slice(0, 200) };
      } catch (err) {
        return { ok: false, model, error: describeOpencodeError(err) };
      }
    },
    { params: t.Object({ provider: t.String() }) },
  );

// Eden Treaty consumes this on the web side for end-to-end type safety
// (apps/web/src/lib/api.ts). Every route above is chained off the same
// `apiRoutes` instance, which is what Eden needs to infer the whole tree.
export type App = typeof apiRoutes;
