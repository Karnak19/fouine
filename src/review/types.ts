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
