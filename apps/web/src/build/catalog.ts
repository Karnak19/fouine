// The one web-side door onto json-render.
//
// The catalog itself lives in `@fouine/shared/build-catalog` because the server
// needs the identical object to generate the layout prompt — a catalog that
// exists twice is a catalog that drifts, and the drift shows up as the model
// emitting a component the browser cannot draw. Everything else json-render
// (types, caps, the sanitiser) is re-exported from here, so an upgrade of a
// young library touches this file and `registry.tsx` and nothing else.

export {
  buildCatalog,
  sanitizeSpec,
  referencedDatasetKeys,
  BUILD_COMPONENTS,
  DATA_BACKED,
  MAX_DATASETS,
  MAX_SPEC_NODES,
  MAX_TABLE_ROWS,
  type BuildDataset,
  type BuildPrevious,
  type DatasetRow,
  type LooseSpec,
  type SanitizedSpec,
} from "@fouine/shared/build-catalog";
