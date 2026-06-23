export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  return strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? esc(values[i]) : ""),
    "",
  );
}

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} &middot; fouine</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0; padding: 2rem; max-width: 860px;
      color: #1f2328; background: #fff;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e6edf3; background: #0d1117; }
      a { color: #4493f8; }
      code, textarea, input { background: #161b22; color: #e6edf3; border-color: #30363d; }
    }
    h1, h2 { margin: 0 0 1rem; }
    h1 { font-size: 1.4rem; }
    nav { display: flex; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #d0d7de; }
    nav a { text-decoration: none; }
    section { margin-bottom: 2rem; }
    label { display: block; font-weight: 600; margin: 0.5rem 0 0.25rem; }
    input, textarea, select {
      width: 100%; padding: 0.5rem; font: inherit;
      border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa;
    }
    textarea { font-family: ui-monospace, SFMono-Regular, monospace; resize: vertical; }
    button {
      padding: 0.5rem 1rem; font: inherit; font-weight: 600; cursor: pointer;
      border: 1px solid #d0d7de; border-radius: 6px; background: #1f6feb; color: #fff; border: none;
    }
    button.secondary { background: #f6f8fa; color: #1f2328; border: 1px solid #d0d7de; }
    button.danger { background: #cf222e; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #d0d7de; }
    code { padding: 0.1rem 0.35rem; border-radius: 4px; background: #eff1f3; }
    .row { display: flex; gap: 1rem; align-items: flex-end; }
    .row > * { flex: 1; }
    .muted { color: #656d76; }
    .pill { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .pill.running { background: #ddf4ff; color: #0969da; }
    .pill.completed { background: #dafbe1; color: #1a7f37; }
    .pill.failed { background: #ffebe9; color: #cf222e; }
    .pill.pending { background: #fff8c5; color: #9a6700; }
  </style>
</head>
<body>
  <nav>
    <a href="/"><strong>fouine</strong></a>
    <a href="/settings">Settings</a>
    <a href="/reviews">Reviews</a>
  </nav>
  <h1>${esc(title)}</h1>
  ${body}
</body>
</html>`;
}

export function statusPill(status: string): string {
  return `<span class="pill ${esc(status)}">${esc(status)}</span>`;
}
