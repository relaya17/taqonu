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
      --bg: #181c26;
      --surface: #222838;
      --surface-hover: #2c3344;
      --border: rgba(160,168,180,0.22);
      --text: #f0f2f5;
      --text-muted: #a8adb8;
      --accent: #7a9cc6;
      --accent-dim: #5a7a9c;
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
      <button class="tab" data-panel="audit" data-i18n="tabAudit">Audit Trail</button>
      <button class="tab" data-panel="policies" data-i18n="tabPolicies">Policies</button>
      <button class="tab" data-panel="approvals" data-i18n="tabApprovals">Approvals</button>
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
            </tr>
          </thead>
          <tbody id="agents-tbody">
            <tr><td colspan="6" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Audit Panel ─────────────────────────────────── -->
    <div class="panel" id="panel-audit">
      <div class="section-header">
        <h2 data-i18n="auditTrail">Audit Trail</h2>
        <span class="count" id="audit-count"></span>
      </div>
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
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th data-i18n="thId">ID</th>
              <th data-i18n="thAgent">Agent</th>
              <th data-i18n="thAction">Action</th>
              <th data-i18n="thStatus">Status</th>
              <th data-i18n="thDecidedBy">Decided By</th>
              <th data-i18n="thCreated">Created</th>
              <th data-i18n="thExpires">Expires</th>
            </tr>
          </thead>
          <tbody id="approvals-tbody">
            <tr><td colspan="7" class="loading" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    var TRANSLATIONS = {
      he: {
        tabOverview: "סקירה", tabAgents: "רישום סוכנים", tabAudit: "מסלול ביקורת", tabPolicies: "מדיניות", tabApprovals: "אישורים",
        loading: "טוען...", loadingMetrics: "טוען מדדים...", registeredAgents: "סוכנים רשומים", auditTrail: "מסלול ביקורת",
        policyDefinitions: "הגדרות מדיניות", approvalRecords: "רשומות אישור",
        thAgentId: "מזהה סוכן", thName: "שם", thStatus: "סטטוס", thCapabilities: "יכולות", thCode: "קוד", thTools: "כלים",
        thSeq: "רצף", thTimestamp: "חותמת זמן", thType: "סוג", thActor: "גורם", thRisk: "סיכון", thResult: "תוצאה", thReason: "סיבה",
        thId: "מזהה", thAgent: "סוכן", thAction: "פעולה", thDecidedBy: "הוחלט על ידי", thCreated: "נוצר", thExpires: "פג תוקף",
        statTotalAgents: "סך הסוכנים", statActiveAgents: "סוכנים פעילים", statCodeWriters: "כותבי קוד", statReadOnly: "קריאה בלבד",
        statAuditEntries: "רשומות ביקורת", statSuccesses: "הצלחות", statFailures: "כשלונות", statHighRisk: "סיכון גבוה",
        statAvgRisk: "ציון סיכון ממוצע", statApprovalsPending: "אישורים ממתינים", statUptime: "זמן פעילות", statDenied: "נדחו",
        agentsCount: "סוכנים", entriesCount: "רשומות", policiesCount: "מדיניות", recordsCount: "רשומות",
        noAgents: "אין סוכנים רשומים", noAuditTitle: "אין רשומות ביקורת", noAuditBody: "פעולות ממשל יופיעו כאן",
        noApprovalsTitle: "אין רשומות אישור", noApprovalsBody: "בקשות אישור יופיעו כאן כשסוכנים מבקשים הרשאות מורחבות",
        serviceStarting: "השירות עולה", waitingData: "ממתין לנתונים...", failedLoad: "הטעינה נכשלה",
        approvalRequired: "נדרש אישור", yes: "כן", no: "לא", none: "אין"
      },
      en: {
        tabOverview: "Overview", tabAgents: "Agent Registry", tabAudit: "Audit Trail", tabPolicies: "Policies", tabApprovals: "Approvals",
        loading: "Loading...", loadingMetrics: "Loading metrics...", registeredAgents: "Registered Agents", auditTrail: "Audit Trail",
        policyDefinitions: "Policy Definitions", approvalRecords: "Approval Records",
        thAgentId: "Agent ID", thName: "Name", thStatus: "Status", thCapabilities: "Capabilities", thCode: "Code", thTools: "Tools",
        thSeq: "Seq", thTimestamp: "Timestamp", thType: "Type", thActor: "Actor", thRisk: "Risk", thResult: "Result", thReason: "Reason",
        thId: "ID", thAgent: "Agent", thAction: "Action", thDecidedBy: "Decided By", thCreated: "Created", thExpires: "Expires",
        statTotalAgents: "Total Agents", statActiveAgents: "Active Agents", statCodeWriters: "Code Writers", statReadOnly: "Read-Only",
        statAuditEntries: "Audit Entries", statSuccesses: "Successes", statFailures: "Failures", statHighRisk: "High Risk",
        statAvgRisk: "Avg Risk Score", statApprovalsPending: "Approvals Pending", statUptime: "Uptime", statDenied: "Denied",
        agentsCount: "agents", entriesCount: "entries", policiesCount: "policies", recordsCount: "records",
        noAgents: "No agents registered", noAuditTitle: "No Audit Entries", noAuditBody: "Governance actions will appear here",
        noApprovalsTitle: "No Approval Records", noApprovalsBody: "Approval requests will appear here when agents request elevated permissions",
        serviceStarting: "Service Starting", waitingData: "Waiting for data...", failedLoad: "Failed to load",
        approvalRequired: "APPROVAL REQUIRED", yes: "YES", no: "NO", none: "NONE"
      },
      ar: {
        tabOverview: "نظرة عامة", tabAgents: "سجل الوكلاء", tabAudit: "مسار التدقيق", tabPolicies: "السياسات", tabApprovals: "الموافقات",
        loading: "جاري التحميل...", loadingMetrics: "جاري تحميل المقاييس...", registeredAgents: "الوكلاء المسجلون", auditTrail: "مسار التدقيق",
        policyDefinitions: "تعريفات السياسات", approvalRecords: "سجلات الموافقة",
        thAgentId: "معرف الوكيل", thName: "الاسم", thStatus: "الحالة", thCapabilities: "القدرات", thCode: "الكود", thTools: "الأدوات",
        thSeq: "تسلسل", thTimestamp: "الوقت", thType: "النوع", thActor: "الفاعل", thRisk: "المخاطر", thResult: "النتيجة", thReason: "السبب",
        thId: "المعرف", thAgent: "الوكيل", thAction: "الإجراء", thDecidedBy: "قرر بواسطة", thCreated: "أُنشئ", thExpires: "ينتهي",
        statTotalAgents: "إجمالي الوكلاء", statActiveAgents: "الوكلاء النشطون", statCodeWriters: "كتّاب الكود", statReadOnly: "للقراءة فقط",
        statAuditEntries: "سجلات التدقيق", statSuccesses: "نجاحات", statFailures: "إخفاقات", statHighRisk: "مخاطر عالية",
        statAvgRisk: "متوسط درجة المخاطر", statApprovalsPending: "موافقات معلّقة", statUptime: "وقت التشغيل", statDenied: "مرفوض",
        agentsCount: "وكلاء", entriesCount: "سجلات", policiesCount: "سياسات", recordsCount: "سجلات",
        noAgents: "لا يوجد وكلاء مسجلون", noAuditTitle: "لا توجد سجلات تدقيق", noAuditBody: "ستظهر إجراءات الحوكمة هنا",
        noApprovalsTitle: "لا توجد سجلات موافقة", noApprovalsBody: "ستظهر طلبات الموافقة هنا عندما يطلب الوكلاء صلاحيات أعلى",
        serviceStarting: "الخدمة قيد التشغيل", waitingData: "في انتظار البيانات...", failedLoad: "فشل التحميل",
        approvalRequired: "مطلوب موافقة", yes: "نعم", no: "لا", none: "لا يوجد"
      }
    };

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
          loadAudit();
          loadPolicies();
          loadApprovals();
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
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">' + t("noAgents") + '</td></tr>';
          return;
        }
        tbody.innerHTML = agents.map(function(a) {
          var caps = a.capabilities.map(function(c) {
            return '<span class="capability-tag">' + c.entityType + '.' + c.action + '</span>';
          }).join('');
          var tools = a.allowedTools.slice(0, 3).map(function(tool) {
            return '<span class="capability-tag">' + tool + '</span>';
          }).join('');
          return '<tr>' +
            '<td class="mono" style="font-family:var(--mono);font-size:12px">' + a.agentId + '</td>' +
            '<td>' + agentDisplayName(a) + '</td>' +
            '<td>' + statusPill(a.status) + '</td>' +
            '<td>' + (caps || '<span class="pill pill-muted">' + t("none") + '</span>') + '</td>' +
            '<td>' + (a.canWriteCode ? '<span class="pill pill-warning">' + t("yes") + '</span>' : '<span class="pill pill-muted">' + t("no") + '</span>') + '</td>' +
            '<td>' + tools + '</td>' +
            '</tr>';
        }).join('');
      } catch (e) {
        var tbody2 = document.getElementById('agents-tbody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="6" class="loading">' + t("failedLoad") + '</td></tr>';
      }
    }

    async function loadAudit() {
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
        var approvals = await res.json();
        var countEl = document.getElementById('approval-count');
        if (countEl) countEl.textContent = approvals.length + ' ' + t("recordsCount");
        var tbody = document.getElementById('approvals-tbody');
        if (!tbody) return;
        if (approvals.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><h3>' + t("noApprovalsTitle") + '</h3><p>' + t("noApprovalsBody") + '</p></td></tr>';
          return;
        }
        tbody.innerHTML = approvals.map(function(a) {
          var statusClass = a.status === 'APPROVED' ? 'pill-success' :
            a.status === 'DENIED' ? 'pill-danger' :
            a.status === 'PENDING' ? 'pill-warning' :
            a.status === 'EXPIRED' ? 'pill-muted' : 'pill-info';
          return '<tr>' +
            '<td class="mono" style="font-family:var(--mono);font-size:11px">' + truncate(a.id, 20) + '</td>' +
            '<td class="mono">' + a.agentId + '</td>' +
            '<td><span class="capability-tag">' + a.entityType + '.' + a.action + '</span></td>' +
            '<td><span class="pill ' + statusClass + '">' + a.status + '</span></td>' +
            '<td class="mono">' + (a.decidedBy || '-') + '</td>' +
            '<td class="ltr" style="font-size:12px">' + new Date(a.createdAt).toLocaleString() + '</td>' +
            '<td class="ltr" style="font-size:12px">' + new Date(a.expiresAt).toLocaleString() + '</td>' +
            '</tr>';
        }).join('');
      } catch (e) {
        var tbody2 = document.getElementById('approvals-tbody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="7" class="loading">' + t("failedLoad") + '</td></tr>';
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
