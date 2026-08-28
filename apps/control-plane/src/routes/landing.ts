/**
 * Landing page — Atlas Sentinel public-facing promo + registration.
 *
 * Served at `/` on the control plane surface (port 3100). The existing
 * governance dashboard moves to `/dashboard`. This page is the first
 * thing a visitor sees: a hero video, a value proposition, and a
 * registration form.
 */

const VIDEO_URL =
  "https://res.cloudinary.com/dora8sxcb/video/upload/v1786694419/hailuo-2_3_ATLAS_SEN_ATLAS_SENTINEL_Premium_Hero_Image_Generation_Specification_PURPOSE_Cre-0_1_wj2dd4.mp4";

const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.2A8.4 8.4 0 1 1 9.8 3 6.8 6.8 0 1 0 21 14.2z"/></svg>';
const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3.2v1.4M12 19.4v1.4M4.6 4.6l1 1M18.4 18.4l1 1M3.2 12h1.4M19.4 12h1.4M4.6 19.4l1-1M18.4 5.6l1-1"/></svg>';
const ICON_GLOBE =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6M12 3c2.4 2.6 3.7 5.6 3.7 9s-1.3 6.4-3.7 9c-2.4-2.6-3.7-5.6-3.7-9S9.6 5.6 12 3z"/></svg>';
const ICON_MENU =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 7.5h14M5 12h14M5 16.5h14"/></svg>';

