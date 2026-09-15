// Pure rendering for the merger's recap comment (#117) — no LLM, no I/O, so it
// snapshot-tests cleanly. Kept to ≤ 12 lines per the issue's "Merge comment"
// section.

import type { MergeMethod } from "~/settings";

export interface RecapData {
  method: MergeMethod;
  mergeSha: string;
  armedBy: string;
  armedAt: string; // ISO timestamp
  approvingReviewUrl: string;
  approvingReviewSummary: string; // first line of fouine's approving review body
  findingsCount: number;
  pushesCount: number;
  checksPassed: number;
  checksMode: "required checks" | "all checks";
  fixerCommits: string[]; // short SHAs; empty = no fixer credit line
  totalCost: number;
}

const METHOD_LABEL: Record<MergeMethod, string> = {
  merge: "Merged",
  squash: "Squashed",
  rebase: "Rebased",
};

function formatUtc(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function renderRecap(data: RecapData): string {
  const lines: string[] = [
    `🦡 ${METHOD_LABEL[data.method]} as \`${data.mergeSha.slice(0, 7)}\`.`,
    `Armed by @${data.armedBy} on ${formatUtc(data.armedAt)}.`,
    `Review: [approved](${data.approvingReviewUrl}) — "${data.approvingReviewSummary.trim() || "(no summary)"}"`,
    `Findings: ${data.findingsCount} reported, cleared in ${data.pushesCount} push${data.pushesCount === 1 ? "" : "es"}.`,
    `Checks: ${data.checksPassed} passed (${data.checksMode}).`,
  ];
  if (data.fixerCommits.length) {
    lines.push(
      `Fixer: ${data.fixerCommits.length} commit${data.fixerCommits.length === 1 ? "" : "s"} by fouine /fix (${data.fixerCommits.join(", ")}).`,
    );
  }
  lines.push(`Cost: $${data.totalCost.toFixed(4)} total on this PR.`);
  return lines.join("\n");
}
