// One LLM call, made right before the merger would otherwise pull the trigger
// on an auto-merge (#117 follow-up): every deterministic gate in decide.ts has
// already passed (fouine APPROVED on the armed SHA, CI green, mergeable, no
// standing CHANGES_REQUESTED) — this is the last, judgment-based check, and it
// never runs before the others because a "critical" verdict must never mask a
// real blocker.
//
// Deliberately NOT an opencode session: by merge time the review's worktree may
// already be gone, and one structured call over the diff is enough — no need
// for a whole agent loop. Reuses the same cheap, OpenAI-compatible chat model
// the dashboard's chat feature calls (see ~/chat/index.ts), not the (possibly
// much more expensive, possibly Anthropic-shaped) review model.

import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { resolveApiKey, resolveChatModel } from "~/settings";
import { OPENCODE_GO_BASE_URL, wireModelId } from "~/chat/index";
import { log } from "~/server/log";

export interface MergeRiskAssessment {
  level: "low" | "critical";
  reason: string; // one short sentence
}

export interface AssessMergeRiskInput {
  title: string;
  body: string;
  diff: string;
  approvingReviewBody: string; // fouine's approving review, for context it already gathered
  findingsCount: number;
}

// Diffs beyond this are refused outright rather than truncated: a truncated
// diff would let the model render a verdict on code it never actually saw,
// which is worse than just holding for a human.
const MAX_DIFF_CHARS = 200_000;

const SYSTEM_PROMPT = `You are the merge-risk gate for fouine's auto-merger, a self-hosted AI code \
reviewer. A PR has already been approved by fouine's own review and has green CI — your only job is \
to decide whether it is safe to auto-merge with no human in the loop, or whether a human should click \
Merge themselves.

Classify the PR as "low" or "critical" risk.

Critical — hold for a human — if the diff touches any of:
- authentication, authorization, permissions, or session handling
- secrets or credentials handling
- database schema or data migrations
- payments or billing
- infrastructure, deployment, or CI/CD configuration
- security-sensitive input handling (parsing untrusted input, injection surfaces, sandboxing)
- a public API or a breaking contract change
- a large, cross-cutting refactor
- deletion of significant code or data

Low risk: docs, tests, copy/text, small contained fixes, styling, internal refactors with good test \
coverage, and anything else clearly outside the critical list above.

When unsure, always choose "critical" — holding for a human costs nothing but a click; merging \
something risky unattended is the failure mode this gate exists to prevent.

Give one short sentence explaining the verdict — it's shown directly to the human on the PR.`;

function buildPrompt(input: AssessMergeRiskInput): string {
  return [
    `## PR title\n${input.title}`,
    `## PR description\n${input.body || "(none)"}`,
    `## fouine's approving review\n${input.approvingReviewBody || "(no summary)"}`,
    `## Findings fouine raised during review\n${input.findingsCount}`,
    `## Diff\n\`\`\`diff\n${input.diff}\n\`\`\``,
  ].join("\n\n");
}

const schema = z.object({
  level: z.enum(["low", "critical"]),
  reason: z.string(),
});

// The real implementation — network call to the opencode-go gateway. evaluate.ts
// takes this as an injectable dependency so its tests never hit the network
// (see the `assess` parameter on evaluatePipeline).
export async function assessMergeRisk(input: AssessMergeRiskInput): Promise<MergeRiskAssessment> {
  if (input.diff.length > MAX_DIFF_CHARS) {
    return { level: "critical", reason: "diff too large to assess safely — held for human review" };
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return { level: "critical", reason: "no opencode API key configured for risk assessment" };
  }

  try {
    const gateway = createOpenAICompatible({
      name: "opencode-go",
      baseURL: OPENCODE_GO_BASE_URL,
      apiKey,
      // opencode-go rejects requests without a session header (see
      // ~/chat/index.ts); a one-shot call is a one-request conversation.
      headers: { "x-opencode-session": crypto.randomUUID() },
    });
    const { object } = await generateObject({
      model: gateway(wireModelId(resolveChatModel())),
      schema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input),
    });
    return object;
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    log.warn("merge risk assessment failed, holding for human review", { error: message });
    return { level: "critical", reason: "risk assessment failed (details in fouine logs)" };
  }
}
