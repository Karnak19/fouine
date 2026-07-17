import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";
import { resolveApiKey, resolveDefaultModel } from "~/settings";
import { createServer } from "node:net";

// ponytail: grab an ephemeral port so concurrent reviews don't all try to bind
// the opencode SDK's hardcoded default 4096 (which made `opencode serve` exit 1
// on any overlapping run). Tiny TOCTOU window between close and bind; the rare
// loser fails its own review and retry covers it.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function parseModel(spec: string): { providerID: string; modelID: string } {
  const [providerID, modelID] = spec.split("/");
  if (!providerID || !modelID) {
    throw new Error(`Invalid model spec "${spec}", expected "provider/model"`);
  }
  return { providerID, modelID };
}

export interface RunOptions {
  directory: string;
  prompt: string;
  model?: string;
  agent?: string;
  // Per-review context for the custom tools (post_review / post_comment /
  // get_prior_reviews). Injected into the opencode subprocess's env at spawn
  // rather than mutated onto the long-lived parent process.env, so two reviews
  // of different PRs running at once can't clobber each other's GitHub context
  // (see OpenCodeService and issue #23).
  env?: Record<string, string>;
}

// GitHub + write-back context the custom tools read from FOUINE_* env vars.
export interface ReviewToolContext {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  reviewId: number;
  internalUrl: string;
  internalSecret: string;
}

// The FOUINE_* env the custom tools read (opencode-config/tools/*). Kept next to
// the opencode plumbing that ships it so the key names stay in one place.
export function reviewToolEnv(ctx: ReviewToolContext): Record<string, string> {
  return {
    FOUINE_GITHUB_TOKEN: ctx.githubToken,
    FOUINE_REPO_OWNER: ctx.owner,
    FOUINE_REPO_NAME: ctx.repo,
    FOUINE_PR_NUMBER: String(ctx.prNumber),
    FOUINE_REVIEW_ID: String(ctx.reviewId),
    FOUINE_INTERNAL_URL: ctx.internalUrl,
    FOUINE_INTERNAL_SECRET: ctx.internalSecret,
  };
}

// Env for the outer-loop improver: repo-scoped, deliberately no FOUINE_PR_NUMBER
// so the PR-bound tools (post_review/post_comment) fail loudly if the agent
// somehow reaches for them.
export function improveToolEnv(ctx: Omit<ReviewToolContext, "prNumber">): Record<string, string> {
  const { FOUINE_PR_NUMBER: _pr, ...env } = reviewToolEnv({ ...ctx, prNumber: 0 });
  return env;
}

export interface RunResult {
  sessionId: string;
  text: string;
  cost: number;
  tokens: number;
}

export async function withOpencode<T>(
  fn: (client: OpencodeClient) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const { client, server } = await createOpencode({ port: await freePort(), signal });
  try {
    return await fn(client);
  } finally {
    server.close();
  }
}

function unwrap<T, E>(res: { data?: T; error?: E }, op: string): T {
  if (!res.data) throw new Error(`opencode ${op} failed: ${JSON.stringify(res.error)}`);
  return res.data;
}

async function setProviderApiKey(client: OpencodeClient, providerID: string): Promise<void> {
  const key = resolveApiKey();
  if (!key) return;
  unwrap(
    await client.auth.set({
      path: { id: providerID },
      body: { type: "api", key },
    }),
    `auth.set(${providerID})`,
  );
}

export async function runReview(
  client: OpencodeClient,
  opts: RunOptions,
  onSession?: (id: string) => Promise<void> | void,
): Promise<RunResult> {
  const model = parseModel(opts.model ?? resolveDefaultModel());
  await setProviderApiKey(client, model.providerID);

  const session = unwrap(
    await client.session.create({
      body: { title: "fouine review" },
      query: { directory: opts.directory },
    }),
    "session.create",
  );

  if (onSession) await onSession(session.id);

  const res = unwrap(
    await client.session.prompt({
      path: { id: session.id },
      body: {
        parts: [{ type: "text", text: opts.prompt }],
        model,
        ...(opts.agent ? { agent: opts.agent } : {}),
      },
    }),
    "session.prompt",
  );

  const text = res.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");

  // Sum cost/tokens across assistant messages so the runner can persist them —
  // the SDK's Session object doesn't carry totals, they live per-message.
  const msgs = unwrap(
    await client.session.messages({ path: { id: session.id } }),
    "session.messages",
  );
  let cost = 0;
  let tokens = 0;
  for (const m of msgs) {
    const info = m.info as {
      role?: string;
      cost?: number;
      tokens?: { input?: number; output?: number; reasoning?: number };
    };
    if (info.role !== "assistant") continue;
    cost += info.cost ?? 0;
    const t = info.tokens;
    if (t) tokens += (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0);
  }

  return { sessionId: session.id, text, cost, tokens };
}
