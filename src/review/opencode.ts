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
}

export interface RunResult {
  sessionId: string;
  text: string;
}

export async function withOpencode<T>(fn: (client: OpencodeClient) => Promise<T>): Promise<T> {
  const { client, server } = await createOpencode({ port: await freePort() });
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

  return { sessionId: session.id, text };
}
