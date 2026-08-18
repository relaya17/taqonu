# Atlas — ביקורת אבטחה / אמינות / אינטליגנציה (Security · Reliability · Intelligence Audit)

תאריך: 18.08.2026
**זו ביקורת בלבד — לא בוצע שום שינוי קוד כתוצאה ממנה.** נבדק מה קיים בפועל, מה חלש, ומה חסר, לפי הצ'קליסט ששלחת (19 סעיפים). הביקורת בוצעה ע"י 4 סוכני חיפוש מקבילים, כל אחד read-only לגמרי (בלי הרשאת כתיבה), על אשכול נושאים אחר, בשילוב הידע שכבר נצבר בסבבי הבנייה הקודמים בשיחה הזו. כל טענה מגובה ב-file:line אמיתי — לא הערכה.

**עקרון העבודה (כמו שביקשת):** קודם לבדוק, אחר כך לתקן P0, אחר כך P1, ורק בסוף לבנות יכולות חדשות. שום דבר מהרשימה הזו לא נבנה אוטומטית — זו מפת דרכים לבחירה שלך.

---

## תמצית מנהלים

**8 ממצאי P0 (חורי אבטחה/אמינות קריטיים, ניתנים לניצול דרך קריאת API ישירה, לא רק תיאורטיים):**

1. **קריאה (GET) לפרויקטים/החלטות/זיכרונות — בלי שום הרשאה.** `GET /api/v1/projects`, `/:id`, `/:id/resume`, `/:id/context-export` לא בודקים בעלות בכלל — כל UUID מוחזר לכל קורא, גם לא-מחובר.
2. **`connections.ts` (GitHub/repo מקומי) — בלי שום הרשאה בכלל,** כולל POST/DELETE שמחזיקים טוקן GitHub משותף לכל השרת (לא per-owner).
3. **Memory — קריאה בלי הרשאה, ובלי `ownerId` בסכמה בכלל.** `GET /api/v1/memory` פתוח לגמרי, ו-`memorySchema` (בניגוד ל-Evidence/Claim) לא כולל `ownerId` — אין דרך לסנן לפי בעלים גם אם רצית.
4. **Memory — אין redaction/סינון סודות,** למרות ש-`detectSecrets`/`redactSecrets` קיימים ומחוברים בכל מקום אחר בקוד (agent.ts, conversation.ts, gate-engine.ts...) — רק לא ב-memory-pipeline.
5. **Memory — הרעלה (poisoning) אמיתית:** כל כותב (כולל לא-מאומת, לפי סעיף 1) יכול להצהיר `epistemicState:"FACT"` על מה שהוא כותב, וזה מיד מקבל דירוג הכי גבוה בהחזרה לסוכנים עתידיים — בלי שום שער אימות.
6. **`apps/worker` — קריסה על שגיאה יחידה.** `processJob()` רץ בלי try/catch, בלי timeout, בלי retry/backoff/circuit-breaker, על תור בזיכרון (לא עמיד) — job אחד שזורק exception מפיל את כל תהליך ה-worker.
7. **Risk Engine ו-Policy Engine בנויים אך לא מחוברים לרוב המערכת.** `computeActionRiskScore`/`bucketForRiskScore` לא נקראים משום route אמיתי בכלל (רק מהטסטים שלהם עצמם). `authorizeEntityAction`/`authorizeToolCall` מכסים רק 7 מתוך 63 קובצי routes — נתיבים רגישים ממש כמו `code.ts` (apply/rollback patch), `kernel.ts` (`/kernel/run`), `remediation.ts` (auto-apply) לא עוברים דרך אף מנוע מדיניות.
8. **`/health` הוא stub סטטי** (`{status:"ok"}` בלבד) — אין שום בדיקת קישוריות DB/LLM/Queue בפועל; מפל של ספק חיצוני או DB יהיה בלתי-נראה לחלוטין למערכות ניטור.

**נקודה חשובה:** האימות עצמו (Authentication) אמיתי וטוב — scrypt+salt, session HMAC עם expiry אמיתי, אינטגרציית Supabase Auth אמיתית עם token refresh. זו לא מערכת מזויפת. **הבעיה היא שהאימות קיים, אבל ה-Authorization (מי מותר לו מה) לא נאכף באופן עקבי אחרי שהמשתמש כבר מזוהה** — בדיוק השאלה שהצ'קליסט שלך מצביע עליה כקריטית: "האם משתמש יכול לבצע פעולה אסורה גם אם הוא עוקף את ה-UI?" — התשובה כרגע היא **כן, בכמה מקומות ממשיים**.

