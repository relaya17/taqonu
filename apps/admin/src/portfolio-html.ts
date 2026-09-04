import type { PortfolioGovernanceSnapshot } from "@atlas/shared";
import type { PortfolioProjection } from "./portfolio-projection.js";

export interface PortfolioPageData {
  readonly controlOrigin: string;
  readonly adminOrigin: string;
  readonly projection: PortfolioProjection;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Row-level field access stays loosely typed (Record<string, unknown>) on
 * purpose, matching the pattern the pre-deletion 82e883e implementation
 * used for the same rendering job - the snapshot's row shapes are wide
 * (many optional/nested fields) and this keeps rendering resilient to a
 * field being absent rather than throwing.
 */
type Row = Record<string, unknown>;

function applicationsSection(snapshot: PortfolioGovernanceSnapshot): string {
  const rows = snapshot.applications as unknown as readonly Row[];
  if (rows.length === 0) {
    return `<p class="muted" data-i18n="portfolioNoApps">No portfolio applications recorded.</p>`;
  }
  return `<div class="grid">${rows
    .map(
      (app) => `<article class="card">
        <h3>${esc(app["name"] ?? app["slug"])}</h3>
        <p class="muted">${esc(app["slug"])} · ${esc(app["role"])} · ${esc(String(app["sourceCommit"] ?? "").slice(0, 12))}</p>
        <p>${esc(app["notes"] ?? "")}</p>
      </article>`,
    )
    .join("")}</div>`;
}

function sourceAgentsSection(snapshot: PortfolioGovernanceSnapshot): string {
  const rows = snapshot.sourceAgents as unknown as readonly Row[];
  if (rows.length === 0) {
    return `<p class="muted" data-i18n="portfolioNoSourceAgents">No source agents recorded.</p>`;
  }
  const appsById = new Map(
    (snapshot.applications as unknown as readonly Row[]).map((app) => [
      String(app["id"] ?? ""),
      app,
    ]),
  );
  return `<div class="grid">${rows
    .map((sa) => {
      const app = appsById.get(String(sa["applicationId"] ?? ""));
      const runtime =
        sa["runtimeStatus"] && typeof sa["runtimeStatus"] === "object"
          ? (sa["runtimeStatus"] as Row)
          : {};
      const provenance =
        sa["provenance"] && typeof sa["provenance"] === "object"
          ? (sa["provenance"] as Row)
          : {};
      return `<article class="card">
        <h3>${esc(sa["displayName"] ?? sa["sourceKey"])}</h3>
        <p class="muted">${esc(sa["sourceKey"])} · ${esc(app?.["slug"] ?? "")} · ${esc(sa["implementationClass"])}</p>
        <p>Verification: ${esc(sa["verificationStatus"])} · Runtime: ${esc(runtime["state"] ?? "UNKNOWN")} / NOT_PROBED</p>
        <p class="muted">${esc(provenance["sourceRepository"])} @ ${esc(String(provenance["sourceCommit"] ?? "").slice(0, 12))}</p>
      </article>`;
    })
    .join("")}</div>`;
}

function capabilitiesSection(snapshot: PortfolioGovernanceSnapshot): string {
  const rows = snapshot.capabilities as unknown as readonly Row[];
  if (rows.length === 0) {
    return `<p class="muted" data-i18n="portfolioNoCapabilities">No capabilities recorded.</p>`;
  }
  const canonById = new Map(
    (snapshot.canonicalCapabilities as unknown as readonly Row[]).map((c) => [
      String(c["id"] ?? ""),
      c,
    ]),
  );
  return `<div class="grid">${rows
    .map((cap) => {
      const canon = cap["canonicalCapabilityId"]
        ? canonById.get(String(cap["canonicalCapabilityId"]))
        : null;
      const canonLabel = canon ? String(canon["key"] ?? "-") : "—";
      return `<article class="card">
        <h3>${esc(cap["name"])}</h3>
        <p class="muted">${esc(cap["domain"])} · Canonical: ${esc(canonLabel)}</p>
        <p>${esc(String(cap["purpose"] ?? "").slice(0, 100))}</p>
      </article>`;
    })
    .join("")}</div>`;
}

function listSection(
  rows: readonly Row[],
  emptyKey: string,
  emptyText: string,
  render: (row: Row) => string,
  limit?: number,
): string {
  if (rows.length === 0) {
    return `<p class="muted" data-i18n="${emptyKey}">${emptyText}</p>`;
  }
  const shown = limit ? rows.slice(0, limit) : rows;
  return `<ul class="notes">${shown.map(render).join("")}</ul>`;
}

function dedupSection(snapshot: PortfolioGovernanceSnapshot): string {
  return listSection(
    snapshot.dedupRelations as unknown as readonly Row[],
    "portfolioNoDedup",
    "No deduplication relations recorded.",
    (d) =>
      `<li><strong>${esc(d["kind"] ?? "UNKNOWN")}</strong> — ${esc(String(d["notes"] ?? "").slice(0, 80))}</li>`,
    20,
  );
}

function decisionsSection(snapshot: PortfolioGovernanceSnapshot): string {
  return listSection(
    snapshot.governanceDecisions as unknown as readonly Row[],
    "portfolioNoDecisions",
    "No governance decisions recorded.",
    (dec) =>
      `<li><strong>${esc(dec["action"] ?? "UNKNOWN")}</strong> (${esc(dec["status"] ?? "UNKNOWN")}) — ${esc(String(dec["rationale"] ?? "").slice(0, 80))}</li>`,
  );
}

function evidenceSection(snapshot: PortfolioGovernanceSnapshot): string {
  return listSection(
    snapshot.evidence as unknown as readonly Row[],
    "portfolioNoEvidence",
    "No evidence recorded.",
    (ev) =>
      `<li><strong>${esc(ev["kind"] ?? "UNKNOWN")}</strong> (${esc(ev["authorityRank"] ?? "")}) — ${esc(String(ev["path"] ?? "").slice(0, 60))}</li>`,
    15,
  );
}

function conflictsSection(snapshot: PortfolioGovernanceSnapshot): string {
  return listSection(
    snapshot.conflicts as unknown as readonly Row[],
    "portfolioNoConflicts",
    "No conflicts recorded.",
    (c) =>
      `<li><strong>${esc(c["key"])}</strong> (${esc(c["status"])}) — ${esc(c["summary"])}</li>`,
  );
}

/**
 * Phase 11.9 - Portfolio Governance (observability) Admin page.
 *
 * Recovers the rendering intent of the pre-deletion 82e883e implementation
 * (apps/admin/src/owner-html.ts, deleted as collateral damage by 4883bfd).
 * Adapted, not restored verbatim: reads from PortfolioProjection (Control
 * Plane's existing read-only projection) instead of a bespoke OwnerPageData
 * blob, and adds an explicit error state distinct from an empty-but-
 * reachable snapshot - the historical version conflated "no data" with
 * "fetch failed" (both rendered as an empty <div class="grid">).
 *
 * This module never writes portfolio data and never talks to the tenant
 * API directly - writes and the canonical audit trail stay on Atlas API's
 * existing /api/v1/portfolio-governance/decisions route, unchanged.
 */
export function renderPortfolioHtml(data: PortfolioPageData): string {
  const controlHref = data.controlOrigin.replace(/\/$/, "");
  const { projection } = data;

  const body =
    projection.reachability === "UNREACHABLE"
      ? `<section class="hero">
      <h1 data-i18n="portfolioTitle">Portfolio governance</h1>
      <p class="banner" data-i18n="portfolioError">Portfolio projection is unreachable. Admin does not invent Portfolio Governance state.</p>
      <p class="muted">${esc(projection.detail ?? "Unknown error")}</p>
    </section>`
      : `<section class="hero">
      <h1 data-i18n="portfolioTitle">Portfolio governance</h1>
      <p class="muted" data-i18n="portfolioNote">Inspect sibling applications without duplicating them. Fabric remains the only Atlas execution registry. Source runtimes are UNKNOWN / NOT_PROBED.</p>
    </section>
    <main>
      <section>
        <h2 data-i18n="portfolioApps">Applications</h2>
        ${applicationsSection(projection.snapshot as PortfolioGovernanceSnapshot)}
      </section>
      <section>
        <h2 data-i18n="portfolioSourceAgents">Source agents</h2>
        ${sourceAgentsSection(projection.snapshot as PortfolioGovernanceSnapshot)}
      </section>
      <section>
        <h2 data-i18n="portfolioCapabilities">Capabilities (${esc((projection.snapshot as PortfolioGovernanceSnapshot).capabilities.length)})</h2>
        ${capabilitiesSection(projection.snapshot as PortfolioGovernanceSnapshot)}
      </section>
      <section>
        <h2 data-i18n="portfolioDedup">Deduplication relations (${esc((projection.snapshot as PortfolioGovernanceSnapshot).dedupRelations.length)})</h2>
        ${dedupSection(projection.snapshot as PortfolioGovernanceSnapshot)}
      </section>
      <section>
        <h2 data-i18n="portfolioEvidence">Evidence (${esc((projection.snapshot as PortfolioGovernanceSnapshot).evidence.length)})</h2>
        ${evidenceSection(projection.snapshot as PortfolioGovernanceSnapshot)}
      </section>
      <section>
        <h2 data-i18n="portfolioDecisions">Governance decisions (${esc((projection.snapshot as PortfolioGovernanceSnapshot).governanceDecisions.length)})</h2>
        ${decisionsSection(projection.snapshot as PortfolioGovernanceSnapshot)}
      </section>
      <section>
        <h2 data-i18n="portfolioConflicts">Conflicts (${esc((projection.snapshot as PortfolioGovernanceSnapshot).conflicts.length)})</h2>
        ${conflictsSection(projection.snapshot as PortfolioGovernanceSnapshot)}
      </section>
    </main>`;

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Atlas Admin — Portfolio governance</title>
  <style>
    :root { --bg:#0b0d10; --card:#14171c; --line:#30343b; --text:#f5f5f5; --muted:#aeb4be; --accent:#e8c37a; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 sans-serif; }
    nav { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:1px solid var(--line); }
    a { color:var(--accent); }
    .hero { padding:32px 24px 16px; }
    .hero h1 { margin:0 0 8px; font-size:1.75rem; }
    .muted { color:var(--muted); }
    .banner { margin:0; padding:12px 14px; border:1px solid var(--line); background:#1b1510; }
    main { padding:0 24px 32px; }
    main section { margin-bottom:28px; }
    main h2 { font-size:1.1rem; border-bottom:1px solid var(--line); padding-bottom:8px; }
    .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
    .card { padding:16px; border:1px solid var(--line); background:var(--card); }
    .notes { padding-left:18px; color:var(--muted); font-size:14px; }
  </style>
</head>
<body>
  <nav>
    <strong>Atlas Admin</strong>
    <div>
      <a href="/">Overview</a>
      ·
      <a href="${esc(controlHref)}" data-i18n="navControl">Control</a>
    </div>
  </nav>
  ${body}
  <script>
    const i18n = {
      he: {
        portfolioTitle: "ממשל תיק יישומים",
        portfolioNote: "בדיקת אפליקציות אחיות בלי לשכפל אותן. Fabric הוא רישום הביצוע היחיד. זמן ריצה של מקורות: UNKNOWN / NOT_PROBED.",
        portfolioError: "תצוגת תיק היישומים אינה זמינה. אדמין לא ממציא מצב ממשל תיק יישומים.",
        portfolioApps: "יישומים",
        portfolioSourceAgents: "סוכני מקור",
        portfolioCapabilities: "יכולות",
        portfolioDedup: "יחסי כפילות",
        portfolioEvidence: "ראיות",
        portfolioDecisions: "החלטות ממשל",
        portfolioConflicts: "התנגשויות",
        navControl: "Control",
      },
      en: {
        portfolioTitle: "Portfolio governance",
        portfolioNote: "Inspect sibling applications without duplicating them. Fabric remains the only Atlas execution registry. Source runtimes are UNKNOWN / NOT_PROBED.",
        portfolioError: "Portfolio projection is unreachable. Admin does not invent Portfolio Governance state.",
        portfolioApps: "Applications",
        portfolioSourceAgents: "Source agents",
        portfolioCapabilities: "Capabilities",
        portfolioDedup: "Deduplication relations",
        portfolioEvidence: "Evidence",
        portfolioDecisions: "Governance decisions",
        portfolioConflicts: "Conflicts",
        navControl: "Control",
      },
      ar: {
        portfolioTitle: "حوكمة المحفظة",
        portfolioNote: "افحص التطبيقات الشقيقة دون تكرارها. Fabric هو سجل التنفيذ الوحيد. حالة تشغيل المصادر UNKNOWN / NOT_PROBED.",
        portfolioError: "عرض المحفظة غير متاح. لا تخترع Admin حالة حوكمة المحفظة.",
        portfolioApps: "التطبيقات",
        portfolioSourceAgents: "وكلاء المصدر",
        portfolioCapabilities: "القدرات",
        portfolioDedup: "علاقات التكرار",
        portfolioEvidence: "الأدلة",
        portfolioDecisions: "قرارات الحوكمة",
        portfolioConflicts: "التعارضات",
        navControl: "Control",
      },
    };
  </script>
</body>
</html>`;
}
