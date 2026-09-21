// Pure formatting for get_ci_results. Split out of the tool file because the tool
// value-imports @opencode-ai/plugin, which only resolves inside opencode's own
// runtime — this module imports nothing, so the tests can reach it.
// The leading underscore flags it as a non-tool module (see _ctx.ts).

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  output?: { title?: string | null; annotations_count?: number | null } | null;
}

export interface Annotation {
  path?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  annotation_level?: string | null;
  title?: string | null;
  message?: string | null;
}

// A long lint failure can emit hundreds of annotations; unclipped they would eat
// the whole review context (same reason get_prior_reviews caps bodies at 4000).
const MAX_ANNOTATIONS = 50;
const MAX_MESSAGE = 1000;

const FAILING = new Set(["failure", "timed_out", "action_required", "cancelled", "stale"]);

export function formatCiResults(
  sha: string,
  runs: CheckRun[],
  annotations: Map<string, Annotation[]>,
): string {
  const short = sha.slice(0, 7);
  if (!runs.length) {
    return `No check runs on commit ${short}. CI may not have started yet — do not read this as CI passing.`;
  }

  const pending = runs.filter((r) => r.status !== "completed");
  const failed = runs.filter((r) => r.status === "completed" && FAILING.has(r.conclusion ?? ""));
  const passed = runs.filter((r) => r.status === "completed" && !FAILING.has(r.conclusion ?? ""));

  const out: string[] = [`CI for head commit ${short} — ${runs.length} check run(s).`];

  // Pending first and stated loudly: an agent that skims this and sees only the
  // passing list will claim the PR is green off a half-finished CI run.
  if (pending.length) {
    out.push(
      "",
      `⏳ STILL RUNNING (${pending.length}): ${pending.map((r) => `${r.name} (${r.status})`).join(", ")}`,
      "CI IS NOT FINISHED. These runs have no verdict yet, so absence of failures below proves nothing.",
      "Do not claim this PR passes CI. Review the code on its own merits and say CI was incomplete.",
    );
  }

  if (failed.length) {
    out.push(
      "",
      `❌ Failed (${failed.length}): ${failed.map((r) => `${r.name} (${r.conclusion})`).join(", ")}`,
    );
  }
  if (passed.length) {
    out.push(
      "",
      `✅ Passed (${passed.length}): ${passed.map((r) => `${r.name} (${r.conclusion})`).join(", ")}`,
    );
  }

  let budget = MAX_ANNOTATIONS;
  let dropped = 0;
  const sections: string[] = [];
  // Failed runs first so the annotations that matter survive the cap.
  const unexplained = failed.filter((r) => !(annotations.get(r.name) ?? []).length);
  for (const run of [...failed, ...passed, ...pending]) {
    const list = annotations.get(run.name) ?? [];
    if (!list.length) continue;
    const shown = list.slice(0, Math.max(budget, 0));
    dropped += list.length - shown.length;
    budget -= shown.length;
    if (!shown.length) continue;
    sections.push(
      "",
      `## ${run.name} — ${run.status === "completed" ? run.conclusion : run.status}${run.output?.title ? `: ${run.output.title}` : ""}`,
      ...shown.map(formatAnnotation),
    );
  }

  if (sections.length) {
    out.push("", "### Annotations", ...sections);
    if (dropped) out.push("", `…(${dropped} further annotation(s) truncated)`);
  }
  // Gated on the failing runs, not on whether ANY annotations came back: a passing
  // lint job's warnings would otherwise hide the fact that a failed run's detail
  // is logs-only — the same read-as-green hazard this tool exists to prevent.
  if (unexplained.length) {
    out.push(
      "",
      `${unexplained.map((r) => r.name).join(", ")} failed but published no annotations — that failure's detail is only in the workflow logs, which fouine cannot read. Judge the code itself; don't assume it's benign.`,
    );
  }

  return out.join("\n");
}

function formatAnnotation(a: Annotation): string {
  const where = a.path ? `${a.path}:${lineRange(a)}` : "(no file)";
  const level = a.annotation_level ?? "notice";
  const title = a.title ? `${a.title} — ` : "";
  return `- [${level}] ${where}: ${title}${clip(a.message)}`;
}

function lineRange(a: Annotation): string {
  const start = a.start_line ?? 0;
  const end = a.end_line ?? start;
  if (!start) return "?";
  return end && end !== start ? `${start}-${end}` : String(start);
}

function clip(s?: string | null): string {
  const t = (s ?? "").trim().replace(/\s*\n\s*/g, " ⏎ ");
  return t.length > MAX_MESSAGE ? `${t.slice(0, MAX_MESSAGE)}…(truncated)` : t;
}