const TRANSLATIONS = {
  he: {
    title: "Atlas Sentinel — פלטפורמת פיקוח AI",
    heroEyebrow: "פלטפורמת ממשל AI",
    heroTitle1: "Atlas Sentinel",
    heroTitle2: "פיקוח ובקרה",
    heroSubtitle: "ממשל בזמן אמת, מסלולי ביקורת ואכיפת מדיניות למערכות סוכני AI. נראות מלאה. אפס נקודות עיוורות.",
    navFeatures: "יכולות",
    navDashboard: "לוח בקרה",
    navAtlas: "Atlas",
    navOwnerAdmin: "ניהול בעלים",
    navRegister: "הרשמה",
    formTitle: "התחברות והרשמה",
    formSubtitle: "מצב פיתוח — atlas.local",
    labelDisplayName: "שם תצוגה",
    labelEmail: "אימייל",
    labelPassword: "סיסמה",
    btnLogin: "התחברות",
    btnRegister: "הרשמה",
    featuresTitle: "ממשל AI מקיף",
    featuresSubtitle: "כל מה שצריך לפיקוח, ביקורת ובקרה על פעולות סוכני AI",
    featureAgentRegistry: "רישום סוכנים",
    featureAgentRegistryDesc: "9 סוכנים רשומים עם פרופילי יכולות מלאים, הרשאות כלים וסיווג רמת סיכון",
    featureAuditTrail: "מסלול ביקורת",
    featureAuditTrailDesc: "יומנים עמידים בפני שינוי עם שרשרת SHA-256. כל החלטה מתועדת, ניתנת לחיפוש ולאימות",
    featureRiskScoring: "ניקוד סיכונים",
    featureRiskScoringDesc: "סיווג סיכונים בשלוש רמות: AUTO_LOG, APPROVAL, BLOCK. רצפות רמת אמון למקורות לא מהימנים",
    featurePolicyEnforcement: "אכיפת מדיניות",
    featurePolicyEnforcementDesc: "9 הגדרות מדיניות עם מיפוי ישות/פעולה. ארכיטקטורת fail-closed — נדחה כברירת מחדל",
    featureApprovalWorkflow: "תהליך אישורים",
    featureApprovalWorkflowDesc: "אישורים קשורים לחפץ עם תפוגת TTL, מניעת הפעלה חוזרת והתאמת ישות/פעולה/סוכן",
    featureHealthMetrics: "מדדי בריאות",
    featureHealthMetricsDesc: "ספירות ביצוע בזמן אמת, שיעורי כשלון, צריכת אישורים והתפלגות סיכונים ממוצעת",
    statTestsPassing: "טסטים עוברים",
    statAiAgents: "סוכני AI",
    statPipelineStages: "שלבי Pipeline",
    statBlindSpots: "נקודות עיוורות",
    footerCopyright: "© 2026 Atlas Sentinel. פלטפורמת ממשל ופיקוח AI.",
    msgLoggingIn: "מתחבר...",
    msgRegistering: "נרשם...",
    msgSuccess: "הצלחה",
    msgError: "שגיאה",
  },
  en: {
    title: "Atlas Sentinel — AI Oversight Platform",
    heroEyebrow: "AI Governance Platform",
    heroTitle1: "Atlas Sentinel",
    heroTitle2: "Oversight & Control",
    heroSubtitle: "Real-time governance, audit trails, and policy enforcement for AI agent systems. Full visibility. Zero blind spots.",
    navFeatures: "Features",
    navDashboard: "Dashboard",
    navAtlas: "Atlas",
    navOwnerAdmin: "Owner Admin",
    navRegister: "Register",
    formTitle: "Login & Register",
    formSubtitle: "Dev mode — atlas.local",
    labelDisplayName: "Display Name",
    labelEmail: "Email",
    labelPassword: "Password",
    btnLogin: "Login",
    btnRegister: "Register",
    featuresTitle: "Complete AI Governance",
    featuresSubtitle: "Everything you need to oversee, audit, and control AI agent operations",
    featureAgentRegistry: "Agent Registry",
    featureAgentRegistryDesc: "9 registered agents with full capability profiles, tool permissions, and risk tier classification",
    featureAuditTrail: "Audit Trail",
    featureAuditTrailDesc: "SHA-256 hash-chained tamper-evident logs. Every decision recorded, searchable, and verifiable",
    featureRiskScoring: "Risk Scoring",
    featureRiskScoringDesc: "Three-tier risk classification: AUTO_LOG, APPROVAL, BLOCK. Trust-level floors for untrusted sources",
    featurePolicyEnforcement: "Policy Enforcement",
    featurePolicyEnforcementDesc: "9 policy definitions with entity/action mapping. Fail-closed architecture — denied by default",
    featureApprovalWorkflow: "Approval Workflow",
    featureApprovalWorkflowDesc: "Artifact-bound approvals with TTL expiry, replay prevention, and entity/action/agent matching",
    featureHealthMetrics: "Health Metrics",
    featureHealthMetricsDesc: "Real-time execution counts, failure rates, approval consumption, and average risk distribution",
    statTestsPassing: "Tests Passing",
    statAiAgents: "AI Agents",
    statPipelineStages: "Pipeline Stages",
    statBlindSpots: "Blind Spots",
    footerCopyright: "© 2026 Atlas Sentinel. AI Governance & Oversight Platform.",
    msgLoggingIn: "Logging in...",
    msgRegistering: "Registering...",
    msgSuccess: "Success",
    msgError: "Error",
  },
  ar: {
    title: "Atlas Sentinel — منصة مراقبة الذكاء الاصطناعي",
    heroEyebrow: "منصة حوكمة الذكاء الاصطناعي",
    heroTitle1: "Atlas Sentinel",
    heroTitle2: "الرقابة والتحكم",
    heroSubtitle: "حوكمة في الوقت الفعلي، مسارات تدقيق، وتطبيق السياسات لأنظمة وكلاء الذكاء الاصطناعي. رؤية كاملة. لا نقاط عمياء.",
    navFeatures: "الميزات",
    navDashboard: "لوحة التحكم",
    navAtlas: "Atlas",
    navOwnerAdmin: "إدارة المالك",
    navRegister: "التسجيل",
    formTitle: "تسجيل الدخول والتسجيل",
    formSubtitle: "وضع التطوير — atlas.local",
    labelDisplayName: "اسم العرض",
    labelEmail: "البريد الإلكتروني",
    labelPassword: "كلمة المرور",
    btnLogin: "تسجيل الدخول",
    btnRegister: "التسجيل",
    featuresTitle: "حوكمة ذكاء اصطناعي شاملة",
    featuresSubtitle: "كل ما تحتاجه للإشراف والتدقيق والتحكم في عمليات وكلاء الذكاء الاصطناعي",
    featureAgentRegistry: "سجل الوكلاء",
    featureAgentRegistryDesc: "9 وكلاء مسجلين مع ملفات قدرات كاملة وأذونات أدوات وتصنيف مستوى المخاطر",
    featureAuditTrail: "مسار التدقيق",
    featureAuditTrailDesc: "سجلات مقاومة للتلاعب بسلسلة SHA-256. كل قرار مسجل وقابل للبحث والتحقق",
    featureRiskScoring: "تقييم المخاطر",
    featureRiskScoringDesc: "تصنيف المخاطر ثلاثي المستويات: AUTO_LOG، APPROVAL، BLOCK. حدود مستوى الثقة للمصادر غير الموثوقة",
    featurePolicyEnforcement: "تطبيق السياسات",
    featurePolicyEnforcementDesc: "9 تعريفات سياسات مع تعيين الكيان/الإجراء. بنية fail-closed — مرفوض افتراضياً",
    featureApprovalWorkflow: "سير عمل الموافقات",
    featureApprovalWorkflowDesc: "موافقات مرتبطة بالقطع الأثرية مع انتهاء TTL ومنع إعادة التشغيل ومطابقة الكيان/الإجراء/الوكيل",
    featureHealthMetrics: "مقاييس الصحة",
    featureHealthMetricsDesc: "إحصائيات التنفيذ في الوقت الفعلي، معدلات الفشل، استهلاك الموافقات، ومتوسط توزيع المخاطر",
    statTestsPassing: "الاختبارات الناجحة",
    statAiAgents: "وكلاء الذكاء الاصطناعي",
    statPipelineStages: "مراحل خط الأنابيب",
    statBlindSpots: "النقاط العمياء",
    footerCopyright: "© 2026 Atlas Sentinel. منصة حوكمة ومراقبة الذكاء الاصطناعي.",
    msgLoggingIn: "جاري تسجيل الدخول...",
    msgRegistering: "جاري التسجيل...",
    msgSuccess: "نجاح",
    msgError: "خطأ",
  },
} as const;

