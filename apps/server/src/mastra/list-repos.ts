import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { repos, reviews } from "~/db";

/**
 * `list_repos` — the MCP entry point into the repo table.
 *
 * Read-only by construction: it reuses the same prepared statements the
 * dashboard's repo list reads (`repos.list`, `reviews.byRepo`) instead of
 * writing new SQL. #164 keeps the dashboard's repo table as the single source
 * for this shape, so a column added there shows up here without a second query
 * to keep in sync.
 *
 * Not registered on the chat agent: the browser chat already has `query_stats`
 * for this and the tool is only listed in the MCP registry.
 */
export const listReposTool = createTool({
  id: "list_repos",
  description:
    "List the repositories fouine reviews. For each one: its full name (owner/repo), whether automatic reviews " +
    "are enabled, and its most recent review (number, status, and when it started), or null if it has none. " +
    "Read-only — this cannot enable, disable, add or remove a repo.",
  inputSchema: z.object({}),
  outputSchema: z.array(
    z.object({
      repo: z.string(),
      enabled: z.boolean(),
      last_review: z
        .object({
          id: z.number(),
          pr: z.number(),
          status: z.string(),
          created_at: z.number(),
        })
        .nullable(),
    }),
  ),
  execute: async () => {
    // Same order as the dashboard list: newest repo first.
    return repos.list.all().map((repo) => {
      const last = reviews.byRepo.all({ $repo: repo.full_name, $limit: 1 })[0];
      return {
        repo: repo.full_name,
        // SQLite boolean, 0 | 1.
        enabled: repo.enabled === 1,
        last_review: last
          ? {
              id: last.id,
              pr: last.pr_number,
              status: last.status,
              created_at: last.created_at,
            }
          : null,
      };
    });
  },
});
