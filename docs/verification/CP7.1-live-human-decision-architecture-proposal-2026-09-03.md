# CP7.1 — Architecture Decision: `LIVE_HUMAN_DECISION` execution path
**תאריך: 2026-09-03**
**סטטוס: הצעת ארכיטקטורה בלבד. אין קוד, אין commit. ממתין לאישורך לפני מעבר ל-CP7.2.**
**`admin-ops.ts` הלא-committed: לא נגעתי בו. נשאר מבודד כפי שביקשת.**

---

## תמצית ההצעה

**אופציה 1 המבוקרת: endpoint אטומי חדש "decide-and-execute" עבור בקשות ברמת HUMAN_ONLY, שמחליף — לבקשות מהסוג הזה בלבד — את דפוס "decide עכשיו, execute מאוחר יותר עם approvalId" הקיים.**

התובנה המרכזית: ההבדל האמיתי בין "Approval Token Replay" ל-"Live Human Decision" הוא לא סוג ה-proof אלא **הטופולוגיה של הבקשה**. כל עוד "לאשר" ו-"לבצע" הן שתי קריאות HTTP נפרדות המחוברות רק ע"י `approvalId` משותף, אין דרך אמינה להבדיל בין אדם שממש עכשיו לוחץ "אשר והרץ" לבין אוטומציה שמצאה approvalId ישן ומנסה אותו. הפתרון הוא לא "טוקן קריפטוגרפי חדש שצריך להמציא" — הוא **לבטל את קיומו של token להעביר** עבור הפעולות האלה: ה-decide וה-execute קורים באותה קריאת HTTP אחת, מאותה session אנושית מאומתת חיה, ואף פעם לא נחשפת ל-caller חיצוני מדינה "APPROVED, ממתין למימוש" שאפשר "לשחק אליה" מאוחר יותר.

זה עונה בדיוק על ה-proof שביקשת: ה"הוכחה הקריפטוגרפית/דומיינית" היא ה-session/JWT האנושי הקיים, **מאומת באותו רגע ממש**, ולא ערך שמור מהעבר.

---

## 1. מה בדיוק נחשב `LIVE_HUMAN_DECISION`

הגדרה: קריאת HTTP בודדת, `POST /api/v1/approvals/:id/decide-and-execute`, שבה:

1. ה-caller מאומת (`requireOperator`/`requireOwner` — נבדק *באותו רגע*, לא נלקח מ-state שמור).
2. אותה קריאה הן מחליטה (PENDING→APPROVED) **והן** מפעילה את ה-governed execution הפנימי (claim→policy re-check→execute→finalize) — בלי לחזור החוצה ל-HTTP בין השלבים.
3. אין תגובת-ביניים חשופה ל-caller שמכילה "approved, בוא תבצע מתי שתרצה" — אין state כזה שנחשף.

זה שונה מה-flow הקיים (`?approvalId=` retry) בכך שהאחרון **תמיד** נשאר "Approval Token Replay" מבחינה מבנית — גם אם בפועל אדם הוא זה שלוחץ retry, אין לשרת דרך להבדיל בין זה לבין אוטומציה. לכן ההצעה: **`?approvalId=` retry ממשיך להתקיים בדיוק כפי שהוא היום, ונשאר חסום ל-HUMAN_ONLY (ללא שינוי בהתנהגות הקיימת והנבדקת)**. ה-endpoint החדש הוא תוספת, לא תחליף.

## 2. מי רשאי לבצע LIVE_HUMAN_DECISION

אותה הרשאה שכבר קיימת ברמת ה-entity policy (`requireOperator`/`requireOwner`, לפי המדיניות של ה-entityType/action הספציפיים) — **אבל** נבדקת מחדש, חיה, בקריאה ל-`decide-and-execute` עצמה, ולא נלקחת מ-`decidedBy` שמור.

המלצה נוספת (בחירה שלך): **הפרדת תפקידים** — `requestedBy` (מי ביקש את האישור) ≠ ה-מזהה שמבצע את ה-`decide-and-execute` (`decidedBy`/executor), לפחות עבור HUMAN_ONLY. כרגע שום דבר בקוד לא מונע self-approval (בדקתי — `decideApprovalRequest` לא משווה `decidedBy` מול `requestedBy`). זה שינוי קטן וממוקד אם תרצה אותו; לא הכרחי מבחינת ה-mechanism עצמו.

