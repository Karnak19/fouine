import { expect, test } from "bun:test";
import plugin from "./plugins/model-fallback.ts";
import {
  isLimitError,
  nextModel,
  parseFallbackFile,
  setupModelFallback,
  shouldSwitch,
  type AvailableModel,
  type FallbackFile,
  type FallbackHost,
  type ModelRef,
  type RetryEvent,
} from "./plugins/_model_fallback.ts";

// Deliberately NOT in plugins/: opencode loads every .ts there as a plugin, so a
// test next to the plugin would be loaded into the review runtime (same reason
// as commandcode.test.ts).

const available = (...specs: string[]): AvailableModel[] =>
  specs.map((spec) => {
    const [providerID, id] = [spec.slice(0, spec.indexOf("/")), spec.slice(spec.indexOf("/") + 1)];
    return { providerID, id, enabled: true };
  });

// A fake host that records what the plugin does, built the way opencode calls
// it: one retry hook registered at setup, then fired once per failed step.
function fakeHost(opts: {
  models?: AvailableModel[] | (() => Promise<AvailableModel[]>);
  parents?: Record<string, string>;
  switchFails?: boolean;
}) {
  const hooks: Array<(event: RetryEvent) => Promise<void>> = [];
  const switches: Array<{ sessionID: string; model: ModelRef }> = [];
  const logs: Array<{ message: string; data: Record<string, unknown>; level?: string }> = [];
  const host: FallbackHost = {
    onRetry: async (callback) => {
      hooks.push(callback);
    },
    switchModel: async (sessionID, model) => {
      if (opts.switchFails) throw new Error("session busy");
      switches.push({ sessionID, model });
    },
    parentOf: async (sessionID) => opts.parents?.[sessionID],
    listModels: async () =>
      typeof opts.models === "function" ? opts.models() : (opts.models ?? []),
    log: (message, data, level) => logs.push({ message, data, ...(level ? { level } : {}) }),
  };
  return { host, hooks, switches, logs };
}

function retryEvent(
  overrides: Partial<Omit<RetryEvent, "decision">> & { decision?: RetryEvent["decision"] } = {},
): RetryEvent {
  return {
    sessionID: "ses_1",
    model: { providerID: "zai-coding-plan", id: "glm-5.2" },
    error: { type: "provider.quota", message: "5-hour quota used up", status: 429 },
    attempt: 2,
    decision: { retry: false },
    ...overrides,
  };
}

const file = (sessions: FallbackFile["sessions"]) => () => ({ sessions });

async function fire(
  setup: ReturnType<typeof fakeHost>,
  read: () => FallbackFile | undefined,
  event: RetryEvent,
) {
  await setupModelFallback(setup.host, read);
  expect(setup.hooks).toHaveLength(1);
  await setup.hooks[0]!(event);
  return event;
}

test("registers exactly one retry hook", async () => {
  const h = fakeHost({});
  await setupModelFallback(h.host, () => undefined);
  expect(h.hooks).toHaveLength(1);
});

test("on a quota error, switches the session to the first fallback and retries at once", async () => {
  const h = fakeHost({ models: available("opencode-go/deepseek-v4-flash", "opencode-go/kimi-k3") });
  const event = await fire(
    h,
    file({ ses_1: ["opencode-go/deepseek-v4-flash", "opencode-go/kimi-k3"] }),
    retryEvent(),
  );
  expect(h.switches).toEqual([
    { sessionID: "ses_1", model: { providerID: "opencode-go", id: "deepseek-v4-flash" } },
  ]);
  expect(event.decision).toEqual({ retry: true, delay: 0 });
  expect(h.logs.map((l) => l.message)).toEqual(["switched to fallback model"]);
  expect(h.logs[0]!.data).toMatchObject({
    from: "zai-coding-plan/glm-5.2",
    to: "opencode-go/deepseek-v4-flash",
  });
});

