import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  OpenCodeServerManager,
  OpenCodeService,
  makeSidecarServe,
  openCodeManager,
  type ManagerDeps,
} from "~/effect/opencode";
import { newActivityState, type OpencodeServe } from "~/review/opencode";
import { createTranscriptStream } from "~/review/transcript";
import { ZAI_PROVIDER } from "~/settings";

// A controllable SSE stream: push events, close to simulate server loss, and
// re-subscribe (used by the reconnect path). Each subscribe() call makes the
// stream live again, like the manager's new pump after a reconnect.
class FakeEvents {
  private queue: unknown[] = [];
  private waiting?: (r: IteratorResult<unknown>) => void;
  private done = false;

  push(event: unknown): void {
    if (this.waiting) {
      const r = this.waiting;
      this.waiting = undefined;
      r({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  close(): void {
    this.done = true;
    if (this.waiting) {
      const r = this.waiting;
      this.waiting = undefined;
      r({ value: undefined, done: true });
    }
  }

  subscribe(): AsyncIterableIterator<unknown> {
    if (this.done) this.done = false;
    const self = this;
    return {
      next(): Promise<IteratorResult<unknown>> {
        if (self.done) return Promise.resolve({ value: undefined, done: true });
        if (self.queue.length) return Promise.resolve({ value: self.queue.shift(), done: false });
        return new Promise((res) => {
          self.waiting = res;
        });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

function fakeServe() {
  const events = new FakeEvents();
  const pushed: Array<{ integrationID: string; key: string }> = [];
  const client = {
    server: { info: async () => ({}) },
    integration: { connect: { key: async (i: { integrationID: string; key: string }) => void pushed.push(i) } },
    event: { subscribe: () => events.subscribe() },
    session: { interrupt: async () => ({ interrupted: true }) },
    location: { reload: async () => {} },
  };
  const serve = { client, port: 1234, kill: () => {} } as unknown as OpencodeServe;
  return { serve, events, pushed };
}

function makeManager(
  serve: OpencodeServe,
  over: Partial<ManagerDeps> = {},
): { manager: OpenCodeServerManager; spawns: () => number } {
  let spawns = 0;
  const manager = new OpenCodeServerManager({
    spawnServe: async () => {
      spawns++;
      return serve;
    },
    probe: async () => true,
    resolveKey: (id) => (id === ZAI_PROVIDER ? undefined : "test-key"),
    now: () => 5_000,
    serverLossGraceMs: 0,
    serverLossPollMs: 0,
    ...over,
  });
  return { manager, spawns: () => spawns };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("sidecar mode talks to OPENCODE_BASE_URL and spawns nothing", () => {
  const serve = makeSidecarServe({ OPENCODE_BASE_URL: "http://sidecar:4096" });
  expect(serve).toBeDefined();
  // Port 0 marks "not our child" — the manager never calls kill() on it.
  expect(serve?.port).toBe(0);
  expect(typeof serve?.client.event.subscribe).toBe("function");
  // No base URL → child mode, not a sidecar.
  expect(makeSidecarServe({})).toBeUndefined();
});

test("spawns the server once across concurrent and later acquires", async () => {
  const { serve } = fakeServe();
  const { manager, spawns } = makeManager(serve);
  const [a, b] = await Promise.all([manager.acquire(), manager.acquire()]);
  expect(spawns()).toBe(1);
  expect(a).toBe(b);
  await manager.acquire();
  expect(spawns()).toBe(1);
  manager.stop();
});

test("pushes the default provider key once at init and re-pushes a rotated key", async () => {
  const { serve, pushed } = fakeServe();
  let key = "test-key";
  const { manager } = makeManager(serve, {
    // ZAI stays unconfigured so the only init push is the default provider.
    resolveKey: (id) => (id === ZAI_PROVIDER ? undefined : key),
  });
  await manager.acquire();
  expect(pushed).toHaveLength(1);
  expect(pushed[0].key).toBe("test-key");

  // A second ensure (a per-repo model on the same provider, same key) is a no-op.
  await manager.ensureProviderKey(pushed[0].integrationID);
  expect(pushed).toHaveLength(1);

  // A rotated dashboard key must reach the live server: the guard compares the
  // key, not just the provider, so no restart is needed.
  key = "rotated-key";
  await manager.ensureProviderKey(pushed[0].integrationID);
  expect(pushed).toHaveLength(2);
  expect(pushed[1].key).toBe("rotated-key");
  manager.stop();
});

test("the run path pushes the run's provider key before session.create", async () => {
  const { serve, pushed } = fakeServe();
  // session.create never succeeds: we only care that the key push happens first.
  (serve.client as unknown as { session: { create: () => Promise<never> } }).session.create =
    async () => {
      throw new Error("session.create boom");
    };

  const calls: string[] = [];
  const proto = OpenCodeServerManager.prototype;
  const originalEnsure = proto.ensureProviderKey;
  proto.ensureProviderKey = async function (providerID: string) {
    calls.push(providerID);
    return originalEnsure.call(this, providerID);
  };

  const singleton = openCodeManager as unknown as { serve?: OpencodeServe; deps: ManagerDeps };
  const previousServe = singleton.serve;
  const previousDeps = singleton.deps;
  singleton.serve = serve;
  singleton.deps = { ...previousDeps, resolveKey: (id) => (id === "runprov" ? "run-key" : undefined) };
  try {
    const program = Effect.gen(function* () {
      const oc = yield* OpenCodeService;
      return yield* oc.runReview(
        { directory: "/tmp/fouine-test", prompt: "hi", model: "runprov/runmodel" },
        () => {},
        new AbortController().signal,
      );
    });
    await Effect.runPromise(program.pipe(Effect.provide(OpenCodeService.Default))).catch(
      () => undefined,
    );

    expect(calls).toContain("runprov");
    expect(pushed).toEqual([{ integrationID: "runprov", key: "run-key" }]);
  } finally {
    proto.ensureProviderKey = originalEnsure;
    singleton.serve = previousServe;
    singleton.deps = previousDeps;
  }
});

test("demultiplexes events by session id and drops unknown sessions", async () => {
  const { serve, events } = fakeServe();
  const { manager } = makeManager(serve);
  await manager.acquire();

  const one = newActivityState(0);
  const two = newActivityState(0);
  manager.register("ses_1", { state: one, transcript: createTranscriptStream(), onServerLost: () => {} });
  manager.register("ses_2", { state: two, transcript: createTranscriptStream(), onServerLost: () => {} });

  events.push({ type: "session.idle", data: { sessionID: "ses_1" } });
  events.push({ type: "session.idle", data: { sessionID: "ses_nobody" } });
  events.push({ type: "server.connected", data: {} });
  await tick();

  // observeEvent arms/advances only the matching session's fold.
  expect(one.armed).toBe(true);
  expect(one.lastActivity).toBe(5_000);
  expect(two.armed).toBe(false);
  manager.stop();
});

test("fails registered reviews and drops the serve when the server stays gone", async () => {
  const { serve, events } = fakeServe();
  const { manager, spawns } = makeManager(serve, { probe: async () => false });
  await manager.acquire();

  const failures: string[] = [];
  manager.register("ses_1", {
    state: newActivityState(0),
    transcript: createTranscriptStream(),
    onServerLost: (m) => failures.push(m),
  });

  events.close();
  await tick();

  expect(failures).toEqual(["opencode server restarted"]);
  expect(manager.current).toBeUndefined();

  // The registry was cleared and the next use re-spawns.
  await manager.acquire();
  expect(spawns()).toBe(2);
  manager.stop();
});

test("reconnects without failing reviews when the server is reachable again", async () => {
  const { serve, events } = fakeServe();
  const { manager } = makeManager(serve, { probe: async () => true });
  await manager.acquire();

  const state = newActivityState(0);
  const failures: string[] = [];
  manager.register("ses_1", {
    state,
    transcript: createTranscriptStream(),
    onServerLost: (m) => failures.push(m),
  });

  events.close();
  await tick();

  expect(failures).toEqual([]);
  expect(manager.current).toBe(serve);

  // The pump was restarted: a fresh event still reaches the same sink.
  events.push({ type: "session.idle", data: { sessionID: "ses_1" } });
  await tick();
  expect(state.armed).toBe(true);
  manager.stop();
});

test("abort during session.create interrupts the late session and registers nothing", async () => {
  const { serve } = fakeServe();
  // session.create hangs until we settle it, so the abort wins the race first
  // and the release runs with no session id yet.
  let resolveCreate: (v: { id: string }) => void = () => {};
  const created = new Promise<{ id: string }>((resolve) => {
    resolveCreate = resolve;
  });
  const interrupted: Array<{ sessionID: string; resume?: boolean }> = [];
  const client = serve.client as unknown as {
    session: {
      create: () => Promise<{ id: string }>;
      interrupt: (req: { sessionID: string; resume?: boolean }) => Promise<unknown>;
      prompt: () => Promise<unknown>;
      wait: () => Promise<void>;
    };
    message: { list: () => Promise<{ data: []; cursor: object }> };
  };
  client.session.create = () => created;
  client.session.interrupt = async (req) => {
    interrupted.push(req);
    return { interrupted: true };
  };
  // Stubs so the run continues harmlessly after teardown instead of rejecting
  // unhandled once the late session id arrives.
  client.session.prompt = async () => ({});
  client.session.wait = async () => undefined;
  client.message = { list: async () => ({ data: [], cursor: {} }) };

  const singleton = openCodeManager as unknown as { serve?: OpencodeServe };
  const previousServe = singleton.serve;
  singleton.serve = serve;

  const registered: string[] = [];
  const proto = OpenCodeServerManager.prototype;
  const originalRegister = proto.register;
  proto.register = function (id: string, sink: Parameters<typeof originalRegister>[1]) {
    registered.push(id);
    return originalRegister.call(this, id, sink);
  };

  const controller = new AbortController();
  try {
    const program = Effect.gen(function* () {
      const oc = yield* OpenCodeService;
      return yield* oc.runReview(
        { directory: "/tmp/fouine-test", prompt: "hi", model: "runprov/runmodel" },
        () => {},
        controller.signal,
      );
    });
    const run = Effect.runPromise(program.pipe(Effect.provide(OpenCodeService.Default))).catch(
      () => undefined,
    );

    await tick();
    controller.abort(new Error("superseded"));
    await run;

    // The id arrives only after the release already ran: the sink must not be
    // registered (nothing would ever interrupt or watch it) but the session must
    // still be interrupted, or the model runs on unsupervised.
    resolveCreate({ id: "ses_late" });
    await tick();
    await tick();

    expect(interrupted).toEqual([{ sessionID: "ses_late", resume: false }]);
    expect(registered).toEqual([]);
    expect((singleton as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(0);
  } finally {
    proto.register = originalRegister;
    singleton.serve = previousServe;
  }
});
