import { expect, test } from "bun:test";
import { OpenCodeServerManager, makeSidecarServe, type ManagerDeps } from "~/effect/opencode";
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

test("pushes the default provider key once at init; pushProviderKey re-pushes", async () => {
  const { serve, pushed } = fakeServe();
  const { manager } = makeManager(serve);
  await manager.acquire();
  expect(pushed).toHaveLength(1);
  expect(pushed[0].key).toBe("test-key");

  // A second ensure (a per-repo model on the same provider) is a no-op.
  await manager.ensureProviderKey(pushed[0].integrationID);
  expect(pushed).toHaveLength(1);

  // A settings change forces a re-push.
  await manager.pushProviderKey(pushed[0].integrationID);
  expect(pushed).toHaveLength(2);
  manager.stop();
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
