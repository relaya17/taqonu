/**
 * Atlas 1.3 Fabric Agents — roles with cognitive functions (ADR-017 v2).
 *
 * Each agent has both:
 * - Domain specialty (what they know)
 * - Cognitive role (how they think in the Expert Battle)
 */

export const FABRIC_AGENT_IDS = [
  "ORCHESTRATOR",
  "ARCHITECT",
  "CODE_ENGINEER",
  "DEBUGGER",
  "QA",
  "TEST_ENGINEER",
  "SECURITY",
  "ACCESSIBILITY",
  "UI_UX",
  "DEVOPS",
  "RESEARCHER",
  "OMISSION_DETECTOR",
  "LEGAL_MEDIA_COMMS",
  "JUDGE",
  "ADVERSARY",
  "DATABASE",
] as const;

export type FabricAgentId = (typeof FABRIC_AGENT_IDS)[number];

export const FABRIC_AGENT_CATEGORIES = [
  "orchestration",
  "engineering",
  "quality",
  "security",
  "design",
  "ops",
  "research",
  "governance",
  "legal",
  "adversarial",
] as const;

export type FabricAgentCategory = (typeof FABRIC_AGENT_CATEGORIES)[number];

/* ─────────────────────────────────────────────────────────────────────────────
   Cognitive Roles — how agents think in Expert Battle
   ───────────────────────────────────────────────────────────────────────────── */

export const COGNITIVE_ROLES = [
  "INVESTIGATOR",
  "DIAGNOSTICIAN",
  "BUILDER",
  "ADVERSARY",
  "AUDITOR",
  "CHALLENGER",
  "ARCHITECT",
  "EVIDENCE_JUDGE",
  "FINAL_VERIFIER",
  "PLANNER",
  "RESEARCHER",
] as const;

export type CognitiveRole = (typeof COGNITIVE_ROLES)[number];

export interface CognitiveRoleDefinition {
  readonly role: CognitiveRole;
  readonly function: string;
  readonly constraints: readonly string[];
}

export const COGNITIVE_ROLE_CATALOG: Readonly<
  Record<CognitiveRole, CognitiveRoleDefinition>
> = {
  INVESTIGATOR: {
    role: "INVESTIGATOR",
    function: "Finds facts and gathers evidence",
    constraints: ["Cannot conclude without evidence", "Must cite sources"],
  },
  DIAGNOSTICIAN: {
    role: "DIAGNOSTICIAN",
    function: "Identifies root cause from symptoms",
    constraints: ["Must differentiate correlation from causation", "Needs reproduction evidence"],
  },
  BUILDER: {
    role: "BUILDER",
    function: "Develops solutions based on specifications",
    constraints: ["Proposals stay gated until approval", "Must address requirements evidence"],
  },
  ADVERSARY: {
    role: "ADVERSARY",
    function: "Proves solutions are wrong or incomplete",
    constraints: ["Cannot validate own conclusions", "Must provide counter-evidence"],
  },
  AUDITOR: {
    role: "AUDITOR",
    function: "Checks compliance and security posture",
    constraints: ["Never asserts 'secure' without evidence", "Escalates uncertainty"],
  },
  CHALLENGER: {
    role: "CHALLENGER",
    function: "Breaks solutions and finds edge cases",
    constraints: ["Must provide reproduction steps", "Cannot just assert failure"],
  },
  ARCHITECT: {
    role: "ARCHITECT",
    function: "Checks systemic impact and boundaries",
    constraints: ["Read-only analysis", "Cannot invent undocumented behavior"],
  },
  EVIDENCE_JUDGE: {
    role: "EVIDENCE_JUDGE",
    function: "Evaluates evidence quality and contradictions",
    constraints: ["Cannot fix what it rejects", "Conservative on thin evidence"],
  },
  FINAL_VERIFIER: {
    role: "FINAL_VERIFIER",
    function: "Decides if the problem is resolved",
    constraints: ["Requires specialist outputs", "Cannot verify own work"],
  },
  PLANNER: {
    role: "PLANNER",
    function: "Decomposes tasks and assigns specialists",
    constraints: ["Cannot write code", "Must have user request evidence"],
  },
  RESEARCHER: {
    role: "RESEARCHER",
    function: "Retrieves knowledge from authorized sources",
    constraints: ["Cannot invent citations", "Must filter by authority"],
  },
};

