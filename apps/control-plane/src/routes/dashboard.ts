/**
 * Dashboard — embedded HTML control plane UI.
 *
 * Serves a self-contained HTML page at the root (`/`) that provides
 * a governance overview: agent registry, audit trail, policies, health,
 * and risk metrics. The page fetches data from the JSON API routes and
 * renders it client-side — no build step, no framework, no CDN.
 *
 * ── Why embedded HTML ──────────────────────────────────────────────────
 *
 * The control plane must be deployable as a single process. External
 * frontend tooling (React, Vite, webpack) adds a build step, a dev
 * server, and a dependency surface that the oversight layer should not
 * carry. The embedded HTML is one file, served by the same Node.js
 * process that serves the API.
 */

import { DASHBOARD_TRANSLATIONS } from "./dashboard-i18n.js";

export function getDashboardHtml(): string {
  const translationsJson = JSON.stringify(DASHBOARD_TRANSLATIONS);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atlas Control Plane</title>
  <style>
    :root {
      --bg: #181c26;
      --surface: #222838;
      --surface-hover: #2c3344;
      --border: rgba(160,168,180,0.22);
      --text: #f0f2f5;
      --text-muted: #a8adb8;
      --accent: #7a9cc6;
      --accent-dim: #3d5a7a;
      --success: #4ade80;
      --warning: #fbbf24;
      --danger: #f87171;
      --info: #60a5fa;
      --radius: 8px;
      --font: system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: "SF Mono", "Cascadia Code", "JetBrains Mono", monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ── Layout ─────────────────────────────────────────── */
    .header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 12px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-center {
      display: flex;
      justify-content: center;
    }
    .header-right {
      display: flex;
      justify-content: flex-end;
      align-items: center;
    }
    .header h1 {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      letter-spacing: -0.02em;
    }
    .header .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      background: var(--accent-dim);
      color: white;
      font-weight: 500;
    }
    .header .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      display: inline-block;
    }

    .container { max-width: 1120px; margin-inline: auto; padding: 16px clamp(12px, 3vw, 24px); }

    .lang-pills {
      display: inline-flex;
      align-items: center;
      gap: 1px;
      padding: 2px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: rgba(24,28,38,0.55);
    }
    .lang-pills button {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      font: 500 10px/1.2 var(--font);
      padding: 3px 7px;
      min-height: 22px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .lang-pills button:hover {
      background: rgba(160,168,180,0.1);
      color: var(--text);
    }
    .lang-pills button[aria-current="true"] {
      background: rgba(160,168,180,0.16);
      color: var(--text);
      font-weight: 650;
    }

    @media (max-width: 720px) {
      .header { grid-template-columns: 1fr; justify-items: center; gap: 8px; padding: 10px 12px; }
      .header-left, .header-right { justify-content: center; }
      .header h1 { font-size: 13px; }
      .header .badge { font-size: 10px; }
      .tabs { overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; }
      .tab { padding: 10px 12px; white-space: nowrap; font-size: 13px; }
      .stat-card { padding: 12px; }
      .stat-card .value { font-size: 22px; }
      .container { padding: 12px 12px; }
    }

    /* ── Tabs ───────────────────────────────────────────── */
    .tabs {
      display: flex;
      gap: 4px;
      justify-content: center;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 14px;
      font-family: var(--font);
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
    }
    .tab:hover { color: var(--text); }
    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .panel { display: none; }
    .panel.active { display: block; }

    /* ── Cards ──────────────────────────────────────────── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      text-align: center;
    }
    .stat-card .label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-card .value {
      font-size: 28px;
      font-weight: 700;
      margin-top: 4px;
    }
    .stat-card .value.success { color: var(--success); }
    .stat-card .value.warning { color: var(--warning); }
    .stat-card .value.danger { color: var(--danger); }
    .stat-card .value.info { color: var(--info); }

    /* ── Tables ─────────────────────────────────────────── */
    .table-wrapper {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: start;
      padding: 12px 16px;
      background: var(--surface-hover);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--surface-hover); }

    /* ── Badges / Pills ────────────────────────────────── */
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .pill-success { background: #16432a; color: var(--success); }
    .pill-warning { background: #422d0a; color: var(--warning); }
    .pill-danger { background: #3d1519; color: var(--danger); }
    .pill-info { background: #1a2744; color: var(--info); }
    .pill-muted { background: #2a2e3d; color: var(--text-muted); }

    .readonly-banner {
      font-size: 12px;
      color: var(--warning);
      border: 1px solid rgba(251,191,36,0.35);
      background: #2a2208;
      border-radius: var(--radius);
      padding: 8px 12px;
      margin-bottom: 16px;
    }
    .plane-stack { margin: 8px 0 20px; }
    .plane-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
      background: var(--surface);
    }
    .plane-card.plane-fabric { border-inline-start: 4px solid var(--accent); }
    .plane-card.plane-apps { border-inline-start: 4px solid var(--info); }
    .plane-card.plane-source { border-inline-start: 4px solid var(--warning); }
    .plane-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .plane-note {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .plane-neq {
      text-align: center;
      color: var(--text-muted);
      font-weight: 800;
      letter-spacing: 0.35em;
      font-size: 14px;
      padding: 6px 0;
    }

    .capability-tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-family: var(--mono);
      background: var(--surface-hover);
      border: 1px solid var(--border);
      margin: 1px 2px;
    }

    /* ── Section headers ───────────────────────────────── */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 16px;
      text-align: center;
    }
    .section-header h2 {
      font-size: 16px;
      font-weight: 600;
    }
    .section-header .count {
      color: var(--text-muted);
      font-size: 13px;
    }

    /* ── Task 7: Kill Switches ─────────────────────────── */
    .btn-refresh, .btn-kill-switch-action {
      cursor: pointer;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--text);
      font-family: var(--font);
      font-size: 12px;
      padding: 6px 12px;
      transition: background 0.15s;
    }
    .btn-refresh:hover, .btn-kill-switch-action:hover {
      background: var(--surface-hover);
    }
    .btn-kill-switch-action:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .kill-switch-message {
      min-height: 20px;
      font-size: 13px;
      margin-bottom: 10px;
      text-align: center;
    }
    .kill-switch-message-success { color: var(--success); }
    .kill-switch-message-error { color: var(--danger); }

    /* ── Policy grid ───────────────────────────────────── */
    .policy-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 12px;
    }
    .policy-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      text-align: center;
    }
    .policy-card .policy-name {
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .policy-card .policy-desc {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* ── Loading ────────────────────────────────────────── */
    .loading {
      text-align: center;
      padding: 40px;
      color: var(--text-muted);
    }

    /* ── Empty state ───────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-muted);
    }
    .empty-state h3 { font-size: 16px; margin-bottom: 8px; color: var(--text); }
    .empty-state p { font-size: 13px; }

    /* English / codes stay LTR-left even on RTL pages */
    .ltr, .capability-tag, .policy-name, .mono, .pill {
      direction: ltr;
      text-align: left;
      unicode-bidi: isolate;
    }
    #clock { direction: ltr; unicode-bidi: isolate; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
    <h1>
      <span class="status-dot"></span>
      Atlas Control Plane
      <span class="badge">v0.1.0</span>
    </h1>
    </div>
    <div class="header-center">
      <nav class="lang-pills" role="navigation" aria-label="Language">
        <button type="button" data-lang="he" lang="he" dir="rtl">he</button>
        <button type="button" data-lang="en" lang="en" dir="ltr">en</button>
        <button type="button" data-lang="ar" lang="ar" dir="rtl">ar</button>
      </nav>
    </div>
    <div class="header-right">
    <span style="color: var(--text-muted); font-size: 13px;" id="clock"></span>
    </div>
  </div>

  <div class="container">
    <div class="tabs">
      <button class="tab active" data-panel="overview" data-i18n="tabOverview">Overview</button>
      <button class="tab" data-panel="agents" data-i18n="tabAgents">Agent Registry</button>
      <button class="tab" data-panel="portfolio" data-i18n="tabPortfolio">Portfolio</button>
      <button class="tab" data-panel="audit" data-i18n="tabAudit">Audit Trail</button>
      <button class="tab" data-panel="policies" data-i18n="tabPolicies">Policies</button>
      <button class="tab" data-panel="approvals" data-i18n="tabApprovals">Approvals</button>
      <button class="tab" data-panel="killswitches" data-i18n="tabKillSwitches">Kill Switches</button>
      <button class="tab" data-panel="applications" data-i18n="tabApplications">Applications</button>
      <button class="tab" data-panel="execution" data-i18n="tabExecution">Live Execution</button>
    </div>

    <!-- ── Overview Panel ──────────────────────────────── -->
    <div class="panel active" id="panel-overview">
      <div class="stats-grid" id="stats-grid">
        <div class="loading" data-i18n="loadingMetrics">Loading metrics...</div>
      </div>
    </div>

    <!-- ── Agents Panel ────────────────────────────────── -->
    <div class="panel" id="panel-agents">
      <div class="section-header">
        <h2 data-i18n="registeredAgents">Registered Agents</h2>
        <span class="count" id="agent-count"></span>
      </div>
      <p class="muted" style="margin-bottom:12px;color:var(--text-muted);font-size:13px;">Oversight list only. Profiles at /api/v1/agent-profiles govern personal memory and professional knowledge separately and do not grant execution. A professional-only agent is denied personal memory. Owner isolation stays first. Marketplace listings at /api/v1/marketplace/listings are not agents. A listing references an agent and a release. Provider, publisher, evidence tier, eligibility, entitlement, and access status stay separate. Access evaluation does not dispatch. Provider claims are not verified evidence. Rental, purchase, and licensing are not offered here.</p>
      <div id="agents-message" class="kill-switch-message" role="status" aria-live="polite"></div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thAgentId">Agent ID</th>
              <th data-i18n="thName">Name</th>
              <th data-i18n="thStatus">Status</th>
              <th data-i18n="thCapabilities">Capabilities</th>
              <th data-i18n="thCode">Code</th>
              <th data-i18n="thTools">Tools</th>
              <th data-i18n="thActions">Actions</th>
            </tr>
          </thead>
          <tbody id="agents-tbody">
            <tr><td colspan="7" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Portfolio Governance Panel ──────────────────── -->
    <div class="panel" id="panel-portfolio">
      <div class="section-header">
        <h2 data-i18n="portfolioTitle">Portfolio Governance</h2>
        <span class="count" id="portfolio-count"></span>
      </div>
      <p class="muted" style="margin-bottom:12px;color:var(--text-muted);font-size:13px;" data-i18n="portfolioNote">Observability only. Not an agent registry. Fabric ≠ source applications ≠ source agents. Runtime: UNKNOWN / NOT_PROBED. No knowledge ingest.</p>
      <div class="readonly-banner" data-i18n="portfolioReadOnly">Read-only — no execution, no ingest, no catalog change.</div>
      <div class="plane-stack">
        <div class="plane-card plane-fabric">
          <div class="plane-title" data-i18n="planeFabric">Atlas Fabric agents</div>
          <p class="plane-note" data-i18n="planeFabricNote">FABRIC_AGENT_CATALOG only. Not source agents. Not executable from this view.</p>
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
      <div class="stats-grid" id="portfolio-stats"></div>
      <div class="section-header" style="margin-top:20px;">
        <h2 data-i18n="portfolioApps">Applications</h2>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thSlug">Slug</th>
              <th data-i18n="thName">Name</th>
              <th data-i18n="thRole">Role</th>
              <th data-i18n="thCommit">Commit</th>
              <th data-i18n="thNotes">Notes</th>
            </tr>
          </thead>
          <tbody id="portfolio-apps-tbody">
            <tr><td colspan="5" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:20px;">
        <h2 data-i18n="portfolioSourceAgents">Source agents</h2>
        <span class="count" id="portfolio-source-agents-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thSourceKey">Source key</th>
              <th data-i18n="thName">Name</th>
              <th data-i18n="thApplication">Application</th>
              <th data-i18n="thImplementation">Implementation</th>
              <th data-i18n="thCapabilities">Capabilities</th>
              <th data-i18n="thVerification">Verification</th>
              <th data-i18n="thRuntime">Runtime</th>
              <th data-i18n="thProvenance">Provenance</th>
              <th data-i18n="thEvidence">Evidence</th>
              <th data-i18n="thDecision">Governance decision</th>
            </tr>
          </thead>
          <tbody id="portfolio-source-agents-tbody">
            <tr><td colspan="10" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:20px;">
        <h2 data-i18n="portfolioCapabilities">Capabilities</h2>
        <span class="count" id="portfolio-capabilities-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thName">Name</th>
              <th data-i18n="thDomain">Domain</th>
              <th data-i18n="thPurpose">Purpose</th>
              <th data-i18n="thCanonical">Canonical</th>
              <th data-i18n="thSideEffects">Side Effects</th>
              <th data-i18n="thReadWrite">Read/Write</th>
            </tr>
          </thead>
          <tbody id="portfolio-capabilities-tbody">
            <tr><td colspan="6" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:20px;">
        <h2 data-i18n="portfolioDedup">Deduplication</h2>
        <span class="count" id="portfolio-dedup-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thDedupKind">Dedup Kind</th>
              <th data-i18n="thLeft">Left</th>
              <th data-i18n="thRight">Right</th>
              <th data-i18n="thCanonical">Canonical</th>
              <th data-i18n="thNotes">Notes</th>
            </tr>
          </thead>
          <tbody id="portfolio-dedup-tbody">
            <tr><td colspan="5" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:20px;">
        <h2 data-i18n="portfolioEvidence">Evidence</h2>
        <span class="count" id="portfolio-evidence-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thEvidenceKind">Kind</th>
              <th data-i18n="thEvidenceAuthority">Authority</th>
              <th data-i18n="thEvidencePath">Path</th>
              <th data-i18n="thApplication">Application</th>
              <th data-i18n="thNotes">Notes</th>
            </tr>
          </thead>
          <tbody id="portfolio-evidence-tbody">
            <tr><td colspan="5" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:20px;">
        <h2 data-i18n="portfolioDecisions">Governance Decisions</h2>
        <span class="count" id="portfolio-decisions-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thDecisionAction">Action</th>
              <th data-i18n="thDecisionStatus">Status</th>
              <th data-i18n="thApplication">Application</th>
              <th data-i18n="thCapabilities">Capability</th>
              <th data-i18n="thRationale">Rationale</th>
            </tr>
          </thead>
          <tbody id="portfolio-decisions-tbody">
            <tr><td colspan="5" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:20px;">
        <h2 data-i18n="portfolioConflicts">Conflicts</h2>
        <span class="count" id="portfolio-conflicts-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thKey">Key</th>
              <th data-i18n="thStatus">Status</th>
              <th data-i18n="thSummary">Summary</th>
            </tr>
          </thead>
          <tbody id="portfolio-conflicts-tbody">
            <tr><td colspan="3" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:20px;">
        <h2 data-i18n="fabricProjectionTitle">Fabric projection</h2>
        <span class="count" id="fabric-projection-count"></span>
      </div>
      <p class="muted" style="margin-bottom:12px;color:var(--text-muted);font-size:13px;" data-i18n="fabricProjectionNote">Projection of FABRIC_AGENT_CATALOG. Catalog status LAB — not ACTIVE.</p>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thAgentId">Agent ID</th>
              <th data-i18n="thName">Name</th>
              <th data-i18n="thStatus">Status</th>
              <th data-i18n="thCode">Code</th>
            </tr>
          </thead>
          <tbody id="fabric-projection-tbody">
            <tr><td colspan="4" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Audit Panel ─────────────────────────────────── -->
    <div class="panel" id="panel-audit">
      <div class="section-header">
        <h2 data-i18n="auditTrail">Audit Trail</h2>
        <span class="count" id="audit-count"></span>
        <button type="button" class="btn-refresh" id="audit-verify-refresh" data-i18n="refresh">Refresh</button>
      </div>
      <div id="audit-verify" class="readonly-banner" role="status" aria-live="polite" data-i18n="auditChainPending">Canonical audit chain: checking…</div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thSeq">Seq</th>
              <th data-i18n="thTimestamp">Timestamp</th>
              <th data-i18n="thType">Type</th>
              <th data-i18n="thActor">Actor</th>
              <th data-i18n="thRisk">Risk</th>
              <th data-i18n="thResult">Result</th>
              <th data-i18n="thReason">Reason</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">
            <tr><td colspan="7" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Policies Panel ──────────────────────────────── -->
    <div class="panel" id="panel-policies">
      <div class="section-header">
        <h2 data-i18n="policyDefinitions">Policy Definitions</h2>
        <span class="count" id="policy-count"></span>
      </div>
      <div class="policy-grid" id="policy-grid">
        <div class="loading" data-i18n="loading">Loading...</div>
      </div>
    </div>

    <!-- ── Approvals Panel ─────────────────────────────── -->
    <div class="panel" id="panel-approvals">
      <div class="section-header">
        <h2 data-i18n="approvalRecords">Approval Records</h2>
        <span class="count" id="approval-count"></span>
        <button type="button" class="btn-refresh" id="approvals-refresh" data-i18n="refresh">Refresh</button>
      </div>
      <div id="approvals-message" class="kill-switch-message" role="status" aria-live="polite"></div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thId">ID</th>
              <th data-i18n="thRequestedBy">Requested By</th>
              <th data-i18n="thAction">Action</th>
              <th data-i18n="thStatus">Status</th>
              <th data-i18n="thDecidedBy">Decided By</th>
              <th data-i18n="thCreated">Created</th>
              <th data-i18n="thExpires">Expires</th>
              <th data-i18n="thActions">Actions</th>
            </tr>
          </thead>
          <tbody id="approvals-tbody">
            <tr><td colspan="8" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Kill Switches Panel (Task 7) ─────────────── -->
    <div class="panel" id="panel-killswitches">
      <div class="section-header">
        <h2 data-i18n="killSwitches">Kill Switches</h2>
        <span class="count" id="kill-switch-count"></span>
        <button type="button" class="btn-refresh" id="kill-switch-refresh" data-i18n="refresh">Refresh</button>
      </div>
      <p style="font-size:13px;color:var(--text-muted);margin:4px 0 12px" data-i18n="killSwitchIntro">
        A kill switch is a global, cross-tenant emergency stop. The effective state is always the environment baseline UNION the runtime override below -- clearing a runtime override can never turn off a category the environment still lists as active.
      </p>
      <div id="kill-switch-message" class="kill-switch-message" role="status" aria-live="polite"></div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thCategory">Category</th>
              <th data-i18n="thEnvBaseline">Env Baseline</th>
              <th data-i18n="thRuntimeOverride">Runtime Override</th>
              <th data-i18n="thEffective">Effective</th>
              <th data-i18n="thOverrideDetails">Override Details</th>
              <th data-i18n="thActions">Actions</th>
            </tr>
          </thead>
          <tbody id="kill-switches-tbody">
            <tr><td colspan="6" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Applications Panel ────────────────────────── -->
    <div class="panel" id="panel-applications">
      <div class="section-header">
        <h2 data-i18n="applicationsTitle">Application Registry</h2>
        <span class="count" id="applications-count"></span>
        <button type="button" class="btn-refresh" id="applications-refresh" data-i18n="refresh">Refresh</button>
      </div>
      <p style="font-size:13px;color:var(--text-muted);margin:4px 0 12px" data-i18n="applicationsIntro">
        Self-registration stays pending until an operator approves it. Atlas-self (def-000) is pre-approved.
      </p>
      <div id="applications-message" class="kill-switch-message" role="status" aria-live="polite"></div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thId">ID</th>
              <th data-i18n="thName">Name</th>
              <th data-i18n="thTrust">Trust</th>
              <th data-i18n="thHealth">Health</th>
              <th data-i18n="thLastEvent">Last Event</th>
              <th data-i18n="thActions">Actions</th>
            </tr>
          </thead>
          <tbody id="applications-tbody">
            <tr><td colspan="6" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Live Execution Panel ──────────────────────── -->
    <div class="panel" id="panel-execution">
      <div class="section-header">
        <h2 data-i18n="executionTitle">Live Agent Executions</h2>
        <span class="count" id="execution-count"></span>
        <button type="button" class="btn-refresh" id="execution-refresh" data-i18n="refresh">Refresh</button>
      </div>
      <p style="font-size:13px;color:var(--text-muted);margin:4px 0 12px" data-i18n="executionIntro">
        Canonical run state from the Atlas API. No fabricated rows. Lifecycle holds are listed separately.
      </p>
      <div id="execution-message" class="kill-switch-message" role="status" aria-live="polite"></div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thRunId">Run ID</th>
              <th data-i18n="thRunStatus">Run Status</th>
              <th data-i18n="thVisibility">Visibility</th>
              <th data-i18n="thType">Mode</th>
              <th data-i18n="thActor">Created By</th>
              <th data-i18n="thTimestamp">Started</th>
              <th data-i18n="thReason">Request</th>
            </tr>
          </thead>
          <tbody id="execution-tbody">
            <tr><td colspan="7" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:24px">
        <h2 data-i18n="processTitle">Supervised Processes</h2>
        <span class="count" id="process-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thId">ID</th>
              <th data-i18n="thApplication">Application</th>
              <th data-i18n="thStatus">Status</th>
              <th data-i18n="thType">Type</th>
            </tr>
          </thead>
          <tbody id="processes-tbody">
            <tr><td colspan="4" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section-header" style="margin-top:24px">
        <h2 data-i18n="errorAggregatesTitle">Aggregated Errors</h2>
        <span class="count" id="error-aggregate-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thType">Code</th>
              <th data-i18n="thCount">Count</th>
              <th data-i18n="thCreated">First Seen</th>
              <th data-i18n="thExpires">Last Seen</th>
              <th data-i18n="thReason">Sample</th>
            </tr>
          </thead>
          <tbody id="error-aggregates-tbody">
            <tr><td colspan="5" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    var TRANSLATIONS = ${translationsJson};
    // END_DASHBOARD_TRANSLATIONS

    var currentLang = "he";
    var AGENT_NAMES = {
      he: { CODE_ENGINEER: "מהנדס קוד", RESEARCH_ANALYST: "אנליסט מחקר", ARCHITECT: "ארכיטקט" },
      ar: { CODE_ENGINEER: "مهندس كود", RESEARCH_ANALYST: "محلل أبحاث", ARCHITECT: "مهندس معماري" }
    };

    function t(key) {
      return (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) || TRANSLATIONS.en[key] || key;
    }

    function applyTranslations() {
      document.querySelectorAll("[data-i18n]").forEach(function(el) {
        var key = el.getAttribute("data-i18n");
        if (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) {
          el.textContent = TRANSLATIONS[currentLang][key];
        }
      });
    }

    function agentDisplayName(agent) {
      var map = AGENT_NAMES[currentLang];
      if (map && map[agent.agentId]) return map[agent.agentId];
      return agent.displayName || agent.agentId;
    }

    (function initLang() {
      var KEY = "atlas-lang";
      function apply(lang, reload) {
        currentLang = lang || "he";
        document.documentElement.lang = currentLang;
        document.documentElement.dir = currentLang === "en" ? "ltr" : "rtl";
        try { localStorage.setItem(KEY, currentLang); } catch (e) {}
        document.querySelectorAll(".lang-pills [data-lang]").forEach(function (b) {
          b.setAttribute("aria-current", b.getAttribute("data-lang") === currentLang ? "true" : "false");
        });
        applyTranslations();
        if (reload) {
          loadOverview();
          loadAgents();
          loadPortfolio();
          loadAudit();
          loadPolicies();
          loadApprovals();
          loadKillSwitches();
          loadApplications();
          loadExecutions();
        }
      }
      document.querySelectorAll(".lang-pills [data-lang]").forEach(function (b) {
        b.addEventListener("click", function () { apply(b.getAttribute("data-lang"), true); });
      });
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) {}
      apply(saved || "he", false);
    })();

    // ── Tab switching ──────────────────────────────────────────────────
    document.querySelectorAll('.tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
        tab.classList.add('active');
        var panelId = 'panel-' + tab.getAttribute('data-panel');
        var panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
      });
    });

    // ── Clock ──────────────────────────────────────────────────────────
    function updateClock() {
      var el = document.getElementById('clock');
      if (el) el.textContent = new Date().toLocaleString();
    }
    setInterval(updateClock, 1000);
    updateClock();

    // ── Helpers ─────────────────────────────────────────────────────────
    function riskPill(risk) {
      if (risk === 'HIGH' || risk === 'BLOCK') return '<span class="pill pill-danger">' + risk + '</span>';
      if (risk === 'APPROVAL') return '<span class="pill pill-warning">' + risk + '</span>';
      if (risk === 'LOW' || risk === 'AUTO_LOG') return '<span class="pill pill-success">' + risk + '</span>';
      return '<span class="pill pill-muted">' + risk + '</span>';
    }

    function resultPill(result) {
      if (result === 'SUCCESS') return '<span class="pill pill-success">' + result + '</span>';
      if (result === 'FAILURE') return '<span class="pill pill-danger">' + result + '</span>';
      if (result === 'PENDING') return '<span class="pill pill-warning">' + result + '</span>';
      return '<span class="pill pill-muted">' + result + '</span>';
    }

    function statusPill(status) {
      if (status === 'ACTIVE') return '<span class="pill pill-success">' + status + '</span>';
      if (status === 'LAB' || status === 'UNKNOWN' || status === 'NOT_PROBED') return '<span class="pill pill-muted">' + status + '</span>';
      if (status === 'SUSPENDED') return '<span class="pill pill-danger">' + status + '</span>';
      if (status === 'DEGRADED') return '<span class="pill pill-warning">' + status + '</span>';
      return '<span class="pill pill-muted">' + status + '</span>';
    }

    function truncate(str, len) {
      if (!str) return '';
      return str.length > len ? str.slice(0, len) + '...' : str;
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ── Data loading ───────────────────────────────────────────────────
    async function loadOverview() {
      try {
        var res = await fetch('/api/v1/health');
        var health = await res.json();
        var statsRes = await fetch('/api/v1/agents/stats');
        var stats = await statsRes.json();
        var grid = document.getElementById('stats-grid');
        if (!grid) return;
        grid.innerHTML = '' +
          '<div class="stat-card"><div class="label">' + t("statTotalAgents") + '</div><div class="value info">' + stats.totalAgents + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statActiveAgents") + '</div><div class="value success">' + stats.activeAgents + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statCodeWriters") + '</div><div class="value warning">' + stats.codeWritingAgents + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statReadOnly") + '</div><div class="value">' + stats.readOnlyAgents + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statAuditEntries") + '</div><div class="value info">' + health.totalExecutions + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statSuccesses") + '</div><div class="value success">' + health.successfulExecutions + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statFailures") + '</div><div class="value danger">' + health.failedExecutions + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statHighRisk") + '</div><div class="value' + (health.highRiskCount > 0 ? ' danger' : '') + '">' + health.highRiskCount + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statAvgRisk") + '</div><div class="value">' + health.avgRiskScore + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statApprovalsPending") + '</div><div class="value' + (health.approvalsPending > 0 ? ' warning' : '') + '">' + health.approvalsPending + '</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statUptime") + '</div><div class="value ltr">' + Math.floor(health.uptimeMs / 1000) + 's</div></div>' +
          '<div class="stat-card"><div class="label">' + t("statDenied") + '</div><div class="value' + (health.deniedExecutions > 0 ? ' warning' : '') + '">' + health.deniedExecutions + '</div></div>';
      } catch (e) {
        var grid2 = document.getElementById('stats-grid');
        if (grid2) grid2.innerHTML = '<div class="empty-state"><h3>' + t("serviceStarting") + '</h3><p>' + t("waitingData") + '</p></div>';
      }
    }

    async function loadAgents() {
      try {
        var res = await fetch('/api/v1/agents');
        var agents = await res.json();
        var countEl = document.getElementById('agent-count');
        if (countEl) countEl.textContent = agents.length + ' ' + t("agentsCount");
        var tbody = document.getElementById('agents-tbody');
        if (!tbody) return;
        if (agents.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state">' + t("noAgents") + '</td></tr>';
          return;
        }
        tbody.innerHTML = agents.map(function(a) {
          var caps = a.capabilities.map(function(c) {
            return '<span class="capability-tag">' + c.entityType + '.' + c.action + '</span>';
          }).join('');
          var tools = a.allowedTools.slice(0, 3).map(function(tool) {
            return '<span class="capability-tag">' + tool + '</span>';
          }).join('');
          var status = a.status || '';
          var locked = status === 'REVOKED' || status === 'RETIRED' || status === 'DISABLED';
          var buttons = '';
          if (!locked && (status === 'PAUSED' || status === 'QUARANTINED' || status === 'SUSPENDED')) {
            buttons += '<button type="button" class="btn-refresh" data-agent-action="resume" data-agent-id="' + escapeHtml(a.agentId) + '">' + t("resumeAgent") + '</button>';
          }
          if (!locked && status !== 'PAUSED') {
            buttons += '<button type="button" class="btn-refresh" data-agent-action="pause" data-agent-id="' + escapeHtml(a.agentId) + '">' + t("pauseAgent") + '</button>';
          }
          if (!locked && status !== 'QUARANTINED') {
            buttons += '<button type="button" class="btn-refresh" data-agent-action="quarantine" data-agent-id="' + escapeHtml(a.agentId) + '">' + t("quarantineAgent") + '</button>';
          }
          if (!locked) {
            buttons += '<button type="button" class="btn-refresh" data-agent-action="revoke" data-agent-id="' + escapeHtml(a.agentId) + '">' + t("revokeAgent") + '</button>';
          }
          var actions = locked
            ? '<span style="color:var(--text-muted);font-size:12px">' + t("none") + '</span>'
            : '<div style="display:flex;flex-direction:column;gap:6px;min-width:180px">' +
                '<input type="text" class="reason-input" id="agent-reason-' + escapeHtml(a.agentId) + '" placeholder="' + t("reasonPlaceholder") + '" minlength="8" />' +
                '<div style="display:flex;flex-wrap:wrap;gap:6px">' + buttons + '</div>' +
              '</div>';
          return '<tr>' +
            '<td class="mono" style="font-family:var(--mono);font-size:12px">' + escapeHtml(a.agentId) + '</td>' +
            '<td>' + agentDisplayName(a) + '</td>' +
            '<td>' + statusPill(a.status) + '</td>' +
            '<td>' + (caps || '<span class="pill pill-muted">' + t("none") + '</span>') + '</td>' +
            '<td>' + (a.canWriteCode ? '<span class="pill pill-warning">' + t("yes") + '</span>' : '<span class="pill pill-muted">' + t("no") + '</span>') + '</td>' +
            '<td>' + tools + '</td>' +
            '<td>' + actions + '</td>' +
            '</tr>';
        }).join('');
        tbody.querySelectorAll('[data-agent-action]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            submitAgentControl(btn.getAttribute('data-agent-id'), btn.getAttribute('data-agent-action'), btn);
          });
        });
      } catch (e) {
        var tbody2 = document.getElementById('agents-tbody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="7" class="loading">' + t("failedLoad") + '</td></tr>';
      }
    }

    function agentMessage(text, isError) {
      var el = document.getElementById('agents-message');
      if (!el) return;
      el.textContent = text;
      el.className = 'kill-switch-message ' + (isError ? 'kill-switch-message-error' : 'kill-switch-message-success');
    }

    async function submitAgentControl(agentId, action, btn) {
      if (action === 'revoke' && !window.confirm(t("confirmRevoke"))) return;
      var reasonEl = document.getElementById('agent-reason-' + agentId);
      var reason = reasonEl && reasonEl.value ? reasonEl.value.trim() : '';
      if (reason.length < 8) {
        agentMessage(t("reasonTooShort"), true);
        return;
      }
      if (btn) btn.disabled = true;
      try {
        var reauthRes = await fetch('/api/v1/auth/reauth', { method: 'POST' });
        var reauthBody = await reauthRes.json().catch(function() { return {}; });
        if (!reauthRes.ok || !reauthBody.ticket) {
          agentMessage(t("reauthFailed"), true);
          if (btn) btn.disabled = false;
          return;
        }
        var res = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/control', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Atlas-Reason': reason,
            'x-atlas-reauth': reauthBody.ticket
          },
          body: JSON.stringify({ action: action })
        });
        var body = await res.json().catch(function() { return {}; });
        if (res.status === 202) {
          agentMessage(t("approvalRequired") + (body.approvalId ? ': ' + body.approvalId : ''), false);
          await loadAgents();
          return;
        }
        if (!res.ok) {
          agentMessage(t("actionFailed") + (body.error || body.reason ? ': ' + (body.error || body.reason) : ''), true);
          if (btn) btn.disabled = false;
          return;
        }
        agentMessage(t("agentControlSucceeded"), false);
        await loadAgents();
      } catch (e) {
        agentMessage(t("actionFailed"), true);
        if (btn) btn.disabled = false;
      }
    }

    async function loadPortfolio() {
      function portfolioError(msg) {
        var appsFail = document.getElementById('portfolio-apps-tbody');
        if (appsFail) appsFail.innerHTML = '<tr><td colspan="5" class="loading">' + msg + '</td></tr>';
        var srcFail = document.getElementById('portfolio-source-agents-tbody');
        if (srcFail) srcFail.innerHTML = '<tr><td colspan="10" class="loading">' + msg + '</td></tr>';
      }
      try {
        var portRes = await fetch('/api/v1/portfolio-governance');
        if (!portRes.ok) throw new Error('portfolio-governance ' + portRes.status);
        var port = await portRes.json();
        var snapshot = port.snapshot || {};
        var summary = port.summary || {};
        var apps = snapshot.applications || [];
        var sourceAgents = snapshot.sourceAgents || [];
        var capabilities = snapshot.capabilities || [];
        var evidence = snapshot.evidence || [];
        var decisions = snapshot.governanceDecisions || [];
        var dedupRelations = snapshot.dedupRelations || [];
        var conflicts = snapshot.conflicts || [];
        var canonicals = snapshot.canonicalCapabilities || [];
        var countEl = document.getElementById('portfolio-count');
        if (countEl) {
          countEl.textContent =
            (summary.applicationCount || apps.length) + ' ' + t("portfolioApps") +
            ' · ' + (summary.sourceAgentCount || sourceAgents.length) + ' ' + t("sourceAgentsCount");
        }
        var stats = document.getElementById('portfolio-stats');
        if (stats) {
          stats.innerHTML =
            '<div class="stat-card"><div class="label">' + t("portfolioApps") + '</div><div class="value info">' + (summary.applicationCount || apps.length) + '</div></div>' +
            '<div class="stat-card"><div class="label">' + t("sourceAgentsCount") + '</div><div class="value">' + (summary.sourceAgentCount || sourceAgents.length) + '</div></div>' +
            '<div class="stat-card"><div class="label">' + t("capabilityCount") + '</div><div class="value">' + (summary.capabilityCount || capabilities.length) + '</div></div>' +
            '<div class="stat-card"><div class="label">' + t("dedupCount") + '</div><div class="value">' + dedupRelations.length + '</div></div>' +
            '<div class="stat-card"><div class="label">' + t("decisionCount") + '</div><div class="value">' + decisions.length + '</div></div>' +
            '<div class="stat-card"><div class="label">' + t("evidenceCount") + '</div><div class="value">' + evidence.length + '</div></div>' +
            '<div class="stat-card"><div class="label">' + t("conflictCount") + '</div><div class="value' + (conflicts.length > 0 ? ' warning' : '') + '">' + conflicts.length + '</div></div>' +
            '<div class="stat-card"><div class="label">' + t("fabricAgentsCount") + '</div><div class="value">' + (summary.fabricAgentRefCount || 0) + '</div></div>';
        }
        var appsById = {};
        apps.forEach(function(a) { appsById[a.id] = a; });
        var capsById = {};
        capabilities.forEach(function(c) { capsById[c.id] = c; });
        var canonById = {};
        canonicals.forEach(function(c) { canonById[c.id] = c; });
        var capsByAgent = {};
        capabilities.forEach(function(c) {
          if (!capsByAgent[c.sourceAgentId]) capsByAgent[c.sourceAgentId] = [];
          capsByAgent[c.sourceAgentId].push(c.name);
        });
        var evidenceByAgent = {};
        evidence.forEach(function(ev) {
          if (!ev.sourceAgentId) return;
          if (!evidenceByAgent[ev.sourceAgentId]) evidenceByAgent[ev.sourceAgentId] = [];
          evidenceByAgent[ev.sourceAgentId].push(ev.kind);
        });
        var decisionByAgent = {};
        decisions.forEach(function(d) {
          if (!d.sourceAgentId) return;
          decisionByAgent[d.sourceAgentId] = d.action + ' / ' + d.status;
        });
        var appsBody = document.getElementById('portfolio-apps-tbody');
        if (appsBody) {
          if (apps.length === 0) {
            appsBody.innerHTML = '<tr><td colspan="5" class="empty-state">' + t("noPortfolioApps") + '</td></tr>';
          } else {
            appsBody.innerHTML = apps.map(function(a) {
              return '<tr>' +
                '<td class="mono">' + a.slug + '</td>' +
                '<td>' + a.name + '</td>' +
                '<td>' + statusPill(a.role) + '</td>' +
                '<td class="mono" style="font-size:11px">' + String(a.sourceCommit || '').slice(0, 12) + '</td>' +
                '<td style="font-size:12px">' + truncate(a.notes, 80) + '</td>' +
                '</tr>';
            }).join('');
          }
        }
        var srcCount = document.getElementById('portfolio-source-agents-count');
        if (srcCount) srcCount.textContent = sourceAgents.length + ' ' + t("sourceAgentsCount");
        var srcBody = document.getElementById('portfolio-source-agents-tbody');
        if (srcBody) {
          if (sourceAgents.length === 0) {
            srcBody.innerHTML = '<tr><td colspan="10" class="empty-state">' + t("noSourceAgents") + '</td></tr>';
          } else {
            srcBody.innerHTML = sourceAgents.map(function(sa) {
              var app = appsById[sa.applicationId];
              var runtime = sa.runtimeStatus || {};
              var runtimeLabel = (runtime.state || 'UNKNOWN') + ' / ' + (runtime.probeKind === 'NONE' || !runtime.probeKind ? 'NOT_PROBED' : runtime.probeKind);
              var prov = sa.provenance || {};
              var provLabel = (prov.sourceRepository || '') + ' @ ' + String(prov.sourceCommit || '').slice(0, 12) + ' · ' + (prov.sourcePath || '');
              var capNames = capsByAgent[sa.id] || [];
              var evKinds = evidenceByAgent[sa.id] || [];
              var capHtml = capNames.length
                ? capNames.slice(0, 4).map(function(n) { return '<span class="capability-tag">' + n + '</span>'; }).join('')
                : '<span class="pill pill-muted">' + t("none") + '</span>';
              var evHtml = evKinds.length ? evKinds.length + ' · ' + evKinds.slice(0, 3).join(', ') : t("none");
              return '<tr>' +
                '<td class="mono" style="font-size:11px">' + sa.sourceKey + '</td>' +
                '<td>' + sa.displayName + '</td>' +
                '<td>' + (app ? app.slug : '') + '</td>' +
                '<td><span class="pill pill-info">' + sa.implementationClass + '</span></td>' +
                '<td>' + capHtml + '</td>' +
                '<td>' + statusPill(sa.verificationStatus) + '</td>' +
                '<td>' + statusPill(runtime.state || 'UNKNOWN') + ' <span class="pill pill-muted">' + runtimeLabel + '</span></td>' +
                '<td style="font-size:11px">' + truncate(provLabel, 72) + '</td>' +
                '<td style="font-size:11px">' + evHtml + '</td>' +
                '<td style="font-size:11px">' + (decisionByAgent[sa.id] || t("none")) + '</td>' +
                '</tr>';
            }).join('');
          }
        }
        // Capabilities table
        var capCount = document.getElementById('portfolio-capabilities-count');
        if (capCount) capCount.textContent = capabilities.length + ' ' + t("capabilityCount");
        var capBody = document.getElementById('portfolio-capabilities-tbody');
        if (capBody) {
          if (capabilities.length === 0) {
            capBody.innerHTML = '<tr><td colspan="6" class="empty-state">' + t("noCapabilities") + '</td></tr>';
          } else {
            capBody.innerHTML = capabilities.map(function(c) {
              var canon = c.canonicalCapabilityId ? canonById[c.canonicalCapabilityId] : null;
              var sideEffects = Array.isArray(c.sideEffects) ? c.sideEffects.join(', ') : t("none");
              var readW = (Array.isArray(c.readAccess) ? c.readAccess.length : 0) + 'R / ' + (Array.isArray(c.writeAccess) ? c.writeAccess.length : 0) + 'W';
              return '<tr>' +
                '<td class="mono" style="font-size:11px">' + c.name + '</td>' +
                '<td><span class="pill pill-info">' + c.domain + '</span></td>' +
                '<td style="font-size:11px">' + truncate(c.purpose, 60) + '</td>' +
                '<td>' + (canon ? '<span class="capability-tag">' + canon.key + '</span>' : '<span class="pill pill-muted">' + t("none") + '</span>') + '</td>' +
                '<td style="font-size:11px">' + (sideEffects || t("none")) + '</td>' +
                '<td style="font-size:11px">' + readW + '</td>' +
                '</tr>';
            }).join('');
          }
        }
        // Dedup table
        var dedupCountEl = document.getElementById('portfolio-dedup-count');
        if (dedupCountEl) dedupCountEl.textContent = dedupRelations.length + ' ' + t("dedupCount");
        var dedupBody = document.getElementById('portfolio-dedup-tbody');
        if (dedupBody) {
          if (dedupRelations.length === 0) {
            dedupBody.innerHTML = '<tr><td colspan="5" class="empty-state">' + t("noDedup") + '</td></tr>';
          } else {
            dedupBody.innerHTML = dedupRelations.map(function(d) {
              var leftCap = d.leftCapabilityId ? capsById[d.leftCapabilityId] : null;
              var rightCap = d.rightCapabilityId ? capsById[d.rightCapabilityId] : null;
              var canon = d.canonicalCapabilityId ? canonById[d.canonicalCapabilityId] : null;
              var kindClass = d.kind === 'CONFLICTING' ? 'pill-danger' : d.kind === 'UNIQUE' ? 'pill-muted' : 'pill-info';
              return '<tr>' +
                '<td><span class="pill ' + kindClass + '">' + d.kind + '</span></td>' +
                '<td style="font-size:11px">' + (leftCap ? leftCap.name : '-') + '</td>' +
                '<td style="font-size:11px">' + (rightCap ? rightCap.name : '-') + '</td>' +
                '<td>' + (canon ? '<span class="capability-tag">' + canon.key + '</span>' : '-') + '</td>' +
                '<td style="font-size:11px">' + truncate(d.notes, 60) + '</td>' +
                '</tr>';
            }).join('');
          }
        }
        // Evidence table
        var evCountEl = document.getElementById('portfolio-evidence-count');
        if (evCountEl) evCountEl.textContent = evidence.length + ' ' + t("evidenceCount");
        var evBody = document.getElementById('portfolio-evidence-tbody');
        if (evBody) {
          if (evidence.length === 0) {
            evBody.innerHTML = '<tr><td colspan="5" class="empty-state">' + t("noEvidence") + '</td></tr>';
          } else {
            evBody.innerHTML = evidence.map(function(ev) {
              var app = ev.applicationId ? appsById[ev.applicationId] : null;
              return '<tr>' +
                '<td><span class="pill pill-info">' + ev.kind + '</span></td>' +
                '<td style="font-size:11px">' + ev.authorityRank + '</td>' +
                '<td class="mono" style="font-size:11px">' + truncate(ev.path, 50) + '</td>' +
                '<td>' + (app ? app.slug : '-') + '</td>' +
                '<td style="font-size:11px">' + truncate(ev.note, 50) + '</td>' +
                '</tr>';
            }).join('');
          }
        }
        // Decisions table
        var decCountEl = document.getElementById('portfolio-decisions-count');
        if (decCountEl) decCountEl.textContent = decisions.length + ' ' + t("decisionCount");
        var decBody = document.getElementById('portfolio-decisions-tbody');
        if (decBody) {
          if (decisions.length === 0) {
            decBody.innerHTML = '<tr><td colspan="5" class="empty-state">' + t("noDecisions") + '</td></tr>';
          } else {
            decBody.innerHTML = decisions.map(function(d) {
              var app = d.applicationId ? appsById[d.applicationId] : null;
              var cap = d.capabilityId ? capsById[d.capabilityId] : null;
              var actionClass = d.action === 'ESCALATE' ? 'pill-danger' : d.action === 'DO_NOT_IMPORT' ? 'pill-warning' : 'pill-info';
              var statusClass = d.status === 'APPROVED' ? 'pill-success' : d.status === 'DENIED' ? 'pill-danger' : 'pill-muted';
              return '<tr>' +
                '<td><span class="pill ' + actionClass + '">' + d.action + '</span></td>' +
                '<td><span class="pill ' + statusClass + '">' + d.status + '</span></td>' +
                '<td>' + (app ? app.slug : '-') + '</td>' +
                '<td style="font-size:11px">' + (cap ? cap.name : '-') + '</td>' +
                '<td style="font-size:11px">' + truncate(d.rationale, 80) + '</td>' +
                '</tr>';
            }).join('');
          }
        }
        // Conflicts table
        var confCountEl = document.getElementById('portfolio-conflicts-count');
        if (confCountEl) confCountEl.textContent = conflicts.length + ' ' + t("conflictCount");
        var confBody = document.getElementById('portfolio-conflicts-tbody');
        if (confBody) {
          if (conflicts.length === 0) {
            confBody.innerHTML = '<tr><td colspan="3" class="empty-state">' + t("noConflicts") + '</td></tr>';
          } else {
            confBody.innerHTML = conflicts.map(function(c) {
              var statusClass = c.status === 'ESCALATED' ? 'pill-danger' : c.status === 'OPEN' ? 'pill-warning' : 'pill-muted';
              return '<tr>' +
                '<td class="mono" style="font-size:11px">' + c.key + '</td>' +
                '<td><span class="pill ' + statusClass + '">' + c.status + '</span></td>' +
                '<td style="font-size:12px">' + truncate(c.summary, 100) + '</td>' +
                '</tr>';
            }).join('');
          }
        }
      } catch (e) {
        portfolioError(t("failedLoad"));
      }
      try {
        var fabRes = await fetch('/api/v1/agents/fabric-projection');
        if (!fabRes.ok) throw new Error('fabric-projection ' + fabRes.status);
        var fab = await fabRes.json();
        var items = fab.items || [];
        var fabCount = document.getElementById('fabric-projection-count');
        if (fabCount) fabCount.textContent = items.length + ' ' + t("fabricAgentsCount");
        var fabBody = document.getElementById('fabric-projection-tbody');
        if (!fabBody) return;
        if (items.length === 0) {
          fabBody.innerHTML = '<tr><td colspan="4" class="empty-state">' + t("noFabricAgents") + '</td></tr>';
          return;
        }
        fabBody.innerHTML = items.map(function(a) {
          return '<tr>' +
            '<td class="mono">' + a.agentId + '</td>' +
            '<td>' + a.displayName + '</td>' +
            '<td>' + statusPill(a.catalogStatus) + '</td>' +
            '<td>' + (a.canWriteCode ? '<span class="pill pill-warning">' + t("yes") + '</span>' : '<span class="pill pill-muted">' + t("no") + '</span>') + '</td>' +
            '</tr>';
        }).join('');
      } catch (e2) {
        var fabFail = document.getElementById('fabric-projection-tbody');
        if (fabFail) fabFail.innerHTML = '<tr><td colspan="4" class="loading">' + t("failedLoad") + '</td></tr>';
      }
    }

    async function loadAudit() {
      try {
        var verifyRes = await fetch('/api/v1/audit/verify');
        var verifyEl = document.getElementById('audit-verify');
        if (verifyEl) {
          if (!verifyRes.ok) {
            var errBody = await verifyRes.json().catch(function() { return {}; });
            verifyEl.textContent = t("auditChainFailed") + (errBody.error ? ': ' + errBody.error : '');
          } else {
            var verify = await verifyRes.json();
            verifyEl.textContent = t("auditCanonical") + ': ' + (verify.status || t("failedLoad")) +
              (typeof verify.checked === 'number' ? ' (' + verify.checked + ')' : '');
          }
        }
      } catch (verifyErr) {
        var verifyFail = document.getElementById('audit-verify');
        if (verifyFail) verifyFail.textContent = t("auditChainFailed");
      }
      try {
        var res = await fetch('/api/v1/audit?limit=50');
        var entries = await res.json();
        var countRes = await fetch('/api/v1/audit/count');
        var countData = await countRes.json();
        var countEl = document.getElementById('audit-count');
        if (countEl) countEl.textContent = countData.count + ' ' + t("entriesCount");
        var tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        if (entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><h3>' + t("noAuditTitle") + '</h3><p>' + t("noAuditBody") + '</p></td></tr>';
          return;
        }
        tbody.innerHTML = entries.map(function(e) {
          return '<tr>' +
            '<td class="mono" style="font-family:var(--mono);font-size:12px">' + e.seq + '</td>' +
            '<td class="ltr" style="font-size:12px;white-space:nowrap">' + new Date(e.timestamp).toLocaleString() + '</td>' +
            '<td class="mono" style="font-family:var(--mono);font-size:11px">' + truncate(e.type, 40) + '</td>' +
            '<td class="mono" style="font-family:var(--mono);font-size:12px">' + e.actorId + '</td>' +
            '<td>' + riskPill(e.risk) + '</td>' +
            '<td>' + resultPill(e.result) + '</td>' +
            '<td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis">' + truncate(e.reason, 80) + '</td>' +
            '</tr>';
        }).join('');
      } catch (e) {
        var tbody2 = document.getElementById('audit-tbody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="7" class="loading">' + t("failedLoad") + '</td></tr>';
      }
    }

    (function wireAuditVerifyRefresh() {
      var btn = document.getElementById('audit-verify-refresh');
      if (btn) btn.addEventListener('click', function() { loadAudit(); });
    })();

    async function loadPolicies() {
      try {
        var res = await fetch('/api/v1/policies');
        var policies = await res.json();
        var countEl = document.getElementById('policy-count');
        if (countEl) countEl.textContent = policies.length + ' ' + t("policiesCount");
        var grid = document.getElementById('policy-grid');
        if (!grid) return;
        grid.innerHTML = policies.map(function(p) {
          return '<div class="policy-card">' +
            '<div class="policy-name">' + p.entityType + '.' + p.action + '</div>' +
            '<div style="margin:6px 0">' + riskPill(p.riskTier) +
            (p.requiresApproval ? ' <span class="pill pill-warning">' + t("approvalRequired") + '</span>' : '') +
            '</div>' +
            '<div class="policy-desc">' + p.description + '</div>' +
            '</div>';
        }).join('');
      } catch (e) {
        var grid2 = document.getElementById('policy-grid');
        if (grid2) grid2.innerHTML = '<div class="loading">' + t("failedLoad") + '</div>';
      }
    }

    async function loadApprovals() {
      try {
        var res = await fetch('/api/v1/approvals');
        if (!res.ok) {
          var errBody = await res.json().catch(function() { return {}; });
          var tbodyErr = document.getElementById('approvals-tbody');
          if (tbodyErr) tbodyErr.innerHTML = '<tr><td colspan="8" class="loading">' + t("failedLoad") + (errBody.error ? ': ' + escapeHtml(errBody.error) : '') + '</td></tr>';
          return;
        }
        var approvals = await res.json();
        if (!Array.isArray(approvals)) {
          var tbodyBad = document.getElementById('approvals-tbody');
          if (tbodyBad) tbodyBad.innerHTML = '<tr><td colspan="8" class="loading">' + t("failedLoad") + '</td></tr>';
          return;
        }
        var countEl = document.getElementById('approval-count');
        if (countEl) countEl.textContent = approvals.length + ' ' + t("recordsCount");
        var tbody = document.getElementById('approvals-tbody');
        if (!tbody) return;
        if (approvals.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><h3>' + t("noApprovalsTitle") + '</h3><p>' + t("noApprovalsBody") + '</p></td></tr>';
          return;
        }
        tbody.innerHTML = approvals.map(function(a) {
          var status = a.status || '';
          var statusClass = status === 'APPROVED' || status === 'CONSUMED' || status === 'FULFILLED' ? 'pill-success' :
            status === 'REJECTED' || status === 'DENIED' || status === 'REVOKED' || status === 'FAILED' ? 'pill-danger' :
            status === 'PENDING' ? 'pill-warning' :
            status === 'EXPIRED' ? 'pill-muted' : 'pill-info';
          var requestedBy = a.requestedBy || (a.context && a.context.agentId) || a.agentId || '-';
          var created = a.requestedAt || a.createdAt;
          var expires = a.expiresAt;
          var pending = status === 'PENDING';
          var rowId = 'approval-row-' + a.id;
          var actions = pending
            ? '<div style="display:flex;flex-direction:column;gap:6px;min-width:220px">' +
                '<input type="text" id="' + rowId + '-reason" placeholder="' + t("reasonPlaceholder") + '" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-elevated,transparent);color:inherit" />' +
                '<div style="display:flex;gap:6px">' +
                  '<button type="button" class="btn-approval-action" data-id="' + a.id + '" data-approve="true" data-reason-input="' + rowId + '-reason">' + t("approveRequest") + '</button>' +
                  '<button type="button" class="btn-approval-action" data-id="' + a.id + '" data-approve="false" data-reason-input="' + rowId + '-reason">' + t("denyRequest") + '</button>' +
                '</div>' +
              '</div>'
            : '<span style="color:var(--text-muted);font-size:12px">' + t("none") + '</span>';
          return '<tr id="' + rowId + '">' +
            '<td class="mono" style="font-family:var(--mono);font-size:11px">' + truncate(a.id, 20) + '</td>' +
            '<td class="mono">' + escapeHtml(String(requestedBy)) + '</td>' +
            '<td><span class="capability-tag">' + escapeHtml(String(a.entityType || '')) + '.' + escapeHtml(String(a.action || '')) + '</span></td>' +
            '<td><span class="pill ' + statusClass + '">' + escapeHtml(String(status)) + '</span></td>' +
            '<td class="mono">' + escapeHtml(String(a.decidedBy || '-')) + '</td>' +
            '<td class="ltr" style="font-size:12px">' + (created ? new Date(created).toLocaleString() : '-') + '</td>' +
            '<td class="ltr" style="font-size:12px">' + (expires ? new Date(expires).toLocaleString() : '-') + '</td>' +
            '<td>' + actions + '</td>' +
            '</tr>';
        }).join('');
        tbody.querySelectorAll('.btn-approval-action').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-id');
            var approve = btn.getAttribute('data-approve') === 'true';
            var inputId = btn.getAttribute('data-reason-input');
            var input = document.getElementById(inputId);
            var reason = input ? input.value.trim() : '';
            submitApprovalDecision(id, approve, reason, btn);
          });
        });
      } catch (e) {
        var tbody2 = document.getElementById('approvals-tbody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="8" class="loading">' + t("failedLoad") + '</td></tr>';
      }
    }

    function approvalMessage(text, isError) {
      var el = document.getElementById('approvals-message');
      if (!el) return;
      el.textContent = text;
      el.className = 'kill-switch-message ' + (isError ? 'kill-switch-message-error' : 'kill-switch-message-success');
    }

    async function submitApprovalDecision(id, approve, reason, btn) {
      if (!reason || reason.length < 8) {
        approvalMessage(t("reasonTooShort"), true);
        return;
      }
      if (btn) btn.disabled = true;
      try {
        var res = await fetch('/api/v1/approvals/' + encodeURIComponent(id) + '/decide', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Atlas-Reason': reason
          },
          body: JSON.stringify({ approve: approve })
        });
        if (!res.ok) {
          var errBody = await res.json().catch(function() { return {}; });
          approvalMessage((errBody.error ? String(errBody.error) : t("actionFailed")), true);
          if (btn) btn.disabled = false;
          return;
        }
        approvalMessage(t("approvalDecideSucceeded"), false);
        await loadApprovals();
      } catch (e) {
        approvalMessage(t("actionFailed"), true);
        if (btn) btn.disabled = false;
      }
    }

    (function wireApprovalsRefresh() {
      var btn = document.getElementById('approvals-refresh');
      if (btn) btn.addEventListener('click', function() { loadApprovals(); });
    })();

    // ── Task 7: Kill Switches ────────────────────────────────────────
    //
    // Every mutation here is a real fetch to Control's own API, which in
    // turn calls apps/api over the existing Control-Plane-service bearer
    // hop (see kill-switch-control.ts / lifecycle-handoff.ts). This UI
    // never assumes success -- it only shows "activated"/"cleared" after
    // the backend responds 2xx, and always re-fetches real state afterward
    // rather than optimistically updating the table.
    var KILL_SWITCH_CATEGORY_LABELS = {
      agentDispatch: { he: "כל שילוח סוכנים (מתג ראשי)", en: "All agent dispatch (master switch)", ar: "كل إرسال الوكلاء (المفتاح الرئيسي)" },
      payments: { he: "תשלומים", en: "Payments", ar: "المدفوعات" },
      webhooksInbound: { he: "Webhooks נכנסים", en: "Inbound webhooks", ar: "Webhooks الواردة" },
      webhooksOutbound: { he: "Webhooks יוצאים", en: "Outbound webhooks", ar: "Webhooks الصادرة" },
      aiWorkers: { he: "עובדי AI ברקע", en: "Background AI workers", ar: "عمال الذكاء الاصطناعي في الخلفية" }
    };

    function killSwitchCategoryLabel(category) {
      var map = KILL_SWITCH_CATEGORY_LABELS[category];
      if (map && map[currentLang]) return map[currentLang];
      return category;
    }

    function killSwitchMessage(text, isError) {
      var el = document.getElementById('kill-switch-message');
      if (!el) return;
      el.textContent = text;
      el.className = 'kill-switch-message ' + (isError ? 'kill-switch-message-error' : 'kill-switch-message-success');
    }

    async function loadKillSwitches() {
      try {
        var res = await fetch('/api/v1/kill-switches');
        if (!res.ok) {
          var errBody = await res.json().catch(function() { return {}; });
          var tbodyErr = document.getElementById('kill-switches-tbody');
          if (tbodyErr) tbodyErr.innerHTML = '<tr><td colspan="6" class="loading">' + t("failedLoad") + (errBody.error ? ': ' + escapeHtml(errBody.error) : '') + '</td></tr>';
          return;
        }
        var data = await res.json();
        var statusList = data.status || [];
        var countEl = document.getElementById('kill-switch-count');
        if (countEl) {
          var activeCount = statusList.filter(function(s) { return s.effectiveActive; }).length;
          countEl.textContent = activeCount + ' / ' + statusList.length + ' ' + t("activeCount");
        }
        var tbody = document.getElementById('kill-switches-tbody');
        if (!tbody) return;
        tbody.innerHTML = statusList.map(function(s) {
          var envPill = s.envActive
            ? '<span class="pill pill-danger">' + t("active") + '</span>'
            : '<span class="pill pill-muted">' + t("inactive") + '</span>';
          var runtimePill = s.runtimeOverrideActive
            ? '<span class="pill pill-warning">' + t("active") + '</span>'
            : '<span class="pill pill-muted">' + t("inactive") + '</span>';
          var effectivePill = s.effectiveActive
            ? '<span class="pill pill-danger">' + t("active") + '</span>'
            : '<span class="pill pill-success">' + t("inactive") + '</span>';
          var details = s.override
            ? '<div style="font-size:11px;line-height:1.5">' +
                '<div><strong>' + t("thReason") + ':</strong> ' + escapeHtml(s.override.reason) + '</div>' +
                '<div class="mono">' + escapeHtml(s.override.setBy) + ' &middot; <span class="ltr" style="display:inline">' + new Date(s.override.setAt).toLocaleString() + '</span></div>' +
              '</div>'
            : '<span style="color:var(--text-muted);font-size:12px">' + t("none") + '</span>';
          var envNote = (s.envActive)
            ? '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">' + t("envForcedNote") + '</div>'
            : '';
          var actionLabel = s.runtimeOverrideActive ? t("clearOverride") : t("activateOverride");
          var actionName = s.runtimeOverrideActive ? 'deactivate' : 'activate';
          var rowId = 'kill-switch-row-' + s.category;
          var actionsCell =
            '<div style="display:flex;flex-direction:column;gap:6px;min-width:220px">' +
              '<input type="text" id="' + rowId + '-reason" placeholder="' + t("reasonPlaceholder") + '" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-elevated,transparent);color:inherit" />' +
              '<button type="button" class="btn-kill-switch-action" data-category="' + s.category + '" data-action="' + actionName + '" data-reason-input="' + rowId + '-reason">' + actionLabel + '</button>' +
              envNote +
            '</div>';
          return '<tr id="' + rowId + '">' +
            '<td class="mono">' + killSwitchCategoryLabel(s.category) + ' <div style="font-size:11px;color:var(--text-muted)">' + s.category + '</div></td>' +
            '<td>' + envPill + '</td>' +
            '<td>' + runtimePill + '</td>' +
            '<td>' + effectivePill + '</td>' +
            '<td>' + details + '</td>' +
            '<td>' + actionsCell + '</td>' +
            '</tr>';
        }).join('');
        tbody.querySelectorAll('.btn-kill-switch-action').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var category = btn.getAttribute('data-category');
            var action = btn.getAttribute('data-action');
            var inputId = btn.getAttribute('data-reason-input');
            var input = document.getElementById(inputId);
            var reason = input ? input.value.trim() : '';
            submitKillSwitchAction(category, action, reason, btn);
          });
        });
      } catch (e) {
        var tbody3 = document.getElementById('kill-switches-tbody');
        if (tbody3) tbody3.innerHTML = '<tr><td colspan="6" class="loading">' + t("failedLoad") + '</td></tr>';
      }
    }

    async function submitKillSwitchAction(category, action, reason, btn) {
      if (!reason || reason.length < 8) {
        killSwitchMessage(t("reasonTooShort"), true);
        return;
      }
      if (btn) btn.disabled = true;
      try {
        var res = await fetch('/api/v1/kill-switches/' + encodeURIComponent(category), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-atlas-reason': reason
          },
          body: JSON.stringify({ action: action })
        });
        var body = await res.json().catch(function() { return {}; });
        if (!res.ok) {
          killSwitchMessage(t("actionFailed") + (body.error ? ': ' + body.error : ''), true);
          if (btn) btn.disabled = false;
          return;
        }
        killSwitchMessage(action === 'activate' ? t("activateSucceeded") : t("clearSucceeded"), false);
        // Never trust the optimistic local state -- always re-fetch the
        // real, backend-confirmed status after a mutation.
        await loadKillSwitches();
      } catch (e) {
        killSwitchMessage(t("actionFailed"), true);
        if (btn) btn.disabled = false;
      }
    }

    (function wireKillSwitchRefresh() {
      var btn = document.getElementById('kill-switch-refresh');
      if (btn) btn.addEventListener('click', function() { loadKillSwitches(); });
    })();

    function applicationsMessage(text, isError) {
      var el = document.getElementById('applications-message');
      if (!el) return;
      el.textContent = text;
      el.className = 'kill-switch-message ' + (isError ? 'kill-switch-message-error' : 'kill-switch-message-success');
    }

    function trustLabel(status) {
      if (status === 'APPROVED') return t("approvedTrust");
      if (status === 'REJECTED') return t("rejectedTrust");
      return t("pendingTrust");
    }

    async function loadApplications() {
      try {
        var res = await fetch('/api/v1/applications');
        if (!res.ok) throw new Error('applications ' + res.status);
        var body = await res.json();
        var items = body.items || [];
        var countEl = document.getElementById('applications-count');
        if (countEl) countEl.textContent = items.length + ' ' + t("portfolioApps");
        var tbody = document.getElementById('applications-tbody');
        if (!tbody) return;
        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">' + t("noApplications") + '</td></tr>';
          return;
        }
        tbody.innerHTML = items.map(function(app) {
          var locked = app.applicationId === 'def-000';
          var actions = locked
            ? '<span style="color:var(--text-muted);font-size:12px">' + t("atlasSelfLocked") + '</span>'
            : '<div style="display:flex;flex-direction:column;gap:6px;min-width:180px">' +
                '<input type="text" class="reason-input" id="app-reason-' + escapeHtml(app.applicationId) + '" placeholder="' + t("reasonPlaceholder") + '" minlength="8" />' +
                '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
                  '<button type="button" class="btn-refresh" data-app-approve="true" data-app-id="' + escapeHtml(app.applicationId) + '">' + t("approveApplication") + '</button>' +
                  '<button type="button" class="btn-refresh" data-app-approve="false" data-app-id="' + escapeHtml(app.applicationId) + '">' + t("rejectApplication") + '</button>' +
                '</div>' +
              '</div>';
          return '<tr>' +
            '<td class="mono">' + escapeHtml(app.applicationId) + '</td>' +
            '<td>' + escapeHtml(app.name || app.applicationId) + '</td>' +
            '<td>' + statusPill(app.trustStatus || 'PENDING') + ' ' + trustLabel(app.trustStatus) + '</td>' +
            '<td>' + escapeHtml(app.health || 'unknown') + '</td>' +
            '<td>' + escapeHtml(app.lastEventType || t("none")) + '</td>' +
            '<td>' + actions + '</td>' +
            '</tr>';
        }).join('');
        tbody.querySelectorAll('[data-app-id]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            submitApplicationDecision(btn.getAttribute('data-app-id'), btn.getAttribute('data-app-approve') === 'true', btn);
          });
        });
      } catch (e) {
        var tbodyErr = document.getElementById('applications-tbody');
        if (tbodyErr) tbodyErr.innerHTML = '<tr><td colspan="6" class="loading">' + t("failedLoad") + '</td></tr>';
      }
    }

    async function submitApplicationDecision(id, approve, btn) {
      var reasonEl = document.getElementById('app-reason-' + id);
      var reason = reasonEl && reasonEl.value ? reasonEl.value.trim() : '';
      if (reason.length < 8) {
        applicationsMessage(t("reasonTooShort"), true);
        return;
      }
      if (btn) btn.disabled = true;
      try {
        var res = await fetch('/api/v1/applications/' + encodeURIComponent(id) + '/decide', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Atlas-Reason': reason },
          body: JSON.stringify({ approve: approve })
        });
        var body = await res.json().catch(function() { return {}; });
        if (!res.ok) {
          applicationsMessage(t("actionFailed") + (body.error ? ': ' + body.error : ''), true);
          if (btn) btn.disabled = false;
          return;
        }
        applicationsMessage(t("applicationDecideSucceeded"), false);
        await loadApplications();
      } catch (e) {
        applicationsMessage(t("actionFailed"), true);
        if (btn) btn.disabled = false;
      }
    }

    (function wireApplicationsRefresh() {
      var btn = document.getElementById('applications-refresh');
      if (btn) btn.addEventListener('click', function() { loadApplications(); });
    })();

    function visibilityLabel(visibility) {
      if (visibility === 'active') return t("activeRun");
      if (visibility === 'completed') return t("completedRun");
      if (visibility === 'failed') return t("failedRun");
      if (visibility === 'blocked') return t("blockedRun");
      if (visibility === 'paused') return t("pausedRun");
      return visibility || t("none");
    }

    async function loadExecutions() {
      var tbody = document.getElementById('execution-tbody');
      var procBody = document.getElementById('processes-tbody');
      try {
        var res = await fetch('/api/v1/executions');
        if (!res.ok) {
          var errBody = await res.json().catch(function() { return {}; });
          if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="loading">' + t("failedLoad") + (errBody.error ? ': ' + escapeHtml(errBody.error) : '') + '</td></tr>';
        } else {
          var data = await res.json();
          var items = data.items || [];
          var countEl = document.getElementById('execution-count');
          if (countEl) countEl.textContent = items.length + ' ' + t("recordsCount");
          if (tbody) {
            if (items.length === 0) {
              tbody.innerHTML = '<tr><td colspan="7" class="empty-state">' + t("noExecutions") + '</td></tr>';
            } else {
              tbody.innerHTML = items.map(function(run) {
                return '<tr>' +
                  '<td class="mono">' + escapeHtml(run.id) + '</td>' +
                  '<td>' + statusPill(run.status) + '</td>' +
                  '<td>' + visibilityLabel(run.visibility) + '</td>' +
                  '<td>' + escapeHtml(run.mode || '') + '</td>' +
                  '<td>' + escapeHtml(run.createdBy || '') + '</td>' +
                  '<td class="ltr">' + escapeHtml(run.startedAt || '') + '</td>' +
                  '<td>' + escapeHtml(run.userRequest || '') + '</td>' +
                '</tr>';
              }).join('');
            }
          }
        }
      } catch (e) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="loading">' + t("failedLoad") + '</td></tr>';
      }
      try {
        var procRes = await fetch('/api/v1/processes');
        if (!procRes.ok) throw new Error('processes');
        var processes = await procRes.json();
        var list = Array.isArray(processes) ? processes : (processes.items || []);
        var procCount = document.getElementById('process-count');
        if (procCount) procCount.textContent = list.length + ' ' + t("recordsCount");
        if (procBody) {
          if (list.length === 0) {
            procBody.innerHTML = '<tr><td colspan="4" class="empty-state">' + t("noProcesses") + '</td></tr>';
          } else {
            procBody.innerHTML = list.map(function(p) {
              return '<tr>' +
                '<td class="mono">' + escapeHtml(p.processId || p.id || '') + '</td>' +
                '<td>' + escapeHtml(p.applicationId || '') + '</td>' +
                '<td>' + statusPill(p.state || p.status || '') + '</td>' +
                '<td>' + escapeHtml(p.processType || p.type || '') + '</td>' +
              '</tr>';
            }).join('');
          }
        }
      } catch (e) {
        if (procBody) procBody.innerHTML = '<tr><td colspan="4" class="loading">' + t("failedLoad") + '</td></tr>';
      }
      var errBody = document.getElementById('error-aggregates-tbody');
      try {
        var errRes = await fetch('/api/v1/error-aggregates');
        if (!errRes.ok) throw new Error('error-aggregates');
        var errData = await errRes.json();
        var entries = errData.entries || [];
        var errCount = document.getElementById('error-aggregate-count');
        if (errCount) errCount.textContent = (errData.totalOccurrences || 0) + ' / ' + entries.length;
        if (errBody) {
          if (entries.length === 0) {
            errBody.innerHTML = '<tr><td colspan="5" class="empty-state">' + t("noErrorAggregates") + '</td></tr>';
          } else {
            errBody.innerHTML = entries.map(function(entry) {
              var sample = (entry.samples && entry.samples[0] && entry.samples[0].message) ? entry.samples[0].message : t("none");
              return '<tr>' +
                '<td class="mono">' + escapeHtml(entry.code || '') + '</td>' +
                '<td>' + escapeHtml(String(entry.count || 0)) + '</td>' +
                '<td class="ltr">' + escapeHtml(entry.firstSeen || '') + '</td>' +
                '<td class="ltr">' + escapeHtml(entry.lastSeen || '') + '</td>' +
                '<td>' + escapeHtml(sample) + '</td>' +
              '</tr>';
            }).join('');
          }
        }
      } catch (e) {
        if (errBody) errBody.innerHTML = '<tr><td colspan="5" class="loading">' + t("failedLoad") + '</td></tr>';
      }
    }

    (function wireExecutionRefresh() {
      var btn = document.getElementById('execution-refresh');
      if (btn) btn.addEventListener('click', function() { loadExecutions(); });
    })();

    // ── Initial load ───────────────────────────────────────────────────
    loadOverview();
    loadAgents();
    loadPortfolio();
    loadAudit();
    loadPolicies();
    loadApprovals();
    loadKillSwitches();
    loadApplications();
    loadExecutions();

    // ── Auto-refresh every 10s ─────────────────────────────────────────
    setInterval(function() {
      loadOverview();
      loadAudit();
    }, 10000);
  </script>
</body>
</html>`;
}
