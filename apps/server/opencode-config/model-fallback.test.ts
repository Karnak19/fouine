import { expect, test } from "bun:test";
import plugin from "./plugins/model-fallback.ts";
import {
  isLimitError,
  nextModel,
  parseFallbackFile,
  setupModelFallback,
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
  const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
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
    log: (message, data) => logs.push({ message, data }),
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

test("a plain 429 overrides opencode's own backoff too", async () => {
  const h = fakeHost({ models: available("opencode-go/deepseek-v4-flash") });
  const event = await fire(
    h,
    file({ ses_1: ["opencode-go/deepseek-v4-flash"] }),
    retryEvent({
      error: { type: "provider.rate-limit", message: "Too many requests", status: 429 },
      decision: { retry: true, delay: 8000 },
    }),
  );
  expect(event.decision).toEqual({ retry: true, delay: 0 });
  expect(h.switches).toHaveLength(1);
});

test("only rate-limit and quota errors switch models", () => {
  for (const type of [
    "provider.rate-limit",
    "provider.quota",
    "provider.budget-limit",
    "provider.free-limit",
    "provider.go-limit",
    "provider.model-budget-limit",
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
  ]) {
    expect(isLimitError(type)).toBe(false);
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
