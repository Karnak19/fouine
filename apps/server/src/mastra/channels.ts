import { AgentChannels } from "@mastra/core/channels";
import type { ChannelConfig, ChannelHandler } from "@mastra/core/channels";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createSlackAdapter } from "@chat-adapter/slack";
import type { Chat } from "chat";
import { boundChatMessages } from "~/chat";
import { log } from "~/server/log";
import { resolveChannelCredentials, type ChannelCredentials } from "~/settings";
import {
  CHANNEL_FAILURE_LIMIT,
  channelKey,
  readChannelHealth,
  resolveChannelTargets,
  writeChannelHealth,
  type ChannelHealthMap,
  type ChannelTarget,
} from "./channel-config";
import { channelAgent } from "./channel-agent";
import { mastra } from "./index";

/**
 * The Slack/Discord runtime (#176).
 *
 * Mastra Channels owns the platform plumbing (Chat SDK adapters, signature
 * verification, thread memory, streaming replies). fouine owns when it is
 * built and where its webhooks are mounted:
 *
 *  - the runtime is lazy, so a process with no channel credentials pays
 *    nothing and a dashboard change needs only the next request (or restart
 *    for a credential already used by a live adapter);
 *  - `AgentChannels` is attached to `channelAgent` with `setChannels` so the
 *    agent includes the channel input/output processors. Building the instance
 *    without that attach point was verified to run the agent but never post the
 *    answer — the processor is what renders the reply back to the platform;
 *  - webhooks are handled by the adapter itself, which is where Slack's signing
 *    secret and Discord's Ed25519 public key are verified. A bad or missing
 *    signature never reaches the agent.
 */

export interface ChannelRuntime {
  channels: AgentChannels;
  sdk: Chat;
}

/** The same bound as chat and MCP, applied to an inbound channel turn. */
function boundChannelQuestion(text: string): void {
  boundChatMessages([{ id: "channel", role: "user", parts: [{ type: "text", text }] }]);
}

/**
 * Reject an over-long channel turn in-thread instead of running the model.
 *
 * `boundChatMessages` throws the same message the HTTP route and MCP use, so
 * all three surfaces share one budget rather than three drifting copies.
 */
const boundedHandler: ChannelHandler = async (thread, message, defaultHandler) => {
  try {
    boundChannelQuestion(message.text);
  } catch (err) {
    log.debug("channel turn refused by bounds", {
      reason: err instanceof Error ? err.message : String(err),
    });
    await thread.post(err instanceof Error ? err.message : String(err));
    return;
  }
  await defaultHandler(thread, message);
};

const handlers = {
  onDirectMessage: boundedHandler,
  onMention: boundedHandler,
  onSubscribedMessage: boundedHandler,
};

/** Exported for the bounds test; the runtime is the only production caller. */
export const channelHandlers = handlers;

function channelAdapters(creds: ChannelCredentials): ChannelConfig["adapters"] {
  const adapters: ChannelConfig["adapters"] = {};
  if (creds.slack) {
    adapters.slack = createSlackAdapter({
      signingSecret: creds.slack.signingSecret,
      botToken: creds.slack.botToken,
      botUserId: creds.slack.botUserId,
    });
  }
  if (creds.discord) {
    adapters.discord = {
      adapter: createDiscordAdapter({
        publicKey: creds.discord.publicKey,
        botToken: creds.discord.botToken,
        applicationId: creds.discord.applicationId,
      }),
      gateway: creds.discord.gateway,
    };
  }
  return adapters;
}

/**
 * Build one runtime from explicit credentials. Exported for tests (which use
 * fake credentials and a loopback mock of the platform API); production goes
 * through the cached `channelRuntime()` below.
 */
export async function buildChannelRuntime(
  creds: ChannelCredentials = resolveChannelCredentials(),
  instance = mastra,
): Promise<ChannelRuntime | null> {
  const adapters = channelAdapters(creds);
  if (Object.keys(adapters).length === 0) return null;

  const channels = new AgentChannels({
    adapters,
    handlers,
    userName: "fouine",
    // Deterministic mapping: the Chat SDK thread id already contains the
    // platform, channel and root message (`slack:C1:1234.5678`), so a restart
    // finds the same Mastra thread instead of orphaning memory behind a random
    // UUID. Existing threads keep their id by design.
    resolveThreadId: ({ thread }) => thread.id,
  });
  // Attaching (not just constructing) is what makes the agent render replies.
  channelAgent.setChannels(channels);
  await channels.initialize(instance);

  const sdk = channels.sdk;
  if (!sdk) throw new Error("Mastra Channels initialized without a Chat SDK instance");
  log.info("channel runtime ready", { adapters: Object.keys(adapters) });
  return { channels, sdk };
}

let runtimePromise: Promise<ChannelRuntime | null> | null = null;

/**
 * The process-wide runtime. Rebuilt only after a failed or empty construction,
 * so a later settings save can bring channels up without a restart.
 */
