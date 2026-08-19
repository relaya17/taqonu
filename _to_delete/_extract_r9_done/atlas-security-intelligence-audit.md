# Atlas — ביקורת אבטחה / אמינות / אינטליגנציה (Security · Reliability · Intelligence Audit)

תאריך: 18-19.08.2026
נבדק מה קיים בפועל, מה חלש, ומה חסר, לפי הצ'קליסט ששלחת (19 סעיפים). הביקורת המקורית בוצעה ע"י 4 סוכני חיפוש מקבילים, read-only לגמרי, על אשכול נושאים אחר. כל טענה מגובה ב-file:line אמיתי — לא הערכה.

**עקרון העבודה (כמו שביקשת):** קודם בדיקה, אחר כך P0, אחר כך P1, ורק בסוף יכולות חדשות.

## ✅ עדכון שישי — 6 ה-P0 מה-re-audit תוקנו בפועל (כולל עקיפת ה-Authentication)

הופעלו 6 סוכנים מקבילים, כל אחד על scope קבצים נפרד, שתיקנו את כל 6 הממצאים מ"עדכון חמישי" (עקיפת auth + 5 הדליפות/IDOR). **אימות מרוכז שביצעתי בעצמי אחרי שכולם סיימו:** `pnpm --filter @atlas/api run build` נקי (0 שגיאות), `pnpm --filter @atlas/api exec vitest run` — **66/66 קבצי בדיקה, 448/448 בדיקות ירוקות** (עלייה מ-400 לפני הסבב). אימתתי גם ידנית (grep) שאין אף call site של `requireUser`/`requireAdmin`/`requireSignedInForWrite` בלי `await` בכל הריפו — כלומר אין באג "fire-and-forget" שבו בדיקת auth נקראת אך לא נאכפת בפועל.

**מה תוקן, סעיף-סעיף:**

1. **עקיפת Authentication (הממצא הכי חמור שנמצא בסשן הזה כולו)** — נבנה `verifySupabaseAccessToken()` חדש ב-`supabase-session.ts`, שקורא בפועל ל-`client.auth.getUser(accessToken)` של Supabase (round-trip אמיתי שמאמת חתימה/תוקף/ביטול מול השרת) במקום לפענח את ה-JWT payload בלי שום בדיקה. זה חייב להפוך את כל שרשרת הזיהוי ל-async (`resolveRequestIdentity`, `getRequestUser`, ו-`requireUser`/`requireAdmin`/`requireSignedInForWrite` ב-`auth-guards.ts`) — שינוי מכני שהתפשט ל-**128 call sites** בכל קבצי ה-routes (כל route הוסיף `await` לפני קריאת ה-guard). בדיקות חדשות מוכיחות: (א) טוקן מזויף עם `sub`/`atlas_role:"admin"` שרירותיים נדחה עכשיו, (ב) טוקן אמיתי (מדומה כראוי מול Supabase SDK) עדיין מתקבל. **טרייד-אוף כן שדווח:** כל בקשה בנתיב Supabase-live עושה עכשיו round-trip רשת אחד ל-Supabase Auth (אין caching) — עלות הכרחית של אימות אמיתי; אם זה יהפוך ל-bottleneck מדוד, cache קצר-TTL הוא צעד המשך סביר. **נמצא ולא תוקן (מחוץ להיקף, ראוי למעקב):** `POST /api/v1/auth/oauth/sync` עדיין קורא ל-`readAccessTokenClaims` הלא-מאומת על טוקן מסופק-לקוח כדי להחליט על עדכון role באותו רגע (התיקון חוסם ניצול המשכי דרך ה-cookie, אבל לא את הרגע הזה עצמו).
2. **`agent-fabric.ts` — `/agents/plan`+`/agents/dispatch`** — נוסף `requireSignedInForWrite` + `ownerId` מוזרם ל-`buildMemoryContext`. 18 בדיקות, כולל בדיקת בידוד חוצה-דיירים אמיתית (owner A/B).
3. **`agent.ts` — `/agent/runs` + באג ה-redaction** — `resolveCloudIdentity` הועבר להיות ללא-תנאי (במקום רק בתוך בלוק "learn memory"), `ownerId` מוזרם ל-`buildMemoryContext`. באג ה-shadowing תוקן: `redactSecrets` מחושב **פעם אחת** ומשמש בכל מקום (כולל הקריאה ל-`persistArletosAgentMemory`), לא רק במשתנה מקומי שהיה ננטש. בדיקה חדשה מוכיחה ש-secret מזויף (`sk-live-...`) לא מגיע יותר ל-Memory הנשמר.
4. **`conversation.ts`+`qa.ts`** — 5 handlers חסרי-auth תוקנו (`/conversation/message`, `/qa/learn` POST+DELETE, `/qa/runs`, `/qa/process-audit`), `ownerId` מוזרם היכן שרלוונטי. `qa/process-audit` גם קיבל בדיקת בעלות פרויקט אמיתית (`assertProjectWriteAccess`, אותו pattern כמו `code.ts`). **נמצא ולא תוקן (מחוץ להיקף):** `GET /conversation/threads/:threadId`, `GET /qa/runs`, `GET /qa/patterns` עדיין ציבוריים — לא היו ברשימת התיקון המקורית, ראוי סבב המשך.
5. **`GET /api/v1/events`** — הוחלט (ותועד בבירור למה) על `requireAdmin` ולא סינון per-tenant, כי גילוי אמיתי: `appendDomainEvent()` כותב `ownerId: STUB_OWNER_ID` קבוע כמעט בכל מקום (רק test file חורג) — סינון לפי שדה שלא מאוכלס אמיתי היה או מדליף הכל או מסתיר הכל. תיקון אמיתי ל-per-tenant דורש לשנות את `appendDomainEvent` ב-~25 call sites — סומן כעבודת המשך נפרדת ומשמעותית, לא בוצע כאן.
6. **`POST /api/v1/memory/:id/approve`** — `requireSignedInForWrite` + `ownerId` דרך `approveMemory()` החדש. **תפיסה חשובה שהסוכן עצמו מצא תוך כדי:** ההוראה המקורית (להעביר `ownerId` ל-`getMemories`) הייתה גורמת לבאג איבוד-נתונים אמיתי (כתיבה חוזרה של רשימה מסוננת הייתה מוחקת memories של בעלים אחרים). הסוכן זיהה זאת בעצמו ותיקן אחרת (בדיקת בעלות ידנית לפני מוטציה, כתיבה חוזרת של הרשימה המלאה) — עם בדיקת רגרסיה ייעודית שמוודאת ששני הבעלים נשארים שלמים.
7. **`decisions.ts`** — `requireUser` נוסף ל-`POST /decisions`+`/decisions/:id/transition`; נוסף cap חדש (`capEpistemicStateAtCreate`, בהשראת `capEpistemicStateForSource` של Memory) שמונע מלקוח לקבוע `epistemicState:CONFIRMED` בזמן יצירה — מוגבל ל-`PROPOSED` לכל היותר. נתיב הקידום האמיתי (`/transition` ל-ACTIVE) ממשיך לעבוד, רק דורש auth עכשיו.

