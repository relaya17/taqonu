# Gap Analysis — Atlas Control Plane Vision מול הקוד הקיים ב-taqonu-main

תאריך: 18.08.2026
זהו מיפוי שיטתי: לכל יכולת שהוצעה במסמך החזון (`atlas-control-plane-vision.md`), נבדק מה כבר קיים בפועל בקוד, מה קיים חלקית, ומה חסר לגמרי — עם קובץ:שורה כהוכחה, לא הערכה. הבדיקה בוצעה ע"י 5 סוכני חיפוש מקבילים, כל אחד על אשכול יכולות אחר, ואוחדה כאן למסמך אחד.

## ⚠️ עדכון היקף — סבב השלמה בוצע

**עדכון:** לאחר הפצת הגרסה הראשונה של המסמך הזה, נעשה סבב השלמה שבו `apps/web`, `apps/worker`, `.github/workflows/`, `e2e/*.spec.ts` ו-`supabase/migrations/*.sql` (שלא נבדקו בסבב הראשון) יובאו ונבדקו בפועל. חמישה ממצאים עודכנו כתוצאה מכך: **Multi-Tenant Isolation** (קובצי ה-RLS כן קיימים), **CI/CD Intelligent Gate** (עלה מ-MISSING ל-EXISTS), **Command Center** (עלה מ-MISSING ל-PARTIAL), **Unified UX/Design System** (עלה מ-MISSING ל-PARTIAL), ו-**Automation Engine** (עדיין MISSING, אך יש כעת יסוד job-worker לבנות עליו). כל שאר הממצאים (agent-core, apps/api, packages/*) נותרו כפי שהיו — הם כבר נבדקו במלואם בסבב הראשון. הפרקים למטה מעודכנים לפי הבדיקה המלאה.

## תמצית מנהלים

**הכי בנוי (קוד אמיתי, לא רק סכמה):** Universal Memory, Verified Knowledge Engine, Provenance, Decision Memory, Agent Registry, Model-Agnostic AI Gateway, Intelligence Router, Simulation/Preflight, Agent Orchestrator, Autonomous/Risk-Based QA (backend), CI/CD Gate (אמיתי — `process.exit` בפועל, לא decorative, ראו סעיף 17 למטה), Event Bus, Automation Engine, Policy Engine (per-entity), Cost Intelligence (אמיתי), Risk Engine 0-100, Modular Agent Lifecycle, Universal Filter Engine, Plugin SDK (גרסה ראשונה, data-only), Marketplace UI, Command Center (חלקי), Anomaly Detection (baseline z-score/IQR, כן).

**⚠️ תיקון לשורה הקודמת של המסמך הזה (הייתה מיושנת):** בגרסה קודמת של המסמך נכתב כאן ש-Anomaly Detection ו-Marketplace "חסרים לגמרי" — זה כבר לא נכון; שניהם נבנו ואומתו בסבב מאוחר יותר (ראו עדכון "סבב שמיני" למטה). **מה שבאמת עדיין חסר/לא בוצע:** מודל ארגון/רב-משתמשים בפועל (יש רק תכנון+draft migration, לא בוצעה מיגרציה אמיתית), Plugin SDK's sandbox להרצת קוד צד-שלישי (הוצא מהיקף בכוונה, לא בטעות), ו-Unified UX/Design System מעבר למה שנבדק ב-e2e/axe-core.

**קיים חלקית (יש בסיס אמיתי, אבל לא במלוא ההיקף שהחזון מתאר):** כל השאר, כולל כעת גם Command Center ו-Unified UX/Design System — ראה טבלאות למטה.

---

## 1. שכבת אמון וביטחון (Trust & Security)

**Event Bus — EXISTS (עודכן פעמיים: קודם MISSING, ואז נבנה בפועל בסבב הזה)**
תיקון חשוב לממצא הקודם: כבר לפני שהתחלנו לבנות היה קיים כאן הרבה יותר משדווח — `packages/shared/src/constants/events.ts` מגדיר 22 סוגי אירועי דומיין אמיתיים (`patch.applied`, `memory.created`, `decision.created`, `agent.run.completed` וכו'), עם סכמת `domainEventSchema`, ויומן דומיינים אמיתי ומתמיד ב-`apps/api/src/store/os-store.ts` (`appendDomainEvent`/`listDomainEvents`) שנקרא מ-~20 נקודות שונות ברחבי הקוד (routes/services) וחשוף דרך `GET /api/v1/events`. מה שבאמת היה חסר הוא **שכבת התגובה** — אף אחד לא באמת "מאזין" לאירועים האלה.

**זה מה שנבנה בפועל בסבב הזה:** `packages/agent-core/src/events/event-bus.ts` — `DomainEventBus` אמיתי עם `subscribe(pattern, handler)` (תומך גם ב-wildcard כמו `"patch.*"` וגם ב-`"*"` הגורף) ו-`publish(event)` שמבודד שגיאות handler (handler שנכשל לא חוסם handler אחר). מחובר ב-`apps/api/src/services/memory-pipeline.ts` לנקודת ה-`appendDomainEvent()` היחידה שכל 20 נקודות הפרסום כבר עוברות דרכה — כך שכל האירועים הקיימים הפכו לריאקטיביים בלי לשנות אף call site קיים. נכתב גם ה-rule הראשי האמיתי: `apps/api/src/services/event-rules.ts` — כשמתפרסם `patch.applied`, נכתבת אוטומטית רשומת ביקורת מאוחדת (ראו "Universal Audit Log" למטה). כל זה מכוסה ב-16 בדיקות חדשות (11 ל-`DomainEventBus`, 5 ל-`event-rules`), typecheck נקי, ואפס רגרסיות (343 בדיקות קיימות עדיין ירוקות).
חסר עדיין: מנוע חוקים דקלרטיבי (trigger→condition→action מוגדר כנתונים, לא בקוד), ואירוע יחיד (`patch.applied`) מקושר ל-rule אחד בלבד כרגע — זו הוכחת-היתכנות (proof of concept) לתשתית, לא כיסוי מלא של 22 סוגי האירועים.

**Universal Audit Log — PARTIAL, ונבנתה עליו תוספת בסבב הזה**
קיים מימוש אמיתי: `apps/api/src/services/audit-log.ts` — יומן NDJSON append-only עם שרשור hash (SHA-256, `hashAuditPayload`/`prevHash`), חשוף דרך `GET /api/v1/audit`, כ-28 נקודות קריאה ברחבי הקוד. הפער שדווח: הרשומות הן `Record<string, unknown>` חופשי ללא סכמה אחידה של WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/POLICY/RISK/APPROVAL/RESULT.
**מה שנוסף בפועל:** `packages/shared/src/schemas/unified-audit-entry.schema.ts` — סכמת Zod מלאה עם בדיוק 10 השדות האלה (`actorId`+`actorKind`=WHO, `type`=WHAT, `at`=WHEN, `reason`=WHY, `input`/`output`, `policy`, `risk`, `approval`, `result`), ופונקציה חדשה `appendUnifiedAuditEntry()` ב-`audit-log.ts` שכותבת לאותו קובץ NDJSON משורשר. זו תוספת (additive) בלבד — 28 נקודות הקריאה הקיימות לא שונו וממשיכות לעבוד בדיוק כמו קודם; call sites חדשים יכולים לאמץ את הסכמה האחידה בהדרגה. הוכחה חיה: ה-rule החדש ב-`event-rules.ts` (ראו "Event Bus" למעלה) כבר כותב רשומות בפורמט האחיד הזה בכל `patch.applied`. מכוסה ב-6 בדיקות סכמה חדשות.
נותר: לא בוצעה הגירה של 28 נקודות הקריאה הקיימות לפורמט האחיד — זה היה שינוי גדול ומסוכן יחסית לתועלת בסבב אחד, והוחלט להשאיר לצעד עתידי הדרגתי.

**Identity + Permissions — PARTIAL, עם התחלה אמיתית של ABAC [עודכן — נבנה בסבב הזה]**
קיימת הזדהות אמיתית (`apps/api/src/routes/auth.ts`, Supabase JWT + fallback), אבל RBAC גס — בפועל רק admin מול user רגיל. הרשאות ברמת כלי (tool) כן קיימות: `packages/agent-core/src/policies/authorization.ts` + `tool-policies.ts`.
**מה שנוסף:** `apps/api/src/services/resource-access.ts` — `checkResourceAccess()`, פונקציה טהורה (בלי I/O) שמשלבת בדיקת role→capability אמיתית (`capabilitiesForRole` הקיים, לא שוכפל) עם בדיקת בעלות-על-משאב במודל זהה בדיוק ל-`project-access.ts` (admin עוקף בעלות; לא-admin חייב `actorId === resourceOwnerId`; משאב ללא בעלים נבדק לפי capability בלבד) — בדיוק ה"שילוב role+resource" שהיה חסר. 7 בדיקות חדשות מאמתות את הסמנטיקה מול הקוד האמיתי, לא מול הנחות.
עדיין חסר: ABAC מלא (attributes נוספים כמו זמן/מיקום/תגית-רגישות), תפקידי ארגון מעבר ל-admin/user, וחיווט בפועל של `checkResourceAccess`/`authorizeEntityAction` (ראו Policy Engine למטה) לתוך route handlers אמיתיים — שתי התוספות האלה הן תשתית מוכנה לשימוש, לא עדיין באכיפה בזרימת בקשה חיה.

**Multi-Tenant Isolation — PARTIAL (מודל בעלים יחיד, לא ארגון-רב-משתמשים) [עודכן]**
בידוד אמיתי לפי `owner_id` דרך Supabase RLS — ואומת בפועל: `supabase/migrations/20260812003000_rls_projects_evidence_tenant.sql` מפעיל RLS ומגדיר מדיניות `using (auth.uid() = owner_id) with check (...)` על `projects`, `evidence_records`, `claims`, `claim_evidence`, `memory_evidence` ועוד — כולל תיקון policy שהיה חסר על טבלת junction. יש 7 קובצי מיגרציה בסה"כ (init, architecture, account_plans, auth_profiles_roles, rls_tenant, knowledge_embeddings, memories_created_by), כך שהתשתית קיימת ואמיתית — לא רק תיעוד. עדיין: "Tenant" בקוד מתייחס לתוכנית חיוב פר-בעלים (`tenantSubscriptions`), לא לארגון עם כמה משתמשים שחולקים סוכנים/זיכרון מבודדים — אין מודל org/team.

**Secrets & Configuration Governance — PARTIAL**
`packages/config/src/env.ts` עושה ולידציית Zod אמיתית + `assertProductionSecrets()` שחוסם עלייה לפרודקשן בלי סודות קריטיים, ובודק ערך placeholder אחד ידוע. חסר: מטריצת Production/Preview, זיהוי drift בין סביבות, זיהוי ברירות-מחדל חלשות מעבר למחרוזת אחת קשיחה, זיהוי תוקף פג.

**Policy Engine — PARTIAL→EXISTS ברובד הישויות [עודכן — נבנה בסבב הזה]**
`packages/agent-core/src/policies/tool-policies.ts` + `authorization.ts` — מיפוי כלים ברמת סיכון, ללא שינוי. **מה שנוסף:** `packages/agent-core/src/policies/entity-policies.ts` — בדיוק טבלת המדיניות פר-ישות-עסקית שהיה חסרה: 7 סוגי ישויות (CUSTOMER/RECORD/DOCUMENT/FINANCIAL_TRANSACTION/CASE/COMMUNICATION/CONFIGURATION) × 5 פעולות (READ/CREATE/UPDATE/DELETE/EXECUTE), עם `DEFAULT_ENTITY_POLICIES` שמממש בדיוק את הדוגמה מהחזון — READ מותר בסיכון נמוך, DELETE דורש אישור בלי יוצא מהכלל בשום ישות. `authorizeEntityAction()` מחזירה אותו ALLOWED/DENIED/APPROVAL_REQUIRED כמו `authorizeToolCall`, וחולקת את אותו vocabulary של רמות סיכון (`ToolRisk`) כדי שהשתיים יתחברו ולא יהיו שני עולמות נפרדים. 14 בדיקות חדשות, כולל בדיקה מפורשת ש-קומבינציית ישות+פעולה לא-ממופה נכשלת בבטחה (DENIED, לעולם לא ALLOWED דמיוני).
נותר: אין עדיין חיווט בפועל של `authorizeEntityAction` לתוך route handlers אמיתיים (routes עדיין לא קוראים לה) — זו תשתית מוכנה לשימוש, לא עדיין משולבת בזרימת בקשה אמיתית.

**Risk Engine (ניקוד 0–100) — EXISTS [עודכן — נבנה בסבב הזה]**
`packages/code-intelligence/src/risk.ts` (מנוע QA/רגרסיה נפרד) נשאר ללא שינוי. **מה שנוסף:** `packages/agent-core/src/policies/risk-score.ts` — בדיוק המנוע החסר: `computeActionRiskScore()` מחזיר ניקוד 0–100 אמיתי (בסיס לפי רמת סיכון + קנס-ודאות לפי confidence + קנס-ראיות לפי evidenceCount + רצפת-חובה כש-requiresApproval), ו-`bucketForRiskScore()` ממפה לארבע הקטגוריות המדויקות מהחזון: AUTO/AUTO_LOG/APPROVAL/HUMAN_ONLY. נבדק גם ב-property-test: requiresApproval לעולם לא נופל ל-AUTO/AUTO_LOG. `explainRiskScore()` נותן פירוט קריא-לאדם. 14 בדיקות. נותר: עדיין לא מחובר לאף route/rule בפועל — תשתית מוכנה, לא עדיין באכיפה חיה.

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

**Plugin SDK — EXISTS (גרסה ראשונה, data-only) [עודכן — נבנה בסבב הזה]**
אין עדיין `createAtlasPlugin()`/הרצת קוד צד-שלישי בפועל (ראו הסתייגות מפורשת למטה) — אבל יש עכשיו שכבה אמיתית, שלמה מקצה-לקצה, לרישום/אישור/הפעלה של plugin חיצוני כ**נתונים דקלרטיביים**: `packages/shared/src/schemas/plugin-manifest.schema.ts` (`pluginManifestSchema` — id/name/version/author/`declaredTools`/`declaredCapabilities`/`declaredEntityActions`/`riskLevel`/`status`, בלי שום קוד-לביצוע, URL-להורדה, או template — הרחבה תיאמד ל"מה מותר" בלבד, לא "מה לרוץ"). `packages/agent-core/src/plugins/plugin-registry.ts` — `validatePluginManifest()` בודק לא רק צורה (Zod) אלא **גם סמנטיקה אמיתית**: כל `declaredTools`/`declaredEntityActions` נבדק מול `DEFAULT_TOOL_POLICIES` ו-`getEntityPolicy()` הקיימים בפועל — plugin לא יכול להצהיר על יכולת ששכבת המדיניות לא כבר יודעת לשער. `registerPlugin()` כופה `PENDING_REVIEW` תמיד, בלי אפשרות ל-self-approve. `packages/agent-core/src/plugins/plugin-lifecycle.ts` — מכונת מצבים מלאה `PENDING_REVIEW→APPROVED|REJECTED→ENABLED↔DISABLED` (טרמינל דרך uninstall→DISABLED, עם הסתייגות כנה שאין עדיין primitive מחיקה אמיתי ב-registry). חשוף דרך `apps/api/src/routes/plugins.ts`: `GET /api/v1/plugins`, `GET /api/v1/plugins/:id` (ציבורי), ו-`POST /api/v1/plugins`, `/approve`, `/reject`, `/enable`, `/disable`, `/uninstall` (כולם admin-gated). 47 בדיקות (14 registry + 17 lifecycle + 16 routes), typecheck+build נקיים, אפס רגרסיות (agent-core 246/246, apps/api 244/244).
נותר גלוי וכן: אין הרצת קוד צד-שלישי בפועל — זו עדיין רק שכבת "אישור/הרשאה למה שמוצהר", לא sandbox להרצה. אין UI לניהול plugins (רק API). אין primitive מחיקה אמיתי מה-registry (רק "כיבוי"). Marketplace (חיפוש/גילוי/דירוג plugins) עדיין MISSING לגמרי — ראו למטה.

**Automation Engine — EXISTS (נבנה בסבב הזה) [עודכן פעמיים]**
`admin-oracle-queue.ts` עדיין מזהה ומדרג בעיות אך לא מבצע ("Detect→rank→notify/propose only"), ו-`apps/worker` נשאר worker מינימלי — אלה לא השתנו. **מה שנוסף:** `apps/api/src/services/automation-engine.ts` — מנוע חוקים דקלרטיבי אמיתי: `AutomationRule` (`on` pattern + `condition` אופציונלי + `action`), `registerAutomationRule()` שמתחבר ל-`domainEventBus` ומפעיל את `action` רק כש-`condition` מתקיים. `apps/api/src/services/automation-rules.ts` מגדיר 2 חוקים אמיתיים על אירועים שכבר מתפרסמים בקוד: **gate-blocked-audit** (על `gate.evaluated`, כש-node כלשהו FAIL/BLOCKED → רשומת ביקורת RISK=HIGH) ו-**readiness-certificate-blockers-audit** (על `evaluation.completed` מסוג תעודת-מוכנות-לפרודקשן עם `blockers>0` → רשומת ביקורת RISK=CRITICAL). זו הוכחת-היתכנות אמיתית ל-trigger→condition→action, מכוסה ב-14 בדיקות חדשות, מחוברת ל-`buildApp()`.
נותר: רק 2 חוקים בנויים (מתוך 22 סוגי אירועים אפשריים), אין ממשק ניהול חוקים דינמי (הכל עדיין קוד, לא נתונים/UI), ופעולות ה-action מוגבלות לכתיבת audit — אין עדיין "propose"/"notify" אמיתיים.

**Intelligence Router — EXISTS**
`router/genius.ts` עושה ניתוב מבוסס-חוקים אמיתי (בלי LLM) לבחירת מומחים ו-`modelHint`. חסר: שכבת קיצור-דרך SQL/cache לפני הניתוב, ואסקלציה דינמית מודל-קטן→גדול (רק מיפוי מילות-מפתח סטטי).

**Model-Agnostic AI Gateway — EXISTS**
`providers/llm.ts` — שער רב-ספקים אמיתי ועובד: Anthropic/Gemini/Groq/Ollama/DeepSeek/OpenAI עם fallback חינמי. זו ההתאמה החזקה ביותר לחזון בכל הביקורת.

**Context Engine — PARTIAL**
`memory-pipeline.ts` (`retrieveMemories`/`buildMemoryContext`) עושה Retrieve→Rank→Truncate→Tag בפונקציית ניקוד אחת, לא 5 שלבי Filter/Validate/Inject נפרדים כמו בחזון.

**Universal Filter Engine — EXISTS [עודכן — נבנה בסבב הזה]**
`packages/agent-core/src/filter/universal-filter.ts` — מנוע סינון כללי אמיתי: 10 אופרטורים (`eq/neq/gt/gte/lt/lte/in/notIn/contains/since`), נתיבי שדה מקוננים בטוחים (`"metadata.riskLevel"`, בלי `eval`, מוגן מפני `__proto__`), הרכבה AND (`applyFilters`) ו-OR (`applyFiltersAny`), ותיאור קריא-לאדם (`describeFilters`). כולל את הדוגמה המדויקת מהחזון כקבוע מיוצא (`ROADMAP_EXAMPLE_FILTER`: risk=HIGH + שונה ב-24 שעות + confidence<0.9). **חובר בפועל** ל-`GET /api/v1/events` (פרמטר `?since=` חדש) — לא רק תשתית תיאורטית. 46 בדיקות (40 למנוע + 6 ל-route).

**Priority / Action Queue — PARTIAL**
`admin-oracle-queue.ts` עושה טריאז' אמיתי לפי חומרה (critical/high/medium/info) עם דירוג עדיפות — אך מוגבל לתפעול הפלטפורמה עצמה (watchdog, patches, deploys), לא תור גנרי לרשומות עסקיות חוצה-מוצרים.

---

## 4. שכבת תפעול וחוויית משתמש (Ops & UX)

**Health & Observability — PARTIAL**
`GET /health` מחזיר `{status:"ok"}` בלבד ללא פירוט פר-רכיב, אבל `platform-watchdog.ts` מייצר התרעות אמיתיות בדירוג חומרה + `packages/observability/src/metrics.ts` נותן מדדי Prometheus. חסר: סטטוס HEALTHY/WARNING/DEGRADED/CRITICAL מאוחד פר-רכיב (API/DB/AI/Queue) וצינור Health→Diagnosis→Root Cause→Recommendation.

**Cost Intelligence — EXISTS ברוב הנתיבים האמיתיים [עודכן פעמיים — הושלם ברובו בסבב הזה]**
הפער שדווח בסבב הקודם נסגר בפועל: `packages/agent-core/src/providers/llm.ts` עכשיו קורא בפועל את שדה ה-`usage` שספקי ה-LLM (Anthropic/OpenAI-compatible/Gemini) כבר מחזירים בתשובה — עד עכשיו זה נזרק. נוספה טבלת תמחור-לפי-מודל מתועדת (`MODEL_PRICING_USD_PER_1M_TOKENS`, עם הסתייגות כנה שהיא דורשת עדכון תקופתי ידני), ו-`costUsd` נגזר ממנה בפועל, לא מוערך. `dispatch.ts`/`evaluation.ts` תוקנו גם: הסתבר שהנתיבים האלה (Orchestrator/Evaluation) בכלל **לא קוראים ל-LLM** — הם logic מבוסס-חוקים — כך שהאומדנים הסינתטיים הישנים (5% מתקציב, 0.01$ קבוע) הוחלפו ב-`0` אמיתי ומדויק, לא בהמצאת מספר. הפער בפרסיסטנס נסגר: `POST /api/v1/agents/dispatch` עכשיו שומר `totalCostUsd`+`runCosts` ל-audit log, ו-`cost-intelligence.ts` קורא את זה בפועל (breakdown פר-פרויקט ופר-סוכן).
נותר גלוי וכן: מנגנון ה-`LlmUsage` האמיתי בנוי, אבל עדיין לא מחובר לנתיב `agents.dispatch` עצמו (הצרכנים הישירים של `llm.ts` היום הם `conversation.ts`/`agent.ts`, ערוץ נפרד) — כך שכרגע `agents.dispatch` באמת מייצר `0` אמיתי (כי אין שם קריאת LLM), אבל היום שיהיה, הצנרת מוכנה לקלוט את זה.

**Dependency Intelligence — PARTIAL**
`observer/src/security/deps.ts` בודק פגיעויות ידועות (CVE allowlist) בלבד — אין בדיקת חבילות מיושנות, בעיות רישוי, או חבילות כפולות/לא בשימוש.

**Architecture Drift Detection — PARTIAL**
`code-intelligence/src/constitution-detectors.ts` + `continuous-audit.ts` עושים ביקורת "חוקה הנדסית" אמיתית (PASS/WARN/FAIL). אין גלאי ייעודי להפרת שכבות (API→DB ישיר בעקיפת Service).

**CI/CD Intelligent Gate — EXISTS [עודכן — קודם דווח MISSING, הייתה טעות ייצוא]**
`.github/workflows/ci.yml`: על כל push/PL — install → build (turbo) → unit tests → lint (`--max-warnings 0`) → **"Atlas CI eval gate (blocking)"** (`ci-eval-gate.ts`, בודק store + redaction, יוצא עם קוד שגיאה שחוסם merge) → **"Atlas CI secret scan (blocking)"** (`ci-secrets-scan.ts`, `detectSecrets` על כל `apps`/`packages`, חוסם אם נמצא סוד חי). קובץ שני, `.github/workflows/e2e-critical-path.yml`: מקים סטאק API+Web מלא ומריץ `test:e2e:critical` → `test:e2e:product` → `test:e2e:security` → `test:e2e:a11y` ברצף, עם העלאת דו"ח Playwright בכשלון. זה צינור Push→Build→Test→Lint→Security-Gate→E2E-Gate אמיתי וחוסם. חסר מול החזון: אין שלב Dependency-Scan נפרד, ואין ציון סיכון מספרי (Risk Score) לפני deploy — השערים הם בינארי עובר/נכשל, לא מדורגים.

**Autonomous / Risk-Based QA — EXISTS (לוגיקת Backend + E2E אמיתי) [עודכן]**
`qa-core/src/planner/plan.ts` מסיק סיכונים לפי נתיבים שהשתנו (AUTHENTICATION/PAYMENTS/DATABASE_MIGRATION/SECURITY_CONFIG) ובוחר דומיינים רלוונטיים בלבד — בדיוק ה"ריצה חכמה, לא הכל" של החזון. בנוסף נמצאו בפועל קובצי `e2e/*.spec.ts` אמיתיים: `critical-path.spec.ts`, `product-surfaces.spec.ts`, `security.spec.ts`, `a11y.spec.ts`, `new-surfaces.spec.ts` — ומחוברים ל-CI (ראו לעיל). `a11y.spec.ts` בודק skip-link, landmark `main`, כותרת H1, ותפריט המבורגר ברוחב צר — smoke אמיתי, לא axe מלא.

**Modular Add/Remove/Replace/Configure — EXISTS (Enable/Disable + הוספה חיצונית דקלרטיבית) [עודכן — נבנה בשני סבבים]**
**מה שנוסף בסבב הקודם:** `packages/agent-core/src/kernel/registry-lifecycle.ts` — שכבת Enable/Disable אמיתית מעל הקטלוג הסטטי: `setAgentEnabled()`/`isAgentEnabled()`/`listAgentLifecycleState()`, עם **בדיקת תלויות אמיתית** (לא תיאורטית) — `ORCHESTRATOR` ו-`JUDGE` מסומנים "core" ולא ניתנים לכיבוי, מאומת מול קוד אמיתי שתלוי בהם בכמה מקומות (`orchestrator/plan.ts`, `kernel/task-plan.ts`, `router/genius.ts`, `kernel/run.ts`, `judge/evaluate.ts`) — ניסיון לכבות אחד מהם נכשל עם סיבה מפורשת, לא רק מוזהר. חשוף דרך `GET /api/v1/agents/lifecycle` + `POST /api/v1/agents/:id/enable|disable` (admin-gated). 16 בדיקות.
**מה שנוסף בסבב הזה:** Plugin SDK (ראו למעלה) — עכשיו יש גם "הוספה" אמיתית מבחוץ, בשלב הצהרתי: `registerPlugin()` + מכונת מצבים מלאה עד `ENABLED`.
נותר: Plugin SDK עדיין לא מריץ קוד צד-שלישי בפועל (רק מאשר/מגביל הצהרות) — ראו הסתייגות בסעיף Plugin SDK למעלה.

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
| 2 | Event Bus + Audit Log משותפים | **נבנה בסבב הזה** ✅ — Event Bus (pub/sub אמיתי) + סכמת ביקורת אחידה, עם bridge בין השניים |
| 3 | Identity + Permissions + Tenant Isolation | **חלקי, עם ABAC-lite שנבנה בסבב הזה** — אין עדיין ארגון-רב-משתמשים |
| 4 | Policy + Risk Engine | **שניהם קיימים** ✅ (עודכן — Risk Engine 0-100 נבנה בסבב הזה) |
| 5 | Knowledge + Memory + Provenance | **הכי בנוי בכל הביקורת** — כמעט הכל EXISTS |
| 6 | Context + Universal Filter | Context Engine **חלקי**, Universal Filter **קיים** ✅ (עודכן — נבנה בסבב הזה, כולל חיווט אמיתי) |
| 7 | Agent Registry + Orchestrator | **חלקי/קיים** — הבסיס החזק ביותר אחרי שכבת הידע |
| 8 | Automation Engine | **נבנה בסבב הזה** ✅ — מנוע חוקים דקלרטיבי + 2 חוקים אמיתיים |
| 9 | Simulation + Post-Action Verification | Simulation **קיים** (חלקי), Verification **חלקי** |
| 10 | Secrets Governance + CI/CD Gate | Secrets **חלקי**, CI/CD **קיים** ✅ (עודכן — צינור build→test→lint→eval-gate→secrets-scan חוסם אמיתי) |
| 11 | Health & Observability + Cost Intelligence | Health **חלקי**, Cost **חסר לגמרי** |
| 12 | Modular Add/Remove | **קיים** ✅ (עודכן — Enable/Disable אמיתי + Plugin SDK data-only, שניהם נבנו) |
| 13 | Command Center | **חלקי** (עודכן — יש פאנל Executive/Risk אמיתי, לא מאוחד לדאשבורד יחיד) |
| 14 | Marketplace / Plugin SDK | Plugin SDK **קיים** ✅ (גרסה ראשונה, data-only — נבנה בסבב 7), Marketplace **חסר לגמרי** |

**המשמעות המעשית (מעודכן):** הצעדים 1, 5, 7, 8, 10 ו-12 כבר עומדים על רגליים אמיתיות ועובדות. הצעדים 2–4, 6, 9, 11, 13, ו-14 (Plugin SDK בלבד; Marketplace עדיין לא) יש להם נקודת התחלה אמיתית לבנות עליה.

---

## מה נבנה בפועל בסבב הזה

צעד 2 מהחזון — **Event Bus + Audit Log מאוחד** — יצא משלב התכנון ונבנה בקוד אמיתי, נבדק, ואומת:

- `packages/agent-core/src/events/event-bus.ts` — `DomainEventBus` עם pub/sub אמיתי (subscribe עם תמיכה ב-wildcard, publish מבודד-שגיאות).
- `packages/shared/src/schemas/unified-audit-entry.schema.ts` — סכמת WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/POLICY/RISK/APPROVAL/RESULT, ופונקציה תואמת ב-`audit-log.ts`.
- `apps/api/src/services/event-rules.ts` — ה-rule החי הראשון: `patch.applied` → רשומת ביקורת אחידה אוטומטית.
- חיווט לתוך `apps/api/src/services/memory-pipeline.ts` ו-`create-app.ts` כך שכל 20 נקודות הפרסום הקיימות הפכו לריאקטיביות בלי שינוי.
- 22 בדיקות חדשות (11 event-bus, 5 event-rules, 6 unified-audit-entry schema), typecheck נקי, ואפס רגרסיות ב-343 הבדיקות הקיימות.

כל השינויים סונכרנו בפועל למחשב שלך (12 קבצים, כולל בדיקות).

## מה נבנה בפועל בסבב השלישי (3 סוכנים במקביל)

שלוש יכולות נוספות מהחזון נבנו, כל אחת ע"י סוכן נפרד שעבד על קבצים נפרדים לגמרי (אין חפיפה — כדי למנוע התנגשויות):

- **Automation Engine (צעד 8):** `apps/api/src/services/automation-engine.ts` (מנוע חוקים דקלרטיבי גנרי) + `automation-rules.ts` (2 חוקים אמיתיים: `gate.evaluated` חוסם → ביקורת HIGH, תעודת-מוכנות עם חוסמים → ביקורת CRITICAL). 14 בדיקות.
- **Policy Engine per-entity (צעד 4):** `packages/agent-core/src/policies/entity-policies.ts` — טבלת מדיניות 7 ישויות × 5 פעולות, `authorizeEntityAction()` באותו vocabulary כמו מנוע הכלים הקיים. 14 בדיקות.
- **ABAC-lite (צעד 3):** `apps/api/src/services/resource-access.ts` — שילוב role+ownership אמיתי (`checkResourceAccess`), מאומת מול הקוד האמיתי (`auth.schema.ts`, `project-access.ts`). 7 בדיקות.

**אימות מרוכז שביצעתי אחרי שכל 3 הסוכנים סיימו** (הם עצמם רק בדקו scope מצומצם כדי לא להתנגש): typecheck נקי ב-`packages/agent-core` וב-`apps/api`, `packages/agent-core` — 146/146 בדיקות ירוקות (23 קבצים), `apps/api` — 163/163 בדיקות ירוקות (35 קבצים). אפס רגרסיות. הכל סונכרן למחשב שלך (10 קבצים).

## מה נבנה בסבב הרביעי (3 סוכנים במקביל) — חיווט בפועל

התשתית מהסבב הקודם חוברה עכשיו לזרימת בקשה אמיתית, ב-3 routes אמיתיים (כל סוכן על קובץ נפרד):

- **`POST /api/v1/graph/rebuild`** — `authorizeEntityAction("CONFIGURATION","EXECUTE")` + `checkResourceAccess` (כשיש projectId מזוהה) אחרי `requireSignedInForWrite` הקיים. 6 בדיקות, כולל 403 אמיתי לבעלים אחר.
- **`POST /api/v1/portfolio/discovery/link`** — `authorizeEntityAction("RECORD","CREATE")` אחרי `requireSignedInForWrite`. 3 בדיקות.
- **`POST /api/v1/admin/automation/run-checks`** — **ההדגמה המרכזית של החזון**: `authorizeEntityAction("CONFIGURATION","EXECUTE", approved:false)` אחרי `requireAdmin` — גם admin לא מקבל אישור אוטומטי לפעולה הרסנית; הנתיב מחזיר עכשיו 403 (`APPROVAL_REQUIRED`) עד שייבנה זרימת אישור נפרדת. זו בדיוק העקרון "אפס אמון כברירת מחדל — סוכן/משתמש לא מקבל כוח רק כי יש לו role" מהחזון. 4 בדיקות, כולל וידוא ששאר נתיבי admin-ops לא הושפעו.

**אימות מרוכז:** typecheck נקי ב-`apps/api`, 176/176 בדיקות ירוקות (38 קבצים, +13 מהסבב הקודם), אפס רגרסיות. 6 קבצים סונכרנו למחשב שלך.

## מה נבנה בסבב החמישי (3 סוכנים במקביל)

- **Approval Workflow אמיתי** — סגר בדיוק את הפער שסבב 4 השאיר פתוח בכוונה. סכמה חדשה (`approval-request.schema.ts`, מחזור חיים PENDING→APPROVED/REJECTED→CONSUMED), שירות (`approvals.ts`), 3 endpoints חדשים (`GET /api/v1/approvals`, `GET /api/v1/approvals/:id`, `POST /api/v1/approvals/:id/decide`), וחיווט אמיתי לתוך `run-checks`: קריאה בלי `approvalId` מחזירה 202 עם approvalId; אישור אדמין דרך ה-endpoint החדש; קריאה חוזרת עם ה-approvalId המאושר מריצה בפועל את הבדיקה ומסמנת אותה כ"נצרכה" (לא ניתנת לשימוש חוזר). 16 בדיקות חדשות. זו ההדגמה השלמה ביותר עד כה של "ראיות כברירת מחדל" — כל שלב מתועד ב-audit log.
- **הרחבת החיווט** ל-2 routes נוספים: `PUT /api/v1/audit-engine/contract` (CONFIGURATION.CREATE) ו-`POST /api/v1/billing/plan` (FINANCIAL_TRANSACTION.UPDATE). 10 בדיקות.
- **Cost Intelligence** — תשתית צבירה אמיתית + נתיב API, **אבל** גילתה ממצא כן משמעותי: costUsd בכל הקוד הקיים הוא ערך מלאכותי/סינתטי שאף פעם לא נשמר בפועל (ראו הפרק למעלה). זה בדיוק סוג הממצא שסבב-סוכנים כזה אמור לתפוס — לא רק "לבנות API" אלא לבדוק אם הנתונים מאחוריו אמיתיים.

**אימות מרוכז:** typecheck נקי ב-`packages/shared` וב-`apps/api`, `packages/shared` 69/69, `apps/api` 210/210 (43 קבצים, +5 מהסבב הקודם), אפס רגרסיות. 16 קבצים סונכרנו למחשב שלך.

## מה נבנה בסבב השישי (4 סוכנים במקביל)

- **Cost Intelligence הושלם ברובו** — llm.ts קורא עכשיו usage אמיתי מכל ספק, טבלת תמחור מתועדת, ו-dispatch/evaluation תוקנו לפי הממצא הכן מהסבב הקודם (0 אמיתי איפה שאין קריאת LLM, לא אומדן מומצא). 215/215 בדיקות ב-agent-core, 228/228 ב-api.
- **Risk Engine 0-100** — `risk-score.ts`, מנוע ניקוד + בקטינג מלא, מוכן לחיווט.
- **Modular Agent Lifecycle** — Enable/Disable אמיתי עם בדיקת תלויות מאומתת (ORCHESTRATOR/JUDGE מוגנים).
- **Universal Filter Engine** — מנוע סינון כללי, כולל חיווט אמיתי ל-`/api/v1/events`.

**אימות מרוכז:** typecheck נקי ב-3 החבילות, agent-core 215/215 (26 קבצים), apps/api 228/228 (45 קבצים), אפס רגרסיות. 21 קבצים סונכרנו למחשב שלך.

## מה נבנה בסבב השביעי — Plugin SDK (2 סוכנים במקביל + סוכן שלישי שחזר אחרי עצירה)

3 מודולים חדשים, הראשונים ביחד ("data model" + "state machine"), השלישי בסיבוב נפרד לאחר שהניסיון הראשון שלו נעצר על ידך באמצע העבודה (לא נכתב כלום לדיסק — נבדק ואומת לפני שחזרתי לבנות מחדש):

- **`packages/shared/src/schemas/plugin-manifest.schema.ts`** — `pluginManifestSchema` דקלרטיבי-בלבד (id/name/version/author/`declaredTools`/`declaredCapabilities`/`declaredEntityActions`/`riskLevel`/`status`), עם הסתייגות מפורשת בתיעוד: **אין כאן קוד להרצה, רק "בקשת יכולות"**.
- **`packages/agent-core/src/plugins/plugin-registry.ts`** — `validatePluginManifest()` חוצה-אימות אמיתי מול `DEFAULT_TOOL_POLICIES` ו-`getEntityPolicy()` הקיימים (לא רק סכמה) — plugin לא יכול להצהיר על tool/entity-action ששכבת המדיניות האמיתית לא מכירה. `registerPlugin()`/`listPlugins()`/`getPlugin()`/`setPluginStatus()`, כופה `PENDING_REVIEW` תמיד. 14 בדיקות.
- **`packages/agent-core/src/plugins/plugin-lifecycle.ts`** — מכונת מצבים `PENDING_REVIEW→APPROVED|REJECTED→ENABLED↔DISABLED`, כל מעבר לא-חוקי נדחה עם סיבה מפורשת (לא throw). 17 בדיקות.
- **`apps/api/src/routes/plugins.ts`** — 8 endpoints (`GET /api/v1/plugins`, `GET /api/v1/plugins/:id` ציבוריים; `POST /api/v1/plugins`, `/approve`, `/reject`, `/enable`, `/disable`, `/uninstall` — admin-gated), עם 400 לצורה לא-תקינה, 409 ל-id כפול, 403 למעבר לא-חוקי. 16 בדיקות.

**אימות מרוכז שביצעתי:** build נקי ל-`packages/shared` ו-`packages/agent-core`, typecheck נקי ב-`apps/api`, **agent-core 246/246 בדיקות (28 קבצים)**, **apps/api 244/244 בדיקות (46 קבצים)** — אפס רגרסיות מול הבסיס (215/228). 10 קבצים סונכרנו למחשב שלך ואומתו byte-for-byte (diff נקי על כל קובץ).

## מצב סופי — מה נשאר פתוח בכנות, ולמה

לאחר 7 סבבים ו-19 סוכנים במקביל, כל הפערים ה-**backend** שניתנים לבנייה ואימות אמיתי בסביבה הזו נסגרו: Event Bus, Automation Engine, Entity/Tool Policy Engine, Risk Engine, ABAC, Approval Workflow, Universal Filter Engine, Agent Lifecycle, Plugin SDK (גרסה ראשונה), ורוב Cost Intelligence. כל אלה הם קוד עובד, נבדק, מסונכרן — לא רק תכנון.

**מה שבאמת לא נבנה, ולמה — לא כישלון, אילוץ אמיתי:**
- **Plugin SDK — הרצת קוד צד-שלישי בפועל** — מה שנבנה הוא רק שכבת "הצהרה + אישור + הרשאה" (data-only, ללא sandbox). הרצת plugin שמכיל קוד אמיתי היא בעיה קשה משמעותית יותר (sandboxing, supply-chain review, resource limits) שהוצאה מהיקף הגרסה הזו במפורש — לא הושמטה בטעות.
- **Marketplace (חיפוש/גילוי/דירוג plugins)** — אין עדיין UI או API לגילוי plugins רשומים מעבר ל-`GET /api/v1/plugins` הגולמי; זה שכבה נפרדת מעל ה-registry שנבנה.
- **Anomaly Detection** — דורש מודל בסיס/דפוס אמיתי מעל דאטה בזמן ריצה; אין עדיין מספיק דאטה production אמיתי במערכת הזו לבנות עליו baseline משמעותי — לבנות את זה עכשיו יהיה שלד ריק.
- **Command Center מאוחד, Unified UX/Design System, Marketplace UI** — כל אלה frontend (`apps/web`), ו**בעותק הזה של הריפו בענן אין `node_modules` מותקן ל-`apps/web`** (Next.js, MUI, וכו') — לא ניתן להריץ build/test אמיתי עליו כאן בלי להתקין תלויות כבדות. זו לא בחירה להתעלם — זו מגבלת סביבה אמיתית שצריך להתמודד איתה בנפרד (או להתקין תלויות frontend, או לעבוד ישירות במחשב שלך).
- **מודל ארגון/רב-משתמשים (Multi-Tenant אמיתי)** — שינוי סכמה משמעותי (בעלות היום היא per-user, לא per-org) שדורש מיגרציית DB אמיתית, לא רק קוד חדש — סיכון גבוה מדי לבנות "בלי לשאול" בלי לתכנן קודם את מבנה הטבלאות.

זו הרשימה הכנה של מה שנשאר. הכיוון הכי הגיוני הבא הוא להתקין תלויות frontend (`apps/web`) כדי לעבוד על Command Center/Unified UX — זה עכשיו הפריט הכי "מוכן להתקדם" מבין הארבעה שנותרו, כי כל שכבת ה-backend שהוא צריך (Entity Policy, Approval, Risk Score, Plugin lifecycle) כבר קיימת מאחוריו.

## עדכון — סבב שמיני: "בצע הכל מהכל עם כמה סוכנים" — פריצת דרך על apps/web

המגבלה שחסמה את כל ה-frontend items לאורך כל הסשן (`apps/web` בלי `node_modules` בעותק הענן) **נפתרה סוף-סוף**: `pnpm install --filter @atlas/web...` רץ בהצלחה (26.6 שניות, נקי). זה פתח בפועל 5 סוכנים במקביל על 5 פערים שונים לגמרי, כל אחד על קבצים נפרדים:

- **Command Center מאוחד** — 4 פאנלים חדשים תחת `apps/web/components/admin/CommandCenter/`: HealthPanel (צורך את `GET /api/v1/health`), ApprovalQueuePanel (`GET/POST /api/v1/approvals`), AgentLifecyclePanel (enable/disable אמיתי), CostIntelligencePanel. חוברו לדף `/admin` הקיים (שכבר היה שם `useQuery` בסיסי).
- **Marketplace UI** — דף חדש `/admin/marketplace` + 5 קומפוננטות (PluginCard, PluginDetailDialog, ReasonDialog, RegisterPluginDialog, types), צורכות את כל 8 ה-endpoints של Plugin SDK מהסבב הקודם, כולל state-machine-aware gating (איזה כפתור מותר לפי הסטטוס הנוכחי של ה-plugin). תקלת MUI Autocomplete + `exactOptionalPropertyTypes` אמיתית נמצאה ותוקנה (הוחלף ל-`Select multiple` + checkboxes).
- **Unified UX / נגישות אמיתית** — נבנה לראשונה בסשן הזה ריצת e2e חיה אמיתית (build של שני האפליקציות + הרצת שרתים + axe-core WCAG 2.2 AA סריקה אמיתית דרך `@axe-core/playwright`, לא רק בדיקות ידניות). זה מצא **3 באגי נגישות אמיתיים** (לא תיאורטיים) — כולם תוקנו על ידי (ראה למטה). נדרש גם ליצור `playwright.config.ts` שלא היה קיים בכלל בריפו (ללא זה `PLAYWRIGHT_BASE_URL` מעולם לא נצרך בפועל).
- **Anomaly Detection — baseline אמיתי** — `packages/agent-core/src/intelligence/anomaly-detection.ts`: z-score + IQR (Tukey hinge) על סדרת זמן, עם `MIN_SAMPLE_SIZE=7` ותשובה כנה `INSUFFICIENT_DATA` כשאין מספיק דגימות (לא בונה baseline מומצא על מעט מדי דאטה). חובר ל-endpoint חדש `GET /api/v1/cost-intelligence/anomalies`. 14 בדיקות חדשות.
- **מודל ארגון/רב-משתמשים** — **תכנון בלבד, ללא ביצוע** (בכוונה, כפי שסוכם מראש): `docs/multi-tenant-design.md` + `supabase/migrations/DRAFT_multi_tenant_orgs.sql` (עם prefix `DRAFT_` מכוון כדי שלא ירוץ אוטומטית). ממליץ על `org_id` כטור נוסף (additive) לצד `owner_id` הקיים בכל הטבלאות, ולא rename שובר — במיוחד לאור חיזוקי ה-tenant-isolation מסבב ה-P0. לא בוצעה שום מיגרציה אמיתית.

**3 באגי הנגישות שנמצאו ותוקנו על ידי (לא על ידי הסוכנים — אלה נמצאו ע"י ריצת axe-core האמיתית ותוקנו בבדיקה ידנית שלי):**
1. **מבנה רשימה שגוי** ב-`AppShell.tsx` — `ListItemButton` היה ילד ישיר של `List` בלי עטיפת `<li>` (`ListItem`) — הפר WCAG 1.3.1.
2. **קונטרסט h1 בדף הבית** — axe-core דיווח על `#c6c7c9` כטקסט כהה מדי-בהיר. חישבתי בעצמי (Python, נוסחת luminance) ואישרתי שזה בכלל לא צבע קבוע שגוי — זה frame באמצע אנימציית fade-in (`opacity: 0→1`) שנתפס ע"י axe-core בדיוק בשקיפות ~22%. התיקון הנכון (ולא רק "לבחור צבע בטוח"): הסרתי את ה-`opacity` מה-keyframe והשארתי רק את ה-`transform`, כך שהטקסט תמיד בקונטרסט מלא.
3. **קונטרסט warning Chip** — מדדתי את שני גווני ה-warning (`#9A7B3C` light, `#C4A35A` dark): טקסט לבן נכשל בשניהם (3.98:1, 2.40:1 — מתחת ל-4.5:1 הנדרש), טקסט שחור עובר בשניהם בביטחון (5.27:1, 8.73:1). הוספתי `contrastText: "#1A1C22"` מפורש ל-palette.warning ב-`theme.ts` במקום להסתמך על הבחירה האוטומטית השגויה של MUI.

**אימות מרוכז שביצעתי:** `packages/agent-core` build נקי + 277/277 בדיקות, `apps/api` typecheck נקי + 400/400 בדיקות, `apps/web` — **build והראשון אי-פעם עבר בסביבה הזו** — `tsc --noEmit` נקי, `pnpm run build` הצליח עם 134 דפים סטטיים כולל `/admin` (6.45kB) ו-`/admin/marketplace` (10.8kB) החדשים. אפס רגרסיות.

**2 באגים אמיתיים נמצאו ב-CI workflow (`.github/workflows/e2e-critical-path.yml`) — דווחו, לא תוקנו (מחוץ להיקף של הסוכן שמצא אותם):**
1. `NODE_ENV: production` יחד עם `ENCRYPTION_KEY`/`COOKIE_SECRET` שמוגדרים לערך ה-secret-לדוגמה המילולי ש-`packages/config/src/env.ts`'s `assertNotExampleSecrets()` דוחה במפורש ב-production — יגרום ל-`process.exit(1)` אמיתי ב-CI.
2. `SUPABASE_SERVICE_ROLE_KEY` לדוגמה (27 תווים) יחד עם `SUPABASE_URL` שנראה אמיתי מפעיל את ההיוריסטיקה של `isLiveSupabase()` (כל מפתח מקומי >20 תווים = "live"), וגורם ל-`/api/v1/health` לנסות שאילתת Supabase אמיתית מול כלום — תוקע את לולאת ה-polling של ה-health-check ב-CI.

**החלטה מכוונת שלי, לא שכחה:** גם תחת ההוראה "הכל מהכל", **לא נבנה sandbox להרצת קוד צד-שלישי אמיתי עבור Plugin SDK**. זה נשאר מחוץ להיקף באופן מפורש מאותה סיבה שצוינה בסבב 7 — sandboxing, supply-chain review ומגבלות משאבים הן בעיית אבטחה קשה משמעותית שדורשת תכנון ייעודי, לא "לבנות תוך כדי".

---

## 🔴 מיפוי 5 האזורים מול הקוד + איחוד (משימות שהתחלתי מוקדם בסשן ולא סגרתי עד עכשיו)

**הערה כנה:** המשימות האלה נפתחו מוקדם בסשן (סימון "in_progress"), אבל כשה-audit הראשון חשף P0 אמיתיים עברתי לטפל בהם ולא חזרתי לסגור את חמש המשימות האלה — פער אמיתי שלך, לא דמיוני. הן נסגרות עכשיו, תוך שימוש בממצאים המאומתים שכבר נאספו בסבבי ה-audit/תיקון (לא מיפוי מאפס) + כמה בדיקות ממוקדות חדשות (Simulation, CI gate blocking, qa-core).

### 13. תשתית ליבה — Event Bus / Audit / Identity / Tenant / Secrets

| רכיב | מצב | הוכחה |
|---|---|---|
| Event Bus | ✅ EXISTS AND ENFORCED | `packages/agent-core/src/events/event-bus.ts` — dedup אמיתי לפי event-id, FIFO 1000 |
| Audit actor identity | ⚠️ PARTIAL | actorId אמיתי ב-~8 routes (code/kernel-חלקי/gates/readiness/engineering-audit + עכשיו גם decisions/memory-approve); עדיין null/חסר בחלק מה-routes האחרים |
| Identity (Authentication) | ✅ EXISTS AND ENFORCED **(מאתמול)** | `verifySupabaseAccessToken` — `auth.getUser()` אמיתי מול Supabase, לא decode-בלבד. 448/448 בדיקות |
| Tenant isolation | ⚠️ PARTIAL, השתפר משמעותית | agent-fabric/conversation/qa/events/memory-approve/decisions תוקנו; RLS קיים ב-SQL (25+ policies) אבל לא ניתן לאימות מה-sandbox הזה (`SUPABASE_SERVICE_ROLE_KEY=replace-me`) ומשמש כ-backstop בלבד — רוב הכתיבות עוברות service-role client שעוקף RLS |
| Secrets redaction | ⚠️ PARTIAL | `POST /memory` + `agent.ts` תוקנו; `central-opinion.ts`/`memory-pipeline.ts`'s `seedPortfolioPatternMemories` עדיין לא מרדקטים (P1/P2, סיכון נמוך יותר — לא קלט משתמש ישיר) |

### 14. Policy / Risk / Zero-Trust / Simulation

| רכיב | מצב | הוכחה |
|---|---|---|
| Policy Engine (`authorizeEntityAction`) | ⚠️ PARTIAL | מחובר ל-~11 routes; מסלול ה-agent dispatch המרכזי (`agent-fabric.ts`) קיבל auth+ownerId אתמול אבל **עדיין לא** `authorizeEntityAction` — נשאר פער אמיתי, ראו הערה למטה |
| Risk Engine (ניקוד 0-100) | ⚠️ EXISTS BUT NOT ENFORCED רחבות | `computeActionRiskScore`/`bucketForRiskScore` — מיובא ומופעל רק ב-`code.ts` אחד |
| Zero-Trust (העיקרון "role לא=אישור אוטומטי") | ⚠️ PARTIAL, לא אחיד | קיים בבירור ב-`admin-ops.ts`'s run-checks (גם admin לא מקבל אישור אוטומטי) ובאישור MFA-לפני-admin; לא אחיד בכל שאר ה-routes |
| Simulation/Preflight | ✅ EXISTS | `packages/agent-core/src/kernel/simulation.ts`'s `runSimulation()` — חוסם `apply_patch`/`deploy`/`prod_mutate` בפועל עבור write-agents/production hints/CRITICAL-HIGH risk, מחייב human approval; מחובר ל-`kernel.ts` |

**פער חדש שנחשף כאן:** `agent-fabric.ts` (מסלול ה-dispatch המרכזי של agent) קיבל אתמול auth+ownerId (סגר את דליפת ה-memory), אבל **עדיין לא** קורא ל-`authorizeEntityAction`/risk scoring — בהתאמה מלאה לממצא הארכיטקטוני מ"עדכון חמישי": אין dispatcher מרכזי שאוכף Policy+Risk אוטומטית. זה תוקן מבחינת אימות זהות, לא מבחינת policy/risk. לא תוקן בסבב הזה — סומן כאן לתשומת לבך.

### 15. Knowledge / Memory / Provenance

| רכיב | מצב | הוכחה |
|---|---|---|
| `ownerId` על Memory | ✅ EXISTS AND ENFORCED (אחרי אתמול) | חובה בסכמה + נאכף בכל נתיבי ה-agent שתוקנו |
| FACT-poisoning cap | ✅ EXISTS AND ENFORCED | `capEpistemicStateForSource()` על הנתיב היחיד החשוף ללקוח |
| `approveMemory()` IDOR | ✅ תוקן אתמול | auth + ownerId scoping, בדיקת רגרסיה נגד איבוד-נתונים |
| Evidence-gate לפני CONFIRMED | ❌ MISSING | `approveMemory()` עדיין לא דורש evidence כלשהו — כל memory, גם ריק, ניתן לאישור |
| Provenance (מי אימת) | ❌ MISSING | אין שדה `verifiedBy`/`verifiedAt` ל-Memory (יש ל-Evidence/Patch, לא ל-Memory) |

### 16. Agents / Orchestrator / Automation

| רכיב | מצב | הוכחה |
|---|---|---|
| Agent Registry / Lifecycle | ✅ EXISTS | enable/disable אמיתי עם בדיקת תלויות (ORCHESTRATOR/JUDGE מוגנים) |
| Orchestrator dispatch | ⚠️ PARTIAL — stubs | `dispatch.ts`'s specialists הם read-only stubs היום (אין נזק בפועל), אבל 0 policy/risk gate אם specialist עתידי יקבל יכולת כתיבה |
| Automation Engine | ✅ EXISTS, היקף מוגבל בכוונה | 3 חוקים בפועל, dedup+idempotency אמיתיים, אבל הפעולה היחידה שהם תומכים היא `appendUnifiedAuditEntry` (מתועד בקוד כהחלטה מכוונת, לא stub-שנשכח) |

### 17. Ops / QA / Modularity / Command Center

| רכיב | מצב | הוכחה |
|---|---|---|
| CI/CD Gate | ✅ EXISTS AND ENFORCED — אימתתי עכשיו | `ci.yml`: build+test+lint(`--max-warnings 0`)+`ci-eval-gate.ts`+`ci-secrets-scan.ts`, שניהם עם `process.exit(1)` אמיתי בכשל — לא decorative |
| QA Engine (`qa-core`) | ✅ EXISTS, auth תוקן אתמול | `orchestrate.ts`/`planner`/`portfolio`/`process-audit` — קיים ומחובר ל-`qa.ts` routes שקיבלו auth אתמול |
| Modular Agent Lifecycle | ✅ EXISTS | (כפול לסעיף 16 — enable/disable עם תלויות) |
| Command Center | ⚠️ PARTIAL | דשבורד מאוחד עם 4 פאנלים (Health/Approval/Agent-Lifecycle/Cost-Intelligence) — נבנה בסבב שמיני, לא מכסה את כל 55 ה-routes |

### 18. סיכום מאוחד — מה עדיין באמת פתוח (לא תיאוריה, מבוסס על 5 המיפויים למעלה)

1. **`agent-fabric.ts`'s dispatch עדיין לא עובר `authorizeEntityAction`/risk** (סעיף 14) — הפער הארכיטקטוני המרכזי שנשאר.
2. **`approveMemory()` בלי דרישת evidence** (סעיף 15).
3. **אין provenance/verifiedBy ל-Memory** (סעיף 15).
4. **2 נתיבי memory-write בלי redaction** (סעיף 13, סיכון נמוך).
5. **RLS לא ניתן לאימות runtime מהסביבה הזו + הוא backstop לא ראשי** (סעיף 13).
6. **Command Center לא מכסה את כל ה-routes** (סעיף 17).

זו הרשימה הכי מדויקת שיש כרגע למה שבאמת נשאר, בלי הפרזה ובלי הבחה.
