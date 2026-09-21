// Command Code (https://commandcode.ai) is an OpenAI-compatible gateway that
// models.dev does not list, so opencode has no native knowledge of it. fouine
// declares the provider itself in the generated opencode.json (see
// buildOpencodeConfig in skills/materialize) and keeps this small catalog for
// the model picker. Model ids carry a `/` (`deepseek/deepseek-v4-flash`), which
// is why parseModel splits a spec on the first slash only.
export const COMMANDCODE_PROVIDER = "commandcode";
export const COMMANDCODE_PROVIDER_NAME = "Command Code";
export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider/v1";

// ponytail: hardcoded because the catalog is not in models.dev and the live
// list (`GET ${COMMANDCODE_BASE_URL}/models`) needs the user's key. Upgrade
// path: fetch that endpoint with the resolved key at catalog-load time in
// review/models.ts and fall back to this list when the key is missing or the
// request fails.
export const COMMANDCODE_MODELS: readonly { id: string; name: string }[] = [
  { id: "zai-org/GLM-5.2", name: "GLM-5.2" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "moonshotai/Kimi-K2.7-code", name: "Kimi K2.7 Code" },
];
