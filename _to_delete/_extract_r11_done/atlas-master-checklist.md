# Atlas — רשימת מצב מאוחדת (Master Checklist)

תאריך: 19.08.2026. מסמך אחד, קצר, שמרכז את כל מה שאומת בפועל בסשן הזה — כדי שלא נאבד שום דבר בין המסמכים הארוכים. לפרטים/הוכחות file:line: `atlas-gap-analysis.md` ו-`atlas-security-intelligence-audit.md`.

## 1. רכיבי מערכת — האם קיימים בקוד

| רכיב | מצב |
|---|---|
| Atlas Core | ✅ קיים |
| Memory / Knowledge / Provenance | ✅ קיים, מהחזקים — אבל provenance (מי אימת) חסר |
| Agent Registry / Orchestrator | ✅ קיים (registry+lifecycle אמיתי; orchestrator dispatch עדיין specialists שהם stubs) |
| Automation Engine | ✅ קיים (3 חוקים, idempotency אמיתי, פעולה יחידה בכוונה: audit-log) |
| Event Bus | ✅ קיים (dedup אמיתי) |
| Risk Engine 0-100 | ⚠️ קיים אך לא נאכף בהיקף רחב — מחובר רק ב-`code.ts` אחד |
| Policy Engine | ⚠️ קיים אך חלקי — מחובר ל-~11 routes מתוך ~55; מסלול ה-agent dispatch לא עובר דרכו |
| Universal Filter | ✅ קיים, מחובר ל-`/events` |
| Cost Intelligence | ✅ קיים, אמיתי (לא synthetic) |
| Anomaly Detection | ✅ קיים — z-score+IQR, כן עם `INSUFFICIENT_DATA` כשאין מספיק דגימות |
| Plugin SDK | ✅ קיים (data-only). **Sandbox להרצת קוד — לא נבנה בכוונה** |
| Marketplace UI | ✅ קיים |
| Command Center | ⚠️ קיים חלקית — 4 פאנלים, לא מכסה את כל ה-routes |
| CI/CD Gate | ✅ קיים וחוסם אמיתי — `process.exit(1)` על כשל, אימתתי בעצמי |
| Simulation/Preflight | ✅ קיים — חוסם `apply_patch`/`deploy` בפועל לפי risk |
| Multi-tenant / RLS | ⚠️ SQL אמיתי קיים (25+ policies), אך: (א) לא ניתן לאימות runtime מהסביבה הזו, (ב) הוא backstop — ההגנה העיקרית היא בדיקות ownerId ברמת ה-API |

## 2. 13 סעיפי האבטחה שביקשת (מצב אחרי כל התיקונים עד כה)

| # | סעיף | מצב |
|---|---|---|
| 1 | Authentication | ✅ EXISTS AND ENFORCED — תוקן: `auth.getUser()` אמיתי במקום decode-בלבד |
| 2 | Authorization (`authorizeEntityAction`) | ⚠️ PARTIAL — ~11/55 routes; agent dispatch עדיין לא |
| 3 | Project ownership | ⚠️ PARTIAL — אכוף ב-~10 routes, לא בכולם |
| 4 | Memory ownership | ✅ EXISTS AND ENFORCED — תוקן אתמול (agent-fabric/conversation/qa) |
| 5 | Connections authorization | ⚠️ PARTIAL — auth תקין, policy/risk לא |
| 6 | Memory secret redaction | ⚠️ PARTIAL — נתיב עיקרי + agent.ts תוקנו; 2 נתיבים נמוכי-סיכון עדיין לא |
| 7 | FACT verification | ⚠️ PARTIAL — ה-cap אכוף; `approveMemory()` עדיין בלי דרישת evidence |
| 8 | Risk enforcement | ⚠️ EXISTS BUT NOT ENFORCED רחבות |
| 9 | Policy enforcement | ⚠️ EXISTS BUT NOT ENFORCED רחבות (`assertAuthorized` קוד מת) |
| 10 | Worker failure handling | ✅ EXISTS AND ENFORCED |
| 11 | Audit actor identity | ⚠️ PARTIAL — אמיתי ב-~8 routes, null בשאר |
| 12 | Health checks | ⚠️ PARTIAL, כנה — DB+LLM אמיתי, worker מדווח UNKNOWN (לא מזויף) |
| 13 | Tenant isolation | ✅ השתפר משמעותית אתמול — 6 דליפות אמיתיות נסגרו; RLS עדיין רק backstop |

## 3. תוקן אתמול בפועל (6 P0, מאומת: 448/448 בדיקות, build נקי)

