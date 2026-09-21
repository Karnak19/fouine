import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModel,
} from "ai";
import { pipeYamlRender } from "@json-render/yaml";
import { MAX_DATASETS, type BuildDataset } from "@fouine/shared/build-catalog";
import { config } from "~/config";
import { resolveApiKey } from "~/settings";
import { wireModelId } from "~/chat";
import { chatMockEnabled } from "~/chat/mock-model";
import { createDatasetStep } from "~/build/datasets";
import { DATA_SYSTEM_PROMPT, datasetBriefing, layoutSystemPrompt } from "~/build/prompt";
import { createBuildDataMockModel, createBuildLayoutMockModel } from "~/build/mock-model";

/**
 * `/build`: one sentence in, a whole dashboard out.
 *
 * Two generations, not one, and the split is the safety property rather than an
 * optimisation. The first has the database schema and the `add_dataset` tool
 * and gets back column names only. The second has the component catalog and
 * the dataset KEYS and never sees a row. So there is no point in the pipeline
 * where a model holds both a number and a place to put it.
 *
 * Both share the chat model setting (`OPENCODE_CHAT_MODEL`). No new knob: this
 * is the same cheap high-volume workload wearing a different hat.
 */

// Same shape of bound as chat's MAX_QUESTION_CHARS: what the browser may ask
// for is paid upstream in tokens on a key that is not free.
export const MAX_PROMPT_CHARS = 2_000;

/**
 * Steps the data model gets. One call per dataset plus the call that decides to
 * stop, and a couple spare for a rejected query it can correct.
 */
export const DATA_STEPS = MAX_DATASETS + 3;

/** The layout model writes one YAML document; it never needs a second turn. */
export const LAYOUT_STEPS = 1;

const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

/** The data parts this route adds on top of json-render's own spec patches. */
export const DATASET_PART = "data-build-dataset";
export const NOTE_PART = "data-build-note";

function models(sessionId: string): { data: LanguageModel; layout: LanguageModel } {
  if (chatMockEnabled()) {
    console.warn("[build] CHAT_MOCK=1 — composing with the scripted mock models, no upstream call");
    return { data: createBuildDataMockModel(), layout: createBuildLayoutMockModel() };
  }
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error("No opencode API key configured — set one in Settings.");
  const gateway = createOpenAICompatible({
    name: "opencode-go",
    baseURL: OPENCODE_GO_BASE_URL,
    apiKey,
    headers: { "x-opencode-session": sessionId },
  });
  const model = gateway(wireModelId(config.chat.model));
  return { data: model, layout: model };
}

/**
 * Run both steps and stream the result as an AI SDK UI message stream.
 *
 * Ordering on the wire is deliberate: every dataset is written the instant its
 * query returns, and the spec patches only start once the layout model begins
 * writing. The page therefore has its data before it has the layout that
 * arranges it — a chart never arrives looking for rows that are not there yet,
 * and the skeleton state is short.
 */
export async function streamBuild(prompt: string, signal?: AbortSignal, id?: string): Promise<Response> {
  const question = String(prompt ?? "").trim();
  if (!question) throw new Error("Describe the dashboard you want.");
  if (question.length > MAX_PROMPT_CHARS) {
    throw new Error(`That is too long — keep it under ${MAX_PROMPT_CHARS} characters.`);
  }

  const { data: dataModel, layout: layoutModel } = models(id ?? crypto.randomUUID());

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const datasets: BuildDataset[] = [];
      const step = createDatasetStep(signal, (d) => {
        datasets.push(d);
        // Straight out to the browser, before the layout exists.
        writer.write({ type: DATASET_PART, id: d.key, data: d });
      });

      const data = streamText({
        model: dataModel,
        system: DATA_SYSTEM_PROMPT,
        prompt: question,
        tools: { add_dataset: step.tool },
        stopWhen: stepCountIs(DATA_STEPS),
        abortSignal: signal,
      });
      // The prose of this step is thrown away on purpose — its only product is
      // the datasets its tool calls produced. Consuming it is what runs them.
      await data.consumeStream();

      const notes = step.result().notes;
      if (datasets.length === 0) {
        notes.push("No data came back for this question, so there is nothing to draw.");
      }
      if (notes.length) writer.write({ type: NOTE_PART, data: { notes } });

      const layout = streamText({
        model: layoutModel,
        system: layoutSystemPrompt(),
        prompt: `${question}\n\n${datasetBriefing(datasets)}`,
        stopWhen: stepCountIs(LAYOUT_STEPS),
        abortSignal: signal,
      });

      // The documented AI SDK integration for @json-render/yaml: the transform
      // turns the model's ```yaml-spec fence into spec patches as it streams,
      // so the layout paints top-down instead of appearing all at once when the
      // last brace lands.
      writer.merge(pipeYamlRender(layout.toUIMessageStream()));
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });

  return createUIMessageStreamResponse({ stream });
}