---

## 1. Identity & Access

| תת-נושא | מצב נוכחי | סיכון | חסר | עדיפות | תיקון מומלץ |
|---|---|---|---|---|---|
| Authentication | אמיתי: scrypt+salt (`auth-store.ts:84-86,160-170`), session HMAC עם expiry+registry (`auth-store.ts:386-452`), Supabase Auth JWT אמיתי עם refresh (`supabase-session.ts:150-181`) | נמוך | — | — | — |
| Authorization | חלקי מאוד: routes של כתיבה בפרויקטים מוגנים (`project-access.ts:135-170`), אבל **כל ה-GET routes של פרויקטים/decisions/memories פתוחים לגמרי** (`projects.ts:33-67,208-270`), ו-`connections.ts` בלי שום guard | **קריטי** | הרשאה על כל GET רגיש + על כל connections.ts | **P0** | להוסיף `requireUser`+בדיקת בעלות (לפי אותה תבנית מ-`assertProjectWriteAccess`) לכל נתיבי הקריאה |
| RBAC/ABAC | 2 roles בלבד (admin/user). `entity-policies.ts`+`resource-access.ts` אמיתיים ומחוברים ל-4+ routes | בינוני | כיסוי לא אחיד | P1 | להרחיב לכל נתיבי המשאבים |
| Session Mgmt | expiry אמיתי, revoke-one/revoke-all, reset סיסמה מבטל sessions | נמוך | idle-timeout | P2 | — |
| MFA | נבדק בקוד כולו — **לא קיים בכלל** | בינוני-גבוה (השתלטות חשבון בסיסמה בלבד) | TOTP | P1 | להוסיף MFA אופציונלי, לפחות לאדמין |
| Rate Limiting | קיים רק על endpoints של auth (login/register/reset). **אין `@fastify/rate-limit` בכלל, ואין הגנה על שאר ה-API.** גם ה-limiter הקיים הוא in-memory — לא עובד עם כמה instance | בינוני-גבוה | rate limiting גלובלי | P1 | להוסיף `@fastify/rate-limit` (או Redis) ברמת האפליקציה |
| Privilege Escalation | לא נמצא נתיב הסלמה עצמית. "משתמש ראשון = admin" הוא סיכון רק ב-bootstrap | נמוך-בינוני | flag מפורש ל-production | P2 | לחסום bootstrap admin מאחורי env flag |

## 5. Tenant / Data Isolation

| רכיב | מצב נוכחי | סיכון | חסר | עדיפות |
|---|---|---|---|---|
| DB (Supabase) | RLS אמיתי (`auth.uid()=owner_id`), אבל **כתיבות ה-API עצמן עוקפות RLS (service-role)** — ה-RLS הוא הגנת-משנה בלבד, לא ההגנה האמיתית | בינוני | — | P1 |
| API/local store | `getProject`/`getDecision`/`getArtifact`/`getPatch`/`getMemories` — **אף אחת לא מקבלת ownerId, כולן קריאות ללא סינון** | **קריטי — מאושר cross-tenant read** | סינון בעלות בקריאה | **P0** |
| Files (connections.ts) | טוקן GitHub/repo גלובלי לשרת, לא per-owner | קריטי | scoping per-owner | **P0** |
| Vector (pgvector) | RLS קיים אך המדיניות `using(true)` לכולם — לא אוכפת את דגל `project_scoped` שקיים בסכמה | נמוך-בינוני | אכיפת project_scoped בפועל | P2 |
| Memory | טבלת ענן מוגנת RLS, אבל **ה-local store הנקרא בפועל ב-GET routes לא בודק כלום** | קריטי (חופף לממצא Memory למעלה) | — | **P0** |
| Logs (audit-log) | קובץ יחיד, אין הפרדה per-owner | בינוני | tagging לפי owner | P1 |
| Cache / Search | לא קיימים בכלל | — | N/A | N/A |
| Events / Jobs | לא נבדק לעומק — worker סומך על מי שמכניס job לתור בלי אכיפה עצמאית | לא ידוע | ביקורת המשך | P2 |

