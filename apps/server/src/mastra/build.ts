import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { DATA_SYSTEM_PROMPT } from "~/build/prompt";
import {
  ADD_DATASET_DESCRIPTION,
  addDatasetInputSchema,
  type createDatasetStep,
} from "~/build/datasets";
import { openAICompatibleConfig } from "~/chat/model";
import { chatMockEnabled } from "~/chat/mock-model";
import { createBuildDataMockModel, createBuildLayoutMockModel } from "~/build/mock-model";
import { resolveApiKey } from "~/settings";

// Request-context key, private to this module. `streamBuild` writes the model
// for the phase about to run; the resolver below reads it.
export const MODEL_KEY = "fouine.build.model";

/**
 * The fouine `/build` agent.
 *
 * One agent instance, run TWICE per request: the data step (with the
 * `add_dataset` tool) and the layout step (no tools). The system prompt is
 * overridden on every run — the split between the two prompts is the safety
 * property, so it must not be baked into one static instruction.
 *
 * `model` is a function for the same reason as chat: the dashboard's Chat model
 * is re-read per request. `/build` never needs two models at once, so the run
 * sets the model for its phase on the request context instead of resolving it
 * here.
 */
export const buildAgent = new Agent({
  id: "build",
  name: "fouine build",
  // Only a default: every run below overrides it. Kept non-empty because the
  // Agent config requires instructions.
  instructions: DATA_SYSTEM_PROMPT,
  model: ({ requestContext }) => {
    const model = requestContext.getRaw(MODEL_KEY) as MastraModelConfig | undefined;
    if (!model) throw new Error("build model was not set on the request context");
    return model;
  },
});

/**
 * The models for one `/build` request.
 *
 * The real gateway path is a Mastra `OpenAICompatibleConfig` — the same one
 * chat uses — so both steps share one config object. The mock is two SEPARATE
 * scripted instances (data and layout answer differently, and each counts its
 * own calls), so it stays an instance and the type cast lives in
 * `~/chat/model.ts` beside the chat mock's.
 */
export function buildModels(
  session: string,
  refine: boolean,
): { data: MastraModelConfig; layout: MastraModelConfig } {
  if (chatMockEnabled()) {
    console.warn("[build] CHAT_MOCK=1 — composing with the scripted mock models, no upstream call");
    return {
      data: createBuildDataMockModel(refine) as unknown as MastraModelConfig,
      layout: createBuildLayoutMockModel(refine) as unknown as MastraModelConfig,
    };
  }
  if (!resolveApiKey()) {
    throw new Error("No opencode API key configured — set one in Settings.");
  }
  const config = openAICompatibleConfig(session);
  return { data: config, layout: config };
}

/**
 * The `add_dataset` toolset for one data run.
 *
 * The tool itself is built by `createDatasetStep` and passed through AS-IS:
 * Mastra accepts AI SDK tools, and the guard, caps, result shape and the
 * "columns and counts, never rows" reply all stay in `~/build/datasets.ts`.
 */
export function datasetToolset(step: ReturnType<typeof createDatasetStep>) {
  return {
    add_dataset: createTool({
      id: "add_dataset",
      description: ADD_DATASET_DESCRIPTION,
      inputSchema: addDatasetInputSchema,
      outputSchema: z.string(),
      execute: (input) => step.execute(input),
    }),
  };
}

/**
 * Point the next `buildAgent` run at one phase's model.
 *
 * Deliberately not memoised on the context (unlike chat): the same request
 * switches models between the data and layout runs, and the mock instances are
 * stateful scripts that must not be recreated per step.
 */
export function setBuildModel(requestContext: RequestContext, model: MastraModelConfig): void {
  requestContext.setRaw(MODEL_KEY, model);
}
