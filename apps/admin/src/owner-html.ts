export interface OwnerPageData {
  readonly controlApi: string;
  readonly applications: readonly Record<string, unknown>[];
  readonly agents: readonly Record<string, unknown>[];
  readonly brief: Record<string, unknown> | null;
  readonly selfAudit: Record<string, unknown> | null;
  readonly error: string | null;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderOwnerHtml(data: OwnerPageData): string {
  const apps = data.applications
    .map((app) => {
      return `<article class="card">
        <h3>${esc(app["name"] ?? app["applicationId"])}</h3>
        <p class="muted">${esc(app["applicationId"])} · ${esc(app["environment"])} · ${esc(app["health"])}</p>
        <p>Agents: ${esc(Array.isArray(app["agentIds"]) ? app["agentIds"].length : 0)} · Findings: ${esc(app["findingCount"])} · Last: ${esc(app["lastEventType"] ?? "—")}</p>
      </article>`;
    })
    .join("");

  const agents = data.agents
    .map((agent) => {
      const denied = Array.isArray(agent["deniedCapabilities"])
        ? (agent["deniedCapabilities"] as string[]).join(", ")
        : "";
      const allowed = Array.isArray(agent["allowedCapabilities"])
        ? (agent["allowedCapabilities"] as string[]).join(", ")
        : "";
      return `<article class="card">
        <h3>${esc(agent["displayName"] ?? agent["agentId"])}</h3>
        <p class="muted">${esc(agent["agentId"])} · ${esc(agent["status"])}</p>
        <p><strong>Allowed:</strong> ${esc(allowed || "—")}</p>
        <p><strong>Denied:</strong> ${esc(denied || "—")}</p>
      </article>`;
    })
    .join("");

  const needs = Array.isArray(data.brief?.["requiresYourApproval"])
    ? (data.brief["requiresYourApproval"] as unknown[])
        .map((item) => `<li>${esc(item)}</li>`)
        .join("")
    : "<li>None</li>";

  const findings = Array.isArray(data.selfAudit?.["findings"])
    ? (data.selfAudit["findings"] as Array<Record<string, unknown>>)
        .map(
          (f) =>
            `<li><strong>${esc(f["severity"])}</strong> ${esc(f["title"])} — ${esc(f["recommendation"])}</li>`,
        )
        .join("")
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Atlas Owner Control Plane</title>
  <style>
    :root { --bg:#0f1117; --card:#1a1d27; --text:#e4e6f0; --muted:#8b8fa3; --accent:#6366f1; --danger:#ef4444; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--text); }
    header { padding:20px 24px; border-bottom:1px solid #2a2e3d; display:flex; justify-content:space-between; align-items:center; }
    h1 { font-size:18px; margin:0; }
    main { padding:24px; display:grid; gap:20px; }
    .grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .card { background:var(--card); border:1px solid #2a2e3d; border-radius:8px; padding:14px; }
    .muted { color:var(--muted); font-size:13px; }
    .error { color:var(--danger); }
    a { color:var(--accent); }
  </style>
</head>
<body>
  <header>
    <h1>Atlas Owner Control Plane</h1>
    <span class="muted">apps/admin · ${esc(data.controlApi)}</span>
  </header>
  <main>
    ${data.error ? `<p class="error">${esc(data.error)}</p>` : ""}
    <section>
      <h2>What requires your approval</h2>
      <ul>${needs}</ul>
    </section>
    <section>
      <h2>Registered applications</h2>
      <div class="grid">${apps || "<p class='muted'>No applications registered yet.</p>"}</div>
    </section>
    <section>
      <h2>Agent registry</h2>
      <div class="grid">${agents}</div>
    </section>
    <section>
      <h2>DEF-000 self-audit</h2>
      <ul>${findings}</ul>
      <p class="muted">Atlas detects and proposes. It cannot silently weaken auth, grant itself privilege, or delete audit.</p>
    </section>
  </main>
</body>
</html>`;
}
