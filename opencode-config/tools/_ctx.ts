// Shared context for the fouine opencode tools. Not a tool itself: opencode only
// registers files in this directory whose default export is a `tool(...)`, and
// ignores helper modules like this one (verified against opencode's tool loader).
// The leading underscore flags it as a non-tool module.

export interface FouineCtx {
  token: string;
  owner: string;
  repo: string;
  pr: string;
}

// Repo-scoped context — what every run has, PR-bound or not (the improver runs
// against a repo, not a PR).
export function fouineRepoCtx(): Omit<FouineCtx, "pr"> {
  const token = process.env.FOUINE_GITHUB_TOKEN;
  const owner = process.env.FOUINE_REPO_OWNER;
  const repo = process.env.FOUINE_REPO_NAME;
  if (!token || !owner || !repo) {
    throw new Error("fouine GitHub context env vars are not set");
  }
  return { token, owner, repo };
}

export function fouineCtx(): FouineCtx {
  const base = fouineRepoCtx();
  const pr = process.env.FOUINE_PR_NUMBER;
  if (!pr) {
    throw new Error("fouine GitHub context env vars are not set");
  }
  return { ...base, pr };
}

// GitHub REST headers. Pass `{ json: true }` for requests with a JSON body (POST);
// GET callers omit it so no needless content-type is sent.
export function ghHeaders(token: string, opts: { json?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (opts.json) headers["content-type"] = "application/json";
  return headers;
}