## 3. קשירת האדם, הפעולה, ה-project וה-approval

לא נדרש primitive קריפטוגרפי חדש — יש להשתמש במה שכבר קיים ב-`ApprovalRequestSchema`:

- `entityType`/`action`/`artifactHash` — כבר נעולים על ה-approval record מרגע היצירה (`createApprovalRequest`), וכבר נאכפים ב-`claimApprovalRequest` (state-machine check, לא boolean).
- `decidedBy` — יירשם מתוך ה-session המאומתת חיה בקריאת `decide-and-execute` עצמה (לא query param).
- מכיוון שה-decide וה-execute הם **אותה פונקציה, אותה טרנזקציית שרת** — אין "channel" ביניהם שצריך לאבטח בנפרד. זו בדיוק הסיבה שזה חזק יותר מטוקן: אין ערך שעובר בין שתי בקשות שאפשר ליירט/לשחזר.

**שאלה פתוחה עבורך:** האם יש תרחיש שבו ה-decide וה-execute *חייבים* להיות ממכשירים/סשנים שונים (למשל: אישור מהטלפון, ביצוע מהשרת)? אם כן, נדרש primitive נוסף (חתימת challenge קצר-טווח, single-use). אם לא — ל-CP7 הנוכחי (admin run-checks + code patch apply, שניהם same-session בפועל) ההצעה הנוכחית מספיקה, ואפשר להוסיף חתימה חוצת-מכשיר כ-v2 אם יידרש.

## 4. מניעת מיחזור (replay) של אותו אישור ע"י סוכן

נובע ישירות מסעיף 1: כיוון שאין state "APPROVED, ממתין" חשוף ל-HUMAN_ONLY (המעבר PENDING→APPROVED→CLAIMED→... קורה כולו בתוך קריאת `decide-and-execute` אחת, אטומית), **אין מה למחזר**. אם הפעולה כבר בוצעה (FULFILLED) — ניסיון נוסף על אותו `approvalId` נכשל ב-403 בדיוק כמו היום (invariant קיים, לא שונה). אם ה-`decide-and-execute` נכשל/נופל, ה-approval לא הופך ל-APPROVED בכלל (ה-decide וה-claim הפנימי קורים כטרנזקציה אחת — אם ה-claim/policy נכשל, לגלגל אחורה גם את ה-decide, לא להשאיר "APPROVED יתום" בחוץ).

## 5. איך HUMAN_ONLY נשאר חסום ל-automation

**ללא שינוי** בהתנהגות הקיימת: `agent-dispatch-guard.ts`'s `needsApproval = bucket === "HUMAN_ONLY" || ...` (ללא תנאי) וההיגיון ב-`governed-claimed-execution.ts` שמסיים claim כ-FAILED כשההימור לא מסופק — **נשארים בדיוק כפי שהם**, ומכסים את מסלול ה-`?approvalId=` retry הישן. הטסטים הקיימים (`agent-dispatch-guard.test.ts` #7, `governed-claimed-execution.test.ts`, `code.test.ts`) ממשיכים לעבור בלי שינוי — הם בודקים בדיוק את המסלול הזה ואמורים להישאר ירוקים.

הצעה נוספת (שינוי סכימה קטן, לא-שובר): להוסיף ל-`DispatchActorKind` (כרגע `"AGENT" | "AUTOMATION"` בלבד — אין היום שום ייצוג ל"בן אדם מבצע ישירות") ערך שלישי, `"HUMAN"`, שמסלול `decide-and-execute` בלבד מציב. זה הופך את ההבחנה למפורשת וניתנת ל-audit/lint, במקום מוסקת רק ממבנה ה-endpoint.

## 6. שימוש משותף — `code.ts` ו-`admin-ops.ts`

