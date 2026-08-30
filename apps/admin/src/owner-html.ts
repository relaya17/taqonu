export interface OwnerPageData {
  readonly controlApi: string;
  readonly webOrigin?: string;
  readonly promoOnly?: boolean;
  readonly demoEmail?: string;
  readonly demoPassword?: string;
  readonly applications: readonly Record<string, unknown>[];
  readonly agents: readonly Record<string, unknown>[];
  readonly portfolioApps: readonly Record<string, unknown>[];
  readonly portfolioSourceAgents: readonly Record<string, unknown>[];
  readonly portfolioCapabilities: readonly Record<string, unknown>[];
  readonly portfolioEvidence: readonly Record<string, unknown>[];
  readonly portfolioDedup: readonly Record<string, unknown>[];
  readonly portfolioDecisions: readonly Record<string, unknown>[];
  readonly portfolioConflicts: readonly Record<string, unknown>[];
  readonly portfolioCanonicals: readonly Record<string, unknown>[];
  readonly brief: Record<string, unknown> | null;
  readonly selfAudit: Record<string, unknown> | null;
  readonly error: string | null;
}

const PROMO_VIDEO = "https://res.cloudinary.com/dora8sxcb/video/upload/v1787766615/hailuo-03_ATLAS_SEN_ATLAS_SENTINEL_Premium_Hero_Image_Generation_Specification_PURPOSE_Cre-0_1_opykbe.mp4";

