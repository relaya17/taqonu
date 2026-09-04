import type { PlatformOverview, PlatformSupervisionSnapshot } from "./platform-overview.js";

export interface PlatformPageData {
  readonly controlOrigin: string;
  readonly studioOrigin: string;
  readonly adminOrigin: string;
  readonly promoOnly?: boolean;
  readonly demoEmail?: string;
  readonly demoPassword?: string;
  readonly overview?: PlatformOverview | null;
}

const PROMO_VIDEO =
  "https://res.cloudinary.com/dora8sxcb/video/upload/v1787766615/hailuo-03_ATLAS_SEN_ATLAS_SENTINEL_Premium_Hero_Image_Generation_Specification_PURPOSE_Cre-0_1_opykbe.mp4";

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function metricList(snapshot: PlatformSupervisionSnapshot): string {
  const entries = Object.entries(snapshot.metrics);
  if (entries.length === 0) {
    return `<p class="muted" data-i18n="noLiveMetrics">No live metrics claimed.</p>`;
  }
  return `<dl class="metrics">${entries
    .map(
      ([key, value]) =>
        `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`,
    )
    .join("")}</dl>`;
}

function notes(snapshot: PlatformSupervisionSnapshot): string {
  return `<ul class="notes">${snapshot.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>`;
}

function surfaceCard(snapshot: PlatformSupervisionSnapshot, extra = ""): string {
  return `<article class="card" data-surface="${esc(snapshot.surface)}">
    <h2>${esc(snapshot.surface)}</h2>
    <p class="muted">${esc(snapshot.role)} · parent ${esc(snapshot.parentSurface ?? "none")}</p>
    <p>${esc(snapshot.runtime)} · ${esc(snapshot.origin)}</p>
    <p>Reachability: <strong>${esc(snapshot.reachability)}</strong> · Health: <strong>${esc(snapshot.health)}</strong></p>
    ${metricList(snapshot)}
    ${notes(snapshot)}
    ${extra}
  </article>`;
}

