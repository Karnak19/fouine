import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModel,
} from "ai";
import { pipeYamlRender } from "@json-render/yaml";
import {
  MAX_DATASETS,
  MAX_PREVIOUS_PROMPTS,
  MAX_PREVIOUS_SPEC_BYTES,
  MAX_SQL_CHARS,
  DATASET_KEY_RE,
  sanitizeSpec,
  type BuildDataset,
  type BuildPrevious,
  type PreviousDataset,
} from "@fouine/shared/build-catalog";
import { config } from "~/config";
import { resolveApiKey } from "~/settings";
import { wireModelId } from "~/chat";
import { chatMockEnabled } from "~/chat/mock-model";
import { log } from "~/server/log";
import { createDatasetStep, rerunPreviousDataset } from "~/build/datasets";
import {
  DATA_SYSTEM_PROMPT,
  DATA_REFINE_PROMPT,
  datasetBriefing,
  layoutSystemPrompt,
  refineDataPrompt,
  refineLayoutPrompt,
} from "~/build/prompt";
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
export interface DatasetError {
  key: string;
  title: string;
  sql: string;
  error: string;
}

function models(sessionId: string, refine: boolean): { data: LanguageModel; layout: LanguageModel } {
  if (chatMockEnabled()) {
    console.warn("[build] CHAT_MOCK=1 — composing with the scripted mock models, no upstream call");
    return { data: createBuildDataMockModel(refine), layout: createBuildLayoutMockModel(refine) };
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
export async function streamBuild(
  prompt: string,
  signal?: AbortSignal,
  id?: string,
  previousInput?: unknown,
): Promise<Response> {
  const question = String(prompt ?? "").trim();
  if (!question) throw new Error("Describe the dashboard you want.");
  if (question.length > MAX_PROMPT_CHARS) {
    throw new Error(`That is too long — keep it under ${MAX_PROMPT_CHARS} characters.`);
  }
  // Thrown, not streamed: a malformed `previous` is a bad request, and the
  // route turns the message into a 400 the page shows as-is.
  const previous = previousInput == null ? undefined : validatePrevious(previousInput);
  const refine = previous !== undefined;

  const { data: dataModel, layout: layoutModel } = models(id ?? crypto.randomUUID(), refine);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const datasets: BuildDataset[] = [];
      const publish = (d: BuildDataset) => {
        datasets.push(d);
        // Straight out to the browser, before the layout exists.
        writer.write({ type: DATASET_PART, id: d.key, data: d });
      };

      // On a refine the existing datasets are re-run HERE, from their SQL,
      // before the model is asked anything. The browser only ever sent SQL and
      // names; whatever it claimed the rows were is not a field we read. A query
      // the guard now refuses (or that returns nothing) is dropped and said in
      // the notes; the page keeps the rest. Never a 500.
      const errors: DatasetError[] = [];
      if (previous) {
        for (const prev of previous.datasets) {
          if (signal?.aborted) break;
          const ran = await rerunPreviousDataset(prev, previous.spec, signal);
          if (ran.ok) {
            publish(ran.dataset);
          } else {
            const failed: DatasetError = { key: prev.key, title: prev.title, sql: prev.sql, error: ran.error };
            errors.push(failed);
            log.warn("build: previous dataset did not re-run", { key: prev.key, error: ran.error });
          }
        }
        log.info("build: refine", {
          id,
          previousDatasets: previous.datasets.length,
          rerun: datasets.length,
          failed: errors.length,
          prompts: previous.prompts.length,
        });
      }

      const step = createDatasetStep(signal, publish, datasets);

      const data = streamText({
        model: dataModel,
        system: previous ? DATA_REFINE_PROMPT : DATA_SYSTEM_PROMPT,
        prompt: previous ? refineDataPrompt(question, previous) : question,
        tools: { add_dataset: step.tool },
        stopWhen: stepCountIs(DATA_STEPS),
        abortSignal: signal,
      });
      // The prose of this step is thrown away on purpose — its only product is
      // the datasets its tool calls produced. Consuming it is what runs them.
      await data.consumeStream();

      const notes = step.result().notes;
      for (const e of errors) {
        notes.push(`The query behind "${e.title}" (${e.key}) no longer runs and was dropped: ${e.error}`);
      }
      if (datasets.length === 0) {
        notes.push("No data came back for this question, so there is nothing to draw.");
      }
      if (notes.length) writer.write({ type: NOTE_PART, data: { notes } });

      const layout = streamText({
        model: layoutModel,
        system: layoutSystemPrompt(),
        // The layout model gets the spec on a refine and the dataset briefing
        // either way — keys, columns and counts. Rows are on the wire above,
        // never in this prompt.
        prompt: previous
          ? refineLayoutPrompt(question, previous, datasets)
          : `${question}\n\n${datasetBriefing(datasets)}`,
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

// ---------------------------------------------------------------------------
// The `previous` body of a refine
// ---------------------------------------------------------------------------

function bad(msg: string): never {
  throw new Error(msg);
}

/**
 * Check what the browser sent back and reduce it to what the server will use.
 *
 * The route's TypeBox schema already bounds shapes and sizes coarsely; this is
 * the pass that knows what the fields MEAN. The spec goes through the same
 * `sanitizeSpec` the browser ran before sending, so a hand-made body cannot
 * smuggle a component the catalog lacks or a prop full of numbers into the
 * layout model's context. Rows are not a field of `PreviousDataset`, and any
 * extra property is dropped here rather than forwarded.
 */
export function validatePrevious(input: unknown): BuildPrevious {
  if (!input || typeof input !== "object") bad("`previous` must be an object.");
  const p = input as Record<string, unknown>;

  const specJson = JSON.stringify(p.spec ?? null);
  if (!p.spec || typeof p.spec !== "object") bad("`previous.spec` is missing.");
  if (Buffer.byteLength(specJson) > MAX_PREVIOUS_SPEC_BYTES) {
    bad(`The current dashboard is too large to refine (over ${Math.round(MAX_PREVIOUS_SPEC_BYTES / 1000)} kB). Start over.`);
  }
  const { spec } = sanitizeSpec(p.spec as BuildPrevious["spec"]);
  if (!spec.root || Object.keys(spec.elements).length === 0) bad("`previous.spec` has nothing to refine. Start over.");

  const rawDatasets = Array.isArray(p.datasets) ? p.datasets : bad("`previous.datasets` must be an array.");
  if (rawDatasets.length > MAX_DATASETS) bad(`A dashboard holds at most ${MAX_DATASETS} datasets.`);
  const seen = new Set<string>();
  const datasets: PreviousDataset[] = rawDatasets.map((raw, i) => {
    if (!raw || typeof raw !== "object") bad(`previous.datasets[${i}] is not an object.`);
    const d = raw as Record<string, unknown>;
    const key = typeof d.key === "string" ? d.key : bad(`previous.datasets[${i}] has no key.`);
    if (!DATASET_KEY_RE.test(key)) bad(`previous.datasets[${i}]: "${key}" is not a valid dataset key.`);
    if (seen.has(key)) bad(`previous.datasets: "${key}" appears twice.`);
    seen.add(key);
    const sql = typeof d.sql === "string" ? d.sql.trim() : bad(`previous.datasets[${i}] (${key}) has no SQL.`);
    if (!sql) bad(`previous.datasets[${i}] (${key}) has empty SQL.`);
    if (sql.length > MAX_SQL_CHARS) bad(`The query behind "${key}" is too long (over ${MAX_SQL_CHARS} characters).`);
    const shape = d.shape;
    if (shape !== undefined && !["value", "line", "bar", "stacked_bar", "table"].includes(String(shape))) {
      bad(`previous.datasets[${i}] (${key}) has an unknown shape.`);
    }
    return {
      key,
      title: typeof d.title === "string" ? d.title.slice(0, 200) : key,
      sql,
      ...(shape ? { shape: shape as PreviousDataset["shape"] } : {}),
    };
  });

  const rawPrompts = Array.isArray(p.prompts) ? p.prompts : bad("`previous.prompts` must be an array.");
  if (rawPrompts.length > MAX_PREVIOUS_PROMPTS) {
    bad(`This dashboard has been refined ${MAX_PREVIOUS_PROMPTS} times — start over to keep going.`);
  }
  const prompts = rawPrompts.map((q, i) => {
    if (typeof q !== "string") bad(`previous.prompts[${i}] is not text.`);
    if (q.length > MAX_PROMPT_CHARS) bad(`previous.prompts[${i}] is over ${MAX_PROMPT_CHARS} characters.`);
    return q;
  });

  return { spec, datasets, prompts };
}