const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.2A8.4 8.4 0 1 1 9.8 3 6.8 6.8 0 1 0 21 14.2z"/></svg>';
const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3.2v1.4M12 19.4v1.4M4.6 4.6l1 1M18.4 18.4l1 1M3.2 12h1.4M19.4 12h1.4M4.6 19.4l1-1M18.4 5.6l1-1"/></svg>';
const ICON_GLOBE =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6M12 3c2.4 2.6 3.7 5.6 3.7 9s-1.3 6.4-3.7 9c-2.4-2.6-3.7-5.6-3.7-9S9.6 5.6 12 3z"/></svg>';
const ICON_MENU =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 7.5h14M5 12h14M5 16.5h14"/></svg>';

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderOwnerHtml(data: OwnerPageData): string {
  const apps = data.applications
    .map((app) => {
      return `<article class="card glass">
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
      return `<article class="card glass" data-agent-id="${esc(agent["agentId"])}">
        <h3 class="agent-title">${esc(agent["displayName"] ?? agent["agentId"])}</h3>
        <p class="muted">${esc(agent["agentId"])} · ${esc(agent["status"])}</p>
        <p><strong data-i18n="labelAllowed">Allowed:</strong> ${esc(allowed || "—")}</p>
        <p><strong data-i18n="labelDenied">Denied:</strong> ${esc(denied || "—")}</p>
      </article>`;
    })
    .join("");

  const portfolioApps = data.portfolioApps
    .map((app) => {
      return `<article class="card glass">
        <h3>${esc(app["name"] ?? app["slug"])}</h3>
        <p class="muted">${esc(app["slug"])} · ${esc(app["role"])} · ${esc(String(app["sourceCommit"] ?? "").slice(0, 12))}</p>
        <p>${esc(app["notes"])}</p>
      </article>`;
    })
    .join("");

  const appsById = new Map(
    data.portfolioApps.map((app) => [String(app["id"] ?? ""), app]),
  );
  const portfolioSourceAgents = data.portfolioSourceAgents
    .map((sa) => {
      const app = appsById.get(String(sa["applicationId"] ?? ""));
      const runtime =
        sa["runtimeStatus"] && typeof sa["runtimeStatus"] === "object"
          ? (sa["runtimeStatus"] as Record<string, unknown>)
          : {};
      const provenance =
        sa["provenance"] && typeof sa["provenance"] === "object"
          ? (sa["provenance"] as Record<string, unknown>)
          : {};
      return `<article class="card glass">
        <h3>${esc(sa["displayName"] ?? sa["sourceKey"])}</h3>
        <p class="muted">${esc(sa["sourceKey"])} · ${esc(app?.["slug"] ?? "")} · ${esc(sa["implementationClass"])}</p>
        <p>Verification: ${esc(sa["verificationStatus"])} · Runtime: ${esc(runtime["state"] ?? "UNKNOWN")} / NOT_PROBED</p>
        <p class="muted">${esc(provenance["sourceRepository"])} @ ${esc(String(provenance["sourceCommit"] ?? "").slice(0, 12))}</p>
      </article>`;
    })
    .join("");

  const portfolioConflicts = data.portfolioConflicts
    .map((c) => `<li><strong>${esc(c["key"])}</strong> (${esc(c["status"])}) — ${esc(c["summary"])}</li>`)
    .join("");

  const canonById = new Map(
    data.portfolioCanonicals.map((c) => [String(c["id"] ?? ""), c]),
  );

  const portfolioCapabilities = data.portfolioCapabilities
    .map((cap) => {
      const canon = cap["canonicalCapabilityId"]
        ? canonById.get(String(cap["canonicalCapabilityId"]))
        : null;
      const canonLabel = canon ? String(canon["key"] ?? "-") : "—";
      return `<article class="card glass">
        <h3>${esc(cap["name"])}</h3>
        <p class="muted">${esc(cap["domain"])} · Canonical: ${esc(canonLabel)}</p>
        <p>${esc(String(cap["purpose"] ?? "").slice(0, 100))}</p>
      </article>`;
    })
    .join("");

  const portfolioDedup = data.portfolioDedup
    .slice(0, 20)
    .map((d) => {
      const kind = String(d["kind"] ?? "UNKNOWN");
      return `<li><strong>${esc(kind)}</strong> — ${esc(String(d["notes"] ?? "").slice(0, 80))}</li>`;
    })
    .join("");

  const portfolioDecisions = data.portfolioDecisions
    .map((dec) => {
      const action = String(dec["action"] ?? "UNKNOWN");
      const status = String(dec["status"] ?? "UNKNOWN");
      const rationale = String(dec["rationale"] ?? "").slice(0, 80);
      return `<li><strong>${esc(action)}</strong> (${esc(status)}) — ${esc(rationale)}</li>`;
    })
    .join("");

  const portfolioEvidence = data.portfolioEvidence
    .slice(0, 15)
    .map((ev) => {
      const kind = String(ev["kind"] ?? "UNKNOWN");
      const authority = String(ev["authorityRank"] ?? "");
      const path = String(ev["path"] ?? "").slice(0, 60);
      return `<li><strong>${esc(kind)}</strong> (${esc(authority)}) — ${esc(path)}</li>`;
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
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Atlas Owner Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0c0e14;
      --bg-solid: #0c0e14;
      --surface: rgba(36,42,54,0.5);
      --surface-glass: rgba(30,36,48,0.35);
      --text: #f0f2f5;
      --text-secondary: #c8cdd6;
      --muted: #8b90a0;
      --accent: #7a9cc6;
      --accent-fill: #3d5a7a;
      --teal: #4ade9a;
      --teal-fill: #0f7a52;
      --on-fill: #ffffff;
      --danger: #f87171;
      --border: rgba(200,208,220,0.12);
      --glow: rgba(122,156,198,0.25);
      --font: 'Inter', system-ui, sans-serif;
      --overlay-dark: rgba(12,14,20,0.6);
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --bg-solid: #f8fafc;
      --surface: rgba(255,255,255,0.7);
      --surface-glass: rgba(255,255,255,0.45);
      --text: #1a1d24;
      --text-secondary: #4a5568;
      --muted: #4a5568;
      --accent: #2c5282;
      --border: rgba(0,0,0,0.1);
      --glow: rgba(122,156,198,0.3);
      --overlay-dark: rgba(0,0,0,0.3);
    }

    body {
      font-family: var(--font);
      background: var(--bg-solid);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
      transition: background 0.3s, color 0.3s;
    }

    /* ── Nav ───────────────────────────────────────── */
    nav {
      position: fixed;
      top: 0;
      inset-inline: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      min-height: 48px;
      background: rgba(12,14,20,0.72);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
    }

    .nav-end {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .icon-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: rgba(36,42,54,0.35);
      color: var(--text-secondary);
      width: 30px;
      height: 30px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .icon-btn:hover {
      background: rgba(80,90,110,0.28);
      color: var(--text);
      border-color: rgba(200,208,220,0.22);
    }
    .icon-btn svg { display: block; }

    .hamburger {
      appearance: none;
      border: 1px solid var(--border);
      background: rgba(36,42,54,0.35);
      color: var(--text-secondary);
      width: 30px;
      height: 30px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .hamburger:hover { background: rgba(80,90,110,0.28); color: var(--text); }

    .mobile-menu {
      display: none;
      position: fixed;
      top: 48px;
      inset-inline: 0;
      background: var(--surface-glass);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
      padding: 12px 16px;
      flex-direction: column;
      gap: 4px;
      z-index: 99;
    }
    .mobile-menu.open { display: flex; }
    .mobile-menu a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }
    .mobile-menu a:hover { color: var(--text); }

    .nav-brand {
      display: flex;
      flex-direction: column;
      gap: 0;
      text-decoration: none;
      color: var(--text);
      min-width: 0;
      line-height: 1.15;
    }

    .nav-brand .app-name {
      font-size: 13px;
      font-weight: 650;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .nav-brand .logo-icon {
      width: 18px;
      height: 18px;
      background: rgba(122,156,198,0.18);
      border: 1px solid rgba(200,208,220,0.14);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .nav-brand .logo-icon svg {
      width: 10px;
      height: 10px;
      fill: var(--text-secondary);
    }

    .nav-brand .app-subtitle {
      font-size: 8px;
      font-weight: 500;
      color: var(--muted);
      letter-spacing: 0.04em;
      padding-inline-start: 24px;
    }


    .lang-wrap { position: relative; }

    .lang-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      inset-inline-end: 0;
      margin-top: 4px;
      background: rgba(24,28,38,0.96);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px;
      min-width: 108px;
      z-index: 110;
    }
    .lang-dropdown.open { display: block; }
    .lang-dropdown button {
      display: block;
      width: 100%;
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--text-secondary);
      font: 500 12px/1.2 var(--font);
      padding: 7px 10px;
      border-radius: 5px;
      cursor: pointer;
      text-align: start;
    }
    .lang-dropdown button:hover { background: rgba(80,90,110,0.28); color: var(--text); }
    .lang-dropdown button[aria-current="true"] { background: rgba(122,156,198,0.16); color: var(--text); font-weight: 600; }

    /* ── Video Background (Full Page) ──────────────── */
    .video-bg {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: -2;
      overflow: hidden;
    }

    .video-bg video {
      position: absolute;
      top: 50%;
      left: 50%;
      min-width: 100%;
      min-height: 100%;
      width: auto;
      height: auto;
      transform: translate(-50%, -50%);
      object-fit: cover;
    }

    .video-overlay {
      position: fixed;
      inset: 0;
      background: linear-gradient(180deg, var(--overlay-dark) 0%, rgba(12,14,20,0.65) 50%, rgba(12,14,20,0.85) 100%);
      z-index: -1;
      transition: background 0.3s;
    }

    [data-theme="light"] .video-overlay {
      background: linear-gradient(180deg, rgba(248,250,252,0.5) 0%, rgba(248,250,252,0.7) 50%, rgba(248,250,252,0.9) 100%);
    }

    /* ── Hero ──────────────────────────────────────── */
    .hero {
      position: relative;
      min-height: 55vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding-top: 56px;
      background: transparent !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      border: none !important;
    }

    .hero-content {
      position: relative;
      z-index: 2;
      text-align: center;
      padding: 40px 20px;
      max-width: 700px;
      background: transparent;
    }

    .hero-eyebrow {
      display: inline-block;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 10px;
      color: var(--teal);
      background: rgba(74,222,154,0.12);
      padding: 4px 12px;
      border-radius: 12px;
      margin-bottom: 16px;
    }

    .hero h1 {
      font-size: clamp(32px, 6vw, 56px);
      font-weight: 700;
      line-height: 1.15;
      margin-bottom: 10px;
      text-shadow: 0 2px 20px rgba(0,0,0,0.5);
    }

    .hero-title-main {
      display: inline-block;
      font-size: 1em;
    }

    .hero-title-sub {
      display: inline-block;
      font-size: 0.55em;
      font-weight: 500;
      color: var(--text-secondary);
      letter-spacing: 0.03em;
    }

    .hero h1 .gradient {
      background: linear-gradient(135deg, var(--accent), var(--teal));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-subtitle {
      font-size: 15px;
      color: var(--text-secondary);
      max-width: 480px;
      margin: 0 auto 24px;
      text-shadow: 0 2px 12px rgba(0,0,0,0.4);
    }

    .hero-cta {
      display: flex;
      gap: 12px;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
      width: 100%;
    }

    .hero-btn {
      padding: 10px 24px;
      border-radius: 8px;
      font: 600 14px/1.2 var(--font);
      text-decoration: none;
      transition: all 0.2s;
    }

    .hero-btn.primary {
      background: linear-gradient(135deg, var(--accent-fill), var(--teal-fill));
      color: var(--on-fill);
    }
    .hero-btn.primary:hover { box-shadow: 0 4px 20px var(--glow); transform: translateY(-2px); }

    .hero-btn.secondary {
      background: rgba(255,255,255,0.06);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .hero-btn.secondary:hover { background: rgba(255,255,255,0.1); }

    /* ── Main Content ──────────────────────────────── */
    main {
      position: relative;
      padding: 40px 20px 60px;
      max-width: 900px;
      margin-inline: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    section {
      width: 100%;
      margin-bottom: 24px;
      background: var(--surface-glass);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      text-align: center;
      transition: background 0.3s, border-color 0.3s;
    }

    section.hero {
      background: transparent;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      border: none;
      border-radius: 0;
      margin-bottom: 0;
    }

    section .grid {
      text-align: center;
    }

    h2 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--text);
      text-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }

    .grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
      width: 100%;
      justify-items: center;
    }

    .card {
      padding: 16px;
      border-radius: 10px;
      width: 100%;
      max-width: 340px;
    }

    .card.glass {
      background: var(--surface-glass);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      transition: all 0.25s;
      text-align: center;
    }

    [dir="rtl"] .card.glass .muted,
    [dir="rtl"] .card.glass p {
      direction: ltr;
      text-align: center;
      unicode-bidi: isolate;
    }

    .card.glass:hover {
      background: var(--surface);
      border-color: rgba(122,156,198,0.3);
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(0,0,0,0.25);
    }

    /* ── Theme Toggle ─────────────────────────────── */
    .theme-btn { /* alias kept for JS */ }

    .card h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .card p {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    .muted { color: var(--muted); }
    .error { color: var(--danger); }
    a { color: var(--accent); }

    .plane-stack { margin: 12px 0 20px; max-width: 720px; }
    .plane-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      background: var(--surface-glass);
      margin-bottom: 4px;
    }
    .plane-card.plane-fabric { border-inline-start: 4px solid var(--accent); }
    .plane-card.plane-apps { border-inline-start: 4px solid #60a5fa; }
    .plane-card.plane-source { border-inline-start: 4px solid #fbbf24; }
    .plane-title { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .plane-note { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .plane-neq { text-align: center; font-weight: 800; letter-spacing: 0.35em; color: var(--muted); padding: 4px 0; }

    ul {
      padding-inline-start: 20px;
      font-size: 13px;
      color: var(--text-secondary);
      text-align: start;
      max-width: 800px;
      margin-inline: auto;
    }

    li { margin-bottom: 8px; }

    /* ── Auth Modal ────────────────────────────────── */
    .auth-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(6px);
      z-index: 200;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .auth-overlay.open { display: flex; }

    .auth-modal {
      background: rgba(28,32,44,0.95);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px;
      max-width: 360px;
      width: 100%;
      text-align: center;
    }

    .auth-modal-close {
      position: absolute;
      top: 10px;
      inset-inline-end: 10px;
      background: transparent;
      border: 0;
      color: var(--muted);
      font-size: 18px;
      cursor: pointer;
      width: 28px;
      height: 28px;
      border-radius: 4px;
    }
    .auth-modal-close:hover { background: rgba(80,90,110,0.3); color: var(--text); }

    .auth-modal h3 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .auth-sub {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 20px;
    }

    .auth-dev-note {
      background: rgba(74,222,154,0.1);
      border: 1px solid rgba(74,222,154,0.2);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 16px;
      font-size: 11px;
      color: var(--teal);
    }

    .form-group {
      margin-bottom: 12px;
    }

    .form-group label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }

    .form-group input {
      width: 100%;
      padding: 10px 12px;
      background: rgba(36,42,54,0.6);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font: 13px var(--font);
      outline: none;
    }

    .form-group input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--glow);
    }

    .btn-auth-submit {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, var(--accent-fill), var(--teal-fill));
      color: var(--on-fill);
      border: none;
      border-radius: 8px;
      font: 600 14px var(--font);
      cursor: pointer;
      margin-top: 6px;
    }
    .btn-auth-submit:hover { box-shadow: 0 4px 16px var(--glow); }
    .btn-auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }

    .auth-msg {
      text-align: center;
      margin-top: 10px;
      font-size: 12px;
      color: var(--muted);
    }

    .auth-switch {
      text-align: center;
      margin-top: 12px;
      font-size: 12px;
      color: var(--muted);
    }

    .auth-switch a {
      color: var(--accent);
      cursor: pointer;
      text-decoration: none;
    }

    @media (max-width: 600px) {
      nav { padding: 6px 10px; }
      .nav-brand .app-name { font-size: 11.5px; gap: 5px; }
      .nav-brand .app-subtitle { font-size: 7.5px; padding-inline-start: 23px; }
      .nav-brand .logo-icon { width: 16px; height: 16px; }
      .hero { min-height: 48vh; padding-top: 48px; }
      .hero h1 { font-size: 24px; }
      .hero-content { padding: 24px 14px; }
      .hero-cta { flex-direction: column; align-items: stretch; }
      .hero-btn { text-align: center; }
      main { padding: 20px 12px 40px; }
      section { padding: 18px 14px; }
      .footer-links { gap: 12px 16px; }
    }

    /* ── Footer ───────────────────────────────────── */
    footer {
      position: relative;
      padding: 40px 24px 32px;
      text-align: center;
      border-top: 1px solid var(--border);
      background: var(--surface-glass);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      margin-top: 40px;
    }

    .footer-inner {
      max-width: 900px;
      margin-inline: auto;
    }

    .footer-links {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 24px;
      margin-bottom: 20px;
      list-style: none;
    }

    .footer-links a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: color 0.2s;
    }
    .footer-links a:hover { color: var(--accent); }

    .footer-brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .footer-brand .logo-mini {
      width: 20px;
      height: 20px;
      background: linear-gradient(135deg, var(--accent), var(--teal));
      border-radius: 4px;
    }

    .footer-brand span {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }

    .footer-copy {
      font-size: 12px;
      color: var(--muted);
    }

    .footer-a11y {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }

    .footer-a11y p {
      font-size: 11px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <!-- Nav -->
  <nav>
    <a href="/" class="nav-brand">
      <span class="app-name">
        <span class="logo-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </span>
        Atlas Owner Admin
      </span>
      <span class="app-subtitle">Atlas Sentinel</span>
    </a>

    <div class="nav-end">
      <button class="icon-btn" id="themeBtn" aria-label="Toggle theme">${ICON_MOON}</button>
      <div class="lang-wrap">
        <button class="icon-btn" id="langBtn" aria-label="Language">${ICON_GLOBE}</button>
        <div class="lang-dropdown" id="langDropdown">
          <button type="button" data-lang="he" lang="he" dir="rtl">עברית</button>
          <button type="button" data-lang="en" lang="en" dir="ltr">English</button>
          <button type="button" data-lang="ar" lang="ar" dir="rtl">العربية</button>
        </div>
      </div>
      <button class="hamburger" id="hamburgerBtn" aria-label="Menu">${ICON_MENU}</button>
    </div>
  </nav>

  <!-- Mobile Menu -->
  <div class="mobile-menu" id="mobileMenu">
    <a href="/login" id="mobileLoginBtn" data-i18n="btnLogin">Login</a>
    <a href="${(data.webOrigin ?? "http://localhost:3000").replace(/\/$/, "")}/he/auth/register" id="mobileRegisterBtn" data-i18n="btnRegister">Register</a>
    <a href="http://127.0.0.1:3100/dashboard" data-i18n="navDashboard">Dashboard</a>
  </div>

  <!-- Full Page Video Background -->
  <div class="video-bg">
    <video autoplay muted loop playsinline preload="metadata" poster="">
      <source src="${PROMO_VIDEO}" type="video/mp4">
    </video>
  </div>
  <div class="video-overlay"></div>

  <!-- Hero -->
  <section class="hero">
    <div class="hero-content">
      <h1>
        <span class="gradient hero-title-main" data-i18n="heroTitle1">Atlas Admin</span><br>
        <span class="hero-title-sub" data-i18n="heroTitle2">Governance & Oversight</span>
      </h1>
      <div class="hero-eyebrow" data-i18n="heroEyebrow">Owner Control Panel</div>
      <p class="hero-subtitle" data-i18n="heroSubtitle">
        Complete control over AI agents, policies, and audit trails.
        Enterprise-grade security for your AI operations.
      </p>
      <div class="hero-cta">
        <a href="/login" class="hero-btn primary" id="heroRegisterBtn" data-i18n="ctaGetStarted">Get Started</a>
        <a href="http://127.0.0.1:3100/dashboard" class="hero-btn secondary" id="linkDashboard" data-i18n="navDashboard">Dashboard</a>
      </div>
    </div>
  </section>

  ${data.promoOnly ? "" : `<!-- Private owner content -->
  <main>
    ${data.error ? `<p class="error">${esc(data.error)}</p>` : ""}
    <section>
      <h2 data-i18n="sectionApprovals">What requires your approval</h2>
      <ul>${needs}</ul>
    </section>
    <section>
      <h2 data-i18n="sectionApps">Registered applications</h2>
      <div class="grid">${apps || "<p class='muted'>No applications registered yet.</p>"}</div>
    </section>
    <section>
      <h2 data-i18n="sectionPortfolio">Portfolio governance (observability)</h2>
      <p class="muted" data-i18n="portfolioNote">Inspect sibling applications without duplicating them. Fabric remains the only Atlas execution registry. Source runtimes are UNKNOWN / NOT_PROBED.</p>
      <div class="plane-stack">
        <div class="plane-card plane-fabric">
          <div class="plane-title" data-i18n="planeFabric">Atlas Fabric agents</div>
          <p class="plane-note" data-i18n="planeFabricNote">FABRIC_AGENT_CATALOG only. Not source agents.</p>
        </div>
        <div class="plane-neq" data-i18n="planeNeq">≠</div>
        <div class="plane-card plane-apps">
          <div class="plane-title" data-i18n="planeSourceApps">Source applications</div>
          <p class="plane-note" data-i18n="planeSourceAppsNote">Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy, Civio. Not Fabric.</p>
        </div>
        <div class="plane-neq" data-i18n="planeNeq">≠</div>
        <div class="plane-card plane-source">
          <div class="plane-title" data-i18n="planeSourceAgents">Source agents</div>
          <p class="plane-note" data-i18n="planeSourceAgentsNote">Never assigned a FabricAgentId. Not Atlas agents.</p>
        </div>
      </div>
      <h3 data-i18n="portfolioApps">Applications</h3>
      <div class="grid">${portfolioApps || "<p class='muted'>No portfolio snapshot.</p>"}</div>
      <h3 data-i18n="portfolioSourceAgents">Source agents</h3>
      <div class="grid">${portfolioSourceAgents || "<p class='muted'>No source agents.</p>"}</div>
      <h3 data-i18n="portfolioCapabilities">Capabilities (${data.portfolioCapabilities.length})</h3>
      <div class="grid">${portfolioCapabilities || "<p class='muted'>No capabilities.</p>"}</div>
      <h3 data-i18n="portfolioDedup">Deduplication Relations (${data.portfolioDedup.length})</h3>
      ${portfolioDedup ? `<ul class="muted">${portfolioDedup}</ul>` : "<p class='muted'>No dedup relations.</p>"}
      <h3 data-i18n="portfolioEvidence">Evidence (${data.portfolioEvidence.length})</h3>
      ${portfolioEvidence ? `<ul class="muted">${portfolioEvidence}</ul>` : "<p class='muted'>No evidence.</p>"}
      <h3 data-i18n="portfolioDecisions">Governance Decisions (${data.portfolioDecisions.length})</h3>
      ${portfolioDecisions ? `<ul class="muted">${portfolioDecisions}</ul>` : "<p class='muted'>No governance decisions.</p>"}
      <h3 data-i18n="portfolioConflicts">Conflicts (${data.portfolioConflicts.length})</h3>
      ${portfolioConflicts ? `<ul class="muted">${portfolioConflicts}</ul>` : "<p class='muted'>No conflicts.</p>"}
    </section>
    <section>
      <h2 data-i18n="sectionAgents">Agent registry</h2>
      <div class="grid">${agents}</div>
    </section>
    <section>
      <h2 data-i18n="sectionAudit">DEF-000 self-audit</h2>
      <ul>${findings}</ul>
      <p class="muted" data-i18n="auditNote">Atlas detects and proposes. It cannot silently weaken auth, grant itself privilege, or delete audit.</p>
    </section>
  </main>`}

  <!-- Footer -->
  <footer>
    <div class="footer-inner">
      <ul class="footer-links">
        <li><a href="#about" data-i18n="footerAbout">About</a></li>
        <li><a href="#settings" data-i18n="footerSettings">Settings</a></li>
        <li><a href="#privacy" data-i18n="footerPrivacy">Privacy</a></li>
        <li><a href="#terms" data-i18n="footerTerms">Terms</a></li>
        <li><a href="#contact" data-i18n="footerContact">Contact</a></li>
        <li><a id="linkAtlas" href="http://localhost:3000/he/welcome" data-i18n="navAtlas">Atlas</a></li>
        <li><a id="linkSentinel" href="http://127.0.0.1:3100" data-i18n="navDashboard">Dashboard</a></li>
      </ul>
      <div class="footer-brand">
        <div class="logo-mini"></div>
        <span>Atlas Sentinel</span>
      </div>
      <p class="footer-copy" data-i18n="footerCopy">© 2026 Atlas Control Plane. All rights reserved.</p>
      <div class="footer-a11y">
        <p data-i18n="footerA11y">We are committed to accessibility. Keyboard navigation, screen reader support, and WCAG 2.1 AA compliance.</p>
      </div>
    </div>
  </footer>

  <!-- Auth Modal -->
  <div class="auth-overlay" id="authOverlay">
    <div class="auth-modal" style="position:relative;">
      <button class="auth-modal-close" id="authClose">&times;</button>
      <h3 id="authTitle" data-i18n="btnLogin">Login</h3>
      <p class="auth-sub" id="authSubtitle" data-i18n="authSubtitleLogin">Sign in to your account</p>
      ${data.demoEmail && data.demoPassword ? `<div class="auth-dev-note">${esc(data.demoEmail)} · ${esc(data.demoPassword)}</div>` : ""}
      <form id="authForm">
        <div class="form-group" id="displayNameGroup" style="display:none;">
          <label for="displayName" data-i18n="labelDisplayName">Display Name</label>
          <input type="text" id="displayName" value="Atlas Dev">
        </div>
        <div class="form-group">
          <label for="email" data-i18n="labelEmail">Email</label>
          <input type="email" id="email" value="${esc(data.demoEmail)}" required>
        </div>
        <div class="form-group">
          <label for="password" data-i18n="labelPassword">Password</label>
          <input type="password" id="password" value="${esc(data.demoPassword)}" minlength="8" required>
        </div>
        <button type="submit" class="btn-auth-submit" id="authSubmitBtn" data-i18n="btnLogin">Login</button>
      </form>
      <p class="auth-msg" id="authMsg"></p>
      <p class="auth-switch" id="authSwitch">
        <span data-i18n="authNoAccount">Don't have an account?</span>
        <a id="authSwitchLink" data-i18n="btnRegister">Register</a>
      </p>
    </div>
  </div>

  <script>
    var TRANSLATIONS = {
      he: {
        heroEyebrow: "לוח בקרה לבעלים",
        heroTitle1: "Atlas Admin",
        heroTitle2: "ממשל ופיקוח",
        heroSubtitle: "שליטה מלאה על סוכני AI, מדיניות ומסלולי ביקורת. אבטחה ברמת ארגון לפעולות ה-AI שלך.",
        ctaGetStarted: "התחל עכשיו",
        navDashboard: "לוח בקרה",
        navAtlas: "Atlas",
        btnLogin: "התחברות",
        btnRegister: "הרשמה",
        authSubtitleLogin: "התחבר לחשבון שלך",
        authSubtitleRegister: "צור חשבון חדש",
        authNoAccount: "אין לך חשבון?",
        authHaveAccount: "יש לך חשבון?",
        labelDisplayName: "שם תצוגה",
        labelEmail: "אימייל",
        labelPassword: "סיסמה",
        sectionApprovals: "מה דורש את האישור שלך",
        sectionApps: "אפליקציות רשומות",
        sectionPortfolio: "ממשל תיק יישומים (תצפית)",
        portfolioNote: "בדיקת אפליקציות אחיות בלי לשכפל אותן. Fabric הוא רישום הביצוע היחיד. זמן ריצה של מקורות: UNKNOWN / NOT_PROBED.",
        planeFabric: "סוכני Atlas Fabric",
        planeFabricNote: "FABRIC_AGENT_CATALOG בלבד. לא סוכני מקור.",
        planeNeq: "≠",
        planeSourceApps: "יישומי מקור",
        planeSourceAppsNote: "Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy, Civio. לא Fabric.",
        planeSourceAgents: "סוכני מקור",
        planeSourceAgentsNote: "לא מקבלים FabricAgentId. לא סוכני Atlas.",
        portfolioApps: "יישומים",
        portfolioSourceAgents: "סוכני מקור",
        sectionAgents: "רישום סוכנים",
        sectionAudit: "ביקורת עצמית DEF-000",
        auditNote: "Atlas מזהה ומציע. היא לא יכולה להחליש אימות בשקט, להעניק לעצמה הרשאות או למחוק ביקורת.",
        msgLoggingIn: "מתחבר...",
        msgRegistering: "נרשם...",
        msgSuccess: "הצלחה",
        msgError: "שגיאה",
        msgUserExists: "משתמש כבר קיים",
        msgInvalidCredentials: "פרטים שגויים",
        labelAllowed: "מותרים",
        labelDenied: "אסורים",
        footerAbout: "אודות",
        footerSettings: "הגדרות",
        footerPrivacy: "פרטיות",
        footerTerms: "תנאים",
        footerContact: "צור קשר",
        footerCopy: "© 2026 Atlas Control Plane. כל הזכויות שמורות.",
        footerA11y: "אנו מחויבים לנגישות. ניווט מקלדת, תמיכה בקוראי מסך, ותאימות WCAG 2.1 AA."
      },
      en: {
        heroEyebrow: "Owner Control Panel",
        heroTitle1: "Atlas Admin",
        heroTitle2: "Governance & Oversight",
        heroSubtitle: "Complete control over AI agents, policies, and audit trails. Enterprise-grade security for your AI operations.",
        ctaGetStarted: "Get Started",
        navDashboard: "Dashboard",
        navAtlas: "Atlas",
        btnLogin: "Login",
        btnRegister: "Register",
        authSubtitleLogin: "Sign in to your account",
        authSubtitleRegister: "Create a new account",
        authNoAccount: "Don't have an account?",
        authHaveAccount: "Already have an account?",
        labelDisplayName: "Display Name",
        labelEmail: "Email",
        labelPassword: "Password",
        sectionApprovals: "What requires your approval",
        sectionApps: "Registered applications",
        sectionPortfolio: "Portfolio governance (observability)",
        portfolioNote: "Inspect sibling applications without duplicating them. Fabric remains the only Atlas execution registry. Source runtimes are UNKNOWN / NOT_PROBED.",
        planeFabric: "Atlas Fabric agents",
        planeFabricNote: "FABRIC_AGENT_CATALOG only. Not source agents.",
        planeNeq: "≠",
        planeSourceApps: "Source applications",
        planeSourceAppsNote: "Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy, Civio. Not Fabric.",
        planeSourceAgents: "Source agents",
        planeSourceAgentsNote: "Never assigned a FabricAgentId. Not Atlas agents.",
        portfolioApps: "Applications",
        portfolioSourceAgents: "Source agents",
        sectionAgents: "Agent registry",
        sectionAudit: "DEF-000 self-audit",
        auditNote: "Atlas detects and proposes. It cannot silently weaken auth, grant itself privilege, or delete audit.",
        msgLoggingIn: "Logging in...",
        msgRegistering: "Registering...",
        msgSuccess: "Success",
        msgError: "Error",
        msgUserExists: "User already exists",
        msgInvalidCredentials: "Invalid credentials",
        labelAllowed: "Allowed",
        labelDenied: "Denied",
        footerAbout: "About",
        footerSettings: "Settings",
        footerPrivacy: "Privacy",
        footerTerms: "Terms",
        footerContact: "Contact",
        footerCopy: "© 2026 Atlas Control Plane. All rights reserved.",
        footerA11y: "We are committed to accessibility. Keyboard navigation, screen reader support, and WCAG 2.1 AA compliance."
      },
      ar: {
        heroEyebrow: "لوحة تحكم المالك",
        heroTitle1: "Atlas Admin",
        heroTitle2: "الحوكمة والرقابة",
        heroSubtitle: "تحكم كامل في وكلاء الذكاء الاصطناعي والسياسات ومسارات التدقيق. أمان على مستوى المؤسسات لعمليات الذكاء الاصطناعي الخاصة بك.",
        ctaGetStarted: "ابدأ الآن",
        navDashboard: "لوحة التحكم",
        navAtlas: "Atlas",
        btnLogin: "تسجيل الدخول",
        btnRegister: "التسجيل",
        authSubtitleLogin: "سجل الدخول إلى حسابك",
        authSubtitleRegister: "إنشاء حساب جديد",
        authNoAccount: "ليس لديك حساب؟",
        authHaveAccount: "لديك حساب بالفعل؟",
        labelDisplayName: "اسم العرض",
        labelEmail: "البريد الإلكتروني",
        labelPassword: "كلمة المرور",
        sectionApprovals: "ما يتطلب موافقتك",
        sectionApps: "التطبيقات المسجلة",
        sectionPortfolio: "حوكمة المحفظة (رصد)",
        portfolioNote: "افحص التطبيقات الشقيقة دون تكرارها. Fabric هو سجل التنفيذ الوحيد. حالة تشغيل المصادر UNKNOWN / NOT_PROBED.",
        planeFabric: "وكلاء Atlas Fabric",
        planeFabricNote: "FABRIC_AGENT_CATALOG فقط. ليسوا وكلاء مصدر.",
        planeNeq: "≠",
        planeSourceApps: "تطبيقات المصدر",
        planeSourceAppsNote: "Vantera و HotelOS و CaseFlow و BrokerOS و LexStudy. ليست Fabric.",
        planeSourceAgents: "وكلاء المصدر",
        planeSourceAgentsNote: "لا يُمنحون FabricAgentId. ليسوا وكلاء Atlas.",
        portfolioApps: "التطبيقات",
        portfolioSourceAgents: "وكلاء المصدر",
        sectionAgents: "سجل الوكلاء",
        sectionAudit: "التدقيق الذاتي DEF-000",
        auditNote: "Atlas يكتشف ويقترح. لا يمكنه إضعاف المصادقة بصمت أو منح نفسه امتيازات أو حذف التدقيق.",
        msgLoggingIn: "جاري تسجيل الدخول...",
        msgRegistering: "جاري التسجيل...",
        msgSuccess: "نجاح",
        msgError: "خطأ",
        msgUserExists: "المستخدم موجود بالفعل",
        msgInvalidCredentials: "بيانات غير صالحة",
        labelAllowed: "مسموح",
        labelDenied: "ممنوع",
        footerAbout: "حول",
        footerSettings: "الإعدادات",
        footerPrivacy: "الخصوصية",
        footerTerms: "الشروط",
        footerContact: "اتصل بنا",
        footerCopy: "© 2026 Atlas Control Plane. جميع الحقوق محفوظة.",
        footerA11y: "نحن ملتزمون بإمكانية الوصول. التنقل بلوحة المفاتيح، دعم قارئات الشاشة، والتوافق مع WCAG 2.1 AA."
      }
    };

    var currentLang = "he";

    function t(key) {
      return TRANSLATIONS[currentLang][key] || TRANSLATIONS.en[key] || key;
    }

    function applyTranslations() {
      document.querySelectorAll("[data-i18n]").forEach(function(el) {
        var key = el.getAttribute("data-i18n");
        if (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) {
          el.textContent = TRANSLATIONS[currentLang][key];
        }
      });

      // Localize known agent titles per language
      var nameMapByLang = {
        he: {
          "CODE_ENGINEER": "מהנדס קוד",
          "RESEARCH_ANALYST": "אנליסט מחקר",
          "ARCHITECT": "ארכיטקט",
          "GUARDRAIL": "Guardrail",
          "SENTINEL": "Sentinel"
        },
        ar: {
          "CODE_ENGINEER": "مهندس كود",
          "RESEARCH_ANALYST": "محلل أبحاث",
          "ARCHITECT": "مهندس معماري",
          "GUARDRAIL": "Guardrail",
          "SENTINEL": "Sentinel"
        }
      };

      var map = nameMapByLang[currentLang] || null;
      if (map) {
        document.querySelectorAll(".card.glass[data-agent-id]").forEach(function(card) {
          var id = card.getAttribute("data-agent-id");
          var title = card.querySelector(".agent-title");
          if (id && title && map[id]) {
            title.textContent = map[id];
          }
        });
      }
    }

    function atlasApi() {
      var host = location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
      return "http://" + host + ":4000";
    }

    function atlasWeb() { return ${JSON.stringify((data.webOrigin ?? "http://localhost:3000").replace(/\/$/, ""))}; }

    function sentinel() { return ${JSON.stringify(data.controlApi.replace(/\/$/, ""))}; }

    (function bindSurfaceLinks() {
      var atlas = document.getElementById("linkAtlas");
      var dash = document.getElementById("linkSentinel");
      var dashBtn = document.getElementById("linkDashboard");
      var mobileDash = document.querySelector("#mobileMenu a[data-i18n='navDashboard']");
      if (atlas) atlas.setAttribute("href", atlasWeb() + "/he/welcome");
      if (dash) dash.setAttribute("href", sentinel() + "/dashboard");
      if (dashBtn) dashBtn.setAttribute("href", sentinel() + "/dashboard");
      if (mobileDash) mobileDash.setAttribute("href", sentinel() + "/dashboard");
    })();

    var authMode = "login";
    var authOverlay = document.getElementById("authOverlay");
    var authTitle = document.getElementById("authTitle");
    var authSubtitle = document.getElementById("authSubtitle");
    var authSubmitBtn = document.getElementById("authSubmitBtn");
    var authSwitchLink = document.getElementById("authSwitchLink");
    var displayNameGroup = document.getElementById("displayNameGroup");

    function openAuthModal(mode) {
      authMode = mode;
      updateAuthModal();
      authOverlay.classList.add("open");
      document.body.style.overflow = "hidden";
    }

    function closeAuthModal() {
      authOverlay.classList.remove("open");
      document.body.style.overflow = "";
      document.getElementById("authMsg").textContent = "";
    }

    function updateAuthModal() {
      if (authMode === "login") {
        authTitle.textContent = t("btnLogin");
        authSubtitle.textContent = t("authSubtitleLogin");
        authSubmitBtn.textContent = t("btnLogin");
        displayNameGroup.style.display = "none";
      } else {
        authTitle.textContent = t("btnRegister");
        authSubtitle.textContent = t("authSubtitleRegister");
        authSubmitBtn.textContent = t("btnRegister");
        displayNameGroup.style.display = "block";
      }
    }

    function submitAuth(e) {
      e.preventDefault();
      var email = document.getElementById("email").value;
      var password = document.getElementById("password").value;
      var displayName = document.getElementById("displayName").value;
      var msg = document.getElementById("authMsg");
      authSubmitBtn.disabled = true;
      msg.textContent = authMode === "register" ? t("msgRegistering") : t("msgLoggingIn");
      var path = authMode === "register" ? "/api/v1/auth/register" : "/api/v1/auth/login";
      var body = authMode === "register"
        ? { email: email, password: password, displayName: displayName, locale: currentLang }
        : { email: email, password: password };
      fetch(atlasApi() + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      }).then(function (res) {
        if (!res.ok) {
          return res.json().then(function (j) {
            var err = new Error(j.message || j.error || res.status);
            err.status = res.status;
            throw err;
          });
        }
        return res.json();
      }).then(function () {
        msg.textContent = t("msgSuccess");
        window.location.href = sentinel() + "/dashboard";
      }).catch(function (err) {
        if (err.status === 409) {
          msg.textContent = t("msgUserExists");
        } else if (err.status === 401) {
          msg.textContent = t("msgInvalidCredentials");
        } else {
          msg.textContent = err.message || t("msgError");
        }
        authSubmitBtn.disabled = false;
      });
    }

    document.getElementById("authForm").addEventListener("submit", submitAuth);
    document.getElementById("authClose").addEventListener("click", closeAuthModal);
    authOverlay.addEventListener("click", function(e) { if (e.target === authOverlay) closeAuthModal(); });
    authSwitchLink.addEventListener("click", function() {
      authMode = authMode === "login" ? "register" : "login";
      updateAuthModal();
    });

    document.getElementById("heroRegisterBtn").addEventListener("click", function(e) { e.preventDefault(); window.location.href = "/login"; });

    // Mobile menu
    var mobileMenu = document.getElementById("mobileMenu");
    document.getElementById("hamburgerBtn").addEventListener("click", function() { mobileMenu.classList.toggle("open"); });
    document.getElementById("mobileLoginBtn").addEventListener("click", function(e) { e.preventDefault(); window.location.href = "/login"; });
    document.getElementById("mobileRegisterBtn").addEventListener("click", function(e) { e.preventDefault(); window.location.href = atlasWeb() + "/he/auth/register"; });

    // Language dropdown
    var langBtn = document.getElementById("langBtn");
    var langDropdown = document.getElementById("langDropdown");
    langBtn.addEventListener("click", function() { langDropdown.classList.toggle("open"); });
    document.addEventListener("click", function(e) {
      if (!langBtn.contains(e.target) && !langDropdown.contains(e.target)) {
        langDropdown.classList.remove("open");
      }
    });

    (function initLang() {
      var KEY = "atlas-lang";
      function apply(lang) {
        currentLang = lang;
        var dir = lang === "en" ? "ltr" : "rtl";
        document.documentElement.lang = lang;
        document.documentElement.dir = dir;
        try { localStorage.setItem(KEY, lang); } catch (e) {}
        document.querySelectorAll(".lang-dropdown [data-lang]").forEach(function (b) {
          b.setAttribute("aria-current", b.getAttribute("data-lang") === lang ? "true" : "false");
        });
        applyTranslations();
        langDropdown.classList.remove("open");
      }
      document.querySelectorAll(".lang-dropdown [data-lang]").forEach(function (b) {
        b.addEventListener("click", function () { apply(b.getAttribute("data-lang")); });
      });
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) {}
      apply(saved || "he");
    })();

    // Theme toggle
    (function initTheme() {
      var THEME_KEY = "atlas-theme";
      var themeBtn = document.getElementById("themeBtn");
      function setTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        themeBtn.innerHTML = theme === "light" ? ${JSON.stringify(ICON_SUN)} : ${JSON.stringify(ICON_MOON)};
        try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
      }
      themeBtn.addEventListener("click", function() {
        var current = document.documentElement.getAttribute("data-theme") || "dark";
        setTheme(current === "dark" ? "light" : "dark");
      });
      var savedTheme = null;
      try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
      setTheme(savedTheme || "dark");
    })();
  </script>
</body>
</html>`;
}