export function renderPlatformHtml(data: PlatformPageData): string {
  const studioHref = `${data.studioOrigin.replace(/\/$/, "")}/he/studio`;
  const controlHref = data.controlOrigin.replace(/\/$/, "");
  const overview = data.overview;
  const privateMain =
    data.promoOnly || !overview
      ? ""
      : `<main>
    <p class="banner" data-i18n="hierarchyBanner">Atlas Admin supervises Control and Studio. This is not Control's operational dashboard.</p>
    <p><a href="/portfolio" data-i18n="openPortfolio">Open portfolio governance</a></p>
    <section class="hierarchy" data-hierarchy="admin-control-studio">
      <pre class="tree">ATLAS ADMIN
├── ATLAS CONTROL  → connected apps / processes / operational agents
└── ATLAS STUDIO   → existing developer workspace (apps/web /studio)</pre>
    </section>
    <section class="grid">
      ${surfaceCard(overview.admin)}
      ${surfaceCard(
        overview.control,
        `<p><a href="${esc(controlHref)}" data-i18n="openControl">Open Control operational UI</a></p>`,
      )}
      ${surfaceCard(
        overview.studio,
        `<p><a href="${esc(studioHref)}" data-i18n="openStudio">Open Studio workspace</a></p>`,
      )}
    </section>
    <p class="muted" data-i18n="tenantAdminNote">apps/web/app/admin is tenant administration — not this Atlas Admin.</p>
  </main>`;

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Atlas Admin</title>
  <style>
    :root { --bg:#0b0d10; --card:#14171c; --line:#30343b; --text:#f5f5f5; --muted:#aeb4be; --accent:#e8c37a; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 sans-serif; }
    nav { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:1px solid var(--line); }
    a { color:var(--accent); }
    .hero { padding:48px 24px 24px; }
    .hero h1 { margin:0 0 8px; font-size:2rem; }
    .muted { color:var(--muted); }
    .banner { margin:0 24px 16px; padding:12px 14px; border:1px solid var(--line); background:#1b1510; }
    .tree { margin:0 24px 24px; padding:16px; background:#101318; border:1px solid var(--line); overflow:auto; }
    .grid { display:grid; gap:16px; padding:0 24px 32px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
    .card { padding:16px; border:1px solid var(--line); background:var(--card); }
    .metrics { display:grid; gap:8px; }
    .metrics div { display:flex; justify-content:space-between; gap:12px; }
    .notes { padding-left:18px; color:var(--muted); font-size:14px; }
    .video-bg { position:fixed; inset:0; z-index:-2; overflow:hidden; }
    .video-bg video { width:100%; height:100%; object-fit:cover; opacity:.28; }
    .cta { display:inline-block; margin-top:16px; padding:10px 16px; background:#fff; color:#111; text-decoration:none; font-weight:700; }
  </style>
</head>
<body>
  <nav>
    <strong>Atlas Admin</strong>
    <div>
      <a href="${esc(studioHref)}" data-i18n="navStudio">Studio</a>
      ·
      <a href="${esc(controlHref)}" data-i18n="navControl">Control</a>
      ·
      <a href="/portfolio" data-i18n="navPortfolio">Portfolio</a>
      ·
      <a href="/login" data-i18n="navLogin">Login</a>
    </div>
  </nav>
  ${
    data.promoOnly
      ? `<div class="video-bg"><video autoplay muted loop playsinline><source src="${PROMO_VIDEO}" type="video/mp4"></video></div>
  <section class="hero">
    <h1 data-i18n="heroTitle">Atlas Admin</h1>
    <p class="muted" data-i18n="heroSubtitle">Platform supervisor for Control and Studio. Not an operational Control clone.</p>
    <a class="cta" href="/login" data-i18n="btnLogin">Owner login</a>
    ${
      data.demoEmail && data.demoPassword
        ? `<p class="muted">${esc(data.demoEmail)} / ${esc(data.demoPassword)}</p>`
        : ""
    }
  </section>`
      : `<section class="hero">
    <h1 data-i18n="heroTitle">Atlas Admin</h1>
    <p class="muted" data-i18n="heroSubtitle">Platform supervisor for Control and Studio. Not an operational Control clone.</p>
  </section>
  ${privateMain}`
  }
  <script>
    const i18n = {
      he: {
        heroTitle: "אדמין Atlas",
        heroSubtitle: "שכבת פיקוח על Control ו-Studio. זה לא דשבורד תפעולי של Control.",
        btnLogin: "כניסת בעלים",
        navStudio: "Studio",
        navControl: "Control",
        navPortfolio: "תיק יישומים",
        navLogin: "כניסה",
        hierarchyBanner: "אדמין מפקח על Control ו-Studio. זה אינו הדשבורד התפעולי של Control.",
        openPortfolio: "פתח ממשל תיק יישומים",
        openControl: "פתח את ממשק Control התפעולי",
        openStudio: "פתח את סביבת Studio",
        tenantAdminNote: "apps/web/app/admin הוא ניהול דייר — לא אדמין הפלטפורמה.",
        noLiveMetrics: "אין מדדים חיים שנטענו.",
      },
      en: {
        heroTitle: "Atlas Admin",
        heroSubtitle: "Platform supervisor for Control and Studio. Not an operational Control clone.",
        btnLogin: "Owner login",
        navStudio: "Studio",
        navControl: "Control",
        navPortfolio: "Portfolio",
        navLogin: "Login",
        hierarchyBanner: "Atlas Admin supervises Control and Studio. This is not Control's operational dashboard.",
        openPortfolio: "Open portfolio governance",
        openControl: "Open Control operational UI",
        openStudio: "Open Studio workspace",
        tenantAdminNote: "apps/web/app/admin is tenant administration — not this Atlas Admin.",
        noLiveMetrics: "No live metrics claimed.",
      },
      ar: {
        heroTitle: "إدارة Atlas",
        heroSubtitle: "طبقة إشراف على Control وStudio. ليست نسخة من لوحة Control.",
        btnLogin: "دخول المالك",
        navStudio: "Studio",
        navControl: "Control",
        navPortfolio: "المحفظة",
        navLogin: "دخول",
        hierarchyBanner: "تشرف Admin على Control وStudio. هذه ليست لوحة Control التشغيلية.",
        openPortfolio: "افتح حوكمة المحفظة",
        openControl: "افتح واجهة Control التشغيلية",
        openStudio: "افتح مساحة Studio",
        tenantAdminNote: "apps/web/app/admin إدارة مستأجر وليست إدارة منصة Atlas.",
        noLiveMetrics: "لا توجد مقاييس حية.",
      },
    };
  </script>
</body>
</html>`;
}