**נמצאה ותועדה, לא תוקנה בסבב הזה (P1, מחוץ להיקף):** ל-`approveMemory()` עדיין אין שום דרישת evidence לפני קידום ל-CONFIRMED (כל memory, גם בלי evidence, ניתן לאישור).

**כל 53 הקבצים שהשתנו (כולל 128 call sites שקיבלו `await`) סונכרנו למחשב שלך ואומתו byte-for-byte.**

## ✅ עדכון — כל 8 ממצאי ה-P0 תוקנו בפועל

לאחר הביקורת ביקשת "תסיים הכל עם כמה סוכנים". הופעלו 7 סוכנים מקבילים, כל אחד על scope קבצים נפרד (כדי למנוע התנגשויות), שתקנו את כל 8 ממצאי ה-P0 בקוד אמיתי, עם בדיקות. אחרי שהסוכנים סיימו נמצאו כמה נקודות קצה שהוחמצו (call sites נוספים שבנו אובייקטי Memory בלי `ownerId` החדש) — אלה תוקנו ישירות על ידי. **אימות מרוכז סופי שביצעתי בעצמי:** build נקי לכל החבילות שנגעו, typecheck נקי (`apps/api`, `apps/worker`), **660/660 בדיקות ירוקות בסך הכל** (`packages/shared` 77/77, `packages/agent-core` 246/246, `packages/database` 11/11, `apps/worker` 7/7, `apps/api` 319/319) — אפס רגרסיות. 40 קבצים סונכרנו למחשב שלך ואומתו byte-for-byte.