const rateLimit = (
  attempt: number,
  decision: RetryEvent["decision"],
  retryAfterMs?: number,
): RetryEvent =>
  retryEvent({
    error: {
      type: "provider.rate-limit",
      message: "Too many requests",
      status: 429,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
    attempt,
    decision,
  });

test("a first short 429 is left to opencode's own backoff", async () => {
  const h = fakeHost({ models: available("opencode-go/deepseek-v4-flash") });
  const event = await fire(
    h,
    file({ ses_1: ["opencode-go/deepseek-v4-flash"] }),
    rateLimit(2, { retry: true, delay: 8000 }),
  );
  expect(event.decision).toEqual({ retry: true, delay: 8000 });
  expect(h.switches).toEqual([]);
  expect(h.logs).toEqual([]);
});

test("a 429 that keeps coming (third attempt) switches and retries at once", async () => {
  const h = fakeHost({ models: available("opencode-go/deepseek-v4-flash") });
  const event = await fire(
    h,
    file({ ses_1: ["opencode-go/deepseek-v4-flash"] }),
    rateLimit(3, { retry: true, delay: 4000 }),
  );
  expect(event.decision).toEqual({ retry: true, delay: 0 });
  expect(h.switches).toHaveLength(1);
});

test("a 429 with a long wait switches on the first attempt", async () => {
  for (const event of [
    // opencode's own delay, which already honours retry-after
    rateLimit(2, { retry: true, delay: 90_000 }),
    // the provider's retry-after on the error
    rateLimit(2, { retry: true, delay: 2000 }, 120_000),
  ]) {
    const h = fakeHost({ models: available("opencode-go/deepseek-v4-flash") });
    await fire(h, file({ ses_1: ["opencode-go/deepseek-v4-flash"] }), event);
    expect(event.decision).toEqual({ retry: true, delay: 0 });
    expect(h.switches).toHaveLength(1);
  }
});

test("a 429 at exactly a minute still waits", async () => {
  const h = fakeHost({ models: available("opencode-go/deepseek-v4-flash") });
  const event = await fire(
    h,
    file({ ses_1: ["opencode-go/deepseek-v4-flash"] }),
    rateLimit(2, { retry: true, delay: 60_000 }, 60_000),
  );
  expect(event.decision).toEqual({ retry: true, delay: 60_000 });
  expect(h.switches).toEqual([]);
});

test("a 429 opencode is giving up on switches", async () => {
  const h = fakeHost({ models: available("opencode-go/deepseek-v4-flash") });
  const event = await fire(
    h,
    file({ ses_1: ["opencode-go/deepseek-v4-flash"] }),
    rateLimit(2, { retry: false }),
  );
  expect(event.decision).toEqual({ retry: true, delay: 0 });
  expect(h.switches).toHaveLength(1);
});

// opencode keeps counting `attempt` across a switch within a step (confirmed
// on a real 2.4.2 server), so a fallback's patience counts from the switch.
test("a fallback reached at attempt 3 gets its own two 429s before moving on", async () => {
  const h = fakeHost({ models: available("a/one", "b/two") });
  await setupModelFallback(h.host, file({ ses_1: ["a/one", "b/two"] }));
  const hook = h.hooks[0]!;
  const main = { providerID: "z", id: "main" };
  const step = (attempt: number, model: ModelRef) => {
    const e = rateLimit(attempt, { retry: true, delay: 4000 });
    return { ...e, model };
  };
  const e2 = step(2, main);
  await hook(e2);
  expect(e2.decision).toEqual({ retry: true, delay: 4000 });
  const e3 = step(3, main);
  await hook(e3);
  expect(e3.decision).toEqual({ retry: true, delay: 0 });
  expect(h.switches.map((s) => s.model.id)).toEqual(["one"]);
  // a/one's first 429, at attempt 4: wait.
  const e4 = step(4, { providerID: "a", id: "one" });
  await hook(e4);
  expect(e4.decision).toEqual({ retry: true, delay: 4000 });
  expect(h.switches).toHaveLength(1);
  // Its second in a row, at attempt 5: move on.
  const e5 = step(5, { providerID: "a", id: "one" });
  await hook(e5);
  expect(e5.decision).toEqual({ retry: true, delay: 0 });
  expect(h.switches.map((s) => s.model.id)).toEqual(["one", "two"]);
});

test("a new step counts its 429s from 1 again", async () => {
  const h = fakeHost({ models: available("a/one", "b/two") });
  await setupModelFallback(h.host, file({ ses_1: ["a/one", "b/two"] }));
  const hook = h.hooks[0]!;
  // Switched at attempt 4 of one step...
  await hook(retryEvent({ attempt: 4 }));
  expect(h.switches).toHaveLength(1);
  // ...then a later step on a/one: attempt 2 waits, attempt 3 switches.
  const e2 = { ...rateLimit(2, { retry: true, delay: 2000 }), model: { providerID: "a", id: "one" } };
  await hook(e2);
  expect(e2.decision).toEqual({ retry: true, delay: 2000 });
  const e3 = { ...rateLimit(3, { retry: true, delay: 4000 }), model: { providerID: "a", id: "one" } };
  await hook(e3);
  expect(e3.decision).toEqual({ retry: true, delay: 0 });
  expect(h.switches.map((s) => s.model.id)).toEqual(["one", "two"]);
});

const authError = { type: "provider.auth", message: "Invalid API key", status: 401 };

test("a fallback that fails on a bad key moves on to the next one, loudly", async () => {
  const h = fakeHost({ models: available("a/one", "b/two") });
  await setupModelFallback(h.host, file({ ses_1: ["a/one", "b/two"] }));
  const hook = h.hooks[0]!;
  await hook(retryEvent());
  const broken = retryEvent({
    model: { providerID: "a", id: "one" },
    error: authError,
    attempt: 3,
    decision: { retry: false },
  });
  await hook(broken);
  expect(broken.decision).toEqual({ retry: true, delay: 0 });
  expect(h.switches.map((s) => s.model.id)).toEqual(["one", "two"]);
  const warn = h.logs.find((l) => l.level === "warn");
  expect(warn?.message).toBe("fallback model is unusable, moving on");
  expect(warn?.data).toMatchObject({ model: "a/one", error: "provider.auth", status: 401 });
});

test("a fallback the server can't route to moves on too", async () => {
  const h = fakeHost({ models: available("a/one", "b/two") });
  await setupModelFallback(h.host, file({ ses_1: ["a/one", "b/two"] }));
  const hook = h.hooks[0]!;
  await hook(retryEvent());
  const broken = retryEvent({
    model: { providerID: "a", id: "one" },
    error: { type: "provider.no-route", message: "Model unavailable: a/one" },
    attempt: 3,
  });
  await hook(broken);
  expect(h.switches.map((s) => s.model.id)).toEqual(["one", "two"]);
});

test("a bad key on the run's own model never switches", async () => {
  const h = fakeHost({ models: available("a/one", "b/two") });
  await setupModelFallback(h.host, file({ ses_1: ["a/one", "b/two"] }));
  const hook = h.hooks[0]!;
  const own = retryEvent({ error: authError, decision: { retry: false } });
  await hook(own);
  expect(own.decision).toEqual({ retry: false });
  expect(h.switches).toEqual([]);
  expect(h.logs).toEqual([]);
});

test("a bad key on a fallback with nothing after it leaves opencode's decision", async () => {
  const h = fakeHost({ models: available("a/one") });
  await setupModelFallback(h.host, file({ ses_1: ["a/one"] }));
  const hook = h.hooks[0]!;
  await hook(retryEvent());
  const broken = retryEvent({
    model: { providerID: "a", id: "one" },
    error: authError,
    attempt: 3,
    decision: { retry: false },
  });
  await hook(broken);
  expect(broken.decision).toEqual({ retry: false });
  expect(h.logs.map((l) => l.message)).toEqual([
    "switched to fallback model",
    "fallback model is unusable, moving on",
    "fallback chain exhausted",
  ]);
});

test("the session record is evicted least-recently-used, so a live session keeps it", async () => {
  const sessions: Record<string, string[]> = { live: ["a/one", "b/two", "c/three"] };
  for (let i = 0; i < 500; i++) sessions[`ses_${i}`] = ["a/one"];
  const h = fakeHost({ models: available("a/one", "b/two", "c/three") });
  await setupModelFallback(h.host, () => ({ sessions }));
  const hook = h.hooks[0]!;
  await hook(retryEvent({ sessionID: "live", attempt: 2 }));
  for (let i = 0; i < 499; i++) await hook(retryEvent({ sessionID: `ses_${i}` }));
  // 500 tracked; touching `live` moves it to the back.
  await hook(retryEvent({ sessionID: "live", model: { providerID: "a", id: "one" }, attempt: 3 }));
  // The 501st session evicts the least recently used one: ses_0, not `live`.
  await hook(retryEvent({ sessionID: "ses_499" }));
  // `live` still knows it switched at attempt 3: a first 429 on b/two waits.
  const e = {
    ...rateLimit(4, { retry: true, delay: 4000 }),
    sessionID: "live",
    model: { providerID: "b", id: "two" },
  };
  await hook(e);
  expect(e.decision).toEqual({ retry: true, delay: 4000 });
  expect(h.switches.filter((s) => s.sessionID === "live").map((s) => s.model.id)).toEqual([
    "one",
    "two",
  ]);
});

test("quota and plan caps switch on the first attempt, whatever the delay", () => {
  for (const type of [
    "provider.quota",
    "provider.budget-limit",
    "provider.model-budget-limit",
    "provider.free-limit",
    "provider.go-limit",
    "provider.chatgpt-limit",
    "provider.chatgpt-workspace-limit",
  ]) {
    expect(
      shouldSwitch({
        error: { type, message: "used up" },
        attempt: 2,
        decision: { retry: true, delay: 2000 },
      }),
    ).toBe(true);
  }
});

test("only the limit types opencode 2.4.2 emits switch models", () => {
  for (const type of [
    "provider.rate-limit",
    "provider.quota",
    "provider.budget-limit",
    "provider.model-budget-limit",
    "provider.free-limit",
    "provider.go-limit",
    "provider.chatgpt-limit",
    "provider.chatgpt-workspace-limit",
  ]) {
    expect(isLimitError(type)).toBe(true);
  }
  for (const type of [
    "provider.auth",
    "provider.invalid-request",
    "provider.content-filter",
    "provider.timeout",
    "provider.internal",
    "provider.transport",
    "provider.unknown",
    "provider.no-route",
    // Look like limits but another model would not fix them: never a switch,
    // even if a later opencode adds them.
    "provider.context-limit",
    "provider.output-limit",
    "provider.token-limit",
  ]) {
    expect(isLimitError(type)).toBe(false);
    expect(
      shouldSwitch({
        error: { type, message: "x" },
        attempt: 5,
        decision: { retry: false },
      }),
    ).toBe(false);
  }
});

test("an auth error leaves the decision and the session alone", async () => {
  const h = fakeHost({ models: available("opencode-go/deepseek-v4-flash") });
  const event = await fire(
    h,
    file({ ses_1: ["opencode-go/deepseek-v4-flash"] }),
    retryEvent({ error: { type: "provider.auth", message: "bad key", status: 401 } }),
  );
  expect(event.decision).toEqual({ retry: false });
  expect(h.switches).toEqual([]);
});

test("walks down the chain as each fallback runs out in turn", async () => {
  const h = fakeHost({ models: available("a/one", "b/two", "c/three") });
  await setupModelFallback(h.host, file({ ses_1: ["a/one", "b/two", "c/three"] }));
  const hook = h.hooks[0]!;
  await hook(retryEvent({ model: { providerID: "z", id: "main" } }));
  await hook(retryEvent({ model: { providerID: "a", id: "one" } }));
  const last = retryEvent({ model: { providerID: "b", id: "two" } });
  await hook(last);
  expect(h.switches.map((s) => s.model)).toEqual([
    { providerID: "a", id: "one" },
    { providerID: "b", id: "two" },
    { providerID: "c", id: "three" },
  ]);
  expect(last.decision).toEqual({ retry: true, delay: 0 });
  // c/three runs out too: everything has been tried, opencode decides.
  const exhausted = retryEvent({ model: { providerID: "c", id: "three" } });
  await hook(exhausted);
  expect(exhausted.decision).toEqual({ retry: false });
  expect(h.switches).toHaveLength(3);
});

// The review finding behind `tried`: a repo whose main model is glm-5.2 while
// the global chain is [kimi-k3, glm-5.2]. Starting after glm-5.2's index would
// call the chain exhausted with kimi-k3 never tried.
test("when the run's own model is in the chain, entries above it are still tried", async () => {
  const h = fakeHost({ models: available("opencode-go/kimi-k3", "zai-coding-plan/glm-5.2") });
  await setupModelFallback(
    h.host,
    file({ ses_1: ["opencode-go/kimi-k3", "zai-coding-plan/glm-5.2"] }),
  );
  const hook = h.hooks[0]!;
  const first = retryEvent({ model: { providerID: "zai-coding-plan", id: "glm-5.2" } });
  await hook(first);
  expect(h.switches.map((s) => s.model)).toEqual([{ providerID: "opencode-go", id: "kimi-k3" }]);
  expect(first.decision).toEqual({ retry: true, delay: 0 });
  // kimi-k3 runs out next: glm-5.2 already failed in this session, so the
  // chain is done rather than bouncing back to it.
  const second = retryEvent({ model: { providerID: "opencode-go", id: "kimi-k3" } });
  await hook(second);
  expect(second.decision).toEqual({ retry: false });
  expect(h.switches).toHaveLength(1);
  expect(h.logs.at(-1)!.message).toBe("fallback chain exhausted");
});

test("what one session tried does not affect another", async () => {
  const h = fakeHost({ models: available("a/one", "b/two") });
  await setupModelFallback(h.host, file({ ses_1: ["a/one", "b/two"], ses_2: ["a/one", "b/two"] }));
  const hook = h.hooks[0]!;
  await hook(retryEvent({ sessionID: "ses_1", model: { providerID: "z", id: "main" } }));
  await hook(retryEvent({ sessionID: "ses_2", model: { providerID: "z", id: "main" } }));
  expect(h.switches.map((s) => [s.sessionID, s.model.id])).toEqual([
    ["ses_1", "one"],
    ["ses_2", "one"],
  ]);
});

test("skips models opencode doesn't list as available", async () => {
  const models = [
    { providerID: "a", id: "one", enabled: false },
    { providerID: "c", id: "three", enabled: true },
  ];
  const h = fakeHost({ models });
  await fire(h, file({ ses_1: ["a/one", "b/two", "c/three"] }), retryEvent());
  expect(h.switches.map((s) => s.model)).toEqual([{ providerID: "c", id: "three" }]);
});

test("never switches to the model that just failed", () => {
  const chain = [
    { providerID: "x", id: "first" },
    { providerID: "zai-coding-plan", id: "glm-5.2" },
  ];
  // The failed model is in the chain: skip just that entry, still from the top.
  expect(nextModel(chain, { providerID: "zai-coding-plan", id: "glm-5.2" }, undefined)).toEqual(
    chain[0],
  );
  expect(nextModel(chain, { providerID: "x", id: "first" }, undefined)).toEqual(chain[1]);
  // Not in the chain: start at the top.
  expect(nextModel(chain, { providerID: "other", id: "m" }, undefined)).toEqual(chain[0]);
  // Models already tried in the session are skipped.
  expect(
    nextModel(chain, { providerID: "other", id: "m" }, undefined, new Set(["x/first"])),
  ).toEqual(chain[1]);
});

test("an exhausted chain leaves opencode's decision untouched", async () => {
  const h = fakeHost({ models: available("b/two") });
  const event = await fire(
    h,
    file({ ses_1: ["b/two"] }),
    retryEvent({ model: { providerID: "b", id: "two" }, decision: { retry: false } }),
  );
  expect(event.decision).toEqual({ retry: false });
  expect(h.switches).toEqual([]);
  expect(h.logs.map((l) => l.message)).toEqual(["fallback chain exhausted"]);
});

test("a missing file does nothing", async () => {
  const h = fakeHost({ models: available("a/one") });
  const event = await fire(h, () => undefined, retryEvent());
  expect(event.decision).toEqual({ retry: false });
  expect(h.switches).toEqual([]);
});

test("a session with no chain (not one of fouine's) does nothing", async () => {
  const h = fakeHost({ models: available("a/one") });
  const event = await fire(h, file({ ses_other: ["a/one"] }), retryEvent());
  expect(event.decision).toEqual({ retry: false });
  expect(h.switches).toEqual([]);
});

test("each session uses its own chain, never another repo's", async () => {
  const h = fakeHost({ models: available("a/one", "b/two") });
  await fire(h, file({ ses_1: ["a/one"], ses_2: ["b/two"] }), retryEvent({ sessionID: "ses_2" }));
  expect(h.switches).toEqual([{ sessionID: "ses_2", model: { providerID: "b", id: "two" } }]);
});

test("a subagent session borrows its parent's chain but switches itself", async () => {
  const h = fakeHost({ models: available("a/one"), parents: { ses_child: "ses_1" } });
  await fire(h, file({ ses_1: ["a/one"] }), retryEvent({ sessionID: "ses_child" }));
  expect(h.switches).toEqual([{ sessionID: "ses_child", model: { providerID: "a", id: "one" } }]);
});

test("the file is read again every time the hook fires", async () => {
  const h = fakeHost({ models: available("a/one", "b/two") });
  let current: FallbackFile = { sessions: { ses_1: ["a/one"] } };
  await setupModelFallback(h.host, () => current);
  await h.hooks[0]!(retryEvent());
  current = { sessions: { ses_1: ["b/two"] } };
  await h.hooks[0]!(retryEvent());
  expect(h.switches.map((s) => s.model.providerID)).toEqual(["a", "b"]);
});

test("a failed model listing still tries the next model", async () => {
  const h = fakeHost({ models: () => Promise.reject(new Error("down")) });
  const event = await fire(h, file({ ses_1: ["a/one"] }), retryEvent());
  expect(h.switches).toHaveLength(1);
  expect(event.decision).toEqual({ retry: true, delay: 0 });
});

test("a failed switch leaves the decision alone", async () => {
  const h = fakeHost({ models: available("a/one"), switchFails: true });
  const event = await fire(h, file({ ses_1: ["a/one"] }), retryEvent());
  expect(event.decision).toEqual({ retry: false });
  expect(h.logs.map((l) => l.message)).toEqual(["fallback switch failed"]);
});

test("parseFallbackFile keeps string chains and rejects anything else", () => {
  expect(parseFallbackFile('{"sessions":{"s":["a/one",3,"b/two"]}}')).toEqual({
    sessions: { s: ["a/one", "b/two"] },
  });
  expect(parseFallbackFile("not json")).toBeUndefined();
  expect(parseFallbackFile('{"nope":1}')).toBeUndefined();
});

// The real entry: default export shape, and its setup wiring onto a context
// shaped like opencode's (only the fields the plugin touches).
test("the plugin entry registers its retry hook on ctx.session", async () => {
  expect(plugin.id).toBe("fouine.model_fallback");
  const names: string[] = [];
  const ctx = {
    session: {
      hook: async (name: string) => {
        names.push(name);
      },
      switchModel: async () => {},
      get: async () => ({}),
    },
    model: { list: async () => ({ data: [] }) },
  };
  await plugin.setup(ctx as never);
  expect(names).toEqual(["retry"]);
});
