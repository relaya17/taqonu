# Gap Analysis — Atlas Control Plane Vision מול הקוד הקיים ב-taqonu-main

תאריך: 18.08.2026
זהו מיפוי שיטתי: לכל יכולת שהוצעה במסמך החזון (`atlas-control-plane-vision.md`), נבדק מה כבר קיים בפועל בקוד, מה קיים חלקית, ומה חסר לגמרי — עם קובץ:שורה כהוכחה, לא הערכה. הבדיקה בוצעה ע"י 5 סוכני חיפוש מקבילים, כל אחד על אשכול יכולות אחר, ואוחדה כאן למסמך אחד.

## ⚠️ עדכון היקף — סבב השלמה בוצע

**עדכון:** לאחר הפצת הגרסה הראשונה של המסמך הזה, נעשה סבב השלמה שבו `apps/web`, `apps/worker`, `.github/workflows/`, `e2e/*.spec.ts` ו-`supabase/migrations/*.sql` (שלא נבדקו בסבב הראשון) יובאו ונבדקו בפועל. חמישה ממצאים עודכנו כתוצאה מכך: **Multi-Tenant Isolation** (קובצי ה-RLS כן קיימים), **CI/CD Intelligent Gate** (עלה מ-MISSING ל-EXISTS), **Command Center** (עלה מ-MISSING ל-PARTIAL), **Unified UX/Design System** (עלה מ-MISSING ל-PARTIAL), ו-**Automation Engine** (עדיין MISSING, אך יש כעת יסוד job-worker לבנות עליו). כל שאר הממצאים (agent-core, apps/api, packages/*) נותרו כפי שהיו — הם כבר נבדקו במלואם בסבב הראשון. הפרקים למטה מעודכנים לפי הבדיקה המלאה.

## תמצית מנהלים

**הכי בנוי (קוד אמיתי, לא רק סכמה):** Universal Memory, Verified Knowledge Engine, Provenance, Decision Memory, Agent Registry, Model-Agnostic AI Gateway, Intelligence Router, Simulation/Preflight, Agent Orchestrator, Autonomous/Risk-Based QA (backend), CI/CD Gate (build→test→lint→eval-gate→secrets-scan חוסם).

**חסר לגמרי (אין שום קוד):** Event Bus (system-wide), Plugin SDK, Automation Engine (אמיתי, מונחה-חוקים), Universal Filter Engine, Risk Engine (0–100 סקור מספרי), Cost Intelligence, Anomaly Detection, Modular Add/Remove/Replace lifecycle, Marketplace.

**קיים חלקית (יש בסיס אמיתי, אבל לא במלוא ההיקף שהחזון מתאר):** כל השאר, כולל כעת גם Command Center ו-Unified UX/Design System — ראה טבלאות למטה.

---

## 1. שכבת אמון וביטחון (Trust & Security)

**Event Bus — MISSING (יש תחליף חלקי בלבד)**
אין pub/sub, message queue, או צינור `EVENT → RULE → AGENT → VALIDATION → ACTION`. אין `apps/worker` בעותק שנבדק. מה שכן קיים: `packages/agent-core/src/kernel/evidence-bus.ts` — מחלקת `EvidenceBus`, אך זהו יומן ראיות/טענות פנימי לכל הרצה בודדת (`publish`, `publishClaim`, `listEvents`), לא אוטובוס אירועים עסקיים כלל-מערכתי. אין מנוע חוקים ואין אירועים כמו `invoice.created`.

**Universal Audit Log — PARTIAL**
קיים מימוש אמיתי: `apps/api/src/services/audit-log.ts` — יומן NDJSON append-only עם שרשור hash (SHA-256, `hashAuditPayload`/`prevHash`), חשוף דרך `GET /api/v1/audit`, כ-28 נקודות קריאה ברחבי הקוד. הפער: הרשומות הן `Record<string, unknown>` חופשי ללא סכמה אחידה של WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/POLICY/RISK/APPROVAL/RESULT — כל נקודת קריאה כותבת שדות אחרים משלה, ואין שדה `risk`/`why` עקבי.

**Identity + Permissions — PARTIAL**
קיימת הזדהות אמיתית (`apps/api/src/routes/auth.ts`, Supabase JWT + fallback), אבל RBAC גס — בפועל רק admin מול user רגיל, ללא ABAC ו-ללא מודל הרשאות פר-משאב/פר-סוכן. הרשאות ברמת כלי (tool) כן קיימות ומדויקות יותר: `packages/agent-core/src/policies/authorization.ts` + `tool-policies.ts`.

**Multi-Tenant Isolation — PARTIAL (מודל בעלים יחיד, לא ארגון-רב-משתמשים) [עודכן]**
בידוד אמיתי לפי `owner_id` דרך Supabase RLS — ואומת בפועל: `supabase/migrations/20260812003000_rls_projects_evidence_tenant.sql` מפעיל RLS ומגדיר מדיניות `using (auth.uid() = owner_id) with check (...)` על `projects`, `evidence_records`, `claims`, `claim_evidence`, `memory_evidence` ועוד — כולל תיקון policy שהיה חסר על טבלת junction. יש 7 קובצי מיגרציה בסה"כ (init, architecture, account_plans, auth_profiles_roles, rls_tenant, knowledge_embeddings, memories_created_by), כך שהתשתית קיימת ואמיתית — לא רק תיעוד. עדיין: "Tenant" בקוד מתייחס לתוכנית חיוב פר-בעלים (`tenantSubscriptions`), לא לארגון עם כמה משתמשים שחולקים סוכנים/זיכרון מבודדים — אין מודל org/team.

**Secrets & Configuration Governance — PARTIAL**
`packages/config/src/env.ts` עושה ולידציית Zod אמיתית + `assertProductionSecrets()` שחוסם עלייה לפרודקשן בלי סודות קריטיים, ובודק ערך placeholder אחד ידוע. חסר: מטריצת Production/Preview, זיהוי drift בין סביבות, זיהוי ברירות-מחדל חלשות מעבר למחרוזת אחת קשיחה, זיהוי תוקף פג.

**Policy Engine — PARTIAL**
`packages/agent-core/src/policies/tool-policies.ts` + `authorization.ts` — מיפוי כלים (לא ישויות עסקיות) לרמת סיכון והאם דרושת אישור. חסרה טבלת מדיניות פר-ישות-עסקית (לקוח/חשבונית/תיק) כמו הדוגמה בחזון.

**Risk Engine (ניקוד 0–100) — MISSING (יש מנוע סיכון שונה)**
`packages/code-intelligence/src/risk.ts` (`computeRiskScore`, מסומן "ADR-014 seed") מכפיל 5 גורמים לציון עד 3125, מחולק ל-LOW/MEDIUM/HIGH/CRITICAL — משמש ל-QA/רגרסיה, לא לשער כל פעולת סוכן. אין ציון 0–100 ואין מיפוי ל-Auto/Auto+Log/Approval/Human-only כפי שהחזון מתאר.

**Zero-Trust Agents — PARTIAL**
`registeredAgentSchema.permissions` (READ_REPO/WRITE_EVIDENCE/APPLY_PATCH/CALL_EXTERNAL/ESCALATE/JUDGE/ORCHESTRATE) — הרשאות אמיתיות פר-סוכן, לא גישה גורפת. אבל לא בטקסונומיה של החזון (READ/WRITE/EXECUTE/COMMUNICATE/FINANCIAL/LEGAL/ADMIN) — השמות ספציפיים ל-engineering-loop.

**Simulation / Preflight — EXISTS (חלקי מול 5 השלבים המלאים)**
`packages/agent-core/src/kernel/simulation.ts` חוסם פעולות בסיכון גבוה/פרודקשן, ו-`kernel/run.ts` מריץ PLAN → SIMULATE → JUDGE → אישור אנושי → EXECUTE בפועל. חסר: ניתוח השפעה קונקרטי ("משפיע על N רשומות"), אין זיהוי התנגשות/כפילות מול דאטה אמיתי — זה היוריסטי (regex/סוג-סוכן), לא preflight מודע-דאטה.

**Post-Action Verification — PARTIAL**
`verifier/self-check.ts` בודק צ'קליסט סטטי (עובדה מול השערה, סודות, ציטוטים) — לא אימות תוצאה. `packages/code-intelligence/src/auto-remediation.ts` כן עושה אימות פוסט-החלה אמיתי, אבל רק לתיקוני קוד. יש `rollbackRef`/`rollbackSnapshot` אמיתיים ל-Patch. חסרה לולאת Action→Verify→Rollback גנרית לפעולות עסקיות (חשבונית, עדכון רשומה).

**Self-Healing — PARTIAL**
`auto-remediation.ts` מממש כמעט את כל השרשרת (Detect→...→Verify) לבעיות constitution/audit ברמת LOW/MEDIUM, כולל שער אישור ל-HIGH/CRITICAL. חסרים שלבי Diagnose/Test אמיתיים (הרצת בדיקות לפני החלה), וההיקף מוגבל לבעיות קוד — לא ריפוי-עצמי מערכתי כללי.

---

## 2. שכבת ידע וזיכרון (Knowledge & Memory)

**Universal Memory — EXISTS**
`packages/shared/src/constants/memory.ts`: 12 טיפוסי הזיכרון (FACT/DECISION/PREFERENCE/EVENT/LESSON/TASK/GOAL/ARCHITECTURE/BUG/SOLUTION/PROJECT_STATE/EXTERNAL_KNOWLEDGE) — התאמה כמעט מדויקת לחזון, כולל סכמה מלאה וסינון-לפני-סוכן דרך `memory-pipeline.ts`.

**Verified Knowledge Engine — EXISTS**
`knowledge-source.schema.ts` + `knowledge-claim.schema.ts` ממפים ישירות ל-Source/Authority/Freshness/Confidence/Jurisdiction/Version. כדאי לוודא שהזרימה חיה קצה-לקצה, לא רק בסכמה.

**Provenance — EXISTS**
`evidenceRecordSchema`/`claimSchema` נושאים מקור, דירוג סמכות, שרשרת `derivedFrom`, אימות, וזיהוי טענות סותרות עם פתרון לפי סמכות (`apps/api/src/routes/conflicts.ts`).

**Information DNA — PARTIAL**
השדות (Origin/Created/Version/Confidence/Verification/Owner/Modified) קיימים אך מפוזרים בין סכמות שונות ולא כאובייקט DNA מאוחד; "Dependencies" קיימות רק כגרף נפרד, לא צמודות לכל פריט מידע.

**Decision Memory — EXISTS**
`decision.schema.ts`: decision/reason/alternatives/tradeOffs/evidence/status/adrPath — התאמה כמעט מילולית לדוגמה בחזון ("בחרנו Turso במקום X כי..."), כולל ניהול מחזור חיים (ACTIVE/SUPERSEDED/PROPOSED/REJECTED).

**Bug → Solution Memory — PARTIAL (הפריט הכי פחות בנוי מבין הזיכרונות)**
BUG ו-SOLUTION קיימים כטיפוסי זיכרון, ו-`observer/src/bugs/ingest.ts` מסווג חומרה. אבל אין שדות rootCause/solution/verification/regressionTest, אין קישור בין BUG ל-SOLUTION, ואין זיהוי דמיון ("זה נראה כמו BUG-184").

**Knowledge Graph — PARTIAL**
`graph.schema.ts` + `observer/src/graph/build.ts` (610 שורות) בונים גרף אמיתי ברמת ארכיטקטורה (PACKAGE/FILE/FUNCTION/API/DATA_STORE...) עם שאילתות blast-radius — בדיוק הגרף ההנדסי. חסר לגמרי: הגרף העסקי (לקוח→חוזה→חשבונית→תשלום) — כל הטיפוסים היום הנדסיים בלבד.

**Change Detection — PARTIAL**
`observer/src/temporal/compare.ts` ו-`behavior/diff.ts` מזהים שינויים אמיתיים ברמת קוד/ארכיטקטורה. חסר: זיהוי שינוי במדד עסקי מספרי (למשל קפיצה של 47%) והתרעת סיכון — לא נמצא בשום מקום.

**Anomaly Detection — MISSING**
אין שום לוגיקת חריגות/z-score/סטייה מדפוס. `observer/src/production/signals.ts` רק בודק נוכחות כלי observability בקוד — סריקה סטטית, לא צינור Normal→Anomaly→Investigation בזמן ריצה.

---

## 3. שכבת סוכנים וארכיטקטורה (Agents & Architecture)

**Agent Registry — EXISTS/PARTIAL**
`FABRIC_AGENT_CATALOG` (14 סוכנים) + `registry.ts` מממשים כמעט בדיוק את סכמת החזון: capabilities/permissions/tools/riskLevel/evidencePolicy/inputSchema/outputSchema/version/trustLevel, חשוף דרך `/api/v1/kernel/agents` ו-`/api/v1/agents`. חסר: טלמטריית בריאות חיה (uptime/error-rate) פר-סוכן.

**Agent Orchestrator — PARTIAL**
`orchestrator/plan.ts` + `dispatch.ts` בונים צינור Orchestrator→Specialists→Judge אמיתי עם קבוצות מקבילות. אין שרשרת קבועה Research→Specialist→Security→Verification→Execution — זה ראוטר דינמי, ואין סוכן "Execution" או "Verification" נפרדים (Judge ממלא רק חלק מהתפקיד).

**Contract-First Architecture — EXISTS (לסוכנים בלבד)**
`registeredAgentSchema` אוכף Input/Output/Permissions/riskLevel/Version פר-סוכן דרך Zod. לא מיושם באופן גורף על כל API/מודול — רק על סוכנים.

**Plugin SDK — MISSING**
אין `createAtlasPlugin()`/`registerTool()`/`registerWorkflow()`/`registerEvent()` בשום מקום. כל הסוכנים מוגדרים סטטית בקובץ קטלוג יחיד — אין API פיתוח חיצוני, אין מנגנון התקנה/מרקטפלייס.

**Automation Engine — MISSING (אך יש יסוד job-worker לבנות עליו) [עודכן]**
אין מנוע שרשראות trigger→condition→action מונחה-אירועים. `admin-oracle-queue.ts` מזהה ומדרג בעיות אך **לא מבצע** ("Detect→rank→notify/propose only. No silent apply."). `apps/worker/src/index.ts` + `jobs/processor.ts` הוא תהליך worker אמיתי אך מינימלי — תור in-memory (לא מתמיד, נמחק בכל restart), 5 סוגי jobs קשיחים בקוד (`github.initial_sync`, `state.reconcile` וכו'), ללא מנוע חוקים כללי. זה יסוד טכני סביר להרחיב ממנו automation אמיתי, אבל כיום אינו כזה.

**Intelligence Router — EXISTS**
`router/genius.ts` עושה ניתוב מבוסס-חוקים אמיתי (בלי LLM) לבחירת מומחים ו-`modelHint`. חסר: שכבת קיצור-דרך SQL/cache לפני הניתוב, ואסקלציה דינמית מודל-קטן→גדול (רק מיפוי מילות-מפתח סטטי).

**Model-Agnostic AI Gateway — EXISTS**
`providers/llm.ts` — שער רב-ספקים אמיתי ועובד: Anthropic/Gemini/Groq/Ollama/DeepSeek/OpenAI עם fallback חינמי. זו ההתאמה החזקה ביותר לחזון בכל הביקורת.

**Context Engine — PARTIAL**
`memory-pipeline.ts` (`retrieveMemories`/`buildMemoryContext`) עושה Retrieve→Rank→Truncate→Tag בפונקציית ניקוד אחת, לא 5 שלבי Filter/Validate/Inject נפרדים כמו בחזון.

**Universal Filter Engine — MISSING**
אין מנוע סינון/עדיפויות משותף חוצה-אפליקציות. יש רק התאמת-דפוסים ספציפית ל-QA (`qa-core/src/portfolio/patterns.ts`).

**Priority / Action Queue — PARTIAL**
`admin-oracle-queue.ts` עושה טריאז' אמיתי לפי חומרה (critical/high/medium/info) עם דירוג עדיפות — אך מוגבל לתפעול הפלטפורמה עצמה (watchdog, patches, deploys), לא תור גנרי לרשומות עסקיות חוצה-מוצרים.

---

## 4. שכבת תפעול וחוויית משתמש (Ops & UX)

**Health & Observability — PARTIAL**
`GET /health` מחזיר `{status:"ok"}` בלבד ללא פירוט פר-רכיב, אבל `platform-watchdog.ts` מייצר התרעות אמיתיות בדירוג חומרה + `packages/observability/src/metrics.ts` נותן מדדי Prometheus. חסר: סטטוס HEALTHY/WARNING/DEGRADED/CRITICAL מאוחד פר-רכיב (API/DB/AI/Queue) וצינור Health→Diagnosis→Root Cause→Recommendation.

**Cost Intelligence — MISSING**
אין שום מעקב עלות טוקנים/מודל, עלות פר-לקוח/workflow, או המלצת חלופה זולה יותר בשום מקום בקוד.

**Dependency Intelligence — PARTIAL**
`observer/src/security/deps.ts` בודק פגיעויות ידועות (CVE allowlist) בלבד — אין בדיקת חבילות מיושנות, בעיות רישוי, או חבילות כפולות/לא בשימוש.

**Architecture Drift Detection — PARTIAL**
`code-intelligence/src/constitution-detectors.ts` + `continuous-audit.ts` עושים ביקורת "חוקה הנדסית" אמיתית (PASS/WARN/FAIL). אין גלאי ייעודי להפרת שכבות (API→DB ישיר בעקיפת Service).

**CI/CD Intelligent Gate — EXISTS [עודכן — קודם דווח MISSING, הייתה טעות ייצוא]**
`.github/workflows/ci.yml`: על כל push/PL — install → build (turbo) → unit tests → lint (`--max-warnings 0`) → **"Atlas CI eval gate (blocking)"** (`ci-eval-gate.ts`, בודק store + redaction, יוצא עם קוד שגיאה שחוסם merge) → **"Atlas CI secret scan (blocking)"** (`ci-secrets-scan.ts`, `detectSecrets` על כל `apps`/`packages`, חוסם אם נמצא סוד חי). קובץ שני, `.github/workflows/e2e-critical-path.yml`: מקים סטאק API+Web מלא ומריץ `test:e2e:critical` → `test:e2e:product` → `test:e2e:security` → `test:e2e:a11y` ברצף, עם העלאת דו"ח Playwright בכשלון. זה צינור Push→Build→Test→Lint→Security-Gate→E2E-Gate אמיתי וחוסם. חסר מול החזון: אין שלב Dependency-Scan נפרד, ואין ציון סיכון מספרי (Risk Score) לפני deploy — השערים הם בינארי עובר/נכשל, לא מדורגים.

**Autonomous / Risk-Based QA — EXISTS (לוגיקת Backend + E2E אמיתי) [עודכן]**
`qa-core/src/planner/plan.ts` מסיק סיכונים לפי נתיבים שהשתנו (AUTHENTICATION/PAYMENTS/DATABASE_MIGRATION/SECURITY_CONFIG) ובוחר דומיינים רלוונטיים בלבד — בדיוק ה"ריצה חכמה, לא הכל" של החזון. בנוסף נמצאו בפועל קובצי `e2e/*.spec.ts` אמיתיים: `critical-path.spec.ts`, `product-surfaces.spec.ts`, `security.spec.ts`, `a11y.spec.ts`, `new-surfaces.spec.ts` — ומחוברים ל-CI (ראו לעיל). `a11y.spec.ts` בודק skip-link, landmark `main`, כותרת H1, ותפריט המבורגר ברוחב צר — smoke אמיתי, לא axe מלא.

**Modular Add/Remove/Replace/Configure — MISSING**
אין `registerAgent`/`registerTool`/API להתקנה-הסרה. הרישום הקיים (`registry.ts`) הוא קטלוג סטטי בלי מנגנון הפעלה/כיבוי/הסרה עם בדיקת תלויות.

**Command Center — PARTIAL [עודכן — קודם דווח MISSING, הייתה טעות ייצוא]**
יש frontend אמיתי (`apps/web`, Next.js + MUI + next-intl). `apps/web/components/admin/AdminShell.tsx` — סרגל ניווט אדמין עם הפריט הראשון "מרכז פיקוד" (`/admin`). `apps/web/components/systems/ExecutiveAuditPanel.tsx` — פאנל דירוג חומרה אמיתי (CRITICAL/HIGH/MEDIUM) עם `topRisks`, `recommendedActions`, `evidenceRefs`, ואחוזי מוכנות לפרודקשן (`productionReadiness`, `verifiedPct`/`unverifiedPct`/`unknownPct`) ו-`verdict.plainLanguageSummary` — זו כבר גרסה ראשונית ממשית לדאשבורד Executive/Risk מהחזון. `apps/web/components/dashboard/PersonalDesk.tsx` נותן טאבים Memory/Decisions/Patches. חסר: איחוד לדאשבורד יחיד Critical/Risk/Intelligence/Automation/Approval/System-Health (היום זה מפוצל בין כמה מסכים נפרדים), ואין תצוגת Automation/Approval-Queue ייעודית.

**Marketplace — MISSING**
אין שום מימוש בקוד — לא ב-backend ולא ב-`apps/web` (נבדק גם שם ולא נמצא דבר); רק אזכורים במסמך החזון עצמו ומילים לא-קשורות (pricing/marketRate).

**Unified UX / Design System — PARTIAL [עודכן — קודם דווח MISSING, הייתה טעות ייצוא]**
יש בסיס i18n/RTL אמיתי: `apps/web/i18n/routing.ts` מגדיר 3 שפות (`he`/`en`/`ar`, `localePrefix: "always"`), `messages/{he,ar,en}.json`, ו-`dir="rtl"` מיושם בפועל ב-layouts (`app/[locale]/layout.tsx`, `app/admin/layout.tsx`). ספריית עיצוב — MUI (Material UI) עם theme מותאם (פונטים "Syne"/"Frank Ruhl Libre"), לא ספריית רכיבים ייעודית ל-Atlas. יש גם smoke-test נגישות אמיתי (`e2e/a11y.spec.ts`) שבודק skip-link ו-landmarks בסיסיים. חסר: בדיקת WCAG 2.2 AA מלאה (axe-core), וספריית קומפוננטות Atlas-ייעודית משותפת בין המוצרים (היום זה MUI גנרי בתוך `apps/web` בלבד, לא חבילת design-system נפרדת שמוצרים אחרים כמו HotelOS/Vantera יכולים לצרוך).

---

## מיפוי מול סדר הבנייה המומלץ (14 הצעדים מהמסמך)

| # | צעד מהחזון | מצב בקוד |
|---|---|---|
| 1 | Atlas Core | **קיים** — kernel/run.ts, registry, orchestrator עובדים קצה-לקצה |
| 2 | Event Bus + Audit Log משותפים | Event Bus **חסר**, Audit Log **חלקי** (יש יומן אמיתי, בלי סכמה אחידה) |
| 3 | Identity + Permissions + Tenant Isolation | **חלקי בכל השלושה** — יש בסיס אמיתי, אין ABAC/ארגון-רב-משתמשים |
| 4 | Policy + Risk Engine | Policy **חלקי** (פר-כלי, לא פר-ישות), Risk Engine 0–100 **חסר** (יש מנוע אחר לצרכים אחרים) |
| 5 | Knowledge + Memory + Provenance | **הכי בנוי בכל הביקורת** — כמעט הכל EXISTS |
| 6 | Context + Universal Filter | Context Engine **חלקי**, Universal Filter **חסר** |
| 7 | Agent Registry + Orchestrator | **חלקי/קיים** — הבסיס החזק ביותר אחרי שכבת הידע |
| 8 | Automation Engine | **חסר לגמרי** |
| 9 | Simulation + Post-Action Verification | Simulation **קיים** (חלקי), Verification **חלקי** |
| 10 | Secrets Governance + CI/CD Gate | Secrets **חלקי**, CI/CD **קיים** ✅ (עודכן — צינור build→test→lint→eval-gate→secrets-scan חוסם אמיתי) |
| 11 | Health & Observability + Cost Intelligence | Health **חלקי**, Cost **חסר לגמרי** |
| 12 | Modular Add/Remove | **חסר לגמרי** |
| 13 | Command Center | **חלקי** (עודכן — יש פאנל Executive/Risk אמיתי, לא מאוחד לדאשבורד יחיד) |
| 14 | Marketplace / Plugin SDK | Plugin SDK **חסר לגמרי**, Marketplace **חסר לגמרי** |

**המשמעות המעשית (מעודכן):** הצעדים 1, 5, 7 ו-10 (הליבה, הידע/זיכרון, מרשם-הסוכנים, ושער ה-CI/CD) כבר עומדים על רגליים אמיתיות ועובדות. הצעדים 2–4, 6, 9, 11, 13 יש להם נקודת התחלה אמיתית לבנות עליה. הצעדים 8, 12, 14 — Automation Engine, Modular lifecycle, Marketplace/Plugin SDK — טרם החלו כלל.

---

## המלצה לצעד הבא

זו ביקורת מיפוי בלבד — לא בוצע כאן שינוי קוד (למעט תיקוני הבאגים והבדיקות מהסבב הקודם ב-agent-core/schemas, שכבר בוצעו ונשלחו קודם). הביקורת עצמה הושלמה כעת במלואה — כולל `apps/web`, `apps/worker`, `.github/workflows`, `supabase/migrations`.

הצעד הכי משתלם הבא, לפי סדר הבנייה בחזון ולפי מה שכבר קיים: **Event Bus + Audit Log מאוחד (צעד 2)** — כי זו תשתית שכל שאר הצעדים החסרים (Automation Engine, Policy Engine, Health, Command Center) תלויים בה, ויש כבר `EvidenceBus` בקוד שאפשר להרחיב ממנו רעיונית, ויומן audit אמיתי (`audit-log.ts`) שרק חסרה לו סכמה אחידה.
