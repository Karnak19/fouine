const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export interface RepoRow {
  full_name: string;
  installation_id: number;
  prompt: string | null;
  model: string | null;
  enabled: number;
  created_at: number;
}

export interface ReviewRow {
  id: number;
  repo_full_name: string;
  pr_number: number;
  title: string | null;
  session_id: string | null;
  status: string;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface Settings {
  opencode_api_key?: string;
  opencode_model?: string;
  default_prompt?: string;
}

export const api = {
  repos: {
    list: () => request<RepoRow[]>("/repos"),
    get: (owner: string, name: string) => request<RepoRow>(`/repos/${owner}/${name}`),
    create: (data: { full_name: string; installation_id: number }) =>
      request<RepoRow>("/repos", { method: "POST", body: JSON.stringify(data) }),
    update: (
      owner: string,
      name: string,
      data: { prompt?: string; model?: string; enabled?: number },
    ) =>
      request<RepoRow>(`/repos/${owner}/${name}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (owner: string, name: string) =>
      request<void>(`/repos/${owner}/${name}`, { method: "DELETE" }),
    reviews: (owner: string, name: string) =>
      request<ReviewRow[]>(`/repos/${owner}/${name}/reviews`),
  },
  reviews: {
    list: () => request<ReviewRow[]>("/reviews"),
    get: (id: number) => request<ReviewRow>(`/reviews/${id}`),
    session: (id: number) => request<unknown>(`/reviews/${id}/session`),
    retry: (id: number) => request<{ ok: boolean }>(`/reviews/${id}/retry`, { method: "POST" }),
  },
  settings: {
    get: () => request<Settings>("/settings"),
    update: (data: Settings) =>
      request<Settings>("/settings", { method: "PUT", body: JSON.stringify(data) }),
    test: () => request<{ ok: boolean; text?: string; error?: string }>("/settings/test"),
  },
};
