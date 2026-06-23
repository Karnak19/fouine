import { Elysia, t } from "elysia";
import { repos, reviews, settings } from "~/db";
import { SETTINGS } from "~/settings";
import { config } from "~/config";
import { layout, statusPill, esc } from "~/server/views";

function fullName(owner: string, name: string): string {
  return `${owner}/${name}`;
}

function mask(key: string | undefined): string {
  if (!key) return "";
  return key.length > 8 ? `${"•".repeat(20)}${key.slice(-4)}` : "•".repeat(key.length);
}

export const dashboard = new Elysia()
  .onAfterHandle(({ set }) => {
    set.headers["content-type"] = "text/html; charset=utf-8";
  })
  .get("/", () => {
    const list = repos.list.all();
    const body = `
      <section>
        <h2>Repositories</h2>
        ${
          list.length === 0
            ? `<p class="muted">No repos yet. Repos are auto-registered on the first PR webhook, or add one manually below.</p>`
            : `<table>
                <thead><tr><th>Repository</th><th>Installation</th><th>Model</th><th>Registered</th></tr></thead>
                <tbody>
                ${list
                  .map(
                    (r) => `<tr>
                    <td><a href="/repos/${esc(r.full_name)}"><code>${esc(r.full_name)}</code></a></td>
                    <td>${esc(r.installation_id)}</td>
                    <td>${r.model ? `<code>${esc(r.model)}</code>` : `<span class="muted">default</span>`}</td>
                    <td class="muted">${esc(new Date(r.created_at * 1000).toISOString().slice(0, 19).replace("T", " "))}</td>
                  </tr>`,
                  )
                  .join("")}
                </tbody>
              </table>`
        }
      </section>
      <section>
        <h2>Register repository</h2>
        <form method="post" action="/repos">
          <div class="row">
            <div>
              <label for="full_name">Full name (owner/repo)</label>
              <input id="full_name" name="full_name" placeholder="acme/widgets" required pattern="[^/]+/[^/]+" />
            </div>
            <div>
              <label for="installation_id">Installation ID</label>
              <input id="installation_id" name="installation_id" type="number" required placeholder="12345678" />
            </div>
          </div>
          <p><button type="submit">Register</button></p>
        </form>
      </section>`;
    return layout("Repositories", body);
  })

  .get("/repos/:owner/:name", ({ params }) => {
    const full = fullName(params.owner, params.name);
    const repo = repos.get.get({ $full_name: full });
    if (!repo) return notFound(`Repository ${full} not found`);
    const revs = reviews.recent.all({ $limit: 999 }).filter((r) => r.repo_full_name === full);
    const body = `
      <p><a href="/">&larr; Repositories</a></p>
      <section>
        <h2><code>${esc(full)}</code></h2>
        <p class="muted">Installation ID: ${esc(repo.installation_id)}</p>
        <form method="post" action="/repos/${esc(params.owner)}/${esc(params.name)}">
          <label for="model">Model override <span class="muted">(provider/model, blank = global default)</span></label>
          <input id="model" name="model" value="${esc(repo.model ?? "")}" placeholder="${esc(config.review.defaultModel)}" />
          <label for="prompt">Review prompt override <span class="muted">(blank = global default)</span></label>
          <textarea id="prompt" name="prompt" rows="10" placeholder="Custom review instructions for this repo...">${esc(repo.prompt ?? "")}</textarea>
          <p>
            <button type="submit" name="_action" value="update">Save</button>
            <button type="submit" class="danger" name="_action" value="delete" formnovalidate>Delete repo</button>
          </p>
        </form>
      </section>
      <section>
        <h2>Recent reviews</h2>
        ${reviewTable(revs)}
      </section>`;
    return layout(`Repository ${full}`, body);
  })

  .post(
    "/repos",
    ({ body, set }) => {
      const { full_name, installation_id } = body;
      repos.upsert.run({
        $full_name: full_name,
        $installation_id: Number(installation_id),
        $prompt: null,
        $model: null,
      });
      set.status = 303;
      set.headers.location = `/repos/${full_name}`;
    },
    { body: t.Object({ full_name: t.String(), installation_id: t.String() }) },
  )

  .post(
    "/repos/:owner/:name",
    ({ params, body, set }) => {
      const full = fullName(params.owner, params.name);
      if (body._action === "delete") {
        repos.remove.run({ $full_name: full });
        set.status = 303;
        set.headers.location = "/";
        return;
      }
      repos.update.run({
        $full_name: full,
        $prompt: body.prompt?.trim() || null,
        $model: body.model?.trim() || null,
      });
      set.status = 303;
      set.headers.location = `/repos/${params.owner}/${params.name}`;
    },
    {
      body: t.Object({
        _action: t.Optional(t.String()),
        prompt: t.Optional(t.String()),
        model: t.Optional(t.String()),
      }),
    },
  )

  .get("/settings", () => {
    const currentKey = settings.get.get({ $key: SETTINGS.API_KEY })?.value;
    const model = settings.get.get({ $key: SETTINGS.MODEL })?.value;
    const prompt = settings.get.get({ $key: SETTINGS.PROMPT })?.value;
    const body = `
      <section>
        <h2>OpenCode provider</h2>
        <form method="post" action="/settings">
          <label for="opencode_api_key">OpenCode API key</label>
          <input id="opencode_api_key" name="opencode_api_key" type="password" placeholder="${esc(mask(currentKey ?? config.opencode.apiKey)) || "set key to enable reviews"}" />
          <p class="muted">Stored locally for this server. Leave blank to keep the current value${
            config.opencode.apiKey ? " (env OPENCODE_API_KEY is set as fallback)" : ""
          }.</p>
          <label for="opencode_model">Default model</label>
          <input id="opencode_model" name="opencode_model" value="${esc(model ?? "")}" placeholder="${esc(config.review.defaultModel)}" />
          <label for="default_prompt">Default review prompt</label>
          <textarea id="default_prompt" name="default_prompt" rows="10" placeholder="Reviewer instructions applied when a repo has no override...">${esc(prompt ?? "")}</textarea>
          <p><button type="submit">Save settings</button></p>
        </form>
      </section>`;
    return layout("Settings", body);
  })

  .post(
    "/settings",
    ({ body, set }) => {
      if (body.opencode_api_key?.trim()) {
        settings.set.run({ $key: SETTINGS.API_KEY, $value: body.opencode_api_key.trim() });
      }
      if (body.opencode_model !== undefined) {
        const v = body.opencode_model.trim();
        if (v) settings.set.run({ $key: SETTINGS.MODEL, $value: v });
        else clear(SETTINGS.MODEL);
      }
      if (body.default_prompt !== undefined) {
        const v = body.default_prompt.trim();
        if (v) settings.set.run({ $key: SETTINGS.PROMPT, $value: v });
        else clear(SETTINGS.PROMPT);
      }
      set.status = 303;
      set.headers.location = "/settings";
    },
    {
      body: t.Object({
        opencode_api_key: t.Optional(t.String()),
        opencode_model: t.Optional(t.String()),
        default_prompt: t.Optional(t.String()),
      }),
    },
  )

  .get("/reviews", () => {
    const list = reviews.recent.all({ $limit: 100 });
    const body = `
      <section>
        <h2>Recent reviews</h2>
        ${reviewTable(list)}
      </section>`;
    return layout("Reviews", body);
  });

function clear(key: string): void {
  settings.set.run({ $key: key, $value: "" });
}

function reviewTable(list: ReturnType<typeof reviews.recent.all>): string {
  if (list.length === 0) return `<p class="muted">No reviews yet.</p>`;
  return `<table>
    <thead><tr><th>#</th><th>Repository</th><th>PR</th><th>Status</th><th>Started</th></tr></thead>
    <tbody>
    ${list
      .map(
        (r) => `<tr>
        <td>${esc(r.id)}</td>
        <td><code>${esc(r.repo_full_name)}</code></td>
        <td>#${esc(r.pr_number)}</td>
        <td>${statusPill(r.status)}</td>
        <td class="muted">${esc(new Date(r.created_at * 1000).toISOString().slice(0, 19).replace("T", " "))}</td>
      </tr>`,
      )
      .join("")}
    </tbody>
  </table>`;
}

function notFound(msg: string): string {
  return layout("Not found", `<p>${esc(msg)}</p>`);
}
