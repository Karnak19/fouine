export interface PullRequestInfo {
  installationId: number;
  repoFullName: string;
  number: number;
  title: string;
  body?: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
}

export type ReviewStatus = "pending" | "running" | "completed" | "failed";

// A GitHub issue (not a PR) as the refiner sees it: enough context to ask good
// questions without a second round-trip. Bodies are truncated and the comment
// list capped — an issue with 400 comments must not blow the prompt.
export interface IssueInfo {
  installationId: number;
  repoFullName: string;
  number: number;
  title: string;
  body: string;
  comments: { author: string; body: string }[];
}
