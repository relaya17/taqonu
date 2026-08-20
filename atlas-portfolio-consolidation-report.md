# דוח איחוד פורטפוליו — 7 אפליקציות + Atlas

**תאריך:** 19 באוגוסט 2026
**היקף:** `C:\Users\User\OneDrive\game\` — brokerOS, CaseFlow-AI, civio, hotelOS-AI, iq-desain, LexStudy, vantera, ‏+ taqonu (Atlas)
**שיטה:** 7 סוכנים במקביל, ניתוח קוד בפועל (קריאה בלבד, לא בוצע שום שינוי)

> **הסתייגות בכנות:** הדוח מבוסס על דגימה ממוקדת של כל ריפו (20-35 קריאות קובץ לכל אחד), לא על קריאה מלאה. הממצאים מצוטטים עם נתיבים אמיתיים וניתנים לאימות. ייתכנו פרטים שלא נדגמו.

---

## 1. הממצא המרכזי — בנית את אותה מערכת שש פעמים

**6 מתוך 7 האפליקציות מכילות מנוע אישור-אנושי עצמאי ומלא.** כל אחד נבנה בנפרד, עם שמות שונים, סכימה שונה, ומסד נתונים שונה — ועושה בדיוק את אותו דבר: **סוכן AI מציע פעולה, אדם מאשר, ורק אז היא מתבצעת.**

| אפליקציה | המנגנון | מצבים | סיווג סיכון | קובץ |
|---|---|---|---|---|
| **vantera** | `gateGovernorAction()` | `pending/approved/rejected/executed/blocked` | `auto · auto_evidence · review · threshold · dual_control · forbidden` | `services/governorPolicy.ts` |
| **CaseFlow** | `humanApprovalQueue` | `queue/approve/block` | `low · medium · high · critical` | `services/aiGuardrails.js` |
| **hotelOS** | `POST /autonomy/suggest` | `pending/approved/rejected` | סף כספי ₪2,000 / ₪5,000 | `execute-approval-act.ts` |
| **LexStudy** | QA lifecycle + evidence queue | 8 מצבים + `DETECTED→QUEUED→UNDER_REVIEW→APPROVED` | `low · medium · high` + `routeTo` | `qaPipeline/lifecycle.ts` |
| **brokerOS** | עמודות `pending*` + `copilot.apply` | `pending/approved/rejected` | `LOW · MEDIUM · HIGH` ב-`AGENT_REGISTRY` | `agent/copilot-apply.ts` |
| **iq-desain** | `SecretaryAction` | `pending/approved/rejected/auto/failed` | `LOW..CRITICAL` (auto ל-LOW) | `models/SecretaryAction.js` |
| **civio** | ❌ אין | — | — | — |
| **Atlas** | `dispatchAgentAction()` | `ALLOWED/DENIED/APPROVAL_REQUIRED` | `AUTO · AUTO_LOG · APPROVAL · HUMAN_ONLY` | `agent-dispatch-guard.ts` |

**המסקנה:** ההפשטה של Atlas אינה תיאורטית. **גילית אותה שבע פעמים באופן בלתי תלוי** — בנדל"ן, במשפט, במלונאות, בוועדי בתים, בלימודי משפט ובבנייה. זו ההוכחה האמפירית החזקה ביותר לטענת ה-application-agnostic, והיא כבר קיימת בדיסק שלך.

### ⚠️ שתי אפליקציות מקדימות את Atlas

**vantera מתקדמת מ-Atlas בשלושה דברים:**
1. **Dual control** — `proposerId` + `approverId`, שני בני אדם שונים. ל-Atlas אין את זה.
2. **Evidence hash-chain** — `automationEvidenceModel.ts` עם `previousHash`/`chainHash` פר-בניין. (ל-Atlas יש hash-chain ל-audit, לא ל-evidence.)
3. **Kill switches** — `KILL_SWITCHES = payments|webhooksInbound|webhooksOutbound|voneMoney|aiWorkers` עם עקיפה מ-env. ל-Atlas אין kill switch בכלל.

**CaseFlow מקדימה בשניים:**
1. **איסור אישור עצמי** — `assertCanResolve()`: *"לא ניתן לאשר פעולה שביקשת בעצמך — נדרש מאשר אחר"*. Atlas לא אוכף את זה.
2. **TTL אוטומטי** — דחייה אוטומטית אחרי 24 שעות. ל-Atlas אין תפוגה לבקשות אישור.

**ול-CaseFlow כבר יש מודול בשם Atlas בפנים:** `routes/atlas.js` + `services/atlas/{overviewService,auditRunnerService,readinessService,patchService,knowledgeSourceService,legalReadinessService}.js` + מיגרציות `056_engineering_audit_atlas.sql`, `057_seed_atlas_defaults.sql`, ומסך ב-`apps/web-office/src/pages/Atlas`. כלומר בנית גם את Atlas עצמו פעמיים.

---

## 2. מפת הפיצול — איפה הכפילות עולה לך הכי הרבה

### 2.1 מסד נתונים — 4 טכנולוגיות שונות, 3 בלי מיגרציות

| אפליקציה | DB | מיגרציות |
|---|---|---|
| brokerOS | Supabase Postgres | 42 קבצי SQL ✅ |
| CaseFlow | Supabase Postgres | 62 קבצי SQL ✅ |
| LexStudy | **Postgres + MongoDB יחד** | 50+ SQL (רק לצד Postgres) ⚠️ |
| civio | MongoDB | ❌ אין |
| vantera | MongoDB (~60 מודלים) | ❌ אין |
| iq-desain | MongoDB | ❌ אין |
| hotelOS | **libSQL/Turso + Drizzle** | ❌ אין — 84 × `CREATE TABLE IF NOT EXISTS` |
| Atlas | Supabase Postgres | יש ✅ |

**הבעיה החמורה ב-hotelOS:** כל הסכימה נוצרת מ-84 פקודות `CREATE TABLE IF NOT EXISTS` בתוך `packages/database/src/client.ts`, עם `ALTER TABLE` בודד. **אי אפשר לשנות עמודה במסד נתונים קיים.** אין היסטוריית גרסאות.

### 2.2 בידוד דיירים — 6 מפתחות שונים, 4 בלי RLS

| אפליקציה | מפתח הדייר | RLS במסד |
|---|---|---|
| brokerOS | `brokerId` | ✅ יש |
| CaseFlow | `firm_id` | ✅ יש |
| LexStudy | ❌ אין דייר — רק `user_id` | ✅ יש (חלקי) |
| vantera | `buildingId` | ❌ אין |
| hotelOS | `tenantId`+`hotelId` | ❌ **אין — libSQL לא תומך** |
| civio | ❌ אין דייר | ❌ אין |
| iq-desain | ❌ אין דייר כלל | ❌ אין |
| Atlas | `ownerId`+`projectId` | 🟡 קיים, לא אומת חי |

**הסיכון הגדול ביותר בכל הפורטפוליו:** ב-hotelOS הבידוד נשען כולו על 50 ריפוזיטוריז שנכתבו ביד. הבדיקה שאמורה לשמור על זה (`tenant-predicate.test.ts`) רק מחפשת את המחרוזת `tenantId` בקובץ — **היא לא יכולה לזהות predicate על עמודה שגויה או `and()` חסר.**

### 2.3 ספקי LLM — 7 מימושים שונים

brokerOS → Gemini בלבד · CaseFlow → OpenAI + Anthropic · civio → Gemini + BYOK OpenAI מהדפדפן · LexStudy → OpenAI · vantera → OpenAI · hotelOS → `openai_compatible` · iq-desain → fetch גנרי

**אף אחת מהן לא חולקת שורת קוד עם אחרת.** ב-brokerOS זה מתועד במפורש בקוד: *"extracted from the fetch/parse boilerplate that already existed (identically) in draft-invoice.ts and copilot.ts … the two older files are left as-is"* — שלושה עותקים של אותו קוד באותו ריפו.

### 2.4 תשתית גנרית שמשוכפלת בכל 7

`logger` · `i18n` · `config/env` · `validation (zod)` · `error types` · `ui components` · `auth (JWT+bcrypt)` · `rate limit` · `audit` · `e2e/a11y harness (Playwright+axe)` · `connectors (Stripe/Resend/Twilio)`

**המקרה הקיצוני:** ב-CaseFlow יש **ארבעה עותקים מפוצלים** של אותו קטלוג תרגומים — `apps/{web,web-office,web-veridict,web-court}/src/i18n.ts` בגדלים 24.4KB / 26.2KB / 22.5KB / 26.5KB — עם `App.css` ו-`declarations.d.ts` זהים בית-בית.

---

## 3. מה שבור — לפי דחיפות

### 🔴 קריטי (אבטחה / נכונות)

| # | ממצא | איפה |
|---|---|---|
| 1 | **סוד JWT קשיח כברירת מחדל** — `"iq-design-dev-secret"` כשאין `JWT_SECRET`; ואף ראוט לא בודק `req.user.role` — ההבחנה contractor/staff דקורטיבית | `iq-desain: middleware/auth.js` |
| 2 | **אין אכיפת בידוד ברמת DB** + אין מיגרציות | `hotelOS: packages/database` |
| 3 | **רו"ח לא יכול לאשר סגירת ספרים** — `canDecideOpsHitl` רץ לפני בדיקת ledger-close, ו-`OPS_HITL_ROLES` לא כולל `accountant`. בפועל `canApproveLedgerClose = ["accountant","cfo"]` הוא **CFO בלבד** — סותר את ההערה בקוד עצמו | `hotelOS: approval-routes.ts` |
| 4 | **תשובות AI בפורום מתפרסמות ללא מודרציה** | `civio: communityController.ts:~130` |
| 5 | **`auditLogMiddleware` עדיין placeholder** — `"Later: persist to DB"` — בזמן שקיים מנגנון audit אמיתי לידו | `civio: middlewares` |

### 🟠 גבוה (נכונות / חוב טכני)

| # | ממצא | איפה |
|---|---|---|
| 6 | **סף ₪2,000 מקודד פעמיים** — כמספר ב-`execute-approval-act.ts:969` וכטקסט חופשי ב-prompt של ה-LLM (`gateway.ts`). כלל "5% ADR" שמוזכר ב-prompt **לא קיים בקוד בכלל** | `hotelOS` |
| 7 | **`imported/` — ~150 קבצים מועתקים מ-3 אפליקציות אחרות** (caseflow, hotelos, brokeros), לא ב-workspace, מובטח שהם מיושנים | `iq-desain` |
| 8 | **`apps/web` מת אבל עדיין נבנה** — ה-README אומר "legacy, not production", אבל `vercel.json` בשורש עדיין בונה אותו | `CaseFlow` |
| 9 | **שני מסדי נתונים לאפליקציה אחת**; `connectDB()` ממשיך בשקט כש-`MONGODB_URI` ריק | `LexStudy` |
| 10 | **URL של מוצר אחר כברירת מחדל** — `AI_API_URL \|\| 'https://api.contractlab.ai'` | `LexStudy: routes/ai.ts:37` |
| 11 | **אפס בדיקות** — אין test runner ואין קובץ בדיקה אחד ב-`apps/*` | `iq-desain` |
| 12 | **שתי מערכות מספור מיגרציות** עם שני קבצי `init` — נדרש script ייעודי רק כדי לשמור על הסדר | `brokerOS` |
| 13 | **`packages/*` מוצהר ב-workspace אבל התיקייה לא קיימת** — ולכן הכל מועתק ידנית (`types/index.ts` זהה בית-בית בין שתי אפליקציות) | `iq-desain` |

### 🟡 בינוני (היגיינה)

- **פסולת מקומפלת ב-git:** `dist/` מוכנס לגיט ב-CaseFlow, LexStudy, vantera · קבצי `_tmp_*` באפס בתים ב-hotelOS, vantera, CaseFlow · `lighthouse-a11y{,2,3}.json` (~580KB) ב-LexStudy · `login-body.json`, `test-output.docx`, `.patch-backups/` ב-CaseFlow · `invoice-generator.html` (43KB) בשורש vantera
- **שני מארחים סטטיים מתחרים:** `netlify.toml` + `vercel.json` שניהם בונים את אותו `apps/web` — ב-brokerOS וב-vantera
- **קוד מת:** `packages/ui` ב-civio הוא stub של Turborepo שאף אפליקציה לא מייבאת · `i18next` מותקן ב-iq-desain עם אפס imports · `officeLiveAgentsEnabled()` ב-brokerOS מתעלם משני הארגומנטים ותמיד מחזיר `true`
- **סחף גרסאות Node:** vantera — `engines`≥20, netlify=20, CI=22
- **סחף שמות:** LexStudy — הריפו `lexstudy`, ה-scope `@lawyers/*`, שירות Render בשם `lawyers-gigd`
- **מיגרציה לא מיושמת:** `_paste_054_055_rag_firm_scope.sql` יושב בתיקיית המיגרציות של CaseFlow

---

## 4. תוכנית האיחוד — 4 שלבים

> **עיקרון מנחה:** לא לאחד הכל. לאחד את מה שכבר הוכח שהוא זהה — ולהשאיר את הדומיין נפרד.

### שלב 0 — ניקוי (יום עבודה אחד, אפס סיכון)

מוחקים בלי לחשוב פעמיים: `iq-desain/imported/` · כל `dist/` מהגיט (+`.gitignore`) · כל `_tmp_*` · `lighthouse-a11y*.json` · `login-*.{json,txt}` · `test-output.docx` · `.patch-backups/` · המארח הסטטי המיותר בכל ריפו שיש בו שניים.

מתקנים מיידית: הסוד הקשיח ב-iq-desain (🔴#1) · באג ה-`accountant` ב-hotelOS (🔴#3) · מיגרציית ה-`_paste_` התלויה ב-CaseFlow.

### שלב 1 — Atlas כמקור אמת יחיד למדיניות (הצעד בעל התשואה הגבוהה ביותר)

**לא מעבירים קוד.** מגדירים ב-Atlas `packages/integrations/<app>` לכל אפליקציה — התבנית קיימת ומוכחת (`render` = 52 שורות):

```
packages/integrations/hotel/src/tools.ts    ← 8 ה-autonomy kinds + ספים + RBAC
packages/integrations/broker/src/tools.ts   ← 22 מפתחות מ-PERMISSIONS
packages/integrations/caseflow/src/tools.ts ← ACTION_RISK_MAP
packages/integrations/vantera/src/tools.ts  ← GOVERNOR_ACTION_KINDS
```

כל אפליקציה שולחת POST ל-Atlas (push, ללא credentials — כמו `provider-adapters.ts` היום). **התוצאה המיידית:** מנוע החלטה אחד, סף אחד, audit אחד, ו-`seedPortfolioPatternMemories` מתחיל לראות דפוסים חוצי-מערכות (הוא דורש הופעה ב-≥2 פרויקטים — היום זה בלתי אפשרי).

**רווח נוסף:** הסף ₪2,000 יפסיק להיות מקודד בשני מקומות סותרים.

### שלב 2 — ייבוא היכולות שחסרות ל-Atlas

לפני שמאחדים — **Atlas צריך להשתפר**, כי שתי אפליקציות מקדימות אותו:

1. **Dual control** מ-vantera → `dispatchAgentAction` (`proposerId` ≠ `approverId`)
2. **איסור אישור עצמי** מ-CaseFlow → `approvals.ts`
3. **TTL לבקשות אישור** מ-CaseFlow (24 שעות)
4. **Kill switches** מ-vantera → אין ל-Atlas מקבילה
5. **`forbidden` כדרגה מפורשת** מ-vantera → היום Atlas ממדל איסור רק דרך policy, לא כדרגת bucket

### שלב 3 — חילוץ תשתית משותפת (הכי יקר — אחרון)

לפי סדר תשואה: `logger` → `config/env (zod)` → `error types` → `validation` → `e2e/a11y harness` → `LLM client` → `ui`.

**`ui` אחרון בכוונה:** ל-hotelOS יש 7 רכיבים, ל-brokerOS ערכת Radix מלאה, ל-LexStudy רכיבים בעבודת יד, ל-CaseFlow ארבעה פיצולים. זו העבודה הגדולה ביותר עם התשואה המיידית הנמוכה ביותר.

---

## 5. מה **לא** לעשות

❌ **לא לאחד מסדי נתונים.** 4 טכנולוגיות (Postgres/Mongo/libSQL), חלקן בלי מיגרציות. פרויקט בפני עצמו, לא חלק מאיחוד.

❌ **לא למזג את האפליקציות למונורפו אחד.** הן חולקות תשתית, לא דומיין. מונורפו אחד ענק = build אחד איטי וכשל אחד שמפיל הכל.

❌ **לא להתחיל מ-`ui`.** הכי מפתה, הכי יקר, הכי פחות משתלם.

❌ **לא להוסיף אפליקציה שמינית לפני שלב 0.**

---

## 6. סיכום מנהלים

**מה שיש לך:** 7 אפליקציות עובדות, 6 מהן עם מנוע אישור-אנושי אמיתי, שתיים מהן מתקדמות יותר מ-Atlas עצמו בהיבטים מסוימים.

**מה שזה עולה לך:** כל תיקון אבטחה נעשה 6 פעמים. ה-hardening שנעשה ל-Atlas היום (retry, שער evidence, הגנת injection, CRUD floor) — אף אחת מ-6 האחרות לא קיבלה אותו.

**מה שזה שווה לך:** ההוכחה שהמודל הגנרי של Atlas נכון היא לא הצהרה במסמך מיצוב — היא 6 מימושים עצמאיים שהתכנסו לאותו מבנה. זה נכס שאי אפשר לזייף ואי אפשר להעתיק.

**הצעד הבא הכי משתלם:** שלב 0 (יום) ואז שלב 1 על **hotelOS בלבד** — 8 סוגי הפעולות כבר מוגדרים שם, כך שזו עבודת מיפוי ולא עבודת עיצוב.