## 2. Agent Security *(ידוע משיחה זו — נבנה ונבדק בסבבים קודמים)*

מבנה `FABRIC_AGENT_CATALOG` כולל בפועל Identity/Capabilities/Tools/Permissions/RiskLevel/Version (`registeredAgentSchema`). **מה שנוסף בסבבים האחרונים וסוגר פערים אמיתיים:** Agent Lifecycle (Enable/Disable עם בדיקת תלויות אמיתית ל-ORCHESTRATOR/JUDGE), Plugin SDK (רישום/אישור/הפעלה של agent חיצוני מוצהר). **מה שהביקורת הזו חושפת כפער אמיתי:** ה-Risk Engine וה-Policy Engine שאמורים להיות בציר `Agent→Request→Permission→Policy→Risk→Tool` **לא מחוברים בפועל** לרוב הנתיבים (ראו סעיפים 6-7 למטה) — כלומר המודל הנכון קיים בתיאוריה/בקוד, אך בפועל רוב הבקשות עוברות `Agent → Tool` בלי לעבור את שרשרת ה-Policy/Risk המלאה.

| נושא | מצב | סיכון | עדיפות |
|---|---|---|---|
| מבנה Agent כישות מלאה | קיים ומיושם | נמוך | — |
| שרשרת Agent→Permission→Policy→Risk→Tool בפועל | **לא אכופה ברוב הנתיבים** (7/63 routes בלבד) | קריטי | **P0** (חופף לסעיף 7) |

## 3. Memory Security

| תת-נושא | מצב נוכחי | סיכון | עדיפות |
|---|---|---|---|
| הרשאת קריאה | **אין הרשאה כלל** על GET routes | קריטי | **P0** |
| Scoping per-agent | אין שדה `agentId`/`allowedAgents` בסכמה — כל סוכן רואה הכל | בינוני-גבוה | P1 |
| בידוד טננטים | אין `ownerId` בסכמת Memory בכלל (בניגוד ל-Evidence/Claim) | קריטי | **P0** |
| Staleness | קיים מנגנון supersession אמיתי (`supersedeMatchingMemories`), אך `validUntil` לא בשימוש בפועל בניקוד | נמוך | P2 |
| Redaction/PII | `detectSecrets`/`redactSecrets` קיימים במערכת אך **לא מחוברים ל-memory-pipeline בכלל** | קריטי | **P0** |
| עמידות בפני הרעלה | כותב יכול להצהיר `epistemicState:"FACT"` בלי אימות, ומיד מדורג הכי גבוה | קריטי | **P0** |

## 4. Knowledge Trust

| תת-נושא | מצב נוכחי | סיכון | עדיפות |
|---|---|---|---|
| הפרדה Fact/Input/External/Inference | קיימת ואמיתית (`KNOWLEDGE_CATEGORIES`, `evidenceSourceTypeSchema`) | נמוך | — |
| Source/Authority tracking | קיים ומלא (`authorityRank`, `authorityLevel`, `verificationMethod`) | נמוך | — |
| Confidence scoring | הסכמה העשירה (`knowledgeClaimSchema.confidence`) **קוד מת** — הנתיב החי (`research.ts`) מחזיר `0.7` קבוע לכל תוצאה | בינוני | P1 |
| Verification status | דומה — `research.ts` שם `epistemicState:"INFERRED"` קבוע לכל hit, גם ממקור רשמי מצוטט ישירות | נמוך-בינוני | P2 |
| רענון-Freshness | **אמיתי בפועל** — `verified-knowledge-refresh.ts` שולף מחדש כל 24 שעות, מחשב hash, מריץ אימות אמיתי | נמוך | — |

## 6. Risk Engine

| מצב נוכחי | סיכון | חסר | עדיפות |
|---|---|---|---|
| `computeActionRiskScore`/`bucketForRiskScore` בנוי ונבדק (14 בדיקות) אך **אף route לא קורא לו** — אימות ע"י grep מלא של הריפו | קריטי — הניקוד קיים אך לא משפיע על שום החלטת הרצה בפועל | חיווט ל-route אמיתי אחד לפחות (למשל code.ts patch-apply) | **P0** |

## 7. Policy Engine

