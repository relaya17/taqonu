# דוח גילוי ואדריכלות — חיבור ופיקוח Atlas על 6 האפליקציות

**תאריך:** 5 בספטמבר 2026
**היקף:** Civio · CaseFlow-AI · LexStudy · Vantera · HotelOS-AI · BrokerOS — תחת פיקוח **Atlas Core (Taqonu)**
**שיטה:** קריאת קוד וקבצים בפועל דרך המחשב שלך (`C:\Users\User\project\github\`), ללא שום שינוי בקוד. חלק גדול מהממצאים מאומת ישירות בקוד; חלק (מסומן בבירור) מגיע מדוח פנימי קודם שכבר כתבת/הרצת בעצמך (`atlas-portfolio-consolidation-report.md`, 19.8.2026) ולא אומת מחדש שורה-שורה כדי לא לבזבז זמן על דבר שכבר נבדק.
**מה זה לא:** זה לא יישום. לא נגעתי בקוד, בסכימה, ב-CI או בהרשאות של אף ריפו.

---

## 1. תקציר מנהלים

יש לך כבר את כל מה שצריך כדי לבנות את זה נכון — אתה פשוט עוד לא חיברת את החוטים.

**הממצא המרכזי, ומאומת בקוד:** אטלס בעצמו (ב-`docs/architecture/managed-system.md`) כבר מגדיר את חמש האפליקציות בתור "Managed Systems" במפורש: *"Atlas does not embed inside Vantera / HotelOS / CaseFlow / BrokerOS / Civio"*. כלומר — האדריכלות הנכונה **כבר תוכננה ותועדה**. הבעיה היא שהיא לא מיושמת: מתוך רשימת ה-Provider Adapters החיה של Atlas (`GET /api/v1/providers/adapters`), אף אחת מ-6 האפליקציות שלך לא מופיעה בתור adapter רשום. יש שם GitHub, Vercel, Render, Supabase, Cloudflare — כל התשתית הגנרית — אבל אפס שורות קוד שמחברות בפועל את Civio, CaseFlow, LexStudy, Vantera, HotelOS או BrokerOS ל-Atlas.

**החיבור היחיד שקיים בכלל הוא Civio, וגם הוא לא באמת "חי":** יש חבילה שלמה, בנויה נכון — `packages/integrations/civio/` עם לקוח HTTP שחותם בקשות ב-HMAC-SHA256 (`client.ts` + `hmac.ts`) ומסכים משותפים (`@atlas/shared`). זו בדיוק התבנית הנכונה. אבל כשמחפשים איפה זה מקבל תעבורה בפועל בצד השרת — הנתיב `CIVIO_CONNECTOR_INGRESS_PATH` **מוזכר רק בקבצי טסט** (`governed-lifecycle-handoff.test.ts`, `personal-supervising-agent.test.ts`), ולא ברשימת ה-routes החיים של ה-API. במונחי בשלות: **CODE EXISTS + EXECUTABLE (בטסטים)**, אבל **לא WIRED** לתעבורה אמיתית.

**התגלית הכי חשובה מבחינה עסקית — ולא ניחוש, אלא ממצא מתועד שלך מ-19.8.2026:** שש מתוך שבע האפליקציות בפורטפוליו שלך (כולל חמש מתוך השש שביקשת להתמקד בהן) בנו **באופן עצמאי לחלוטין** בדיוק את אותו מנגנון — "סוכן AI מציע פעולה, אדם מאשר, ורק אז מתבצעת" — עם שמות שונים ומסדי נתונים שונים. זו לא בעיה, זו **הוכחה אמפירית חזקה** לכך שהמודל הגנרי של Atlas נכון. אבל היא גם אומרת שכל תיקון אבטחה נעשה היום שש פעמים בנפרד, ושתיים מהאפליקציות (Vantera, CaseFlow) כבר **מתקדמות מ-Atlas עצמו** בפרטים קריטיים (ראה סעיף 5).

**הבעיה השנייה שגיליתי:** ל-CaseFlow-AI כבר יש מודול פנימי בשם **"Atlas"** משלה (`routes/atlas.js`, `services/atlas/*`, טבלאות `056_engineering_audit_atlas.sql`, מסך `/Atlas` ב-UI). זה לא ה-Atlas שלך — זה שם שנבחר באופן עצמאי לפיצ'ר דומה רעיונית (audit/readiness). זה לא אסון, אבל זו התנגשות שמות שתבלבל כל מי שיעבוד על החיבור בין השניים, וצריך החלטה מודעת (סעיף 9).

**המלצה בשורה אחת:** אל תבנה עוד שכבת תשתית. תעתיק את התבנית שכבר קיימת ועובדת (Civio: tools.ts + client.ts עם HMAC + to-evidence.ts) לחמש האפליקציות הנותרות, תרשום סוף-סוף route מקבל בצד ה-API (גם ל-Civio, שעדיין חסר לו את זה), ותתחיל מ-HotelOS — כי שם סוגי הפעולות (autonomy kinds) כבר מוגדרים בקוד, וזו עבודת מיפוי, לא עבודת עיצוב.

---

## 2. מיפוי 6 האפליקציות + Atlas

| אפליקציה | מיקום בדיסק | מה זה עושה | Stack עיקרי | סטטוס עדות |
|---|---|---|---|---|
| **Atlas (Taqonu)** | `project\github\taqonu-main` | "Truth & Control Layer" — גוף הפיקוח עצמו. Next.js web + Fastify API + admin + control-plane + worker | Next.js 15 · Node 22 · Supabase Postgres · pnpm monorepo | CODE EXISTS, RUNTIME VERIFIED (יש `pnpm dev`, health endpoints, E2E) |
| **BrokerOS** | `project\github\brokerOS-main` | תיווך נדל"ן: אתר לקוחות, CRM, pipeline עסקאות, חלוקת עמלות, co-broke | Web+Mobile monorepo · Supabase Postgres (42 מיגרציות SQL) | CODE EXISTS, RUNTIME VERIFIED — Atlas Proof Case #001 (`docs/case-studies/001-brokeros.md`), אבל דרך connector גנרי (GitHub/local scan) לא ייעודי |
| **CaseFlow-AI** | `project\github\CaseFlow-AI-main` | Legal OS: ניהול משרד עו"ד + Veridict (בוררות/ביטוח) + Virtual Court — 3 אפליקציות תחת מונורפו אחד (`apps/web-office`, `web-veridict`, `web-court`) | Supabase Postgres (62 מיגרציות) · OpenAI+Anthropic | CODE EXISTS. יש לה מודול "Atlas" פנימי משלה — ראה סעיף 9 |
| **Civio** | `project\github\civio-main` (יש גם עותק ישן `civio`) | "מכתביה" — כלי ליצירת מכתבים לרשויות, בדיקת זכויות, ניסוח בעזרת AI | MongoDB · Gemini + BYOK OpenAI מהדפדפן | CODE EXISTS + חיבור חלקי ל-Atlas (ראה סעיף 4) |
| **HotelOS-AI** ("Vantera"? — לא, שונה, ראה הערה) | `project\github\hotelOS-AI-main` | שכבת אינטליגנציה מעל PMS קיים (Opera/Protel/Mews) — 6 אפליקציות: Executive/Admin/Guest/Work/Platform/API, סוכנים עם HITL | libSQL/Turso + Drizzle · `openai_compatible` | CODE EXISTS, RUNTIME VERIFIED (deploy חי ב-Vercel), **0 חיבור ל-Atlas** |
| **LexStudy** | **לא אותר תחת `project\github`** | לפי הדוח הפנימי: מוצר QA/lifecycle משפטי (`@lawyers/*` scope), Postgres+MongoDB במקביל | Postgres+MongoDB · OpenAI | DOCUMENTED בלבד (מהדוח הפנימי מ-19.8) — **צריך ממך את הנתיב הנוכחי**, ראה סעיף 10 |
| **Vantera** | **לא אותר תחת `project\github`** | לפי הדוח הפנימי: ניהול ועדי בתים/בניינים, עם מנגנון אישור מתקדם משמעותית מ-Atlas עצמו | MongoDB (~60 מודלים) · OpenAI | DOCUMENTED בלבד (מהדוח הפנימי מ-19.8) — **צריך ממך את הנתיב הנוכחי**, ראה סעיף 10 |

הערה חשובה: בהודעה שלך "וונטרה = הוטלס" — בדקתי בקוד ובדוח הפנימי שלך, ואלה **שתי אפליקציות שונות לגמרי** (Vantera = ניהול בניינים/ועדי בתים; HotelOS = מלונאות). ייתכן שהתכוונת רק לפסיק בין שני שמות ולא לשוויון. המשכתי עם שתיהן כנפרדות — תתקן אותי אם טעיתי.

---

## 3. מנגנון האישור-האנושי — נבנה 7 פעמים בנפרד (ומאומת בקוד לשתיים מהן)

זה הממצא הכי חשוב לארכיטקטורת החיבור, כי זה בדיוק הדבר ש-Atlas אמור לרכז:

| אפליקציה | המנגנון | מצבים | סיווג סיכון | קובץ מקור |
|---|---|---|---|---|
| **Vantera** | `gateGovernorAction()` | pending/approved/rejected/executed/blocked | auto · auto_evidence · review · threshold · dual_control · forbidden | `services/governorPolicy.ts` |
| **CaseFlow** | `humanApprovalQueue` | queue/approve/block | low·medium·high·critical | `services/aiGuardrails.js` |
| **HotelOS** | `POST /autonomy/suggest` | pending/approved/rejected | סף כספי ₪2,000/₪5,000 | `execute-approval-act.ts` |
| **LexStudy** | QA lifecycle + evidence queue | 8 מצבים, DETECTED→QUEUED→UNDER_REVIEW→APPROVED | low·medium·high + routeTo | `qaPipeline/lifecycle.ts` |
| **BrokerOS** | עמודות `pending*` + `copilot.apply` | pending/approved/rejected | LOW·MEDIUM·HIGH ב-`AGENT_REGISTRY` | `agent/copilot-apply.ts` |
| **Civio** | ❌ אין מנגנון | — | — | — |
| **Atlas עצמו** | `dispatchAgentAction()` | ALLOWED/DENIED/APPROVAL_REQUIRED | AUTO·AUTO_LOG·APPROVAL·HUMAN_ONLY | `agent-dispatch-guard.ts` |

*(שורה זו כולה מגיעה מהדוח הפנימי מ-19.8 — 7 סוכנים מקביליים שדגמו 20-35 קבצים לכל ריפו. לא קראתי מחדש את כל הקבצים האלה בעצמי כדי לא לחזור על עבודה שכבר נעשתה; ה-4 שכן פתחתי ישירות — Atlas, BrokerOS case-study, CaseFlow Atlas module, Civio connector — תואמים למה שמתואר.)*

**שני ממצאים קריטיים מהטבלה הזו לגבי איך Atlas צריך להתפתח לפני שהוא הופך ל"מקור אמת" אמיתי:**

**Vantera מקדימה את Atlas בשלושה דברים** שאתה חייב לייבא לפני שאתה סומך על Atlas כמנוע ההחלטה היחיד: *Dual control* (מציע ומאשר חייבים להיות שני בני אדם שונים — ב-`proposerId`/`approverId`; ל-Atlas אין את זה כלל), *Evidence hash-chain* פר-יחידה (Vantera שומרת שרשרת hash לכל בניין; ל-Atlas יש hash-chain ל-audit אבל לא ל-evidence עצמה), ו-**Kill switches** — `KILL_SWITCHES = payments|webhooksInbound|webhooksOutbound|voneMoney|aiWorkers` עם עקיפה מ-env; ל-Atlas אין שום מתג חירום גלובלי. זה חסר קריטי לפני שנותנים ל-Atlas סמכות על כסף אמיתי.

**CaseFlow מקדימה בשניים:** איסור אישור עצמי מפורש (`assertCanResolve()`: *"לא ניתן לאשר פעולה שביקשת בעצמך"* — Atlas לא אוכף היום את זה, כלומר תיאורטית אותו אדם יכול להיות גם המציע וגם המאשר), ו-TTL אוטומטי — בקשת אישור שלא נענתה תוך 24 שעות נדחית אוטומטית; ל-Atlas אין תפוגה כזו, אז בקשות יכולות להישאר תלויות לנצח.

---

## 4. מה כבר קיים בפועל בין Atlas לאפליקציות (ולא רק מתועד)

### 4.1 תבנית ה-Connector של Atlas — קיימת, עובדת, ומוכחת

Atlas כבר בנה תבנית generic ל"provider adapter" תחת `packages/integrations/<provider>/src/`, עם שלושה קבצים קבועים בכל אחד: `tools.ts` (הצהרת הפעולות האפשריות + סיווג סיכון, למשל `render.deployments.trigger` מוגדר `HIGH_RISK_WRITE, requiresApproval: true`, בעוד `render.services.read` הוא `READ_ONLY`), `to-evidence.ts` (ממפה תצפית גולמית ל-Evidence Record מנורמל עם `epistemicState`/`authorityRank`/`confidence`), ו-`feed.ts` (סיכום קריא לבן-אדם). זו בדיוק תבנית "read-first, explicit contract" שהבקשה המקורית שלך דרשה — היא כבר קיימת, בנויה נכון, ויש לה טסטים (`*.test.ts` לצד כל קובץ).

היום התבנית הזו רשומה ופעילה (`GET /api/v1/providers/adapters`) עבור: GitHub (live), Local (live), Vercel (live, עם endpoint אמיתי `POST /api/v1/feeds/vercel`), Render (live), Cloudflare (live), Supabase/MongoDB (feed בלבד, לא adapter מלא). Netlify, Sentry, Stripe, AWS/Azure/GCP מסומנים "planned" — קיימים ברשימה אבל לא ממומשים. **אף אחת מ-6 האפליקציות שלך לא ברשימה הזו.**

### 4.2 Civio — הצעד הראשון שכבר נעשה, אבל לא הושלם

`packages/integrations/civio/` הוא ניסיון החיבור הראשון והיחיד לאפליקציית-מוצר (לא תשתית ענן גנרית). המימוש נכון מבחינה אבטחתית: חתימת HMAC-SHA256 עם timestamp+nonce נגד replay (חלון 5 דקות), אורך מפתח מינימלי 32 תווים, והשוואת חתימה ב-`timingSafeEqual` (מגן מפני timing attacks) — זו בדיוק הרמה שהייתי מצפה לה בביקורת אבטחה. אבל הנתיב שהלקוח שולח אליו (`CIVIO_CONNECTOR_INGRESS_PATH`) **לא רשום בשום route חי** ב-`apps/api/src/routes/` — מופיע רק בתוך טסטים. במילים אחרות: מישהו בנה חצי מהגשר (הצד שמדבר) ולא את הצד השני (מי שמקשיב), ואז זה ננטש.

### 4.3 BrokerOS — "Proof Case #001", אבל לא דרך חיבור ייעודי

Atlas מתייחס ל-BrokerOS כ-"Golden Project" רשמי (`docs/case-studies/001-brokeros.md`, עם endpoint חי `GET /api/v1/case-studies/brokeros-001`). זה נשמע כמו החיבור הכי בשל — אבל בפועל זו קריאה חד-כיוונית: Atlas סורק את הקוד של BrokerOS (workspace walk / GitHub connector הגנרי) ומפיק verdict/certificate. BrokerOS עצמו לא שולח אליו כלום, ואין ל-Atlas גישה לאירועי runtime בזמן אמת (אישורים, עסקאות, HITL) — רק לקוד הסטטי. זו בדיוק ההבחנה בין "Atlas מבין את המערכת" לבין "Atlas מפקח על מה שקורה בה עכשיו", וכרגע יש רק את הראשון.

### 4.4 CaseFlow, HotelOS, LexStudy, Vantera — אפס חיבור טכני

לא נמצא אף route, webhook, SDK import או משתנה סביבה שמצביע על תקשורת דו-כיוונית עם Atlas בקוד שנבדק ישירות (BrokerOS, HotelOS) או בדוח הפנימי (CaseFlow, LexStudy, Vantera). זה תואם בדיוק את מה שאמרת בהודעה המקורית שלך: "בכולן חסר חיבור ועבודה".

---

## 5. עקרון הארכיטקטורה — כבר מנוסח נכון ע"י Atlas עצמו

התיעוד הנורמטיבי (`docs/architecture/managed-system.md`) קובע כלל ברור, וכדאי שתדבוק בו במודע כי הוא בדיוק העיקרון שגם אני הייתי ממליץ עליו כארכיטקט:

> "Connectors observe from the outside (Git, API, DB, CI, deploy). Atlas does not embed inside Vantera / HotelOS / CaseFlow / BrokerOS / Civio."

כלומר: Atlas **לא** אמור לגשת ישירות למסדי הנתונים של האפליקציות, ולא אמור להטמיע קוד בתוכן. במקום זה, כל אפליקציה **דוחפת (push)** אירועים מנורמלים ל-Atlas — בלי credentials, עם חתימה (כמו ש-Civio כבר עושה) — ו-Atlas שומר אותם כ-Evidence. הזרימה הרשמית היא `DISCOVER → UNDERSTAND → VERIFY → ACT`, כש-**ACT הוא תמיד אחרון**: המלצה → הערכת סיכון → policy → אישור אנושי → ביצוע → אימות → evidence. אין auto-apply לפרודקשן בברירת מחדל.

זה בדיוק העיקרון שביקשת ממני לבדוק ("Atlas לא צריך להפוך לבקאנד שני") — והתשובה היא שהוא **כבר מתוכנן ככה נכון**, אתה רק צריך לאכוף את זה בפועל בכל 6 האפליקציות, לא רק להשאיר את זה כתיעוד.

**נקודת אזהרה אחת:** ב-CaseFlow קיים מודול פנימי בשם ממש "Atlas" (`routes/atlas.js`, `services/atlas/{overviewService, auditRunnerService, readinessService, patchService, knowledgeSourceService, legalReadinessService}.js`, מיגרציות `056_engineering_audit_atlas.sql` / `057_seed_atlas_defaults.sql`, ומסך `/Atlas` תחת `apps/web-office`). זה בעצם גרסה מוקטנת ועצמאית של אותו רעיון (audit/readiness/patch) שנבנתה בתוך CaseFlow בלי קשר ל-Atlas שלך. יש כאן שתי החלטות אפשריות: (א) להשאיר את זה כפיצ'ר פנימי של CaseFlow ולתת ל-Atlas החיצוני שם אחר בממשק כדי למנוע בלבול, או (ב) לבדוק אם יש שם לוגיקה (למשל `legalReadinessService`) ששווה "למשוך" ל-Atlas הראשי כמו שכבר עשית עם vantera/CaseFlow למעלה. אני לא ממליץ למזג את שניהם טכנית בשלב הזה — זה בדיוק סוג הפרויקט שהדוח הפנימי שלך ממליץ נגדו ("לא למזג למונורפו אחד").

---

## 6. פערים קריטיים שרלוונטיים ישירות לאמון שאפשר לתת לכל אפליקציה

אלה לא כל הבאגים בפורטפוליו — רק אלה שרלוונטיים לשאלה "כמה אפשר לסמוך על המידע/הפעולות שמגיעות מהאפליקציה הזו כש-Atlas יתחיל לפקח עליה" (מקור: הדוח הפנימי מ-19.8, לא אומת מחדש):

מסד הנתונים של **HotelOS** נבנה כולו מ-84 פקודות `CREATE TABLE IF NOT EXISTS` בתוך `packages/database/src/client.ts` בלי מיגרציות אמיתיות, ואין לו הפרדת-דיירים ברמת ה-DB בכלל (libSQL לא תומך ב-RLS) — הבידוד בין מלונות/רשתות נשען כולו על כך שמישהו כתב ידנית `WHERE tenantId = ?` בכל שאילתה, וטסט האימות היחיד (`tenant-predicate.test.ts`) רק מחפש את המחרוזת `tenantId` בקובץ ולא יכול לזהות `WHERE` שגוי או `and()` חסר. זה אומר שלפני שאתה נותן ל-Atlas לבצע פעולות (ACT) על HotelOS, אתה צריך הוכחה נוספת — לא רק "יש קוד" — שהבידוד בין הלקוחות שלך אמיתי.

**HotelOS** גם סותר את עצמו בקוד: הסף הכספי ל-approval (₪2,000) מקודד פעמיים במקומות שונים (`execute-approval-act.ts:969` וגם כטקסט חופשי בפרומפט ל-LLM ב-`gateway.ts`), וכלל "5% ADR" שמוזכר בפרומפט **לא קיים בקוד בפועל** — כלומר ה-LLM עלול "להאמין" לכלל שלא אוכף שום דבר. וגם: `canApproveLedgerClose` מוגבל בפועל ל-CFO בלבד למרות שההערה בקוד אומרת שרואה חשבון גם יכול.

ב-**Civio**, תשובות AI בפורום מתפרסמות **בלי מודרציה** (`communityController.ts:~130`), ו-`auditLogMiddleware` הוא עדיין placeholder ("Later: persist to DB") — כלומר גם ה-audit log של Civio עצמו לא באמת נשמר במסד נתונים היום, מה שאומר של-Atlas אין ממה "למשוך" evidence אמין מ-Civio גם אם החיבור הטכני היה קיים.

**מסקנה מעשית:** אל תתחיל את החיבור מ-Civio (למרות שיש לו הכי הרבה קוד connector מוכן) ומ-HotelOS בו-זמנית ותצפה לאמון מלא — קודם תדע אילו Evidence אתה מקבל ואיזה confidence לתת להם. Atlas כבר תומך בזה במודל (`epistemicState: OBSERVED/UNVERIFIED/UNKNOWN`, `confidence: 0-1`) — פשוט תשתמש בזה נכון: כל evidence שמגיע מ-Civio לפני שיתוקן ה-audit log האמיתי צריך להיות מסומן confidence נמוך.

---

## 7. קוד פתוח שיכול לחסוך עבודה (במקום לבנות בעצמך)

בדקתי — ה"גלגל" שכבר בנית (evidence graph + policy gate + HITL state machine) הוא ספציפי מספיק לתחום שלך שאין תחליף drop-in מלא, אבל יש שלושה כלים בשלים שכדאי לשקול **כתחליף חלקי או השראה** לחלקים ספציפיים, במקום לבנות אותם שוב בפעם השמינית:

**Temporal** — מנוע workflow אורקסטרציה עם תמיכה מובנית ב-human-in-the-loop (signals/queries שמחכים לאישור אנושי, עם timeout מובנה) — בדיוק הפיצ'ר של TTL-אוטומטי שחסר ל-Atlas ושכבר קיים ב-CaseFlow. יש לו cookbook רשמי ל-HITL עם Python/TS. שווה לשקול רק אם ה-workflow orchestration עצמו (לא רק ה-state machine הפשוט של pending/approved) הופך למורכב — היום זה כנראה overkill, אבל אם תוסיף TTL + retries + escalation chains זה בדיוק מה שTemporal פותר valid.

**Cerbos / Open Policy Agent (OPA)** — מנועי policy-as-code מוכנים, בדיוק לסוג ההחלטה ש-`dispatchAgentAction`/`gateGovernorAction` עושים היום ב-if/else מפוזר. Cerbos נחשב היום הבחירה הפשוטה יותר להטמעה (policy files דקלרטיביים, PDP נפרד), בעוד OPA/Rego גמיש יותר אבל תלול יותר בלמידה. אם אתה רוצה ש-6 האפליקציות ישתפו *באמת* מנוע החלטה אחד (לא רק אבחון) — זה בדיוק המקום להטמיע Cerbos כ-policy decision point מרכזי ב-Atlas, במקום ה-switch/case הפנימי.

**Langfuse** (open source, self-hosted) — observability ל-LLM/agent tracing: כל קריאה לסוכן, tool call, latency, cost. זה משלים בדיוק את מה ש-Atlas כבר עושה ל-evidence סטטי, אבל לא עושה עדיין ל-**ריצה בפועל של הסוכנים עצמם** בתוך 6 האפליקציות. שילוב עם Langfuse ייתן לך תיעוד runtime אמיתי של מה שכל agent בפועל עשה — לא רק מה שהקוד *יכול* לעשות.

**המלצה:** אל תחליף את מנגנון ה-Evidence Graph של Atlas — הוא הנכס הייחודי שלך (בדיוק כמו שהדוח הפנימי שלך אומר: "לא ניתן לזייף ולא ניתן להעתיק"). אבל את שלושת החוסרים הספציפיים (TTL, dual control forcing, kill switch) אפשר לממש הכי מהר בהשראת Cerbos/Temporal בלי לאמץ את כל הפלטפורמה.

---

## 8. תוכנית מינימלית מומלצת (Minimum Viable Integration)

**שלב 0 (יום עבודה, סיכון אפס):** לרשום סוף-סוף route חי ל-Civio ingress (הצד השרתי היחיד שחסר כדי שהחיבור הראשון שכבר בנוי יעבוד בפועל), ולתקן את שני הבאגים החמורים שכבר מזוהים (`accountant` ב-HotelOS, סוד JWT קשיח ב-iq-desain — לא ברשימת ה-6 אבל אותו קוד עלול להיות מועתק).

**שלב 1 — Atlas כמקור אמת יחיד (התשואה הגבוהה ביותר, לפי הדוח הפנימי שלך):** לבנות `packages/integrations/{hotel,broker,caseflow,vantera,lexstudy}/` בדיוק לפי תבנית Civio/Render — `tools.ts` עם רשימת הפעולות המסוכנות (ל-HotelOS זה כבר קיים כ-8 autonomy kinds, כלומר עבודת מיפוי בלבד ולא עיצוב), `client.ts` עם חתימת HMAC (להעתיק מ-Civio), `to-evidence.ts`. כל אפליקציה דוחפת POST ל-Atlas בלי credentials — בדיוק כמו ה-provider adapters הקיימים.

**שלב 2 — לפני שסומכים על Atlas באופן בלעדי:** לייבא ל-Atlas את שלושת החוסרים מ-Vantera (dual control, kill switches, "forbidden" כדרגה מפורשת) ואת השניים מ-CaseFlow (איסור אישור-עצמי, TTL 24 שעות). זה תנאי, לא המלצה — בלי dual control ו-kill switch, נתינת סמכות ACT ל-Atlas על כסף אמיתי (HotelOS ledger, עמלות BrokerOS) היא סיכון תפעולי של ממש.

**שלב 3 (אחרון, יקר ביותר):** חילוץ תשתית משותפת (logger, config, error types, LLM client, UI) — רק אחרי ששלבים 0-2 עובדים על אפליקציה אחת אמיתית מקצה לקצה.

**המלצה קונקרטית להתחלה:** HotelOS, כי סוגי הפעולות כבר מוגדרים בקוד (8 autonomy kinds) — זו עבודת מיפוי טהורה, בלי החלטות עיצוב חדשות.

---

## 9. סיכונים

תלות בזמינות: ברגע שאפליקציה תדחוף Evidence ל-Atlas באופן חי, זמינות Atlas הופכת לתלות תפעולית עבורה — צריך degradation graceful (האפליקציה ממשיכה לפעול גם אם Atlas לא זמין, רק ה-evidence מתעכב).

התנגשות שמות/מותג: המודול הפנימי "Atlas" בתוך CaseFlow עלול לבלבל משתמשים ומפתחים כאחד ברגע שהחיבור האמיתי יתחיל — מומלץ להחליט מראש איך לקרוא לזה בממשק.

אמון-יתר ב-evidence לא אמין: כפי שהודגם בסעיף 6, לפחות שתי אפליקציות (Civio, HotelOS) מייצרות כרגע מידע שאסור לסמוך עליו במלואו (audit log placeholder, סתירות בסף כספי) — אם Atlas יתחיל להחליט על סמך evidence כזה בלי לסמן confidence נמוך, ה-Truth Layer עצמו הופך ללא אמין.

אי-איתור Vantera ו-LexStudy: אני לא יכול לאמת שום דבר בהן ישירות (ראה סעיף 10) — כל מה שכתוב עליהן כאן מגיע מדוח פנימי מלפני כשלושה שבועות, לא מבדיקה חיה של היום.

---

## 10. גבול היישום — מה קיים, מה מתועד, מה חסר

| רכיב | מצב | רמת עדות |
|---|---|---|
| עיקרון ארכיטקטוני (connectors מבחוץ, ACT אחרון) | **מיושם בתיעוד**, לא נאכף בקוד עדיין בכל 6 האפליקציות | DOCUMENTED |
| תבנית Connector גנרית (`tools.ts`/`to-evidence.ts`/`client.ts`) | קיימת ועובדת ל-9 ספקי תשתית | CODE EXISTS, EXECUTABLE, חלקן RUNTIME VERIFIED (github/vercel/render) |
| חיבור Civio ל-Atlas | לקוח+HMAC בנויים, **route מקבל לא רשום** | CODE EXISTS, EXECUTABLE (בטסטים בלבד), לא WIRED |
| חיבור BrokerOS ל-Atlas | קריאה חד-כיוונית דרך GitHub/local scan, לא connector ייעודי | RUNTIME VERIFIED לקריאה בלבד |
| חיבור CaseFlow / HotelOS ל-Atlas | לא נמצא | MISSING |
| חיבור Vantera / LexStudy ל-Atlas | לא ניתן לבדיקה (מיקום קוד לא אותר) | UNKNOWN |
| Dual control, TTL, kill-switch ב-Atlas | לא קיימים; קיימים בחלק מהאפליקציות המפוקחות | MISSING (proposed בסעיף 8) |
| Evidence Graph כמודל | קיים ועובד, עם epistemicState/confidence | CODE EXISTS, RUNTIME VERIFIED |

---

## 11. מה אני צריך ממך כדי להשלים את התמונה

מיקומי הקוד הנוכחיים של **Vantera** ו-**LexStudy** — הם לא נמצאים תחת `C:\Users\User\project\github\`, והנתיב הישן שמופיע בדוח הפנימי (`C:\Users\User\OneDrive\game\`) לא נגיש/לא קיים יותר באותה צורה. אם תגיד לי איפה הם היום אבדוק אותם באותה רמת פירוט כמו Civio/BrokerOS/HotelOS/CaseFlow, ואעדכן את הדוח הזה בלי לפתוח שיחה חדשה.

---

## 12. פסיקה סופית

**ATLAS INTEGRATION — READY WITH CONDITIONS**

הארכיטקטורה נכונה ומתועדת נכון, התבנית הטכנית להטמעה כבר קיימת ועובדת (הוכחה ב-9 provider adapters + חצי-מומש ב-Civio), וההוכחה שהמודל מתאים לכל 6 האפליקציות היא לא תיאורטית — היא כבר "התגלתה" באופן עצמאי שש פעמים בקוד עצמו. התנאים לפני שממליצים על ACT אמיתי (לא רק תצפית): (1) לרשום את ה-route החי הראשון (Civio), (2) לייבא ל-Atlas dual control + kill switch + TTL לפני שנותנים לו סמכות על פעולות עם כסף אמיתי, (3) לפתור את התנגשות השם "Atlas" בתוך CaseFlow, (4) לאתר ולבדוק את Vantera ו-LexStudy בפועל.
