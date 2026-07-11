import { tool } from "@opencode-ai/plugin";
import { fouineCtx, ghHeaders } from "./_ctx";

export default tool({
  description:
    "Fetch this pull request's prior reviews and comments, including the author's replies. " +
    "Call this FIRST on a re-review (the author pushed new commits) to recover what you already " +
    "flagged and how the author responded, so you don't re-raise resolved or by-design points.",
  args: {},
  async execute() {
    const { token, owner, repo, pr } = fouineCtx();
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