export interface FabricAgentDefinition {
  readonly id: FabricAgentId;
  readonly title: string;
  readonly titleHe: string;
  readonly titleAr: string;
  readonly specialty: string;
  readonly category: FabricAgentCategory;
  /** Primary cognitive role in Expert Battle */
  readonly cognitiveRole: CognitiveRole;
  /** Secondary cognitive roles this agent can assume */
  readonly secondaryCognitiveRoles?: readonly CognitiveRole[];
  readonly allowedTools: readonly string[];
  readonly forbiddenTools: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly maxCostUsd: number;
  readonly timeoutMs: number;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly canWriteCode: boolean;
  readonly evaluationSuite: string;
  /** Marketplace-style cost hint (not a Cursor-style model picker). */
  readonly costHintEn: string;
  readonly costHintHe: string;
  readonly costHintAr: string;
  readonly strengthsEn: readonly string[];
  readonly strengthsHe: readonly string[];
  readonly strengthsAr: readonly string[];
  readonly weaknessesEn: readonly string[];
  readonly weaknessesHe: readonly string[];
  readonly weaknessesAr: readonly string[];
  /** Golden rule: no agent may validate its own unverified conclusion */
  readonly cannotSelfValidate: boolean;
}

export const FABRIC_AGENT_CATALOG: Readonly<
  Record<FabricAgentId, FabricAgentDefinition>