**מה תוקן, סעיף-סעיף (ראו הפרטים המקוריים בטבלאות למטה — כל שורת P0 מתויגת עכשיו ✅):**
1. **הרשאת קריאה** — `GET` על projects/decisions/artifacts/memories דורש עכשיו `requireUser`/בעלות אמיתית; admin עוקף.
2. **`connections.ts`** — כל הנתיבים דורשים עכשיו הרשאה, טוקן GitHub scoped per-owner.
3. **`ownerId` בסכמת Memory** — הפך לשדה חובה (`memorySchema`), עם תיקון לכל 6 נקודות הבנייה של Memory בקוד (כולל 2 שהסוכנים החמיצו ותוקנו ישירות: `arletos-agent-memory.ts`, `central-opinion.ts`, `demo-seed.ts`, ו-`packages/database`'s `mapMemory`/hydrate).
4. **Redaction** — `redactSecrets`/`detectSecrets` מחוברים עכשיו ל-`POST /api/v1/memory`.
5. **שער אימות FACT** — `capEpistemicStateForSource()` חדש: sourceType לא-מאומת לא יכול יותר לטעון FACT/VERIFIED/CONFIRMED ישירות; רק `approveMemory()` יכול לקדם.
6. **Worker** — try/catch אמיתי + retry+backoff+dead-letter; job בודד שנכשל כבר לא מפיל את התהליך (נבדק: "does not crash the process when a job throws, and retries it").
7. **Risk Engine + Policy Engine** — מחוברים עכשיו ל-`code.ts`'s patch apply/rollback (הנתיב שהביקורת המליצה להתחיל ממנו).
8. **`actorId` אמיתי ב-audit** — מוחדר עכשיו כ-`payload.actorId` דרך `patch-write.ts`, ונקרא בפועל ב-`event-rules.ts`/`automation-rules.ts` במקום `null` קבוע. גם `causationId` נוסף לסכמת ה-audit המאוחד.
   *(הערה כנה: `gates.ts`/`readiness.ts` עדיין לא מזינים actorId כי אין להם עדיין guard הרשאה בכלל — זה חור נפרד, לא "תוקן חלקית" אלא תועד ככזה בקוד עצמו.)*
9. **`/health`** — נבדק DB אמיתי עכשיו (`health-check.ts` חדש), מחזיר סטטוס פר-רכיב.
10. **E2E כשלים** — נוסף `e2e/failure-paths.spec.ts` (לא ניתן להריץ בענן הזה כי ל-`apps/web` אין node_modules מותקן — נכתב ומוכן להרצה ב-CI/במחשב שלך).

## ✅ עדכון שני — כל 11 ממצאי ה-P1 תוקנו בפועל

הופעלו 8 סוכנים מקבילים נוספים, שוב כל אחד על scope קבצים נפרד. **אימות מרוכז סופי שביצעתי בעצמי (build+typecheck+טסטים בכל חבילה שנגעה):** אפס רגרסיות, **785/785 בדיקות ירוקות בסך הכל** (`packages/shared` 83/83, `packages/agent-core` 263/263, `packages/observability` 31/31, `packages/database` 11/11, `apps/worker` 7/7, `apps/api` 390/390 — עלייה מ-660 לפני הסבב). 46 קבצים (כולל `pnpm-lock.yaml`) סונכרנו למחשב שלך ואומתו byte-for-byte.

**מה תוקן:**
1. **MFA** — TOTP אמיתי (`otplib`), דו-שלבי (setup→confirm), backup codes מגובבים (לא plaintext), `login` עם MFA מופעל מחזיר `mfaRequired`+טוקן זמני במקום session, `/mfa/verify` משלים. מדיניות אדמין: לא ניתן להעניק role=admin למשתמש בלי MFA מופעל כבר (עם exemption מתועד ל-bootstrap admin).
2. **Rate limiting גלובלי** — `@fastify/rate-limit`, 300 בקשות/דקה per-IP, לא מחליף (משלים) את המגביל הצר הקיים על auth. + hook latency גלובלי (`http_request_duration_ms` על כל בקשה, לא רק 2 נתיבים כמו קודם).
3. **כיסוי Policy Engine הורחב** — `kernel.ts`, `remediation.ts`, `byo-cloud.ts`, `gates.ts`, `readiness.ts` — כולל תיקון אגבי לפער מהסבב הקודם: ל-`gates.ts`/`readiness.ts` לא הייתה שום הרשאה בכלל, ועכשיו יש גם הרשאה וגם actorId אמיתי ב-audit (סוגר את ההערה הכנה מהסבב הקודם).
4. **Idempotency + דה-דופ אירועים** — `event-bus.ts` לא שולח אירוע כפול (FIFO 1000 אחרונים), ו-`automation-engine.ts` מוסיף שכבה עצמאית שנייה שמונעת הרצה כפולה של אותו (rule, event) גם אם ה-bus איכשהו לא תפס.
5. **Metrics אמיתיים** — היסטוגרמות אמיתיות (p50/p95/p99, `_bucket`/`_sum`/`_count` בפורמט Prometheus תקני) במקום ring-buffer מזויף. + error aggregator חדש (dedup לפי code+normalized-message, לא stack trace מלא).
6. **Cost-aware routing + דה-דופ קריאות LLM** — `genius.ts` מוריד עכשיו רמת מודל אם המודל היקר מגמתי חורג מ-3× העלות של מודל זול תואם-יכולת, או ששיעור השגיאות שלו מעל 50%. + cache קצר-TTL (45 שניות) למניעת קריאת LLM כפולה לאותה בקשה בדיוק.
7. **Confidence אמיתי ב-research.ts** — ציון לפי סוג-מקור אמיתי (אמנה/גוף רשמי > ממשלה > אוניברסיטה) והתאמת נושא מדויקת מול רופפת, לא `0.7` קבוע. מעולם לא מגיע ל-FACT/VERIFIED (רק OBSERVED/INFERRED/ASSUMED) — כנות לגבי מה שבאמת ניתן לאמת בנתיב הזה.
8. **Memory per-agent scoping + audit per-owner tagging** — שדות `agentId`/`allowedAgents` חדשים (אופציונליים, לא שוברים התנהגות קיימת) ב-Memory; `listUnifiedAuditEntries({ownerId})` חדש לסינון audit trail לפי טננט.

**מה עדיין פתוח מכוונה:** יחס בדיקות happy/failure ביחידה (שיפור אורגני, לא תיקון בודד), והערת ה-RLS/service-role ב-DB (אילוץ ארכיטקטוני, מוקהה ע"י תיקוני ה-P0). שני אלה תועדו כלא-מיועדים לתיקון סבב זה.

## ✅ עדכון שלישי — apps/web נפתח (node_modules הותקן), נמצאו ותוקנו 3 באגי נגישות אמיתיים

בסבב "בצע הכל מהכל" (מסמך `atlas-gap-analysis.md` מפרט את חמשת הסוכנים המלאים), `pnpm install --filter @atlas/web...` פתר את המגבלה שחסמה כל בדיקת frontend אמיתית בסביבה הזו. זה אפשר בפעם הראשונה בסשן הרצת e2e חיה אמיתית עם `@axe-core/playwright` (סריקת WCAG 2.2 AA אמיתית, לא רק בדיקות ידניות) — נמצאו 3 באגי נגישות אמיתיים, כולם תוקנו: מבנה רשימה שגוי (`AppShell.tsx`, חסר `<li>`-עטיפה — WCAG 1.3.1), קונטרסט h1 בדף הבית (התברר כ-frame באמצע אנימציית fade-in, לא צבע קבוע שגוי — תוקן בהסרת ה-`opacity` מה-keyframe), וקונטרסט Chip של warning (טקסט לבן נכשל ב-4.5:1 בשני המצבים; הוחלף ל-`contrastText: "#1A1C22"` מפורש). פירוט מלא + מספרי הקונטרסט המדויקים במסמך ה-gap-analysis.

זה גם חשף (ולא תוקן — מחוץ להיקף) 2 באגים אמיתיים ב-`.github/workflows/e2e-critical-path.yml`: production secrets לדוגמה שיפילו את השרת בפועל דרך `assertNotExampleSecrets()`, והיוריסטיקת `isLiveSupabase()` שתגרום ל-health-check polling ב-CI להיתקע. ראו gap-analysis.md לפרטים.

## 🔴 עדכון רביעי — Re-audit ממוקד לפי בקשתך: "STOP CODING → RE-AUDIT ONLY → RESOLVE CONTRADICTIONS → VERIFIED P0 LIST → WAIT FOR APPROVAL"

**שום קוד לא שונה בסבב הזה.** 6 סוכני חקירה read-only-בלבד (אסור להם לכתוב/לערוך קבצים) רצו במקביל על 4 השאלות שהצבת (Authorization end-to-end, Memory isolation, Memory poisoning, Secrets) + חיבור אמיתי של Policy+Risק + מיפוי Event Bus (אינפורמטיבי, עדיפות נמוכה כמו שביקשת). **אחר כך אימתתי אישית, עם ציטוטי file:line שקראתי בעצמי (לא רק "האמנתי לסוכן"), את 5 הממצאים החמורים ביותר ומצאתי גם סתירה אחת של סוכן מול המציאות בקוד (מפורט למטה).**

### רשימת P0 מאומתת אישית (קראתי את הקוד בעצמי, לא רק דוח הסוכן)

1. **דליפת memory חוצת-דיירים ללא אימות בכלל** — `apps/api/src/routes/agent-fabric.ts:100` (`POST /agents/plan`) ו-`:162` (`POST /agents/dispatch`) — קראתי את שני ה-handlers: אין שום `requireUser`/`requireSignedInForWrite` בהם (יש רק על נתיבי `/knowledge/*` באותו קובץ). הם קוראים ל-`buildMemoryContext()` בלי `ownerId`, ו-`os-store.ts`'s `getMemories()` עצמו כולל תיעוד מפורש: *"Any caller reachable from an HTTP route MUST pass ownerId — this is the actual enforcement point"* — תיעוד שהופר כאן. תוכן ה-`statement` המלא של memories של דיירים אחרים חוזר גם ב-response וגם נכתב ל-domain event.
2. **`GET /api/v1/events` — פומבי לגמרי, מדליף memory statements של כל הדיירים** — קראתי את `apps/api/src/routes/events.ts` במלואו (40 שורות): אין שום import של auth guard בקובץ, אין סינון owner בכלל. זה חושף בעיה עמוקה יותר: גם אם `GET /api/v1/memory` מסונן נכון לפי owner, ה-route הזה עוקף את ההגנה לגמרי כי אירועי `memory.created`/`observation.recorded` נושאים את תוכן ה-`statement` המלא ב-payload.
3. **`POST /api/v1/memory/:id/approve` — ללא אימות, ללא בדיקת בעלות (IDOR)** — קראתי את `memory.ts:187-217`: אין `requireUser`. קראתי גם את `approveMemory()` ב-`memory-pipeline.ts:343`: קורא ל-`getMemories(k)` **בלי** ownerId. כל תוקף שמנחש UUID של memory יכול לקדם memory של דייר אחר ל-CONFIRMED, בלי שום ייחוס (לא נרשם מי אישר).
4. **דליפת secrets לתוך memory קבועה — לא "חסר redaction", אלא באג shadowing אמיתי** — קראתי את `apps/api/src/routes/agent.ts`: בשורה 252 יש `const userRequest = redactSecrets(body.userRequest)`, אבל בשורה 451 (הקריאה ל-`persistArletosAgentMemory`) מועבר **`body.userRequest` הגולמי**, לא המשתנה המסונן. כל secret שמשתמש מדביק בצ'אט עם הסוכן המובנה נשמר כמו שהוא ב-memory חוצה-session, ומסונכרן ל-Supabase — בלי שום job שסורק מחדש נתונים קיימים.
5. **`POST /api/v1/decisions` — ללא אימות בכלל, ומאפשר `epistemicState: CONFIRMED` ישירות מהלקוח** — קראתי את `decisions.ts:85-125`: אין `requireUser`. בניגוד ל-Memory (שיש לו `capEpistemicStateForSource`), כאן `body.epistemicState` מהלקוח עובר ישר, בלי שום cap לפי מקור — זהו האנלוג של "memory poisoning" עבור Decisions, ולא סגור.

### סתירה שמצאתי ותיקנתי בעצמי (בדיוק הדוגמה שביקשת שלא אתן לדוח "להיאמן" בלי בדיקה)

הסוכן שמיפה את ה-Event Bus דיווח: *"gates.ts POST /evaluate ... have no auth guard... actorId null"* — **זה שגוי**. קראתי את `gates.ts` בעצמי: יש `requireSignedInForWrite` (שורה 27) ו-`actorId: user.id` נשלח בפועל ב-event (שורה 66). הסוכן פשוט העתיק הערת קוד ישנה שנשארה ב-`automation-rules.ts` (מהסבב הקודם, לפני שגם gates.ts קיבל auth guard בסבב ה-P1) בלי לבדוק את gates.ts עצמו. **המצב האמיתי:** actorId כן מוזרם נכון (תיקנתי, זה P2 לא P1). הפער האמיתי היחיד שנשאר שם: `ownerId: null` נשאר hardcoded תמיד ב-2 מתוך 3 חוקים — לא בעיית אבטחה (actorId, הייחוס העיקרי, תקין), רק שדה תיוג-דייר משני שלא מולא. הורדתי את זה ל-P2.

### תיקון נוסף לתיעוד קודם — טענת "Risk Engine מחובר ל-11 routes" מוגזמת

בדקתי: מנוע הניקוד המספרי (`computeActionRiskScore`/`bucketForRiskScore`, ה-buckets ALLOW/BLOCK/APPROVAL/HUMAN_ONLY) **מיובא ומופעל רק בקובץ אחד — `code.ts`**. עשרת ה-routes האחרים (`kernel.ts` [חלקית: רק 2 מתוך 13 handlers], `remediation.ts`, `byo-cloud.ts`, `gates.ts`, `readiness.ts`, `graph.ts`, `portfolio.ts` [חלקית], `admin-ops.ts`, `engineering-audit.ts`, `billing.ts`) משתמשים רק בשכבת המדיניות הקטגורית (`authorizeEntityAction` → ALLOWED/DENIED/APPROVAL_REQUIRED), **לא** בניקוד סיכון מספרי. זה עדיין real enforcement — אבל התיאור הקודם "Risk Engine מחובר" היה לא מדויק לגבי 10 מתוך 11.

### הליבה של שלב 2 שביקשת ("לחבר באמת את Policy+Risk") — ממצא ארכיטקטוני מרכזי

**אין dispatcher מרכזי אחד** שדרכו כל פעולת agent/tool עוברת אוטומטית Identity→Policy→Risk→Decision→Execute→Verify→Audit. האכיפה היום היא **100% משמעת של כותב ה-route, לא ארכיטקטורה**: כל route שמישהו שכח להוסיף לו `authorizeEntityAction` — פשוט לא נאכף. אימתתי שני ממצאים קריטיים של הסוכן:
- `assertAuthorized()` — הפונקציה **היחידה** בשכבת ה-tool-policy שבאמת `throw`-ת (חוסמת) — היא **קוד מת**, אין לה אף call site אמיתי בפרודקשן.
- `authorizeToolCall()` מחושב ומוצג ב-response כ-`authorizationPreview` (ב-`agent.ts`, `conversation.ts`) — אבל שום `if` לא בודק את התוצאה שלו כדי לחסום בפועל. זה נראה כמו אכיפה בתגובת ה-API, אבל זו רק תצוגה.
- מסלול ה-dispatch האמיתי של agent (`agent-fabric.ts` → `orchestrator/dispatch.ts`) — 0 קריאות ל-`authorizeEntityAction` או לניקוד סיכון בכלל. כרגע ה-specialists שם הם read-only stubs, אז אין נזק בפועל היום — אבל אין שום דבר בארכיטקטורה שהיה עוצר specialist עתידי עם יכולת כתיבה.

### ממצאים נוספים שדווחו ע"י הסוכנים (ציטוטי file:line קיימים, לא אומתו על ידי אחד-אחד אישית — מומלץ spot-check נוסף לפני תיקון)

- **Memory isolation:** `agentId`/`allowedAgents` (שדות ה-P1) קיימים בסכמה אבל אכיפה אמיתית (`isVisibleToAgent`) קיימת רק בפונקציה אחת, והיא no-op אלא אם הקורא *בוחר* לספק `agentId` בעצמו (לא מאומת) — ומ-5 ה-routes שקוראים ל-agent, אף אחד לא מעביר את זה. בפועל: שדה דקורטיבי, לא בקרת גישה אמיתית.
- **`projectId` isolation** לא נאכף בכלל ב-`memory.ts`/`agent.ts`/`agent-fabric.ts`/`conversation.ts`/`qa.ts` (0 שימושים ב-`project-access.ts`'s helpers שם) — לעומת routes אחרים (decisions/projects/code) שכן משתמשים בו.
- **אין שום שדה/מסלול provenance-verification** ל-Memory (מי אישר/אימת) — ל-Evidence ול-Patch יש `verifiedAt`/`approvedBy`, ל-Memory אין.
- **routes נוספים ללא auth בכלל** (דווח ע"י סוכן, לא אומת אישית שורה-שורה): `conflicts.ts:122`, `evidence.ts:26`, `state.ts:27`, `qa.ts:216,235,376`, `experts.ts:53`, `conversation.ts:112`, `portfolio.ts:200`, `kernel.ts:92,257,279`, `metrics.ts:68`.
- **routes עם mutation אך ללא policy/risk gate כלל** (לא בהכרח חסרי-auth): `plugins.ts` (install/enable/uninstall — 6 mutators), `connections.ts`, `github.ts`, `engineering-loop.ts`, `agent-lifecycle.ts`.
- **Event Bus / automation rules**: dedup תקין, actorId אמיתי בפועל (אחרי התיקון שלי לסתירה למעלה) — אבל אף חוק לא בודק Policy/Risk לפני שהוא פועל (מכוון, "system-triggered", אבל עדיין פער אמיתי אם חוק עתידי יעשה יותר מ-audit-log). "Expected vs Actual" (שלב 4 שהצעת) — greenfield לגמרי, לא קיים כלל, לא נשכח.

### לא בוצע שום תיקון קוד בסבב הזה — ממתין לאישורך

לפי ההוראה שלך: STOP CODING → RE-AUDIT → RESOLVE CONTRADICTIONS → VERIFIED P0 LIST → WAIT FOR APPROVAL. זה בדיוק מה שבוצע. שום route/schema/service לא שונה. מחכה להנחיה שלך על סדר התיקון (מומלץ: קודם 5 ה-P0 המאומתים אישית למעלה, במיוחד #1+#2 שהן דליפות חוצות-דיירים ללא אימות בכלל — הן החמורות ביותר כי הן לא דורשות שום credential בצד התוקף).

## 🔴🔴 עדכון חמישי — Step 0 Verification (13 סעיפים, בלי לשנות קוד) — נמצא ממצא חדש שחמור מכל מה שנמצא עד כה

לפי בקשתך המפורשת: **שום קוד לא שונה בסבב הזה.** בדקתי אחד-אחד את 13 הסעיפים שביקשת, עם קריאת קוד אישית (לא רק דיווח סוכן) על הפריטים שלא כוסו עד עכשיו — Authentication, Connections, Worker, Health. תוך כדי הבדיקה של **Authentication** (סעיף 1) נתקלתי בממצא שלא היה חלק מאף ביקורת קודמת, והוא **חמור יותר מכל 5 ה-P0 שדווחו בעדכון הקודם ביחד** — כי הוא שובר את ההנחה שכל שאר הבדיקות (ownership, tenant isolation וכו') נשענות עליה.

### 🔴 הממצא החדש: עקיפת Authentication מלאה + הסלמת הרשאות ל-admin — ללא צורך בשום credential

קראתי את שרשרת הזיהוי בשלמותה: `apps/api/src/middleware/auth-guards.ts` → `apps/api/src/services/resolve-identity.ts` → `apps/api/src/services/identity-reconcile.ts`.

**מה מצאתי:** כשה-deployment מוגדר מול Supabase אמיתי (`isLiveSupabase()` — המצב הרגיל בפרודקשן, לא מצב offline/dev), מקור הזהות המועדף הוא `atlas_sb_session` cookie. `readAccessTokenClaims()` (`identity-reconcile.ts:53-56`, התיעוד בקוד עצמו אומר את זה במפורש: *"Read... from a Supabase JWT **without verifying the signature**"*) פשוט מפענח base64 את ה-payload של הטוקן **בלי שום בדיקת חתימה קריפטוגרפית** — לא `jwt.verify`, לא קריאה חזרה ל-Supabase לאימות, שום דבר (חיפשתי `jsonwebtoken`/`jose`/`jwt.verify` בכל הריפו — 0 תוצאות, הספריות אפילו לא מותקנות).

ה-cookie עצמו (`readSupabaseSessionCookie`, `supabase-session.ts:190-208`) הוא JSON גולמי שנקרא ישירות מה-header `Cookie` שהלקוח שולח — ואף שהוא מוגדר `HttpOnly` (מונע גישה מ-JS בדפדפן), **שום דבר לא מונע מלקוח HTTP גולמי (curl/Postman/סקריפט) לשלוח כל ערך שהוא ל-header הזה**. HttpOnly מגן רק מפני XSS בדפדפן — הוא לא בדיקת אבטחה בצד השרת.

**כלומר, בפועל:** תוקף יכול לשלוח בקשה עם `Cookie: atlas_sb_session={"accessToken":"x.<base64-של-{"sub":"<כל-uuid>","app_metadata":{"atlas_role":"admin"},"exp":<עתידי>}>","expiresAt":<עתידי>}` — ולקבל בחזרה זהות `admin` מלאה, עם `id` שהוא בוחר בעצמו (יכול להיות uuid מומצא, או אפילו ה-id של משתמש אמיתי קיים אם הוא ידוע/מנוחש), **בלי סיסמה, בלי טוקן אמיתי, בלי שום דבר מ-Supabase בכלל**. אימתתי גם ש-`authUserSchema`'s `id` הוא רק `uuidSchema` (בדיקת פורמט, לא אימות) — כל UUID תקין עובר.

זה פוגע ב-`requireUser`/`requireAdmin`/`requireSignedInForWrite` **כולם**, כי כולם בסופו של דבר קוראים ל-`getRequestUser` שמסתמך על השרשרת הזו. **כל route שבדקתי בסבבים הקודמים כ"מוגן היטב" (code.ts, decisions.ts GET, projects.ts, kernel.ts) — מוגן רק מפני משתמש לא-מזוהה, לא מפני זהות מזויפת.**

**חשוב, להשוואה — הנתיב המקומי (`atlas_session`, offline/dev fallback) תקין:** `peekSession()` (`auth-store.ts:691-720`) כן עושה HMAC-SHA256 אמיתי עם `timingSafeEqual`, נגד `COOKIE_SECRET`. הבעיה קיימת **רק** בנתיב Supabase-live — שהוא בדיוק המצב שאמור לרוץ בפרודקשן אמיתי.

**חומרה: P0 קריטי ביותר — גבוה משמעותית מכל מה שדווח עד כה, כי הוא לא "נתיב אחד ללא הרשאה" אלא עקיפה מלאה של המנגנון שכל שאר הבדיקות (ownership, tenant isolation, admin-gating) מניחות שהוא אמיתי.**

### טבלת Verification — 13 הסעיפים שביקשת

| # | סעיף | סטטוס | הסבר קצר |
|---|---|---|---|
| 1 | **Authentication** | **EXISTS BUT NOT ENFORCED** 🔴🔴 | תשתית session/cookie קיימת, אך שלב אימות החתימה עצמו לא קורה בנתיב Supabase-live — הממצא החדש למעלה. הנתיב המקומי (offline) תקין (HMAC אמיתי). |
| 2 | **Authorization** (`authorizeEntityAction`) | **PARTIAL** | מנגנון אמיתי קיים, מחובר ידנית ל-~11 מתוך ~55 קבצי route; רוב ה-mutating routes האחרים (0 קריאות); מסלול ה-agent dispatch המרכזי לא עובר דרכו בכלל. |
| 3 | **Project ownership** | **PARTIAL** | `project-access.ts` הגיוני ואמיתי, אכוף ב-~10 קבצי route (projects/decisions/code/systems/db-feeds/deploy-feeds/remediation/provider-adapters/observer/sentinel); לא נאכף כלל ב-memory/agent/agent-fabric/conversation/qa. |
| 4 | **Memory ownership** | **PARTIAL** | `ownerId` חובה בסכמה ונאכף כש-`getMemories()` מקבל אותו; אבל `agent-fabric.ts`'s `/agents/plan`+`/dispatch`, `agent.ts`'s `/agent/runs`, `conversation.ts`, `qa.ts` קוראים ל-`buildMemoryContext()` בלי להעביר אותו — דליפה חוצת-דיירים אמיתית (P0-1 בעדכון הקודם). |
| 5 | **Connections authorization** | **PARTIAL** | קראתי את `connections.ts` בשלמות: כל 6 ה-mutating routes כן קוראים ל-`requireUser`/`requireSignedInForWrite` (אימות + בעלות תקינים). חסר: `authorizeEntityAction`/risk — כמו רוב הראוטים האחרים. |
| 6 | **Memory secret redaction** | **PARTIAL** | `POST /api/v1/memory` עצמו כן קורא `redactSecrets` (מאומת). אבל 4 מתוך 5 נתיבי כתיבה אחרים לא — כולל `agent.ts`'s זרימת agent-chat, שבה יש אפילו באג shadowing מפורש (עדכון קודם: משתנה מסונן נוצר ואף פעם לא נשלח לפונקציית השמירה). |
| 7 | **FACT verification** | **PARTIAL** | ה-cap (`capEpistemicStateForSource`) EXISTS AND ENFORCED על הנתיב היחיד שחשוף ללקוח. אבל `approveMemory()` (מקדם ל-CONFIRMED) — ללא auth, ללא בדיקת evidence בכלל. |
| 8 | **Risk enforcement** (ניקוד מספרי 0-100) | **EXISTS BUT NOT ENFORCED** | `computeActionRiskScore`/`bucketForRiskScore` קיימים ועובדים, אך מיובאים ומופעלים **בקובץ אחד בלבד** (`code.ts`) מתוך כל האפליקציה. |
| 9 | **Policy enforcement** (tool-level) | **EXISTS BUT NOT ENFORCED** | `DEFAULT_TOOL_POLICIES` קיים כמטא-דאטה; `assertAuthorized()` — הפונקציה היחידה שבאמת חוסמת — קוד מת, 0 call sites בפרודקשן; `authorizeToolCall()` מוצג כ-preview בתגובת ה-API בלי שנבדק בפועל. |
| 10 | **Worker failure handling** | **EXISTS AND ENFORCED** ✅ | קראתי את `apps/worker/src/index.ts` בשלמות: try/catch אמיתי, retry עם exponential backoff, bounded ל-3 ניסיונות, לוג `job_permanently_failed` כן קורה (לא נעלם בשקט). מגבלה כנה ומתועדת: התור הוא in-memory בלבד (לא durable) — לא מוסתר, מתועד בקוד. |
| 11 | **Audit actor identity** | **PARTIAL** | actorId אמיתי ב-~6 routes (code/kernel[חלקי]/gates/readiness/engineering-audit); null/חסר ברוב האחרים. **הערה קריטית לאור ממצא #1:** גם כשה-actorId "אמיתי", הוא מבוסס על הזהות שהתקבלה מהשרשרת השבורה — כלומר ניתן לזיוף גם הוא. |
| 12 | **Health checks** | **PARTIAL** | DB ו-LLM providers נבדקים אמיתי (`checkDatabase`/`checkLlmProviders`). Worker מדווח `UNKNOWN` בכנות (״API ו-worker הם תהליכים נפרדים, אין ערוץ health משותף״) — לא מזויף כ-HEALTHY, זו הגינות, לא באג. |
| 13 | **Tenant isolation** | **EXISTS BUT NOT ENFORCED** | קיימים מנגנוני isolation אמיתיים (ownerId filtering, project ownership) שעובדים כש-caller משתמש בהם נכון — אבל (א) יש נתיבים אמיתיים שעוקפים אותם (סעיף 4), ו-(ב) ממצא #1 הופך את כל ההנחה למותנית: אם אפשר להתחזות לכל user, אין tenant isolation אמיתי מול תוקף נחוש. |

**FALSE POSITIVE:** לא נמצא אף אחד מבין 13 הסעיפים עצמם. (התיקון היחיד מהסוג הזה בסבב הזה היה בעדכון הקודם — טענת סוכן שגויה על `gates.ts`, שכבר תוקנה שם.)

### מה זה אומר בפועל

ממצא #1 משנה את סדר העדיפויות שהצעתי בעדכון הקודם: **הוא צריך לבוא לפני הכל**, כולל לפני 5 ה-P0 שכבר דווחו — כי תיקון "דליפת memory ב-`/agents/plan`" למשל לא שווה הרבה אם אפשר גם ככה להתחזות לכל user ולקרוא ל-`GET /api/v1/memory` הרגיל עם הזהות שלו. אין המלצה לתיקון כאן — רק verification, כמו שביקשת. **שום קוד לא שונה.** מחכה להנחיה שלך.

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
