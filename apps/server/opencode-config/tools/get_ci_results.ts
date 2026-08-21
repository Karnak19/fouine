import { tool } from "@opencode-ai/plugin";
import { type Annotation, type CheckRun, formatCiResults } from "./_ci_format";
import { fouineCtx, ghGet, ghHeaders } from "./_ctx";

export default tool({
  description:
    "Read this PR's CI results for its head commit: which check runs passed, failed or are still " +
    "running, plus the per-file, per-line annotations the failing ones published (test failures, " +
    "type errors, lint violations). Call this INSTEAD of running the test suite, typechecker or " +
    "linter yourself — CI already ran them on this exact commit, with the env and deps you don't " +
    "have. Call it early, before judging whether the PR is broken. If it reports runs still in " +
    "progress, CI is not finished: never claim the PR passes, and say so in your review.",
  args: {},
  async execute() {
    const { token, owner, repo, pr } = fouineCtx();
    const h = ghHeaders(token);
    const base = `https://api.github.com/repos/${owner}/${repo}`;

    // The head SHA is not in the FOUINE_* env, and check runs are keyed by ref.
    const prData = (await ghGet(`${base}/pulls/${pr}`, h)) as { head?: { sha?: string } };
    const sha = prData.head?.sha;
    if (!sha) throw new Error(`could not resolve head SHA for PR #${pr}`);

    const checks = (await ghGet(`${base}/commits/${sha}/check-runs?per_page=100`, h)) as {
      check_runs?: (CheckRun & { id: number })[];
    };
    // Our own check run reports the review itself; including it is noise at best
    // and self-referential confusion at worst.
    const runs = (checks.check_runs ?? []).filter((r) => !/^fouine/i.test(r.name));

    const withAnnotations = runs.filter((r) => (r.output?.annotations_count ?? 0) > 0);
    const fetched = await Promise.all(
      withAnnotations.map(async (r) => {
        const list = (await ghGet(
          `${base}/check-runs/${r.id}/annotations?per_page=100`,
          h,
        )) as Annotation[];
        return [r.name, list] as const;
      }),
    );

    return formatCiResults(sha, runs, new Map(fetched));
  },
});