| מצב נוכחי | סיכון | חסר | עדיפות |
|---|---|---|---|
| **7 מתוך 63** קובצי routes קוראים ל-`authorizeEntityAction`/`authorizeToolCall`. נתיבים רגישים ממש שלא מכוסים: `code.ts` (14 נתיבי כתיבה, כולל apply/rollback patch), `kernel.ts` (7, כולל `/kernel/run`), `remediation.ts` (5, כולל `/auto-apply-low`), `byo-cloud.ts`, `connections.ts`, `plugins.ts` | קריטי — פעולות עם פוטנציאל נזק ממשי (apply patch, kernel run, auto-remediate) רצות בלי לעבור שום מנוע מדיניות | חיווט הדרגתי ל-code.ts/kernel.ts/remediation.ts קודם | **P0** |

## 8. Automation Safety

| תת-נושא | מצב נוכחי | סיכון | עדיפות |
|---|---|---|---|
| Idempotency Key | קיים רק ל-Stripe webhooks. `automation-engine` "idempotent" = בטוח לרשום פעמיים, **לא** דה-דופ על ביצוע אירוע | בינוני-גבוה | P1 |
| Correlation/Causation ID | **אמיתי ומחווט היטב** דרך `domain-event.schema.ts`→`memory-pipeline.ts`→`automation-rules.ts`→audit. רק `causationId` חסר בסכמת ה-audit המאוחד | נמוך | P2 |
| Retry/Timeout/Circuit-Breaker | **`apps/worker` בלי טיפול שגיאות בכלל** — job שזורק exception מפיל את התהליך; תור בזיכרון לא עמיד; אין retry/backoff | **קריטי** | **P0** |
| מניעת ביצוע כפול | `event-bus.ts publish()` בלי דה-דופ לפי event-id — פרסום כפול = הפעלה כפולה של אותו rule | בינוני | P1 |

## 9. Provenance + Audit

| תת-נושא | מצב נוכחי | סיכון | עדיפות |
|---|---|---|---|
| שדות בסכמה | כמעט מלא (WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/POLICY/RISK/APPROVAL/RESULT + correlationId), חסר `causationId`/`evidenceRefs` מפורש | נמוך | P1 |
| אכלוס בפועל | **רק 3 call sites אמיתיים בכל הריפו.** ב-2 מהם (`event-rules.ts`, `automation-rules.ts`) `actorId` **תמיד null** — עם הערה בקוד שמודה בזה במפורש | גבוה — אי אפשר לענות "מי עשה" לרוב סוגי הרשומות | ליחס actorId אמיתי, לחוט אותו מה-route המקורי | **P0** |

## 10-13. Intelligence Layer / Expected-vs-Actual / Pre&Post-Action Intelligence *(מבוסס ידע מהשיחה + הביקורת החדשה)*

היכולות הבסיסיות (Memory/Context/Knowledge/Verified-Knowledge/Risk/Decision) קיימות ברמות שונות של שלמות (ראו טבלאות למעלה). **מה שהרעיון שלך ב-POC (Expected vs Actual, HotelOS/CaseFlow) דורש בפועל שעדיין לא קיים בשום מקום בקוד:**
- Change Detection ייעודי ("מה השתנה מהצפוי") — לא נמצא.
- Anomaly Detection — MISSING לגמרי (כבר תועד קודם בשיחה, נדרש דאטה production אמיתי).
- Pre-Action Impact Analysis ("מה יקרה אם") — לא קיים; יש רק Simulation/Preflight חלקי בהקשר אחר (code patches).
- Post-Action Verification אוטומטי — Judge קיים אבל לא כמנגנון גנרי "verify+rollback" על כל automation rule.

**הבשורה הטובה:** התשתית שה-POC שלך צריך כבר קיימת בחלקים נפרדים — Entity Policy Engine, Risk Engine (0-100, לא מחובר עדיין — סעיף 6), Approval Workflow, Unified Audit — כל אלה בדיוק אבני הבניין ל-`Expected → Actual → Compare → Policy → Risk → Decision → Block/Allow → Evidence` שתיארת. זה לא דורש התחלה מאפס; זה דורש **לחבר** (סעיפים 6-7 P0) ואז להוסיף שכבת "Expected Behavior" דקלרטיבית מעל זה — עבודה משמעותית אך לא מתחילה מאפס.

## 14. Self-Healing

