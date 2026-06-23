import type { OpencodeClient } from "@opencode-ai/sdk";

export interface CommentToolInfo {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
}

const serverScript = `${import.meta.dir}/server.ts`;

export async function registerCommentTool(
  client: OpencodeClient,
  info: CommentToolInfo,
): Promise<void> {
  const res = await client.mcp.add({
    body: {
      name: "fouine",
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
}
