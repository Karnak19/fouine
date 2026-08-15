import { afterEach, expect, test } from "bun:test";

// Deliberately NOT in plugin/: opencode discovers plugins by globbing
// {plugin,plugins}/*.{ts,js} in this dir, so a test file next to the plugin
// would be loaded as one — importing bun:test into the review runtime and
// registering tests inside opencode. One level up is outside the glob.
//
// The cap is read once at module load, so each case re-imports with a distinct
// query string to defeat the module cache. Asserting through the hook rather
// than on an exported constant, because the plugin file must export nothing but
// plugin factories (opencode calls every export).
let n = 0;
const hookWith = async (raw: string | undefined) => {
  if (raw === undefined) delete process.env.OPENCODE_BASH_TIMEOUT_MAX_MS;
  else process.env.OPENCODE_BASH_TIMEOUT_MAX_MS = raw;
  const mod = await import(`./plugin/cap-bash-timeout.ts?case=${n++}`);
  const plugin = await mod.CapBashTimeout({} as never);
  return plugin["tool.execute.before"] as (
    input: { tool: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>;
};

const clamp = async (raw: string | undefined, requested: number) => {
  const hook = await hookWith(raw);
  const output = { args: { command: "x", timeout: requested } as Record<string, unknown> };
  await hook({ tool: "bash" }, output);
  return output.args.timeout;
};

afterEach(() => {
  delete process.env.OPENCODE_BASH_TIMEOUT_MAX_MS;
});

test("clamps an over-cap request to the default", async () => {
  expect(await clamp(undefined, 1_800_000)).toBe(120_000);
});

test("leaves an under-cap request alone", async () => {
  expect(await clamp(undefined, 5_000)).toBe(5_000);
});

test("honours a valid override", async () => {
  expect(await clamp("30000", 1_800_000)).toBe(30_000);
});

// The whole point: a bad value must not silently hand the model an unbounded
// timeout (NaN comparison is always false) or a 0ms cap that kills every command.
test.each([["oops"], [""], ["  "], ["0"], ["-5"], ["NaN"], ["Infinity"]])(
  "falls back to the default for the invalid value %p",
  async (raw) => {
    expect(await clamp(raw, 1_800_000)).toBe(120_000);
    expect(await clamp(raw, 5_000)).toBe(5_000);
  },
);

test("ignores non-bash tools and requests with no timeout", async () => {
  const hook = await hookWith(undefined);
  const other = { args: { timeout: 1_800_000 } as Record<string, unknown> };
  await hook({ tool: "read" }, other);
  expect(other.args.timeout).toBe(1_800_000);

  const noTimeout = { args: { command: "x" } as Record<string, unknown> };
  await hook({ tool: "bash" }, noTimeout);
  expect(noTimeout.args.timeout).toBeUndefined();
});