לחלץ helper משותף חדש, למשל `runLiveHumanDecisionExecution()`, לצד `runGovernedClaimedExecution` הקיים (אותה קובץ שירות או קובץ אח) — עם אותה חתימה בערך (`executeOnce`, `entityType`, `action`, וכו') כמו `RunGovernedClaimedExecutionInput` היום, כך ששני ה-routes ממשיכים לשתף קוד בדיוק כמו שהם חולקים את `runGovernedClaimedExecution` היום. ה-endpoint `decide-and-execute` עצמו יכול להיות route גנרי אחד (`apps/api/src/routes/approvals.ts`) שמקבל `approvalId` ומפעיל את ה-`executeOnce` המתאים — בדומה לאיך ש-`runGovernedClaimedExecution` כבר גנרי לחלוטין לגבי מה ש-`executeOnce` עושה בפועל.

## 7. כשלון ביצוע אחרי שהאדם אישר

אין צורך בתכנון חדש — נעשה שימוש חוזר מלא במנגנון הקיים והנבדק: `executeOnce` מחזיר `SUCCESS`/`FAILURE`, ו-`finalizeClaimed` ממפה ל-`FULFILLED`/`FAILED`. ההבדל היחיד: כיוון שהכל קורה בתוך קריאת ה-`decide-and-execute` האחת, **האדם רואה את התוצאה מיד באותה תגובת HTTP** (UX טוב יותר מהיום, לא רק אותו דבר) — ה-invariant "כשל finalize לעולם לא מדווח EXECUTED" (invariant #9 הקיים) נשאר תקף ללא שינוי.

## 8. תיעוד audit

לא נדרשת תשתית audit חדשה. `appendUnifiedAuditEntry` כבר תומך ב-`actorKind: "USER"` (נראה בשימוש כבר ב-`approval.decided`). הצעה: לשמור על שתי רשומות audit נפרדות אך מקושרות דרך `approvalId` (עקבי עם איך שהמערכת כבר מתעדת decide בנפרד מ-execute) — `approval.decided` (כמו היום) ואחריה מיד רשומת ה-execution הרגילה של ה-route, עם `actorKind: "USER"` ולא `"AGENT"` כדי לשקף שמדובר בביצוע אנושי-חי, לא סוכן.

## 9. Crash/retry בלי double execution

**זה כבר פתור.** מנגנון ה-`OUTCOME_UNKNOWN` / `executionStartedAt` / `startClaims` הקיים ב-`governed-claimed-execution.ts` הוא אגנוסטי לחלוטין לגבי "מי טריגר את הביצוע" — הוא פועל על ה-claim/execution עצמם, לא על צורת ה-HTTP request שהוביל אליהם. `decide-and-execute` עדיין עובר דרך אותו `claimOrResume`→mark-started→`executeOnce`→finalize מבפנים. קריסה באמצע מסתיימת כ-`OUTCOME_UNKNOWN` בדיוק כמו היום — אין כאן עבודת תכנון נוספת.

## 10. אילו invariants משתנים

כל 14 ה-invariants הקיימים **נשארים תקפים ללא שינוי** — זו הרחבה, לא שינוי. שני invariants חדשים מוצעים:

- **#15 (חדש):** פעולות ברמת HUMAN_ONLY מבוצעות אך ורק דרך `decide-and-execute` אטומי, מאומת-חי; לעולם לא דרך claim על approval שאושר בעבר.
- **#16 (חדש, אופציונלי — תלוי אם תרצה separation-of-duties):** `requestedBy` ≠ מבצע ה-`decide-and-execute` עבור HUMAN_ONLY.

---

## מה עוד נדרש להחליט לפני כתיבת קוד

1. **שם ה-endpoint וה-contract** — `decide-and-execute` כפי שהצעתי, או שם אחר?
2. **Cross-device approval** (סעיף 3) — בסקופ ל-v1 או לא?
3. **Separation-of-duties** (סעיפים 2, invariant #16) — לאכוף עכשיו או להשאיר לעתיד?
4. **`DispatchActorKind: "HUMAN"`** (סעיף 5) — להוסיף עכשיו כחלק מ-CP7.1/7.2, או מספיק ההבחנה המבנית (איזה endpoint הופעל) בלי שינוי טיפוס?
5. רק לאחר אישור הסעיפים האלה — עוברים ל-CP7.2 (כתיבת קוד: ה-endpoint המשותף + חיווט admin-ops.ts/code.ts אליו).

**STOP.** מסמך תכנון בלבד. אין קוד, אין commit, אין push. `admin-ops.ts` הלא-committed נשאר כפי שהוא, מבודד.
