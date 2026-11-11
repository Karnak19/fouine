import { test, expect, spyOn } from "bun:test";
import { findings, repos, reviews } from "~/db";
import { log } from "~/server/log";
import { emitReviewCompleted } from "~/mastra/review-events";
import {
  CHANNEL_FAILURE_LIMIT,
  channelKey,
  type ChannelHealthMap,
  type ChannelTarget,
} from "~/mastra/channel-config";
import {
  notifyReviewCompleted,
  reviewNotificationText,
  type ChannelHealthStore,
} from "~/mastra/channels";

const REVIEW = {
  repo: "acme/web",
  pr: 164,
  blocking: 2,
  url: "https://github.com/acme/web/pull/164",
};

function memoryHealth(): ChannelHealthStore & { map: ChannelHealthMap } {
  let map: ChannelHealthMap = {};
  return {
    map,
    read: () => structuredClone(map),
    write: (next) => {
      map = next;
    },
  };
}

test("the payload is the documented one, with a link to the PR", () => {
  expect(reviewNotificationText(REVIEW)).toBe(
    "Review done on #164 — 2 blocking.\nhttps://github.com/acme/web/pull/164",
  );
});

test("one post per configured channel; a failure is counted once and never retried", async () => {
  const health = memoryHealth();
  const posted: string[] = [];
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  try {
    await notifyReviewCompleted(REVIEW, {
      targets: () => [
        { platform: "slack", channel: "C1" },
        { platform: "discord", channel: "D1" },
      ],
      post: async (target: ChannelTarget) => {
        posted.push(channelKey(target));
        if (target.channel === "D1") throw new Error("discord down");
      },
      health,
    });

    // Each target exactly once, even though one failed.
    expect(posted).toEqual(["slack:C1", "discord:D1"]);
    expect(health.read()).toEqual({
      "discord:D1": {
        failures: 1,
        disabled: false,
        lastError: "discord down",
        at: expect.any(Number),
      },
    });
    expect(warn).toHaveBeenCalledWith(
      "channel review notification failed",
      expect.objectContaining({ platform: "discord", channel: "D1", failures: 1 }),
    );
  } finally {
    warn.mockRestore();
  }
});

test(`the ${CHANNEL_FAILURE_LIMIT}th consecutive failure disables the channel; later reviews skip it`, async () => {
  const health = memoryHealth();
  let attempts = 0;
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  try {
    for (let i = 0; i < CHANNEL_FAILURE_LIMIT; i++) {
      await notifyReviewCompleted(REVIEW, {
        targets: () => [{ platform: "slack", channel: "C-BAD" }],
        post: async () => {
          attempts++;
          throw new Error("still down");
        },
        health,
      });
    }
    expect(attempts).toBe(CHANNEL_FAILURE_LIMIT);
    expect(health.read()["slack:C-BAD"]).toMatchObject({
      failures: CHANNEL_FAILURE_LIMIT,
      disabled: true,
    });
    expect(warn).toHaveBeenCalledWith(
      "channel disabled after repeated notification failures",
      expect.objectContaining({ platform: "slack", channel: "C-BAD", failures: CHANNEL_FAILURE_LIMIT }),
    );

    // The 6th review does not touch the platform at all.
    await notifyReviewCompleted(REVIEW, {
      targets: () => [{ platform: "slack", channel: "C-BAD" }],
      post: async () => {
        attempts++;
      },
      health,
    });
    expect(attempts).toBe(CHANNEL_FAILURE_LIMIT);
  } finally {
    warn.mockRestore();
  }
});

test("a success clears a previous failure streak", async () => {
  const health = memoryHealth();
  await notifyReviewCompleted(REVIEW, {
    targets: () => [{ platform: "slack", channel: "C1" }],
    post: async () => {
      throw new Error("transient");
    },
    health,
  });
  expect(health.read()["slack:C1"].failures).toBe(1);

  await notifyReviewCompleted(REVIEW, {
    targets: () => [{ platform: "slack", channel: "C1" }],
    post: async () => {},
    health,
  });
  expect(health.read()["slack:C1"]).toBeUndefined();
});