export function getLandingHtml(): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atlas Sentinel — AI Oversight Platform</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #181c26;
      --bg-solid: #181c26;
      --surface: #2c3342;
      --surface-2: #3a4254;
      --surface-glass: rgba(30,36,48,0.35);
      --border: rgba(200,208,220,0.15);
      --text: #f0f2f5;
      --text-secondary: #d0d4dc;
      --text-muted: #a8adb8;
      --accent: #7a9cc6;
      --accent-fill: #3d5a7a;
      --accent-glow: rgba(122,156,198,0.3);
      --accent-hover: #8eb0d8;
      --teal: #4ade9a;
      --teal-fill: #0f7a52;
      --on-fill: #ffffff;
      --teal-glow: rgba(74,222,154,0.18);
      --amber: #fbbf24;
      --coral: #f87171;
      --font: 'Inter', system-ui, -apple-system, sans-serif;
      --mono: 'JetBrains Mono', monospace;
      --overlay-dark: rgba(24,28,38,0.6);
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --bg-solid: #f8fafc;
      --surface: rgba(255,255,255,0.8);
      --surface-2: rgba(255,255,255,0.9);
      --surface-glass: rgba(255,255,255,0.45);
      --border: rgba(0,0,0,0.1);
      --text: #1a1d24;
      --text-secondary: #4a5568;
      --text-muted: #4a5568;
      --accent: #2c5282;
      --accent-glow: rgba(122,156,198,0.35);
      --overlay-dark: rgba(0,0,0,0.25);
    }

    body {
      font-family: var(--font);
      background: var(--bg-solid);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      transition: background 0.3s, color 0.3s;
    }

    /* ── Nav ──────────────────────────────────────── */
    nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 18px;
      min-height: 48px;
      background: rgba(24,28,38,0.68);
      backdrop-filter: blur(24px) saturate(1.15);
      -webkit-backdrop-filter: blur(24px) saturate(1.15);
      border-bottom: 1px solid rgba(200,208,220,0.1);
    }

    .nav-start {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .nav-end {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .nav-brand {
      display: flex;
      flex-direction: column;
      gap: 0;
      text-decoration: none;
      color: var(--text);
      line-height: 1.15;
      min-width: 0;
    }

    .nav-brand .app-name {
      font-size: 13px;
      font-weight: 650;
      letter-spacing: -0.02em;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .nav-brand .app-name .logo-icon {
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

    .nav-brand .app-name .logo-icon svg {
      width: 10px;
      height: 10px;
      fill: var(--text-secondary);
    }

    .nav-brand .app-subtitle {
      font-size: 8px;
      font-weight: 500;
      color: var(--text-muted);
      letter-spacing: 0.04em;
      padding-inline-start: 24px;
    }

    .nav-auth {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-login {
      background: rgba(36,42,54,0.6);
      color: var(--text-secondary);
      border: 1px solid rgba(200,208,220,0.15);
      padding: 6px 14px;
      border-radius: 6px;
      font: 500 12px/1.2 var(--font);
      cursor: pointer;
      transition: all 0.15s;
      text-decoration: none;
    }

    .btn-login:hover {
      background: rgba(160,168,180,0.12);
      color: var(--text);
    }

    .btn-register-nav {
      background: linear-gradient(135deg, var(--accent-fill), var(--teal-fill));
      color: var(--on-fill);
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      font: 600 12px/1.2 var(--font);
      cursor: pointer;
      transition: all 0.15s;
      text-decoration: none;
    }

    .btn-register-nav:hover {
      box-shadow: 0 0 16px var(--accent-glow);
      transform: translateY(-1px);
    }

    .lang-wrap { position: relative; }

    .icon-btn {
      appearance: none;
      border: 1px solid rgba(200,208,220,0.14);
      background: rgba(36,42,54,0.4);
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
      background: rgba(160,168,180,0.12);
      color: var(--text);
    }
    .icon-btn svg { display: block; }

    .lang-btn {
      appearance: none;
      border: 1px solid rgba(200,208,220,0.14);
      background: rgba(36,42,54,0.4);
      color: var(--text-secondary);
      width: 30px;
      height: 30px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .lang-btn:hover {
      background: rgba(160,168,180,0.12);
      color: var(--text);
    }

    .lang-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      inset-inline-end: 0;
      margin-top: 6px;
      background: rgba(36,42,54,0.95);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(200,208,220,0.15);
      border-radius: 8px;
      padding: 4px;
      min-width: 100px;
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
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      text-align: start;
      transition: all 0.15s;
    }
    .lang-dropdown button:hover {
      background: rgba(160,168,180,0.12);
      color: var(--text);
    }
    .lang-dropdown button[aria-current="true"] {
      background: rgba(122,156,198,0.2);
      color: var(--text);
      font-weight: 600;
    }

    .hamburger {
      display: none;
      appearance: none;
      border: 1px solid rgba(200,208,220,0.14);
      background: rgba(36,42,54,0.4);
      color: var(--text-secondary);
      width: 30px;
      height: 30px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .hamburger:hover {
      background: rgba(160,168,180,0.12);
      color: var(--text);
    }

    .mobile-menu {
      display: none;
      position: fixed;
      top: 56px;
      inset-inline: 0;
      background: rgba(24,28,38,0.95);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      flex-direction: column;
      gap: 8px;
      z-index: 99;
    }
    .mobile-menu.open { display: flex; }
    .mobile-menu a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      padding: 10px 0;
      border-bottom: 1px solid rgba(200,208,220,0.08);
    }
    .mobile-menu a:hover { color: var(--text); }

    @media (max-width: 768px) {
      .nav-auth { display: none; }
      .hamburger { display: inline-flex; align-items: center; justify-content: center; }
      nav { padding: 6px 10px; }
      .nav-brand .app-name { font-size: 12px; gap: 5px; }
      .nav-brand .app-name .logo-icon { width: 16px; height: 16px; }
      .nav-brand .app-subtitle { font-size: 7.5px; padding-inline-start: 21px; }
      .hero-content { padding: 80px 16px 36px; }
      .hero-cta { flex-direction: column; align-items: stretch; }
      .hero-cta a { text-align: center; }
      .features { padding: 48px 16px; }
      .features-header h2 { font-size: 24px; }
    }

    /* ── Video Background (Full Page) ────────────── */
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
      background: linear-gradient(
        180deg,
        var(--overlay-dark) 0%,
        rgba(24,28,38,0.65) 50%,
        rgba(24,28,38,0.85) 100%
      );
      z-index: -1;
      transition: background 0.3s;
    }

    [data-theme="light"] .video-overlay {
      background: linear-gradient(
        180deg,
        rgba(248,250,252,0.5) 0%,
        rgba(248,250,252,0.7) 50%,
        rgba(248,250,252,0.9) 100%
      );
    }

    /* ── Hero ─────────────────────────────────────── */
    .hero {
      position: relative;
      min-height: 85vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .hero-content {
      position: relative;
      z-index: 2;
      text-align: center;
      max-width: 800px;
      padding: 96px 24px 64px;
    }

    .hero-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 500;
      color: var(--teal);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-top: 12px;
      margin-bottom: 20px;
      background: var(--teal-glow);
      padding: 5px 12px;
      border-radius: 16px;
      border: 1px solid rgba(45,212,160,0.2);
    }

    .hero-eyebrow::before {
      content: '';
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--teal);
      animation: blink 2s ease-in-out infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .hero h1 {
      font-size: clamp(36px, 6vw, 64px);
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.03em;
      margin-bottom: 20px;
      direction: ltr;
    }

    .hero h1 .gradient-text {
      background: linear-gradient(135deg, var(--accent), var(--teal));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-subtitle {
      font-size: 18px;
      color: var(--text-secondary);
      max-width: 560px;
      margin: 0 auto 40px;
      line-height: 1.7;
    }

    .hero-cta {
      display: flex;
      gap: 16px;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
      width: 100%;
    }

    .hero-btn-primary {
      background: linear-gradient(135deg, var(--accent-fill), var(--teal-fill));
      color: var(--on-fill);
      padding: 14px 32px;
      border-radius: 10px;
      font: 600 16px/1.2 var(--font);
      text-decoration: none;
      transition: all 0.2s;
      box-shadow: 0 4px 20px var(--accent-glow);
    }

    .hero-btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 32px var(--accent-glow);
    }

    .hero-btn-secondary {
      background: rgba(255,255,255,0.08);
      color: var(--text);
      padding: 14px 32px;
      border-radius: 10px;
      font: 500 16px/1.2 var(--font);
      text-decoration: none;
      border: 1px solid var(--border);
      transition: all 0.2s;
    }

    .hero-btn-secondary:hover {
      background: rgba(255,255,255,0.12);
      border-color: rgba(200,208,220,0.35);
    }

    /* ── Auth Modal ──────────────────────────────── */
    .auth-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 200;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .auth-overlay.open { display: flex; }

    .auth-modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 16px 64px rgba(0,0,0,0.5);
      position: relative;
    }

    .auth-modal-close {
      position: absolute;
      top: 12px;
      inset-inline-end: 12px;
      background: transparent;
      border: 0;
      color: var(--text-muted);
      font-size: 20px;
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      transition: all 0.15s;
    }
    .auth-modal-close:hover {
      background: rgba(160,168,180,0.15);
      color: var(--text);
    }

    .auth-modal h3 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--text);
    }

    .auth-modal .auth-sub {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 24px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }

    .form-group input {
      width: 100%;
      padding: 12px 14px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-family: var(--font);
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .form-group input::placeholder {
      color: var(--text-muted);
    }

    .form-group input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .btn-auth-submit {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, var(--accent-fill), var(--teal-fill));
      color: var(--on-fill);
      border: none;
      border-radius: 10px;
      font-family: var(--font);
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.2s;
      margin-top: 8px;
    }

    .btn-auth-submit:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 24px var(--accent-glow);
    }

    .btn-auth-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .auth-switch {
      text-align: center;
      margin-top: 16px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .auth-switch a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
      cursor: pointer;
    }
    .auth-switch a:hover { text-decoration: underline; }

    .auth-msg {
      text-align: center;
      margin-top: 12px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .auth-dev-note {
      background: rgba(74,222,154,0.1);
      border: 1px solid rgba(74,222,154,0.25);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 20px;
      font-size: 12px;
      color: var(--teal);
    }

    /* ── Features ─────────────────────────────────── */
    .features {
      position: relative;
      padding: 80px 24px;
      max-width: 1100px;
      margin-inline: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .features-header {
      text-align: center;
      margin-bottom: 56px;
      max-width: 600px;
    }

    .features-header h2 {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }

    .features-header p {
      font-size: 16px;
      color: var(--text-secondary);
      max-width: 500px;
      margin: 0 auto;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      width: 100%;
      max-width: 1000px;
    }

    @media (max-width: 900px) {
      .features-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 600px) {
      .features-grid { grid-template-columns: 1fr; }
      .hero-content { padding: 72px 14px 32px; }
      .hero h1 { font-size: clamp(26px, 8vw, 40px); }
    }

    .feature-card {
      background: var(--surface-glass);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 28px 24px;
      transition: all 0.25s;
      text-align: center;
    }

    .feature-card:hover {
      background: var(--surface);
      border-color: rgba(122,156,198,0.3);
      transform: translateY(-3px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    }

    .feature-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 20px;
    }

    .feature-icon.purple { background: rgba(99,102,241,0.12); }
    .feature-icon.teal { background: var(--teal-glow); }
    .feature-icon.amber { background: rgba(245,166,35,0.12); }
    .feature-icon.coral { background: rgba(232,86,74,0.1); }
    .feature-icon.blue { background: rgba(59,130,246,0.12); }
    .feature-icon.green { background: rgba(34,197,94,0.12); }

    .feature-card h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .feature-card p {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    /* ── Stats bar ────────────────────────────────── */
    .stats-bar {
      position: relative;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      padding: 40px 24px;
      background: rgba(36,42,54,0.4);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .stats-inner {
      max-width: 900px;
      margin-inline: auto;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 32px;
      text-align: center;
    }

    @media (max-width: 600px) {
      .stats-inner { grid-template-columns: repeat(2, 1fr); }
    }

    .stat-item .stat-num {
      font-family: var(--mono);
      font-size: 32px;
      font-weight: 600;
      color: var(--text);
      display: block;
    }

    .stat-item .stat-label {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    /* ── Footer ───────────────────────────────────── */
    footer {
      position: relative;
      padding: 40px 24px;
      text-align: center;
      border-top: 1px solid var(--border);
      background: rgba(24,28,38,0.5);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .footer-inner {
      max-width: 900px;
      margin-inline: auto;
    }

    footer p {
      font-size: 13px;
      color: var(--text-muted);
    }

    footer a {
      color: var(--text-secondary);
      text-decoration: none;
    }

    footer a:hover { color: var(--accent); }

    .footer-links {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 24px;
      margin-inline: auto;
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

    .footer-a11y {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }

    .footer-a11y p {
      font-size: 11px;
      color: var(--text-muted);
    }

    /* ── Toast ────────────────────────────────────── */
    .toast {
      position: fixed;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--teal);
      color: var(--bg);
      padding: 12px 28px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      opacity: 0;
      transition: transform 0.4s, opacity 0.4s;
      z-index: 200;
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  </style>
</head>
<body>

  <!-- Nav -->
  <nav>
    <div class="nav-start">
      <button class="hamburger" id="hamburgerBtn" aria-label="Menu">${ICON_MENU}</button>
      <div class="nav-actions">
        <button class="icon-btn" id="themeBtn" aria-label="Toggle theme">${ICON_MOON}</button>
        <div class="lang-wrap">
          <button class="icon-btn" id="langBtn" aria-label="Language">${ICON_GLOBE}</button>
          <div class="lang-dropdown" id="langDropdown">
            <button type="button" data-lang="he" lang="he" dir="rtl">עברית</button>
            <button type="button" data-lang="en" lang="en" dir="ltr">English</button>
            <button type="button" data-lang="ar" lang="ar" dir="rtl">العربية</button>
          </div>
        </div>
      </div>
      <div class="nav-auth">
        <a href="#login" class="btn-login" data-i18n="btnLogin" id="loginBtn">Login</a>
        <a href="#register" class="btn-register-nav" data-i18n="btnRegister" id="registerNavBtn">Register</a>
      </div>
    </div>

    <a href="/" class="nav-brand">
      <span class="app-name">
        Atlas Control Plane
        <span class="logo-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </span>
      </span>
      <span class="app-subtitle">Atlas Sentinel</span>
    </a>
  </nav>

  <!-- Mobile Menu -->
  <div class="mobile-menu" id="mobileMenu">
    <a href="#features" data-i18n="navFeatures">Features</a>
    <a href="/dashboard" data-i18n="navDashboard">Dashboard</a>
    <a href="#login" data-i18n="btnLogin" id="mobileLoginBtn">Login</a>
    <a href="#register" data-i18n="btnRegister" id="mobileRegisterBtn">Register</a>
  </div>

  <!-- Full Page Video Background -->
  <div class="video-bg">
    <video autoplay muted loop playsinline preload="metadata" poster="">
      <source src="${VIDEO_URL}" type="video/mp4">
    </video>
  </div>
  <div class="video-overlay"></div>

  <!-- Hero -->
  <section class="hero">
    <div class="hero-content">
      <div class="hero-eyebrow" data-i18n="heroEyebrow">AI Governance Platform</div>
      <h1>
        <span class="gradient-text" data-i18n="heroTitle1">Atlas Sentinel</span><br>
        <span data-i18n="heroTitle2">Oversight &amp; Control</span>
      </h1>
      <p class="hero-subtitle" data-i18n="heroSubtitle">
        Real-time governance, audit trails, and policy enforcement
        for AI agent systems. Full visibility. Zero blind spots.
      </p>

      <div class="hero-cta">
        <a href="#register" class="hero-btn-primary" data-i18n="ctaGetStarted" id="heroRegisterBtn">Get Started</a>
        <a href="/dashboard" class="hero-btn-secondary" data-i18n="navDashboard">Dashboard</a>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="features" id="features">
    <div class="features-header">
      <h2 data-i18n="featuresTitle">Complete AI Governance</h2>
      <p data-i18n="featuresSubtitle">Everything you need to oversee, audit, and control AI agent operations</p>
    </div>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon purple">&#x1F6E1;</div>
        <h3 data-i18n="featureAgentRegistry">Agent Registry</h3>
        <p data-i18n="featureAgentRegistryDesc">9 registered agents with full capability profiles, tool permissions, and risk tier classification</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon teal">&#x1F4DC;</div>
        <h3 data-i18n="featureAuditTrail">Audit Trail</h3>
        <p data-i18n="featureAuditTrailDesc">SHA-256 hash-chained tamper-evident logs. Every decision recorded, searchable, and verifiable</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon amber">&#x26A0;</div>
        <h3 data-i18n="featureRiskScoring">Risk Scoring</h3>
        <p data-i18n="featureRiskScoringDesc">Three-tier risk classification: AUTO_LOG, APPROVAL, BLOCK. Trust-level floors for untrusted sources</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon coral">&#x1F512;</div>
        <h3 data-i18n="featurePolicyEnforcement">Policy Enforcement</h3>
        <p data-i18n="featurePolicyEnforcementDesc">9 policy definitions with entity/action mapping. Fail-closed architecture — denied by default</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon blue">&#x2705;</div>
        <h3 data-i18n="featureApprovalWorkflow">Approval Workflow</h3>
        <p data-i18n="featureApprovalWorkflowDesc">Artifact-bound approvals with TTL expiry, replay prevention, and entity/action/agent matching</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon green">&#x1F4CA;</div>
        <h3 data-i18n="featureHealthMetrics">Health Metrics</h3>
        <p data-i18n="featureHealthMetricsDesc">Real-time execution counts, failure rates, approval consumption, and average risk distribution</p>
      </div>
    </div>
  </section>

  <!-- Stats -->
  <div class="stats-bar">
    <div class="stats-inner">
      <div class="stat-item">
        <span class="stat-num">349</span>
        <span class="stat-label" data-i18n="statTestsPassing">Tests Passing</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">9</span>
        <span class="stat-label" data-i18n="statAiAgents">AI Agents</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">8</span>
        <span class="stat-label" data-i18n="statPipelineStages">Pipeline Stages</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">0</span>
        <span class="stat-label" data-i18n="statBlindSpots">Blind Spots</span>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <footer>
    <div class="footer-inner">
      <ul class="footer-links">
        <li><a href="#about" data-i18n="footerAbout">About</a></li>
        <li><a href="#settings" data-i18n="footerSettings">Settings</a></li>
        <li><a href="#privacy" data-i18n="footerPrivacy">Privacy</a></li>
        <li><a href="#terms" data-i18n="footerTerms">Terms</a></li>
        <li><a href="#contact" data-i18n="footerContact">Contact</a></li>
        <li><a href="/dashboard" data-i18n="navDashboard">Dashboard</a></li>
        <li><a id="linkAtlas" href="http://localhost:3000/he/welcome" data-i18n="navAtlas">Atlas</a></li>
        <li><a id="linkOwnerAdmin" href="http://127.0.0.1:3200" data-i18n="navOwnerAdmin">Owner Admin</a></li>
      </ul>
      <div class="footer-brand">
        <div class="logo-mini"></div>
        <span>Atlas Sentinel</span>
      </div>
      <p data-i18n="footerCopyright">&copy; 2026 Atlas Sentinel. AI Governance &amp; Oversight Platform.</p>
      <div class="footer-a11y">
        <p data-i18n="footerA11y">We are committed to accessibility. Keyboard navigation, screen reader support, and WCAG 2.1 AA compliance.</p>
      </div>
    </div>
  </footer>

  <!-- Auth Modal -->
  <div class="auth-overlay" id="authOverlay">
    <div class="auth-modal">
      <button class="auth-modal-close" id="authClose">&times;</button>
      <h3 id="authTitle" data-i18n="btnLogin">Login</h3>
      <p class="auth-sub" id="authSubtitle" data-i18n="authSubtitleLogin">Sign in to your account</p>
      
      <div class="auth-dev-note">
        dev@atlas.local · AtlasDev1!
      </div>

      <form id="authForm">
        <div class="form-group" id="displayNameGroup" style="display:none;">
          <label for="displayName" data-i18n="labelDisplayName">Display Name</label>
          <input type="text" id="displayName" value="Atlas Dev">
        </div>
        <div class="form-group">
          <label for="email" data-i18n="labelEmail">Email</label>
          <input type="email" id="email" value="dev@atlas.local" required>
        </div>
        <div class="form-group">
          <label for="password" data-i18n="labelPassword">Password</label>
          <input type="password" id="password" value="AtlasDev1!" minlength="8" required>
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

  <!-- Toast -->
  <div class="toast" id="toast">Account created successfully!</div>

  <script>
    var TRANSLATIONS = {
      he: {
        title: "Atlas Control Plane — פלטפורמת פיקוח AI",
        heroEyebrow: "פלטפורמת ממשל AI",
        heroTitle1: "Atlas Sentinel",
        heroTitle2: "פיקוח ובקרה",
        heroSubtitle: "ממשל בזמן אמת, מסלולי ביקורת ואכיפת מדיניות למערכות סוכני AI. נראות מלאה. אפס נקודות עיוורות.",
        navFeatures: "יכולות",
        navDashboard: "לוח בקרה",
        navAtlas: "Atlas",
        navOwnerAdmin: "ניהול בעלים",
        ctaGetStarted: "התחל עכשיו",
        labelDisplayName: "שם תצוגה",
        labelEmail: "אימייל",
        labelPassword: "סיסמה",
        btnLogin: "התחברות",
        btnRegister: "הרשמה",
        authSubtitleLogin: "התחבר לחשבון שלך",
        authSubtitleRegister: "צור חשבון חדש",
        authNoAccount: "אין לך חשבון?",
        authHaveAccount: "יש לך חשבון?",
        featuresTitle: "ממשל AI מקיף",
        featuresSubtitle: "כל מה שצריך לפיקוח, ביקורת ובקרה על פעולות סוכני AI",
        featureAgentRegistry: "רישום סוכנים",
        featureAgentRegistryDesc: "9 סוכנים רשומים עם פרופילי יכולות מלאים, הרשאות כלים וסיווג רמת סיכון",
        featureAuditTrail: "מסלול ביקורת",
        featureAuditTrailDesc: "יומנים עמידים בפני שינוי עם שרשרת SHA-256. כל החלטה מתועדת, ניתנת לחיפוש ולאימות",
        featureRiskScoring: "ניקוד סיכונים",
        featureRiskScoringDesc: "סיווג סיכונים בשלוש רמות: AUTO_LOG, APPROVAL, BLOCK. רצפות רמת אמון למקורות לא מהימנים",
        featurePolicyEnforcement: "אכיפת מדיניות",
        featurePolicyEnforcementDesc: "9 הגדרות מדיניות עם מיפוי ישות/פעולה. ארכיטקטורת fail-closed — נדחה כברירת מחדל",
        featureApprovalWorkflow: "תהליך אישורים",
        featureApprovalWorkflowDesc: "אישורים קשורים לחפץ עם תפוגת TTL, מניעת הפעלה חוזרת והתאמת ישות/פעולה/סוכן",
        featureHealthMetrics: "מדדי בריאות",
        featureHealthMetricsDesc: "ספירות ביצוע בזמן אמת, שיעורי כשלון, צריכת אישורים והתפלגות סיכונים ממוצעת",
        statTestsPassing: "טסטים עוברים",
        statAiAgents: "סוכני AI",
        statPipelineStages: "שלבי Pipeline",
        statBlindSpots: "נקודות עיוורות",
        footerCopyright: "© 2026 Atlas Control Plane. פלטפורמת ממשל ופיקוח AI.",
        msgLoggingIn: "מתחבר...",
        msgRegistering: "נרשם...",
        msgSuccess: "הצלחה",
        msgError: "שגיאה",
        msgUserExists: "משתמש כבר קיים",
        msgInvalidCredentials: "פרטים שגויים",
        footerAbout: "אודות",
        footerSettings: "הגדרות",
        footerPrivacy: "פרטיות",
        footerTerms: "תנאים",
        footerContact: "צור קשר",
        footerA11y: "אנו מחויבים לנגישות. ניווט מקלדת, תמיכה בקוראי מסך, ותאימות WCAG 2.1 AA."
      },
      en: {
        title: "Atlas Control Plane — AI Oversight Platform",
        heroEyebrow: "AI Governance Platform",
        heroTitle1: "Atlas Sentinel",
        heroTitle2: "Oversight & Control",
        heroSubtitle: "Real-time governance, audit trails, and policy enforcement for AI agent systems. Full visibility. Zero blind spots.",
        navFeatures: "Features",
        navDashboard: "Dashboard",
        navAtlas: "Atlas",
        navOwnerAdmin: "Owner Admin",
        ctaGetStarted: "Get Started",
        labelDisplayName: "Display Name",
        labelEmail: "Email",
        labelPassword: "Password",
        btnLogin: "Login",
        btnRegister: "Register",
        authSubtitleLogin: "Sign in to your account",
        authSubtitleRegister: "Create a new account",
        authNoAccount: "Don't have an account?",
        authHaveAccount: "Already have an account?",
        featuresTitle: "Complete AI Governance",
        featuresSubtitle: "Everything you need to oversee, audit, and control AI agent operations",
        featureAgentRegistry: "Agent Registry",
        featureAgentRegistryDesc: "9 registered agents with full capability profiles, tool permissions, and risk tier classification",
        featureAuditTrail: "Audit Trail",
        featureAuditTrailDesc: "SHA-256 hash-chained tamper-evident logs. Every decision recorded, searchable, and verifiable",
        featureRiskScoring: "Risk Scoring",
        featureRiskScoringDesc: "Three-tier risk classification: AUTO_LOG, APPROVAL, BLOCK. Trust-level floors for untrusted sources",
        featurePolicyEnforcement: "Policy Enforcement",
        featurePolicyEnforcementDesc: "9 policy definitions with entity/action mapping. Fail-closed architecture — denied by default",
        featureApprovalWorkflow: "Approval Workflow",
        featureApprovalWorkflowDesc: "Artifact-bound approvals with TTL expiry, replay prevention, and entity/action/agent matching",
        featureHealthMetrics: "Health Metrics",
        featureHealthMetricsDesc: "Real-time execution counts, failure rates, approval consumption, and average risk distribution",
        statTestsPassing: "Tests Passing",
        statAiAgents: "AI Agents",
        statPipelineStages: "Pipeline Stages",
        statBlindSpots: "Blind Spots",
        footerCopyright: "© 2026 Atlas Control Plane. AI Governance & Oversight Platform.",
        msgLoggingIn: "Logging in...",
        msgRegistering: "Registering...",
        msgSuccess: "Success",
        msgError: "Error",
        msgUserExists: "User already exists",
        msgInvalidCredentials: "Invalid credentials",
        footerAbout: "About",
        footerSettings: "Settings",
        footerPrivacy: "Privacy",
        footerTerms: "Terms",
        footerContact: "Contact",
        footerA11y: "We are committed to accessibility. Keyboard navigation, screen reader support, and WCAG 2.1 AA compliance."
      },
      ar: {
        title: "Atlas Control Plane — منصة مراقبة الذكاء الاصطناعي",
        heroEyebrow: "منصة حوكمة الذكاء الاصطناعي",
        heroTitle1: "Atlas Sentinel",
        heroTitle2: "الرقابة والتحكم",
        heroSubtitle: "حوكمة في الوقت الفعلي، مسارات تدقيق، وتطبيق السياسات لأنظمة وكلاء الذكاء الاصطناعي. رؤية كاملة. لا نقاط عمياء.",
        navFeatures: "الميزات",
        navDashboard: "لوحة التحكم",
        navAtlas: "Atlas",
        navOwnerAdmin: "إدارة المالك",
        ctaGetStarted: "ابدأ الآن",
        labelDisplayName: "اسم العرض",
        labelEmail: "البريد الإلكتروني",
        labelPassword: "كلمة المرور",
        btnLogin: "تسجيل الدخول",
        btnRegister: "التسجيل",
        authSubtitleLogin: "سجل الدخول إلى حسابك",
        authSubtitleRegister: "إنشاء حساب جديد",
        authNoAccount: "ليس لديك حساب؟",
        authHaveAccount: "لديك حساب بالفعل؟",
        featuresTitle: "حوكمة ذكاء اصطناعي شاملة",
        featuresSubtitle: "كل ما تحتاجه للإشراف والتدقيق والتحكم في عمليات وكلاء الذكاء الاصطناعي",
        featureAgentRegistry: "سجل الوكلاء",
        featureAgentRegistryDesc: "9 وكلاء مسجلين مع ملفات قدرات كاملة وأذونات أدوات وتصنيف مستوى المخاطر",
        featureAuditTrail: "مسار التدقيق",
        featureAuditTrailDesc: "سجلات مقاومة للتلاعب بسلسلة SHA-256. كل قرار مسجل وقابل للبحث والتحقق",
        featureRiskScoring: "تقييم المخاطر",
        featureRiskScoringDesc: "تصنيف المخاطر ثلاثي المستويات: AUTO_LOG، APPROVAL، BLOCK. حدود مستوى الثقة للمصادر غير الموثوقة",
        featurePolicyEnforcement: "تطبيق السياسات",
        featurePolicyEnforcementDesc: "9 تعريفات سياسات مع تعيين الكيان/الإجراء. بنية fail-closed — مرفوض افتراضياً",
        featureApprovalWorkflow: "سير عمل الموافقات",
        featureApprovalWorkflowDesc: "موافقات مرتبطة بالقطع الأثرية مع انتهاء TTL ومنع إعادة التشغيل ومطابقة الكيان/الإجراء/الوكيل",
        featureHealthMetrics: "مقاييس الصحة",
        featureHealthMetricsDesc: "إحصائيات التنفيذ في الوقت الفعلي، معدلات الفشل، استهلاك الموافقات، ومتوسط توزيع المخاطر",
        statTestsPassing: "الاختبارات الناجحة",
        statAiAgents: "وكلاء الذكاء الاصطناعي",
        statPipelineStages: "مراحل خط الأنابيب",
        statBlindSpots: "النقاط العمياء",
        footerCopyright: "© 2026 Atlas Control Plane. منصة حوكمة ومراقبة الذكاء الاصطناعي.",
        msgLoggingIn: "جاري تسجيل الدخول...",
        msgRegistering: "جاري التسجيل...",
        msgSuccess: "نجاح",
        msgError: "خطأ",
        msgUserExists: "المستخدم موجود بالفعل",
        msgInvalidCredentials: "بيانات غير صالحة",
        footerAbout: "حول",
        footerSettings: "الإعدادات",
        footerPrivacy: "الخصوصية",
        footerTerms: "الشروط",
        footerContact: "اتصل بنا",
        footerA11y: "نحن ملتزمون بإمكانية الوصول. التنقل بلوحة المفاتيح، دعم قارئات الشاشة، والتوافق مع WCAG 2.1 AA."
      }
    };

    var currentLang = "he";

    function t(key) {
      return TRANSLATIONS[currentLang][key] || TRANSLATIONS.en[key] || key;
    }

    function applyTranslations() {
      document.title = t("title");
      document.querySelectorAll("[data-i18n]").forEach(function(el) {
        var key = el.getAttribute("data-i18n");
        if (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) {
          el.textContent = TRANSLATIONS[currentLang][key];
        }
      });
    }

    function atlasApi() {
      var host = location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
      return "http://" + host + ":4000";
    }

    function atlasWeb() {
      var host = location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
      return "http://" + host + ":3000";
    }

    function ownerAdmin() {
      var host = location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
      return "http://" + host + ":3200";
    }

    (function bindSurfaceLinks() {
      var atlas = document.getElementById("linkAtlas");
      var admin = document.getElementById("linkOwnerAdmin");
      if (atlas) atlas.setAttribute("href", atlasWeb() + "/he/welcome");
      if (admin) admin.setAttribute("href", ownerAdmin());
    })();

    var authMode = "login";
    var authOverlay = document.getElementById("authOverlay");
    var authTitle = document.getElementById("authTitle");
    var authSubtitle = document.getElementById("authSubtitle");
    var authSubmitBtn = document.getElementById("authSubmitBtn");
    var authSwitch = document.getElementById("authSwitch");
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
        authSwitch.querySelector("[data-i18n='authNoAccount'], [data-i18n='authHaveAccount']").textContent = t("authNoAccount");
        authSwitchLink.textContent = t("btnRegister");
        displayNameGroup.style.display = "none";
      } else {
        authTitle.textContent = t("btnRegister");
        authSubtitle.textContent = t("authSubtitleRegister");
        authSubmitBtn.textContent = t("btnRegister");
        authSwitch.querySelector("[data-i18n='authNoAccount'], [data-i18n='authHaveAccount']").textContent = t("authHaveAccount");
        authSwitchLink.textContent = t("btnLogin");
        displayNameGroup.style.display = "block";
      }
    }

    function submitAuth(e) {
      e.preventDefault();
      var email = document.getElementById("email").value;
      var password = document.getElementById("password").value;
      var displayName = document.getElementById("displayName").value;
      var msg = document.getElementById("authMsg");
      var btn = authSubmitBtn;
      btn.disabled = true;
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
        window.location.href = "/dashboard";
      }).catch(function (err) {
        if (err.status === 409) {
          msg.textContent = t("msgUserExists");
        } else if (err.status === 401) {
          msg.textContent = t("msgInvalidCredentials");
        } else {
          msg.textContent = err.message || t("msgError");
        }
        btn.disabled = false;
      });
    }

    document.getElementById("authForm").addEventListener("submit", submitAuth);
    document.getElementById("authClose").addEventListener("click", closeAuthModal);
    authOverlay.addEventListener("click", function(e) { if (e.target === authOverlay) closeAuthModal(); });
    authSwitchLink.addEventListener("click", function() {
      authMode = authMode === "login" ? "register" : "login";
      updateAuthModal();
    });

    // Open modal from nav buttons
    document.getElementById("loginBtn").addEventListener("click", function(e) { e.preventDefault(); openAuthModal("login"); });
    document.getElementById("registerNavBtn").addEventListener("click", function(e) { e.preventDefault(); openAuthModal("register"); });
    document.getElementById("heroRegisterBtn").addEventListener("click", function(e) { e.preventDefault(); openAuthModal("register"); });

    // Mobile menu
    var mobileMenu = document.getElementById("mobileMenu");
    document.getElementById("hamburgerBtn").addEventListener("click", function() { mobileMenu.classList.toggle("open"); });
    document.getElementById("mobileLoginBtn").addEventListener("click", function(e) { e.preventDefault(); mobileMenu.classList.remove("open"); openAuthModal("login"); });
    document.getElementById("mobileRegisterBtn").addEventListener("click", function(e) { e.preventDefault(); mobileMenu.classList.remove("open"); openAuthModal("register"); });

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
      apply(saved || document.documentElement.lang || "he");
    })();

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        var target = document.querySelector(this.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      });
    });

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