export function channelRuntime(): Promise<ChannelRuntime | null> {
  if (runtimePromise) return runtimePromise;
  const attempt = buildChannelRuntime();
  runtimePromise = attempt;
  attempt
    .then((runtime) => {
      if (!runtime && runtimePromise === attempt) runtimePromise = null;
    })
    .catch(() => {
      if (runtimePromise === attempt) runtimePromise = null;
    });
  return attempt;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The public channel webhook handler, mounted at
 * `/webhook/channels/{slack|discord}` from `server/app.ts`.
 *
 * No session gate — the platform cannot log in. The adapter verifies the
 * platform signature synchronously and answers 401 for a bad/missing one;
 * a successfully verified event returns 200 immediately and the agent answers
 * in the background.
 */
export async function handleChannelWebhook(
  platform: string,
  request: Request,
  runtime?: ChannelRuntime | null,
): Promise<Response> {
  if (platform !== "slack" && platform !== "discord") {
    return json(404, { error: "unknown channel platform" });
  }
  let active = runtime;
  if (active === undefined) {
    try {
      active = await channelRuntime();
    } catch (err) {
      log.error("channel runtime failed to start", { platform, error: String(err) });
      return json(503, { error: "channel runtime unavailable" });
    }
  }
  if (!active || !active.channels.hasAdapter(platform)) {
    return json(503, { error: `${platform} channel is not configured` });
  }
  return active.channels.handleWebhookEvent(platform, request);
}

// ── Review-done notifications ───────────────────────────────────────────────

export interface ReviewNotification {
  repo: string;
  pr: number;
  blocking: number;
  url: string;
}

export function reviewNotificationText(review: ReviewNotification): string {
  return `Review done on #${review.pr} — ${review.blocking} blocking.\n${review.url}`;
}

export interface ChannelHealthStore {
  read(): ChannelHealthMap;
  write(health: ChannelHealthMap): void;
}

const defaultHealthStore: ChannelHealthStore = {
  read: readChannelHealth,
  write: writeChannelHealth,
};

export interface NotificationDeps {
  targets?: (repo: string) => ChannelTarget[];
  /**
   * The platform post. `null` means "channels are not configured": the review
   * still succeeds, but no failure is recorded against a target that never had
   * a chance to post.
   */
  post?: ((target: ChannelTarget, text: string) => Promise<unknown>) | null;
  health?: ChannelHealthStore;
}

async function defaultPoster(): Promise<
  ((target: ChannelTarget, text: string) => Promise<unknown>) | null
> {
  const runtime = await channelRuntime();
  if (!runtime) return null;
  return (target, text) =>
    runtime.sdk.channel(`${target.platform}:${target.channel}`).post(text);
}

/**
 * Fan one review completion out to its configured channels, fire-and-forget.
 *
 * Never throws and never retries. Each target gets exactly one post; a failed
 * post increments that target's consecutive-failure count, and the fifth
 * disables it with a warning in the log and in the dashboard's CHANNEL_HEALTH
 * row. A success clears the streak.
 *
 * The payload is built once by `emitReviewCompleted` (MCP and channels share
 * it) — this module only formats and delivers it.
 */
export async function notifyReviewCompleted(
  review: ReviewNotification,
  deps: NotificationDeps = {},
): Promise<void> {
  try {
    const targets = (deps.targets ?? resolveChannelTargets)(review.repo);
    if (targets.length === 0) return;

    const post = deps.post === undefined ? await defaultPoster() : deps.post;
    if (!post) {
      // Configured targets with no adapter credentials is a deployment issue,
      // not a channel outage: do not count it toward auto-disable.
      log.warn("channel review notification skipped: no channel credentials", {
        repo: review.repo,
        pr: review.pr,
      });
      return;
    }

    const healthStore = deps.health ?? defaultHealthStore;
    const text = reviewNotificationText(review);

    // One post per review per channel, even if the JSON lists the same channel
    // twice.
    const seen = new Set<string>();

    // Sequential on purpose: each result updates one shared JSON row, and a
    // parallel read-modify-write would lose a concurrent failure count.
    for (const target of targets) {
      if (target.enabled === false) continue;
      const key = channelKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      const before = healthStore.read()[key];
      if (before?.disabled) continue;

      try {
        await post(target, text);
        if (before && before.failures > 0) {
          const health = healthStore.read();
          delete health[key];
          healthStore.write(health);
        }
      } catch (err) {
        const health = healthStore.read();
        const failures = (health[key]?.failures ?? 0) + 1;
        const disabled = failures >= CHANNEL_FAILURE_LIMIT;
        health[key] = {
          failures,
          disabled: disabled || health[key]?.disabled === true,
          lastError: err instanceof Error ? err.message : String(err),
          at: Date.now(),
        };
        healthStore.write(health);
        log.warn("channel review notification failed", {
          platform: target.platform,
          channel: target.channel,
          repo: review.repo,
          pr: review.pr,
          failures,
          error: String(err),
        });
        if (disabled) {
          log.warn("channel disabled after repeated notification failures", {
            platform: target.platform,
            channel: target.channel,
            failures,
          });
        }
      }
    }
  } catch (err) {
    // Belt and braces: the caller is a review-completion path and must never
    // see a notification failure.
    log.warn("channel review notification crashed", {
      repo: review.repo,
      pr: review.pr,
      error: String(err),
    });
  }
}