לא נבנה — **וזה נכון**, בדיוק כמו שכתבת. אין המלצה לגעת בזה עד שסעיפים 6-9 (Risk מחובר, Policy מחובר, Automation Safety, Provenance מלא) יהיו מוצקים. הסדר הנכון (Detect→Diagnose→Recommend→Simulate→Approve→Execute→Verify→Rollback) לא רלוונטי כרגע כי חלק מהחוליות הראשונות (Verify אוטומטי, Risk מחובר) עדיין לא קיימות.

## 15. Performance Intelligence

| תת-נושא | מצב | סיכון | עדיפות |
|---|---|---|---|
| Cache | לא קיים בכלל (רק GitHub token cache צר) | נמוך-בינוני | P2 |
| DB indexes | קיימים בפועל (HNSW, FTS, btree) | נמוך | — |
| Latency measurement | רק 2 routes נמדדים; אין hook גלובלי | בינוני | P1 |
| Cost-aware routing | **לא סגור לולאה** — `genius.ts` הוא regex סטטי בלבד, לא מושפע מ-usage אמיתי שנאסף | בינוני | P1 |
| דה-דופ קריאות LLM | לא קיים | בינוני | P1 |

## 16. Observability

| תת-נושא | מצב | סיכון | עדיפות |
|---|---|---|---|
| Metrics | 9 מדדים, אך ring-buffer בזיכרון (מתאפס בהפעלה מחדש), לא Prometheus היסטוגרמות אמיתיות | בינוני | P1 |
| Health per-component | **`{status:"ok"}` בלבד, אין בדיקת DB/LLM/Queue** | **קריטי** | **P0** |
| Error tracking | stdout בלבד, אין אגרגציה | בינוני | P1 |
| Cost visibility | לא מוצג בשום מקום observability, רק ב-route ייעודי | נמוך | P2 |

## 17. Failure Testing

| תת-נושא | מצב | סיכון | עדיפות |
|---|---|---|---|
| E2E failure paths | רק `security.spec.ts` בודק כשלים אמיתיים (401/403/webhook לא חתום). 4 מתוך 5 קבצי e2e הם happy-path טהור | גבוה | **P0** |
| יחס בדיקות happy/failure ביחידה | ~75-85% happy path בדוגמה שנבדקה | בינוני | P1 |
| Chaos/fault injection | לא קיים כלים בכלל (nock/toxiproxy) | נמוך-בינוני | P2 |

## 18. Modular Agents *(ידוע מהשיחה — נבנה)*

Enable/Disable אמיתי עם בדיקת תלויות (`registry-lifecycle.ts`). **קיים.**

## 19. Plugins / Marketplace *(ידוע מהשיחה — נבנה חלקית הרגע)*

Plugin SDK (data-only — הצהרה/אישור/lifecycle) **קיים**, נבנה ואומת בסבב האחרון. Marketplace (חיפוש/גילוי) **עדיין MISSING**, כמו שכבר תועד.

---

## תוכנית פעולה מומלצת (בדיוק לפי הסדר שהצעת)

**שלב 1 — לתקן P0 בלבד (8 ממצאים, כולם אבטחה/אמינות ליבה, לא פיצ'רים חדשים):**
הרשאת קריאה לפרויקטים/memory/connections; ownerId בסכמת Memory; redaction ב-memory pipeline; שער אימות ל-epistemicState:FACT; try/catch+retry ב-worker; חיווט Risk Engine + Policy Engine לפחות לנתיב אחד רגיש (patch-apply); actorId אמיתי ב-audit; health check אמיתי; לפחות e2e אחד לכל תרחיש כשל מרכזי.

**שלב 2 — P1 (11 ממצאים):** MFA, rate limiting גלובלי, כיסוי ABAC רחב יותר, כיסוי policy-engine רחב יותר, idempotency על automation, דה-דופ אירועים, metrics אמיתיים, cost-aware routing, confidence אמיתי ב-research.

**שלב 3 — רק אחרי ששלבים 1-2 יציבים:** להמשיך ל-Anomaly Detection / Expected-vs-Actual POC / Self-Healing — כל אלה תלויים בכך שה-Risk/Policy/Verification שכבר קיימים באמת יהיו מחוברים ואמינים קודם.

זו לא רשימת "לבנות הכל" — זו מפת דרכים לבחור ממנה. תגידי לי איפה להתחיל.
