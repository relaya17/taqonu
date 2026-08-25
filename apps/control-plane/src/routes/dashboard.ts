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

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atlas Control Plane</title>
  <style>
    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --surface-hover: #232736;
      --border: #2a2e3d;
      --text: #e4e6f0;
      --text-muted: #8b8fa3;
      --accent: #6366f1;
      --accent-dim: #4f46e5;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #3b82f6;
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
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
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

    .container { max-width: 1280px; margin: 0 auto; padding: 24px; }

    /* ── Tabs ───────────────────────────────────────────── */
    .tabs {
      display: flex;
      gap: 4px;
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
      text-align: left;
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
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .section-header h2 {
      font-size: 16px;
      font-weight: 600;
    }
    .section-header .count {
      color: var(--text-muted);
      font-size: 13px;
    }

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
  </style>
</head>
<body>
  <div class="header">
    <h1>
      <span class="status-dot"></span>
      Atlas Control Plane
      <span class="badge">v0.1.0</span>
    </h1>
    <span style="color: var(--text-muted); font-size: 13px;" id="clock"></span>
  </div>

  <div class="container">
    <div class="tabs">
      <button class="tab active" data-panel="overview">Overview</button>
      <button class="tab" data-panel="agents">Agent Registry</button>
      <button class="tab" data-panel="audit">Audit Trail</button>
      <button class="tab" data-panel="policies">Policies</button>
      <button class="tab" data-panel="approvals">Approvals</button>
    </div>

    <!-- ── Overview Panel ──────────────────────────────── -->
    <div class="panel active" id="panel-overview">
      <div class="stats-grid" id="stats-grid">
        <div class="loading">Loading metrics...</div>
      </div>
    </div>

    <!-- ── Agents Panel ────────────────────────────────── -->
    <div class="panel" id="panel-agents">
      <div class="section-header">
        <h2>Registered Agents</h2>
        <span class="count" id="agent-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Agent ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Capabilities</th>
              <th>Code</th>
              <th>Tools</th>
            </tr>
          </thead>
          <tbody id="agents-tbody">
            <tr><td colspan="6" class="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Audit Panel ─────────────────────────────────── -->
    <div class="panel" id="panel-audit">
      <div class="section-header">
        <h2>Audit Trail</h2>
        <span class="count" id="audit-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Seq</th>
              <th>Timestamp</th>
              <th>Type</th>
              <th>Actor</th>
              <th>Risk</th>
              <th>Result</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">
            <tr><td colspan="7" class="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Policies Panel ──────────────────────────────── -->
    <div class="panel" id="panel-policies">
      <div class="section-header">
        <h2>Policy Definitions</h2>
        <span class="count" id="policy-count"></span>
      </div>
      <div class="policy-grid" id="policy-grid">
        <div class="loading">Loading...</div>
      </div>
    </div>

    <!-- ── Approvals Panel ─────────────────────────────── -->
    <div class="panel" id="panel-approvals">
      <div class="section-header">
        <h2>Approval Records</h2>
        <span class="count" id="approval-count"></span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Status</th>
              <th>Decided By</th>
              <th>Created</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody id="approvals-tbody">
            <tr><td colspan="7" class="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
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
      if (status === 'SUSPENDED') return '<span class="pill pill-danger">' + status + '</span>';
      if (status === 'DEGRADED') return '<span class="pill pill-warning">' + status + '</span>';
      return '<span class="pill pill-muted">' + status + '</span>';
    }

    function truncate(str, len) {
      if (!str) return '';
      return str.length > len ? str.slice(0, len) + '...' : str;
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
          '<div class="stat-card"><div class="label">Total Agents</div><div class="value info">' + stats.totalAgents + '</div></div>' +
          '<div class="stat-card"><div class="label">Active Agents</div><div class="value success">' + stats.activeAgents + '</div></div>' +
          '<div class="stat-card"><div class="label">Code Writers</div><div class="value warning">' + stats.codeWritingAgents + '</div></div>' +
          '<div class="stat-card"><div class="label">Read-Only</div><div class="value">' + stats.readOnlyAgents + '</div></div>' +
          '<div class="stat-card"><div class="label">Audit Entries</div><div class="value info">' + health.totalExecutions + '</div></div>' +
          '<div class="stat-card"><div class="label">Successes</div><div class="value success">' + health.successfulExecutions + '</div></div>' +
          '<div class="stat-card"><div class="label">Failures</div><div class="value danger">' + health.failedExecutions + '</div></div>' +
          '<div class="stat-card"><div class="label">High Risk</div><div class="value' + (health.highRiskCount > 0 ? ' danger' : '') + '">' + health.highRiskCount + '</div></div>' +
          '<div class="stat-card"><div class="label">Avg Risk Score</div><div class="value">' + health.avgRiskScore + '</div></div>' +
          '<div class="stat-card"><div class="label">Approvals Pending</div><div class="value' + (health.approvalsPending > 0 ? ' warning' : '') + '">' + health.approvalsPending + '</div></div>' +
          '<div class="stat-card"><div class="label">Uptime</div><div class="value">' + Math.floor(health.uptimeMs / 1000) + 's</div></div>' +
          '<div class="stat-card"><div class="label">Denied</div><div class="value' + (health.deniedExecutions > 0 ? ' warning' : '') + '">' + health.deniedExecutions + '</div></div>';
      } catch (e) {
        var grid2 = document.getElementById('stats-grid');
        if (grid2) grid2.innerHTML = '<div class="empty-state"><h3>Service Starting</h3><p>Waiting for data...</p></div>';
      }
    }

    async function loadAgents() {
      try {
        var res = await fetch('/api/v1/agents');
        var agents = await res.json();
        var countEl = document.getElementById('agent-count');
        if (countEl) countEl.textContent = agents.length + ' agents';
        var tbody = document.getElementById('agents-tbody');
        if (!tbody) return;
        if (agents.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No agents registered</td></tr>';
          return;
        }
        tbody.innerHTML = agents.map(function(a) {
          var caps = a.capabilities.map(function(c) {
            return '<span class="capability-tag">' + c.entityType + '.' + c.action + '</span>';
          }).join('');
          var tools = a.allowedTools.slice(0, 3).map(function(t) {
            return '<span class="capability-tag">' + t + '</span>';
          }).join('');
          return '<tr>' +
            '<td style="font-family:var(--mono);font-size:12px">' + a.agentId + '</td>' +
            '<td>' + a.displayName + '</td>' +
            '<td>' + statusPill(a.status) + '</td>' +
            '<td>' + (caps || '<span class="pill pill-muted">NONE</span>') + '</td>' +
            '<td>' + (a.canWriteCode ? '<span class="pill pill-warning">YES</span>' : '<span class="pill pill-muted">NO</span>') + '</td>' +
            '<td>' + tools + '</td>' +
            '</tr>';
        }).join('');
      } catch (e) {
        var tbody2 = document.getElementById('agents-tbody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="6" class="loading">Failed to load</td></tr>';
      }
    }

    async function loadAudit() {
      try {
        var res = await fetch('/api/v1/audit?limit=50');
        var entries = await res.json();
        var countRes = await fetch('/api/v1/audit/count');
        var countData = await countRes.json();
        var countEl = document.getElementById('audit-count');
        if (countEl) countEl.textContent = countData.count + ' entries';
        var tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        if (entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><h3>No Audit Entries</h3><p>Governance actions will appear here</p></td></tr>';
          return;
        }
        tbody.innerHTML = entries.map(function(e) {
          return '<tr>' +
            '<td style="font-family:var(--mono);font-size:12px">' + e.seq + '</td>' +
            '<td style="font-size:12px;white-space:nowrap">' + new Date(e.timestamp).toLocaleString() + '</td>' +
            '<td style="font-family:var(--mono);font-size:11px">' + truncate(e.type, 40) + '</td>' +
            '<td style="font-family:var(--mono);font-size:12px">' + e.actorId + '</td>' +
            '<td>' + riskPill(e.risk) + '</td>' +
            '<td>' + resultPill(e.result) + '</td>' +
            '<td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis">' + truncate(e.reason, 80) + '</td>' +
            '</tr>';
        }).join('');
      } catch (e) {
        var tbody2 = document.getElementById('audit-tbody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="7" class="loading">Failed to load</td></tr>';
      }
    }

    async function loadPolicies() {
      try {
        var res = await fetch('/api/v1/policies');
        var policies = await res.json();
        var countEl = document.getElementById('policy-count');
        if (countEl) countEl.textContent = policies.length + ' policies';
        var grid = document.getElementById('policy-grid');
        if (!grid) return;
        grid.innerHTML = policies.map(function(p) {
          return '<div class="policy-card">' +
            '<div class="policy-name">' + p.entityType + '.' + p.action + '</div>' +
            '<div style="margin:6px 0">' + riskPill(p.riskTier) +
            (p.requiresApproval ? ' <span class="pill pill-warning">APPROVAL REQUIRED</span>' : '') +
            '</div>' +
            '<div class="policy-desc">' + p.description + '</div>' +
            '</div>';
        }).join('');
      } catch (e) {
        var grid2 = document.getElementById('policy-grid');
        if (grid2) grid2.innerHTML = '<div class="loading">Failed to load</div>';
      }
    }

    async function loadApprovals() {
      try {
        var res = await fetch('/api/v1/approvals');
        var approvals = await res.json();
        var countEl = document.getElementById('approval-count');
        if (countEl) countEl.textContent = approvals.length + ' records';
        var tbody = document.getElementById('approvals-tbody');
        if (!tbody) return;
        if (approvals.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><h3>No Approval Records</h3><p>Approval requests will appear here when agents request elevated permissions</p></td></tr>';
          return;
        }
        tbody.innerHTML = approvals.map(function(a) {
          var statusClass = a.status === 'APPROVED' ? 'pill-success' :
            a.status === 'DENIED' ? 'pill-danger' :
            a.status === 'PENDING' ? 'pill-warning' :
            a.status === 'EXPIRED' ? 'pill-muted' : 'pill-info';
          return '<tr>' +
            '<td style="font-family:var(--mono);font-size:11px">' + truncate(a.id, 20) + '</td>' +
            '<td>' + a.agentId + '</td>' +
            '<td><span class="capability-tag">' + a.entityType + '.' + a.action + '</span></td>' +
            '<td><span class="pill ' + statusClass + '">' + a.status + '</span></td>' +
            '<td>' + (a.decidedBy || '-') + '</td>' +
            '<td style="font-size:12px">' + new Date(a.createdAt).toLocaleString() + '</td>' +
            '<td style="font-size:12px">' + new Date(a.expiresAt).toLocaleString() + '</td>' +
            '</tr>';
        }).join('');
      } catch (e) {
        var tbody2 = document.getElementById('approvals-tbody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="7" class="loading">Failed to load</td></tr>';
      }
    }

    // ── Initial load ───────────────────────────────────────────────────
    loadOverview();
    loadAgents();
    loadAudit();
    loadPolicies();
    loadApprovals();

    // ── Auto-refresh every 10s ─────────────────────────────────────────
    setInterval(function() {
      loadOverview();
      loadAudit();
    }, 10000);
  </script>
</body>
</html>`;
}
