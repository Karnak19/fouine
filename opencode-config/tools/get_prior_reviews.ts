import { tool } from "@opencode-ai/plugin";
import { fouineRepoCtx, ghHeaders } from "./_ctx";

export default tool({
  description:
    "Fetch a pull request's prior reviews and comments, including the author's replies. " +
    "On a re-review (the author pushed new commits), call this FIRST to recover what you already " +
    "flagged and how the author responded, so you don't re-raise resolved or by-design points. " +
    "Defaults to the PR under review; pass `pr` to read another PR's threads (improver runs).",
  args: {
    pr: tool.schema
      .number()
      .int()
      .nullable()
      .default(null)
      .describe("PR number to fetch. Omit for the PR currently under review."),
  },
  async execute(args) {
    const { token, owner, repo } = fouineRepoCtx();
    const pr = args.pr ?? process.env.FOUINE_PR_NUMBER;
    if (!pr) throw new Error("no PR number: pass `pr` or run in a PR-bound review");
    const h = ghHeaders(token);
    const base = `https://api.github.com/repos/${owner}/${repo}`;

    const [reviews, inline, issue] = await Promise.all([
      ghGet(`${base}/pulls/${pr}/reviews?per_page=100`, h),
      ghGet(`${base}/pulls/${pr}/comments?per_page=100`, h),
      ghGet(`${base}/issues/${pr}/comments?per_page=100`, h),
    ]);

    const short = (sha?: string) => (sha ? sha.slice(0, 7) : "?");
    const out: string[] = [];

    const allReviews = reviews as GhReview[];
    if (allReviews.length) {
      out.push(`## Reviews (${allReviews.length})`);
      for (const r of allReviews) {
        out.push(
          `### ${r.user?.login ?? "?"} — ${r.state} @ ${short(r.commit_id)} (${r.submitted_at ?? ""})`,
          clip(r.body) || "_(no body)_",
        );
      }
    }

    if ((inline as GhComment[]).length) {
      out.push(`\n## Inline comments (${(inline as GhComment[]).length})`);
      for (const c of inline as GhComment[]) {
        const reply = c.in_reply_to_id ? " [reply]" : "";
        out.push(
          `- ${c.user?.login ?? "?"} on ${c.path}:${c.line ?? c.original_line ?? "?"} @ ${short(c.commit_id)}${reply}: ${clip(c.body)}`,
        );
      }
    }

    if ((issue as GhComment[]).length) {
      out.push(`\n## PR comments (${(issue as GhComment[]).length})`);
      for (const c of issue as GhComment[]) {
        out.push(`- ${c.user?.login ?? "?"} (${c.created_at ?? ""}): ${clip(c.body)}`);
      }
    }

    return out.length ? out.join("\n") : "No prior reviews or comments on this PR.";
  },
});

// Bodies can be long; cap so a chatty history can't blow up the review context.
function clip(s?: string): string {
  const t = (s ?? "").trim();
  return t.length > 4000 ? `${t.slice(0, 4000)}\n…(truncated)` : t;
}

interface GhReview {
  user?: { login?: string };
  state: string;
  body?: string;
  submitted_at?: string;
  commit_id?: string;
}
interface GhComment {
  user?: { login?: string };
  body?: string;
  path?: string;
  line?: number;
  original_line?: number;
  in_reply_to_id?: number;
  commit_id?: string;
  created_at?: string;
}

async function ghGet(url: string, headers: Record<string, string>): Promise<unknown[]> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return (await res.json()) as unknown[];
}