test("disabled and explicitly disabled targets are skipped", async () => {
  const health = memoryHealth();
  health.write({ "slack:C-DISABLED": { failures: 5, disabled: true } });
  const posted: string[] = [];
  await notifyReviewCompleted(REVIEW, {
    targets: () => [
      { platform: "slack", channel: "C-OFF", enabled: false },
      { platform: "slack", channel: "C-DISABLED" },
      { platform: "slack", channel: "C-ON" },
    ],
    post: async (target) => void posted.push(target.channel),
    health,
  });
  expect(posted).toEqual(["C-ON"]);
});

test("a channel listed twice still gets exactly one post", async () => {
  const health = memoryHealth();
  let posts = 0;
  await notifyReviewCompleted(REVIEW, {
    targets: () => [
      { platform: "slack", channel: "C1" },
      { platform: "slack", channel: "C1" },
    ],
    post: async () => void posts++,
    health,
  });
  expect(posts).toBe(1);
});

test("no credentials is a deployment warning, not a channel failure", async () => {
  const health = memoryHealth();
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  try {
    await notifyReviewCompleted(REVIEW, {
      targets: () => [{ platform: "slack", channel: "C1" }],
      post: null,
      health,
    });
    expect(health.read()).toEqual({});
    expect(warn).toHaveBeenCalledWith(
      "channel review notification skipped: no channel credentials",
      expect.objectContaining({ repo: "acme/web", pr: 164 }),
    );
  } finally {
    warn.mockRestore();
  }
});

test("a target resolver failure is swallowed into a warning", async () => {
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  try {
    await expect(
      notifyReviewCompleted(REVIEW, {
        targets: () => {
          throw new Error("bad config");
        },
        post: async () => {},
        health: memoryHealth(),
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "channel review notification crashed",
      expect.objectContaining({ repo: "acme/web", error: "Error: bad config" }),
    );
  } finally {
    warn.mockRestore();
  }
});

// ── Fire-and-forget from the review completion path ─────────────────────────

function seedReview(full: string, pr: number) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  return reviews.insert.get({
    $repo: full,
    $pr: pr,
    $title: "Test PR",
    $session: null,
    $status: "pending",
    $trigger: "opened",
    $attempt: 0,
  })!;
}

test("a notification that never settles does not delay review completion", async () => {
  const review = seedReview("acme/notify-hang", 1);
  const seen: string[] = [];

  const raced = await Promise.race([
    emitReviewCompleted(
      review.id,
      async (name) => void seen.push(name),
      () => new Promise<void>(() => {}),
    ).then(() => "done"),
    Bun.sleep(500).then(() => "timeout"),
  ]);

  expect(raced).toBe("done");
  expect(seen).toEqual(["review.completed"]);
});

test("refine/implement/improve rows do not post a PR-shaped channel notification", async () => {
  for (const [trigger, pr] of [
    ["refine", 7],
    ["implement", 8],
    ["improve", 0],
  ] as const) {
    repos.upsert.run({ $full_name: `acme/${trigger}`, $installation_id: 1, $prompt: null, $model: null });
    const review = reviews.insert.get({
      $repo: `acme/${trigger}`,
      $pr: pr,
      $title: trigger,
      $session: null,
      $status: "pending",
      $trigger: trigger,
      $attempt: 0,
    })!;
    let notified = 0;
    await emitReviewCompleted(
      review.id,
      async () => {},
      async () => void notified++,
    );
    expect(notified).toBe(0);
  }
});

test("a throwing notifier is only a warning — the review emit still runs", async () => {  const review = seedReview("acme/notify-throw", 2);
  findings.insert.run({
    $review: review.id,
    $repo: "acme/notify-throw",
    $pr: 2,
    $kind: "inline",
    $severity: "blocking",
    $event: null,
    $path: "src/a.ts",
    $line: 1,
    $body: "finding",
    $github_review_id: null,
    $github_comment_id: null,
  });
  const seen: Array<Record<string, unknown>> = [];
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  try {
    await expect(
      emitReviewCompleted(
        review.id,
        async (_name, data) => void seen.push(data),
        async () => {
          throw new Error("slack exploded");
        },
      ),
    ).resolves.toBeUndefined();
    expect(seen).toEqual([
      {
        repo: "acme/notify-throw",
        pr: 2,
        blocking: 1,
        url: "https://github.com/acme/notify-throw/pull/2",
      },
    ]);
    expect(warn).toHaveBeenCalledWith(
      "channel review notification failed",
      expect.objectContaining({ review: review.id, error: "Error: slack exploded" }),
    );
  } finally {
    warn.mockRestore();
  }
});