> = {
  ORCHESTRATOR: {
    id: "ORCHESTRATOR",
    title: "Atlas Master Orchestrator",
    titleHe: "אורקסטרטור ראשי",
    titleAr: "المنسّق الرئيسي",
    specialty: "Decompose · select specialists · budgets · handoffs",
    category: "orchestration",
    cognitiveRole: "PLANNER",
    allowedTools: ["plan", "dispatch", "budget", "trace"],
    forbiddenTools: ["apply_patch", "exfiltrate"],
    evidenceRequirements: ["user request", "project context"],
    maxCostUsd: 0.5,
    timeoutMs: 120_000,
    riskLevel: "MEDIUM",
    canWriteCode: false,
    evaluationSuite: "orch-plan-v1",
    costHintEn: "Low — planning overhead only",
    costHintHe: "נמוך — תכנון בלבד",
    costHintAr: "منخفض — تخطيط فقط",
    strengthsEn: [
      "Routes by task fit, not “best LLM”",
      "Enforces budgets and isolation",
      "Typed Evidence Bus handoffs",
    ],
    strengthsHe: [
      "מנתב לפי התאמת משימה, לא “המודל הכי טוב”",
      "אוכף תקציבים ובידוד",
      "העברות Evidence Bus מטופסות",
    ],
    strengthsAr: [
      "يوجّه حسب ملاءمة المهمة وليس “أفضل نموذج”",
      "يفرض الميزانيات والعزل",
      "تسليمات Evidence Bus مُنمَّطة",
    ],
    weaknessesEn: [
      "Does not write code",
      "Quality depends on specialist coverage",
      "Thin prompts yield thin plans",
    ],
    weaknessesHe: [
      "לא כותב קוד",
      "האיכות תלויה בכיסוי המומחים",
      "בקשות דלות → תוכניות דלות",
    ],
    weaknessesAr: [
      "لا يكتب شيفرة",
      "الجودة تعتمد على تغطية المتخصصين",
      "طلبات ضعيفة → خطط ضعيفة",
    ],
    cannotSelfValidate: true,
  },
  ARCHITECT: {
    id: "ARCHITECT",
    title: "Architect",
    titleHe: "אדריכל מערכת",
    titleAr: "مهندس معمارية",
    specialty: "Modules · dependencies · boundaries · debt · scalability",
    category: "engineering",
    cognitiveRole: "ARCHITECT",
    allowedTools: ["analyze_repo", "impact", "read_adr"],
    forbiddenTools: ["apply_patch"],
    evidenceRequirements: ["repo graph", "ADRs"],
    maxCostUsd: 0.4,
    timeoutMs: 90_000,
    riskLevel: "MEDIUM",
    canWriteCode: false,
    evaluationSuite: "architect-v1",
    costHintEn: "Mid — graph + ADR reads",
    costHintHe: "בינוני — גרף + ADR",
    costHintAr: "متوسط — رسم بياني + ADR",
    strengthsEn: [
      "Boundary and debt analysis",
      "ADR-aware recommendations",
      "Read-only — safe by default",
    ],
    strengthsHe: [
      "ניתוח גבולות וחוב טכני",
      "המלצות מודעות ל־ADR",
      "קריאה בלבד — בטוח כברירת מחדל",
    ],
    strengthsAr: [
      "تحليل الحدود والدين التقني",
      "توصيات واعية بـ ADR",
      "قراءة فقط — آمن افتراضيًا",
    ],
    weaknessesEn: [
      "Cannot apply patches",
      "Needs repo graph evidence",
      "Won’t invent undocumented prod behavior",
    ],
    weaknessesHe: [
      "לא מחיל תיקונים",
      "דורש ראיות גרף מאגר",
      "לא ממציא התנהגות prod לא מתועדת",
    ],
    weaknessesAr: [
      "لا يطبّق تصحيحات",
      "يحتاج أدلة رسم المستودع",
      "لا يخترع سلوك إنتاج غير موثّق",
    ],
    cannotSelfValidate: true,
  },
  CODE_ENGINEER: {
    id: "CODE_ENGINEER",
    title: "Code Engineer",
    titleHe: "מהנדס קוד",
    titleAr: "مهندس شيفرة",
    specialty: "Generate · fix · refactor · migrate — Patch Artifact only",
    category: "engineering",
    cognitiveRole: "BUILDER",
    allowedTools: ["propose_patch", "analyze_repo", "impact"],
    forbiddenTools: ["apply_patch_without_approval"],
    evidenceRequirements: ["failing test or explicit requirement"],
    maxCostUsd: 0.8,
    timeoutMs: 120_000,
    riskLevel: "HIGH",
    canWriteCode: true,
    evaluationSuite: "code-engineer-v1",
    costHintEn: "Higher — patch proposals",
    costHintHe: "גבוה יותר — הצעות תיקון",
    costHintAr: "أعلى — مقترحات تصحيح",
    strengthsEn: [
      "Produces gated Patch Artifacts",
      "Tied to failing tests or explicit reqs",
      "Impact-aware proposals",
    ],
    strengthsHe: [
      "מפיק Patch Artifacts תחת שער",
      "קשור לבדיקות כושלות או דרישה מפורשת",
      "הצעות מודעות להשפעה",
    ],
    strengthsAr: [
      "ينتج Patch Artifacts تحت بوابة موافقة",
      "مرتبط باختبارات فاشلة أو مطلب صريح",
      "مقترحات واعية بالأثر",
    ],
    weaknessesEn: [
      "WRITE stays approval-gated",
      "Refuses without evidence",
      "Not a free-form chat coder",
    ],
    weaknessesHe: [
      "WRITE נשאר תחת אישור",
      "מסרב בלי ראיות",
      "לא צ׳אט קוד חופשי",
    ],
    weaknessesAr: [
      "الكتابة تبقى تحت موافقة",
      "يرفض بلا أدلة",
      "ليس مبرمج دردشة حرّة",
    ],
    cannotSelfValidate: true,
  },
  DEBUGGER: {
    id: "DEBUGGER",
    title: "Debugger",
    titleHe: "מאתר באגים",
    titleAr: "مصحّح أخطاء",
    specialty: "Reproduce → isolate → identify → propose → verify",
    category: "engineering",
    cognitiveRole: "DIAGNOSTICIAN",
    allowedTools: ["logs", "tests", "propose_patch", "analyze_repo"],
    forbiddenTools: ["apply_patch_without_approval"],
    evidenceRequirements: ["repro steps or stack/logs"],
    maxCostUsd: 0.7,
    timeoutMs: 120_000,
    riskLevel: "HIGH",
    canWriteCode: true,
    evaluationSuite: "debugger-v1",
    costHintEn: "Higher — repro + patch loop",
    costHintHe: "גבוה יותר — שחזור + תיקון",
    costHintAr: "أعلى — إعادة إنتاج + تصحيح",
    strengthsEn: [
      "Structured reproduce→verify loop",
      "Uses logs and failing tests as evidence",
      "Patch proposals stay gated",
    ],
    strengthsHe: [
      "לולאת שחזור→אימות מובנית",
      "משתמש בלוגים ובדיקות כושלות כראיות",
      "הצעות תיקון נשארות תחת שער",
    ],
    strengthsAr: [
      "حلقة إعادة إنتاج→تحقق منظمة",
      "يستخدم السجلات والاختبارات الفاشلة كأدلة",
      "مقترحات التصحيح تبقى تحت بوابة",
    ],
    weaknessesEn: [
      "Needs repro or stack evidence",
      "Can escalate when evidence is thin",
      "Not for greenfield feature design",
    ],
    weaknessesHe: [
      "דורש שחזור או stack",
      "יכול להסלים כשהראיות דלות",
      "לא לעיצוב פיצ׳ר מאפס",
    ],
    weaknessesAr: [
      "يحتاج إعادة إنتاج أو مكدس",
      "قد يصعّد عند ضعف الأدلة",
      "ليس لتصميم ميزة من الصفر",
    ],
    cannotSelfValidate: true,
  },
  QA: {
    id: "QA",
    title: "QA Strategist",
    titleHe: "אסטרטג QA",
    titleAr: "استراتيجي ضمان جودة",
    specialty: "Decide what must be tested by risk",
    category: "quality",
    cognitiveRole: "CHALLENGER",
    allowedTools: ["risk_map", "coverage_gaps", "gates"],
    forbiddenTools: ["apply_patch"],
    evidenceRequirements: ["risk ranking", "critical paths"],
    maxCostUsd: 0.3,
    timeoutMs: 60_000,
    riskLevel: "MEDIUM",
    canWriteCode: false,
    evaluationSuite: "qa-v1",
    costHintEn: "Low — risk strategy",
    costHintHe: "נמוך — אסטרטגיית סיכון",
    costHintAr: "منخفض — استراتيجية مخاطر",
    strengthsEn: [
      "Risk-based test planning",
      "Critical-path focus",
      "Feeds Test Engineer cleanly",
    ],
    strengthsHe: [
      "תכנון בדיקות לפי סיכון",
      "מיקוד בנתיבים קריטיים",
      "מזין את מהנדס הבדיקות בבירור",
    ],
    strengthsAr: [
      "تخطيط اختبارات حسب المخاطر",
      "تركيز على المسارات الحرجة",
      "يغذّي مهندس الاختبار بوضوح",
    ],
    weaknessesEn: [
      "Does not author tests itself",
      "Needs risk/critical-path evidence",
      "Won’t claim untested paths are ready",
    ],
    weaknessesHe: [
      "לא כותב בדיקות בעצמו",
      "דורש ראיות סיכון/נתיבים",
      "לא יטען שנתיבים לא נבדקו מוכנים",
    ],
    weaknessesAr: [
      "لا يكتب الاختبارات بنفسه",
      "يحتاج أدلة مخاطر/مسارات",
      "لن يدّعي جاهزية مسارات غير مختبرة",
    ],
    cannotSelfValidate: true,
  },
  TEST_ENGINEER: {
    id: "TEST_ENGINEER",
    title: "Test Engineer",
    titleHe: "מהנדס בדיקות",
    titleAr: "مهندس اختبارات",
    specialty: "Unit · integration · E2E · regression · edge cases",
    category: "quality",
    cognitiveRole: "BUILDER",
    secondaryCognitiveRoles: ["CHALLENGER"],
    allowedTools: ["propose_patch", "run_tests"],
    forbiddenTools: ["apply_patch_without_approval"],
    evidenceRequirements: ["QA plan or failing suite"],
    maxCostUsd: 0.5,
    timeoutMs: 120_000,
    riskLevel: "MEDIUM",
    canWriteCode: true,
    evaluationSuite: "test-engineer-v1",
    costHintEn: "Mid — test authoring",
    costHintHe: "בינוני — כתיבת בדיקות",
    costHintAr: "متوسط — تأليف اختبارات",
    strengthsEn: [
      "Authors unit/integration/E2E patches",
      "Regression and edge-case focus",
      "Runs under QA plan evidence",
    ],
    strengthsHe: [
      "כותב תיקוני unit/integration/E2E",
      "מיקוד ברגרסיה ומקרי קצה",
      "רץ תחת ראיות תוכנית QA",
    ],
    strengthsAr: [
      "يؤلّف تصحيحات unit/integration/E2E",
      "تركيز على الانحدار والحالات الحدّية",
      "يعمل تحت أدلة خطة QA",
    ],
    weaknessesEn: [
      "Needs QA plan or failing suite",
      "Apply stays gated",
      "Not a substitute for product risk ranking",
    ],
    weaknessesHe: [
      "דורש תוכנית QA או suite כושל",
      "החלה נשארת תחת שער",
      "לא מחליף דירוג סיכון מוצרי",
    ],
    weaknessesAr: [
      "يحتاج خطة QA أو جناح فاشل",
      "التطبيق يبقى تحت بوابة",
      "ليس بديلاً عن ترتيب مخاطر المنتج",
    ],
    cannotSelfValidate: true,
  },
  SECURITY: {
    id: "SECURITY",
    title: "Security",
    titleHe: "אבטחה",
    titleAr: "أمن",
    specialty: "AuthN/Z · secrets · injection · tenants · supply chain",
    category: "security",
    cognitiveRole: "AUDITOR",
    secondaryCognitiveRoles: ["ADVERSARY"],
    allowedTools: ["security_scan", "deps_audit", "analyze_repo"],
    forbiddenTools: ["exfiltrate", "apply_patch_without_approval"],
    evidenceRequirements: ["threat surface", "deps lockfile"],
    maxCostUsd: 0.6,
    timeoutMs: 90_000,
    riskLevel: "CRITICAL",
    canWriteCode: false,
    evaluationSuite: "security-v1",
    costHintEn: "Mid-high — threat + deps",
    costHintHe: "בינוני-גבוה — איום + תלויות",
    costHintAr: "متوسط-عالٍ — تهديد + تبعيات",
    strengthsEn: [
      "AuthZ, secrets, injection focus",
      "Tenant and supply-chain awareness",
      "Never asserts “secure” without evidence",
    ],
    strengthsHe: [
      "מיקוד AuthZ, סודות, injection",
      "מודעות ל־tenant ושרשרת אספקה",
      "לא טוען “מאובטח” בלי ראיות",
    ],
    strengthsAr: [
      "تركيز على AuthZ والأسرار والحقن",
      "وعي بالمستأجرين وسلسلة التوريد",
      "لا يدّعي “آمن” بلا أدلة",
    ],
    weaknessesEn: [
      "Read/propose posture — not auto-fix",
      "Needs threat surface evidence",
      "Escalates thin claims to Judge",
    ],
    weaknessesHe: [
      "קריאה/הצעה — לא תיקון אוטומטי",
      "דורש ראיות משטח איום",
      "מסלים טענות דלות לשופט",
    ],
    weaknessesAr: [
      "قراءة/اقتراح — لا إصلاح تلقائي",
      "يحتاج أدلة سطح التهديد",
      "يصعّد الادعاءات الضعيفة إلى القاضي",
    ],
    cannotSelfValidate: true,
  },
  ACCESSIBILITY: {
    id: "ACCESSIBILITY",
    title: "Accessibility",
    titleHe: "נגישות",
    titleAr: "إتاحة",
    specialty: "WCAG · keyboard · focus · SR · RTL · contrast",
    category: "design",
    cognitiveRole: "AUDITOR",
    allowedTools: ["a11y_scan", "analyze_ui"],
    forbiddenTools: ["apply_patch_without_approval"],
    evidenceRequirements: ["UI surfaces", "WCAG target"],
    maxCostUsd: 0.3,
    timeoutMs: 60_000,
    riskLevel: "MEDIUM",
    canWriteCode: false,
    evaluationSuite: "a11y-v1",
    costHintEn: "Low — UI a11y scan",
    costHintHe: "נמוך — סריקת נגישות",
    costHintAr: "منخفض — فحص إتاحة",
    strengthsEn: [
      "WCAG + RTL (he/ar) first-class",
      "Keyboard and focus order",
      "Treats a11y as defects, not polish",
    ],
    strengthsHe: [
      "WCAG + RTL (עב/ער) כמחלקה ראשונה",
      "מקלדת וסדר פוקוס",
      "מתייחס לנגישות כפגם, לא כליטוש",
    ],
    strengthsAr: [
      "WCAG + RTL (عب/عر) أولوية أولى",
      "لوحة مفاتيح وترتيب تركيز",
      "يعامل الإتاحة كعيب وليس لمسة نهائية",
    ],
    weaknessesEn: [
      "Needs UI surfaces / screens",
      "Does not auto-apply fixes",
      "Desktop-only keyboard is insufficient",
    ],
    weaknessesHe: [
      "דורש משטחי UI / מסכים",
      "לא מחיל תיקונים אוטומטית",
      "מקלדת דסקטופ בלבד אינה מספיקה",
    ],
    weaknessesAr: [
      "يحتاج أسطح واجهة / شاشات",
      "لا يطبّق إصلاحات تلقائيًا",
      "لوحة مفاتيح سطح المكتب وحدها غير كافية",
    ],
    cannotSelfValidate: true,
  },
  UI_UX: {
    id: "UI_UX",
    title: "UI/UX",
    titleHe: "ממשק וחוויה",
    titleAr: "واجهة وتجربة",
    specialty: "Flows · usability · responsive · IA · consistency",
    category: "design",
    cognitiveRole: "INVESTIGATOR",
    allowedTools: ["analyze_ui", "flow_map"],
    forbiddenTools: ["apply_patch_without_approval"],
    evidenceRequirements: ["screens / routes"],
    maxCostUsd: 0.3,
    timeoutMs: 60_000,
    riskLevel: "LOW",
    canWriteCode: false,
    evaluationSuite: "uiux-v1",
    costHintEn: "Low — flow critique",
    costHintHe: "נמוך — ביקורת זרימות",
    costHintAr: "منخفض — نقد التدفقات",
    strengthsEn: [
      "One-job-per-screen discipline",
      "Empty/error/mobile states",
      "Concrete actionable findings",
    ],
    strengthsHe: [
      "משמעת משימה-אחת-למסך",
      "מצבי ריק/שגיאה/מובייל",
      "ממצאים קונקרטיים לביצוע",
    ],
    strengthsAr: [
      "انضباط مهمة واحدة لكل شاشة",
      "حالات فارغة/خطأ/جوال",
      "نتائج ملموسة قابلة للتنفيذ",
    ],
    weaknessesEn: [
      "Not a visual design/Figma tool",
      "Needs screens or flow description",
      "Won’t confuse polish with usability",
    ],
    weaknessesHe: [
      "לא כלי עיצוב חזותי/Figma",
      "דורש מסכים או תיאור זרימה",
      "לא מבלבל ליטוש עם שימושיות",
    ],
    weaknessesAr: [
      "ليس أداة تصميم بصري/Figma",
      "يحتاج شاشات أو وصف تدفق",
      "لا يخلط اللمعان بالاستخدامية",
    ],
    cannotSelfValidate: true,
  },
  DEVOPS: {
    id: "DEVOPS",
    title: "DevOps",
    titleHe: "DevOps",
    titleAr: "ديف أوبس",
    specialty: "CI/CD · cloud · DB · migrations · observability",
    category: "ops",
    cognitiveRole: "BUILDER",
    secondaryCognitiveRoles: ["INVESTIGATOR"],
    allowedTools: ["ci_status", "deploy_meta", "analyze_infra"],
    forbiddenTools: ["prod_mutate_without_approval"],
    evidenceRequirements: ["CI config", "deploy target"],
    maxCostUsd: 0.4,
    timeoutMs: 90_000,
    riskLevel: "HIGH",
    canWriteCode: false,
    evaluationSuite: "devops-v1",
    costHintEn: "Mid — CI/deploy meta",
    costHintHe: "בינוני — מטא CI/פריסה",
    costHintAr: "متوسط — بيانات CI/نشر",
    strengthsEn: [
      "CI gates and rollback mindset",
      "Env separation (local/staging/prod)",
      "Observability and migration safety",
    ],
    strengthsHe: [
      "שערי CI וחשיבת rollback",
      "הפרדת סביבות (מקומי/staging/prod)",
      "תצפיתיות ובטיחות מיגרציות",
    ],
    strengthsAr: [
      "بوابات CI وعقلية التراجع",
      "فصل البيئات (محلي/staging/إنتاج)",
      "قابلية المراقبة وأمان الترحيل",
    ],
    weaknessesEn: [
      "No destructive prod experiments",
      "Needs CI/deploy evidence",
      "Green CI ≠ production readiness",
    ],
    weaknessesHe: [
      "בלי ניסויים הרסניים בפרוד",
      "דורש ראיות CI/פריסה",
      "CI ירוק ≠ מוכנות לייצור",
    ],
    weaknessesAr: [
      "بلا تجارب تدميرية في الإنتاج",
      "يحتاج أدلة CI/نشر",
      "CI أخضر ≠ جاهزية إنتاج",
    ],
    cannotSelfValidate: true,
  },
  RESEARCHER: {
    id: "RESEARCHER",
    title: "Researcher",
    titleHe: "חוקר",
    titleAr: "باحث",
    specialty: "Authorized external sources → Evidence packages",
    category: "research",
    cognitiveRole: "RESEARCHER",
    allowedTools: [
      "knowledge_search",
      "ingest_source",
      "verify_url",
      "fs.read_file",
      "fs.read_directory",
      "fs.search_repo",
    ],
    forbiddenTools: ["apply_patch", "unofficial_scrape_as_official"],
    evidenceRequirements: ["query", "allowed source classes"],
    maxCostUsd: 0.4,
    timeoutMs: 90_000,
    riskLevel: "MEDIUM",
    canWriteCode: false,
    evaluationSuite: "research-v1",
    costHintEn: "Mid — authorized retrieval",
    costHintHe: "בינוני — שליפה מורשית",
    costHintAr: "متوسط — استرجاع مصرّح",
    strengthsEn: [
      "Authority + freshness filtered retrieval",
      "Packages evidence for specialists",
      "Refuses unofficial scrape-as-official",
    ],
    strengthsHe: [
      "שליפה מסוננת לפי סמכות ורעננות",
      "אורז ראיות למומחים",
      "מסרב לגרד לא רשמי כרשמי",
    ],
    strengthsAr: [
      "استرجاع مُصفّى حسب السلطة والحداثة",
      "يحزّم أدلة للمتخصصين",
      "يرفض الكشط غير الرسمي كرسمي",
    ],
    weaknessesEn: [
      "Does not invent citations",
      "Needs allowed source classes",
      "Empty corpus → INSUFFICIENT_EVIDENCE",
    ],
    weaknessesHe: [
      "לא ממציא ציטוטים",
      "דורש מחלקות מקורות מורשות",
      "קורפוס ריק → INSUFFICIENT_EVIDENCE",
    ],
    weaknessesAr: [
      "لا يخترع استشهادات",
      "يحتاج فئات مصادر مسموحة",
      "مدونة فارغة → INSUFFICIENT_EVIDENCE",
    ],
    cannotSelfValidate: true,
  },
  OMISSION_DETECTOR: {
    id: "OMISSION_DETECTOR",
    title: "Omission Detector",
    titleHe: "גלאי השמטות",
    titleAr: "كاشف الإغفالات",
    specialty:
      "omission gaps · constitution checklist · unrequested risks · evidence gaps",
    category: "governance",
    cognitiveRole: "INVESTIGATOR",
    secondaryCognitiveRoles: ["ADVERSARY"],
    allowedTools: ["constitution_run", "analyze_repo", "risk_map"],
    forbiddenTools: ["apply_patch", "exfiltrate"],
    evidenceRequirements: ["user intent or product profile", "repo evidence"],
    maxCostUsd: 0.45,
    timeoutMs: 90_000,
    riskLevel: "HIGH",
    canWriteCode: false,
    evaluationSuite: "omission-v1",
    costHintEn: "Mid — constitution gaps",
    costHintHe: "בינוני — פערים בחוקה",
    costHintAr: "متوسط — فجوات الدستور",
    strengthsEn: [
      "Finds gaps nobody requested",
      "Constitution checklist overlay",
      "Never confuses “not asked” with “not required”",
    ],
    strengthsHe: [
      "מוצא פערים שאף אחד לא ביקש",
      "שכבת צ׳ק־ליסט חוקה",
      "לא מבלבל “לא ביקשו” עם “לא נדרש”",
    ],
    strengthsAr: [
      "يجد فجوات لم يطلبها أحد",
      "طبقة قائمة فحص الدستور",
      "لا يخلط “لم يُطلب” مع “غير مطلوب”",
    ],
    weaknessesEn: [
      "Hypotheses need Judge/evidence",
      "Needs intent + repo evidence",
      "Does not auto-remediate",
    ],
    weaknessesHe: [
      "היפותזות דורשות שופט/ראיות",
      "דורש כוונה + ראיות מאגר",
      "לא מתקן אוטומטית",
    ],
    weaknessesAr: [
      "الفرضيات تحتاج قاضيًا/أدلة",
      "يحتاج نية + أدلة المستودع",
      "لا يعالج تلقائيًا",
    ],
    cannotSelfValidate: true,
  },
  LEGAL_MEDIA_COMMS: {
    id: "LEGAL_MEDIA_COMMS",
    title: "Legal Media & Communications",
    titleHe: "משפט מדיה ותקשורת",
    titleAr: "قانون الإعلام والاتصالات",
    specialty:
      "Counsel-prep readiness for IL + US + EU official portals — not a licensed attorney",
    category: "legal",
    cognitiveRole: "AUDITOR",
    secondaryCognitiveRoles: ["RESEARCHER"],
    allowedTools: [
      "legal_media_review",
      "cite_verified_sources",
      "knowledge_search",
    ],
    forbiddenTools: ["apply_patch", "write_code", "give_legal_advice"],
    evidenceRequirements: [
      "repo legal surfaces",
      "verified gov/university cites only",
      "explicit not-a-lawyer disclaimer",
    ],
    maxCostUsd: 0.4,
    timeoutMs: 90_000,
    riskLevel: "HIGH",
    canWriteCode: false,
    evaluationSuite: "legal-media-v1",
    costHintEn: "Mid — readiness for counsel (not legal fees)",
    costHintHe: "בינוני — מוכנות לעו״ד (לא שכר טרחה)",
    costHintAr: "متوسط — جاهزية للمحامي (ليس أتعاباً)",
    strengthsEn: [
      "Flags privacy/UGC/ads/copyright/AI-surface gaps for a lawyer",
      "Cites only allow-listed IL/US/EU gov and university portals",
      "Always returns NOT LEGAL ADVICE + lawyerReadiness",
    ],
    strengthsHe: [
      "מסמן פערים בפרטיות/UGC/פרסום/זכויות/משטחי AI לעו״ד",
      "מצטט רק פורטלים רשמיים בישראל / ארה״ב / האיחוד",
      "תמיד מחזיר אין ייעוץ משפטי + מוכנות לעו״ד",
    ],
    strengthsAr: [
      "يؤشر فجوات خصوصية/محتوى/إعلان/حقوق/أسطح ذكاء للمَحامي",
      "يستشهد فقط ببوابات رسمية في إسرائيل / الولايات المتحدة / الاتحاد",
      "يعيد دائماً ليس استشارة قانونية + جاهزية للمحامي",
    ],
    weaknessesEn: [
      "Cannot practice law or bind any jurisdiction",
      "Heuristics miss nuanced case law",
      "Requires human attorney for opinions",
    ],
    weaknessesHe: [
      "לא עוסק בעריכת דין ולא מחייב אף שיפוט",
      "היוריסטיקות מפספסות פסיקה עדינה",
      "דורש עורך דין אנושי לחוות דעת",
    ],
    weaknessesAr: [
      "لا يمارس المحاماة ولا يُلزم أي ولاية",
      "الاستدلالات تفوّت السوابق الدقيقة",
      "يتطلب محامياً بشرياً للرأي",
    ],
    cannotSelfValidate: true,
  },
  JUDGE: {
    id: "JUDGE",
    title: "Evidence Judge",
    titleHe: "שופט ראיות",
    titleAr: "قاضي الأدلة",
    specialty: "Believe the result? Contradictions · unsupported · unsafe",
    category: "governance",
    cognitiveRole: "EVIDENCE_JUDGE",
    secondaryCognitiveRoles: ["FINAL_VERIFIER"],
    allowedTools: ["evaluate", "conflict_scan", "escalate"],
    forbiddenTools: ["apply_patch", "write_code"],
    evidenceRequirements: ["specialist outputs", "evidence refs"],
    maxCostUsd: 0.35,
    timeoutMs: 60_000,
    riskLevel: "CRITICAL",
    canWriteCode: false,
    evaluationSuite: "judge-v1",
    costHintEn: "Low-mid — belief check",
    costHintHe: "נמוך-בינוני — בדיקת אמון",
    costHintAr: "منخفض-متوسط — فحص الثقة",
    strengthsEn: [
      "APPROVE / REJECT / MORE_EVIDENCE / ESCALATE",
      "Contradiction and unsupported-claim scan",
      "Never writes code",
    ],
    strengthsHe: [
      "אישור / דחייה / עוד ראיות / הסלמה",
      "סריקת סתירות וטענות לא נתמכות",
      "לעולם לא כותב קוד",
    ],
    strengthsAr: [
      "موافقة / رفض / مزيد أدلة / تصعيد",
      "فحص التناقضات والادعاءات غير المدعومة",
      "لا يكتب شيفرة أبدًا",
    ],
    weaknessesEn: [
      "Depends on specialist outputs",
      "Cannot fix what it rejects",
      "Conservative on thin evidence",
    ],
    weaknessesHe: [
      "תלוי בפלטי מומחים",
      "לא מתקן את מה שהוא דוחה",
      "שמרני על ראיות דלות",
    ],
    weaknessesAr: [
      "يعتمد على مخرجات المتخصصين",
      "لا يصلح ما يرفضه",
      "محافظ عند ضعف الأدلة",
    ],
    cannotSelfValidate: true,
  },
  ADVERSARY: {
    id: "ADVERSARY",
    title: "Adversary",
    titleHe: "יריב",
    titleAr: "خصم",
    specialty: "Challenge conclusions · find counter-evidence · break assumptions",
    category: "adversarial",
    cognitiveRole: "ADVERSARY",
    allowedTools: ["analyze_repo", "risk_map", "conflict_scan"],
    forbiddenTools: ["apply_patch", "write_code"],
    evidenceRequirements: ["specialist conclusions", "proposed solutions"],
    maxCostUsd: 0.4,
    timeoutMs: 90_000,
    riskLevel: "HIGH",
    canWriteCode: false,
    evaluationSuite: "adversary-v1",
    costHintEn: "Mid — adversarial review",
    costHintHe: "בינוני — סקירה יריבית",
    costHintAr: "متوسط — مراجعة خصومية",
    strengthsEn: [
      "Challenges all conclusions",
      "Finds counter-evidence",
      "Exposes hidden assumptions",
    ],
    strengthsHe: [
      "מאתגר כל מסקנות",
      "מוצא ראיות נגד",
      "חושף הנחות סמויות",
    ],
    strengthsAr: [
      "يتحدى جميع الاستنتاجات",
      "يجد أدلة معارضة",
      "يكشف الافتراضات الخفية",
    ],
    weaknessesEn: [
      "Cannot validate own conclusions",
      "Needs specialist output to challenge",
      "May over-challenge valid work",
    ],
    weaknessesHe: [
      "לא יכול לאמת מסקנות עצמו",
      "צריך פלט מומחה לאתגר",
      "עלול לאתגר יתר על המידה",
    ],
    weaknessesAr: [
      "لا يمكنه التحقق من استنتاجاته",
      "يحتاج مخرجات متخصص للتحدي",
      "قد يبالغ في التحدي",
    ],
    cannotSelfValidate: true,
  },
  DATABASE: {
    id: "DATABASE",
    title: "Database Specialist",
    titleHe: "מומחה מסדי נתונים",
    titleAr: "متخصص قواعد البيانات",
    specialty: "Schema · queries · indexes · transactions · replication",
    category: "engineering",
    cognitiveRole: "INVESTIGATOR",
    secondaryCognitiveRoles: ["BUILDER", "DIAGNOSTICIAN"],
    allowedTools: ["analyze_repo", "query_explain", "schema_analyze"],
    forbiddenTools: ["apply_patch_without_approval", "prod_mutate"],
    evidenceRequirements: ["schema", "query plans", "data distribution"],
    maxCostUsd: 0.5,
    timeoutMs: 90_000,
    riskLevel: "HIGH",
    canWriteCode: true,
    evaluationSuite: "database-v1",
    costHintEn: "Mid — schema + query analysis",
    costHintHe: "בינוני — ניתוח סכמה ושאילתות",
    costHintAr: "متوسط — تحليل المخطط والاستعلامات",
    strengthsEn: [
      "Query plan analysis",
      "Index optimization",
      "Data integrity focus",
    ],
    strengthsHe: [
      "ניתוח תוכניות שאילתה",
      "אופטימיזציית אינדקסים",
      "מיקוד בשלמות נתונים",
    ],
    strengthsAr: [
      "تحليل خطط الاستعلام",
      "تحسين الفهارس",
      "التركيز على سلامة البيانات",
    ],
    weaknessesEn: [
      "Needs schema and query evidence",
      "Production mutations require approval",
      "Test data may not reflect production",
    ],
    weaknessesHe: [
      "דורש ראיות סכמה ושאילתות",
      "מוטציות בפרוד דורשות אישור",
      "נתוני בדיקה לא משקפים פרוד",
    ],
    weaknessesAr: [
      "يحتاج أدلة مخطط واستعلامات",
      "طفرات الإنتاج تتطلب موافقة",
      "بيانات الاختبار قد لا تعكس الإنتاج",
    ],
    cannotSelfValidate: true,
  },
};