1. עקיפת Authentication (החמור מכולם)
2. `agent-fabric.ts` — דליפת memory + חסר auth
3. `agent.ts` — אותה דליפה + באג redaction (secrets)
4. `conversation.ts`+`qa.ts` — 5 endpoints חסרי-auth
5. `GET /events` — public לגמרי → `requireAdmin`
6. `POST /memory/:id/approve` — IDOR
7. `decisions.ts` — חסר auth + epistemicState לא capped

## 4. עדכון — 3 מתוך 6 הפערים תוקנו עכשיו (מאומת: 458/458 בדיקות apps/api + 277/277 agent-core + 85/85 shared, build נקי בכל 3 החבילות)

1. ✅ **תוקן** — `agent-fabric.ts`'s `/agents/dispatch` עכשיו עובר `authorizeEntityAction("CONFIGURATION","EXECUTE")` (אותו pattern כמו `kernel.ts`). `/agents/plan` נשאר בלי (רק מציע תוכנית, לא מבצע — עקבי עם `kernel.ts`'s `/kernel/plan`). **לא נוסף** ניקוד risk מספרי — הוסבר בקוד למה (אין signal לפני-הפעולה כמו ב-`code.ts`; ידרוש תכנון approval-workflow נפרד).
2. ✅ **תוקן** — `approveMemory()` דוחה עכשיו קידום ל-CONFIRMED כשאין evidence בכלל (400 `NO_EVIDENCE`, לא 404 מטעה).
3. ✅ **תוקן** — נוספו `verifiedBy`/`verifiedAt` ל-`memorySchema` (אופציונליים, לא שוברים תאימות), מתמלאים אמיתית ב-`approveMemory()`.
4. ✅ **תוקן** — `central-opinion.ts` ו-`memory-pipeline.ts`'s pattern-seeding עכשיו קוראים ל-`redactSecrets` לפני שמירה.
5. ⚠️ **לא ניתן לתיקון מכאן** — RLS לא ניתן לאימות מהסביבה הזו (אין חיבור DB חי, `SUPABASE_SERVICE_ROLE_KEY=replace-me`). זו מגבלת סביבה, לא באג בקוד.
6. ⚠️ **לא תוקן, החלטה שלך נדרשת** — Command Center לא מכסה את כל ה-routes; זו הרחבת feature, לא תיקון קוד בודד — צריך שתגידי אילו פאנלים נוספים רלוונטיים.

## 4ב. עוד 3 תיקונים (המשך יזום, "מה שכן אפשר") — מאומת: 468/468 apps/api, build נקי

7. ✅ **תוקן** — `POST /auth/oauth/sync` היה סוג אחר של אותה עקיפת-auth: `body.accessToken` (קלט לקוח גולמי) נסמך על `atlas_role` בלי אימות חתימה → הסלמת הרשאות. עכשיו עובר `verifySupabaseAccessToken()` האמיתי (אותה פונקציה מתיקון האתמול), פלוס בדיקה ש-`sub` בטוקן תואם את המשתמש המסונכרן.
8. ✅ **תוקן** — 2 הבאגים ב-CI workflow (`e2e-critical-path.yml`) שדווחו ולא תוקנו: `SUPABASE_SERVICE_ROLE_KEY` שונה בחזרה ל-`"replace-me"` המדויק (כדי ש-`isLiveSupabase()` יזהה נכון offline), `ENCRYPTION_KEY`/`COOKIE_SECRET` שונו לערכים שאינם ה-example הידוע (`assertNotExampleSecrets()`). `NODE_ENV: production` נשאר בכוונה — הוא בוחן התנהגות production-only אמיתית (Secure cookie flag, הסתרת password-reset token).
9. ✅ **תוקן** — `plugins.ts`'s 6 routes מוטציה (register/approve/reject/enable/disable/uninstall) קיבלו `authorizeEntityAction("CONFIGURATION", CREATE/UPDATE/DELETE)` בנוסף ל-`requireAdmin` הקיים — היו לגמרי בלי policy engine קודם.

## 5. מה נבדק והתברר שגוי (רשימות ישנות/חיצוניות שהופרכו)

- "Event Bus/Risk Engine/Automation Engine/Universal Filter/Cost Intelligence/Anomaly Detection/Plugin-Marketplace חסרים" — **לא נכון**, כולם קיימים (ראו טבלה 1).
- "gates.ts חסר auth guard" (דיווח סוכן קודם) — **לא נכון**, יש auth ו-actorId אמיתי.
- "Risk Engine מחובר ל-11 routes" (תיעוד קודם) — **לא מדויק** — הניקוד המספרי מחובר לקובץ אחד בלבד; 10 האחרים משתמשים רק במדיניות קטגורית.

---
*מסמך זה הוא תמצית. לכל טענה יש file:line מגובה ב-`atlas-gap-analysis.md` (מיפוי מלא) ו-`atlas-security-intelligence-audit.md` (audit אבטחה מלא + תיקונים).*
