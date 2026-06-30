import type { OpencodeClient } from "@opencode-ai/sdk";
import { log } from "~/server/log";

export interface CommentToolInfo {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
}

const SERVER_NAME = "fouine";
const TOOL_NAME = "post_pr_review";
const serverScript = `${import.meta.dir}/server.ts`;

async function waitForTool(
  client: OpencodeClient,
  needle: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.tool.ids();
    const ids = (res.data as string[] | undefined) ?? [];
    const found = ids.find((id) => id.includes(needle));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`MCP tool "${needle}" not discovered within ${timeoutMs}ms`);
}

export async function registerCommentTool(
  client: OpencodeClient,
  info: CommentToolInfo,
): Promise<void> {
  const res = await client.mcp.add({
    body: {
      name: SERVER_NAME,
      config: {
        type: "local",
        command: ["bun", serverScript],
        enabled: true,
        environment: {
          FOUINE_GITHUB_TOKEN: info.token,
          FOUINE_REPO_OWNER: info.owner,
          FOUINE_REPO_NAME: info.repo,
          FOUINE_PR_NUMBER: String(info.prNumber),
        },
      },
    },
  });
  if (!res.data) {
    throw new Error(`failed to register fouine MCP server: ${JSON.stringify(res.error)}`);
  }

  // add only saves the config; connect spawns the server and lists its tools
  const conn = await client.mcp.connect({ path: { name: SERVER_NAME } });
  if (!conn.data) {
    throw new Error(`failed to connect fouine MCP server: ${JSON.stringify(conn.error)}`);
  }

  const toolId = await waitForTool(client, TOOL_NAME, 15_000);
  log.info("comment tool ready", {
    tool: toolId,
    repo: `${info.owner}/${info.repo}`,
    pr: info.prNumber,
  });
}
