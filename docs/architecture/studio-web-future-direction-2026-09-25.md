# Studio / Web — מסמך מאוחד

**תאריך:** 2026-09-26  
**סטטוס:** כיוון בלבד. אין אישור לשנות קוד, נתיבים, Control, שערי אישור, או גבולות אבטחה.

המסמך מאחד שלושה מקורות:

1. צילום המסך מ־2026-09-25 (עברית, RTL, סטודיו כהה, סרגל עליון, הודעת ממשל על המשתמש / זיכרון / Patch / אישור / Apply).
2. מפת השימור שנבדקה מול הקוד.
3. סדר העבודה שסוכם: קודם חיבור, אחר כך ארבעת הפערים האמיתיים, ואז אימות.

אין לבנות Studio חדש. אין עורך שני, זיכרון שני, סוכן שני, או מסלול Apply מקביל.

## מה הצילום קובע

- המובייל והעברית הם חלק מהחדר, לא שכבת תרגום מאוחרת.
- הסרגל העליון נשאר קומפקטי: תפריט, שפה, ערכת נושא, זהות ArletOS.
- משטח העבודה כהה בתוך מעטפת בהירה.
- הודעת הממשל נשארת גלויה: המשתמש, הזיכרון, ה־Patch, האישור, ו־Apply הם דברים שונים.
- האזורים באותו חדר: קבצים, תיקיות, עורך, בדיקות, ראיות, פעילות, טרמינל, והסוכן.

## חדרי המוצר

| חדר | תפקיד |
| --- | --- |
| Dashboard | מה דורש תשומת לב, ולאן נכנסים |
| Projects | יצירת פרויקט וקישור תיקייה |
| Studio | סביבת העבודה. בנויה סביב הסוכן האישי, בלי שהסוכן מחליף את העורך או את המומחים |
| PSA | שכבה מתמשכת. `psa:<ownerId>`. מתאם. לא דף בתפריט ולא CODE_ENGINEER |
| 16 Fabric | מומחים נפרדים |
| Agents & Knowledge | קטלוג וידע מאושר |
| Account | זהות, הגדרות, תוכנית. מד אחסון זיכרון רק כשיהיה מימוש |
| Control | מדיניות, SoD, Apply / Verify / Rollback, ראיות. לא מנוע אישור חדש |

## כלל מחייב

Explain, Diagnose, Review, והתראת כשל חוזר מגיעים עד הצעה.

```text
תצפית
  → ניתוח / זיכרון / ידע מומחה
  → המלצה
  → Proposal
  → אישור אדם / זהות שנייה
  → Apply
  → Verify
  → ראיות
```

הם לא מקבלים סמכות כתיבה חדשה. Fix לא כותב לקובץ בשקט.

ידע Atlas אינו זיכרון משתמש. זיכרון משתמש אינו זיכרון פרויקט. זיכרון מומחה אינו זיכרון אישי. קובץ בפרויקט אינו זיכרון. שרשור הצ׳אט אינו רשומת ה־PSA.

מצבי הידע בסכמה כוללים: FACT, CONFIRMED, VERIFIED, OBSERVED, INFERRED, ASSUMED, PROPOSED, UNVERIFIED, UNKNOWN, CONFLICTED, CONTRADICTED, STALE, INSUFFICIENT_EVIDENCE. `EPISTEMIC_V1_TO_V2` ממפה CONFIRMED אל VERIFIED. VERIFIED כמצב אפיסטמי אינו סטטוס ה־patch ששמו VERIFIED. INFERRED נשאר INFERRED.

## סדר עבודה

אין להתחיל שלב לפני שהקודם סגור. אין לממש את הרשימה הזו מתוך המסמך לבדו.

### 1. הקשר פרויקט — CONNECT

Dashboard ו־Projects פותחים היום `/studio` ו־`/workbench` בלי מזהה הפרויקט. Studio כבר קורא `?project=`. החיבור הוא לשאת את המזהה שנבחר. לא מנגנון חדש.

צ׳יפי blockers ב־Dashboard הולכים ל־`/readiness` בלי `project`. גם את זה לחבר.

### 2. Studio כחדר אחד — MOVE

לרכז סביב הקובץ הפתוח את מה שכבר קיים: עץ, עורך, Problems, Git, PSA, Run, Checks.

שורת הפעולות (Explain, Diagnose, Review) היא ארגון של בקרות קיימות. היא לא מסלול ביצוע עצמאי.

Truth, Health, Readiness, QA, Process Audit, Observer, Sentinel כבר יושבים ב־Checks. נתיבי הסיידבר נשארים aliases. לא חדרים מקבילים.

### 3. PSA — CONNECT

לחבר אל הפאנל הקיים את what שכבר קיים ב־API ולא נקרא מהמסך:

- `POST /api/v1/supervising-agent/explain`
- `POST /api/v1/supervising-agent/recommend`
- `POST /api/v1/supervising-agent/escalate`
- `POST /api/v1/supervising-agent/request`

`request` חייב להישאר עם זהות Fabric. אסור שה־`agentId` יהיה ה־PSA עצמו. הקואורדינציה שנראית היום היא תוכנית בלבד (`coordinate`). היא לא מריצה כלים.

הפאנל מכיר `projectId`. הוא עדיין לא מקבל קובץ, בחירה, Git, או דיאגנוסטיקה. זה חיבור, לא סוכן חדש.

### 4. זהות שנייה בתוך ה־workflow — IMPROVE

`decide-and-execute` קיים. המבקש מקבל 403. אין פאנל ב־Studio. להציג את הצעד במסלול הקיים. לא מנוע אישור חדש. לא להחליש SoD.

### 5. דסק ו־Verify — CONNECT

Studio המוכח משתמש ב־`POST /api/v1/code/patches/:id/verify`.

הדסק קורא ל־`POST /api/v1/remediation/drafts/:id/verify`.

אלה שני נתיבים. אין ליצור verify שלישי. הדסק צריך להציג את אותו תיקון ואת אותן ראיות ש־Studio כבר מייצר, על נתיב ה־patch המוכח. נתיב ה־draft לא מחליף אותו כל עוד הם לא אותו אובייקט.

### 6. Checks — MOVE

כבר קיים. רק להפסיק להציג אותם כחדרים נפרדים מלבד alias.

### 7. מחזור חיי זיכרון — MISSING

איחוד, ארכיון, `supersededBy` ככלי למשתמש, ומד אחסון של זיכרון המשתמש.

`memoryWarningMb` ב־`performance-limits.ts` הוא סף RAM של תהליך השרת. הוא לא מד האחסון של המשתמש. אין למחוק זיכרון בעלים אוטומטית.

### 8. כשל חוזר — MISSING

אחזור זיכרון קיים. מנוע שמשווה אירועים מאומתים, מצמיד ראיות, ומסמן INFERRED אינו קיים. לא לכנות את ה־retrieve בשם הזה.

### 9. פעולות קובץ בדיסק — MISSING

שינוי שם והזזה של קובץ על הדיסק אינם קיימים כפעולת Studio. Git יודע להציג rename. שינוי שם סמל ב־`StudioLanguageBar` הוא שירות שפה, לא שינוי שם קובץ.

אם יתווסף, רק במסלול המאושר. לא פעולה שקטה של ה־PSA או של הצ׳אט.

### 10. אימות Production — ENVIRONMENT-BLOCKED

אחרי שהחיבורים המקומיים סגורים:

- Studio מאומת ב־Production: אין חשבון אוטומטי ואין workspace של לקוח על שרת ה־API.
- Apply, SoD, Rollback ב־CI: חסומים כל עוד `SUPABASE_SERVICE_ROLE_KEY=replace-me`.
- תצפית PSA על תהליכי Control: ריקה בלי URL וטוקן.

זה לא אומר שהמוצר המקומי חסר.

## פונקציות שקיימות ולא באות לידי ביטוי

לא למחוק. לחבר רק את מה ששייך למשתמש ב־Studio, בלי לפתוח ניתוח Control לכל משתמש.

| פונקציה | איפה בקוד | במסך היום | מה לעשות |
| --- | --- | --- | --- |
| explain / recommend / escalate / request של ה־PSA | `personal-supervising-agent.ts` | לא | CONNECT אל הפאנל. בלי זהות חדשה |
| `language/symbols` | `studio-language.ts` | לא | CONNECT לחיפוש סמלים. diagnostics, hover, definition, references כבר ב־Problems או ב־Language bar |
| `POST /code/fix`, `/refactor`, `/tests` | `code.ts` | המצב נבחר ב־Ask Agent, לא ככפתור נפרד | PRESERVE. אלה אותה `createProposal`. לא מסלול שני |
| `POST /code/explain`, `/analyze`, `/impact`, `/risks`, `/review` | `code.ts` | לא | לא לפתוח למשתמש רגיל. הם דורשים תפקיד Control ו־`workspaceRoot` גולמי. Explain למשתמש צריך להיבנות על הפרויקט שבבעלותו, לא על הנתיב הזה |
| `git.blame`, `git.log`, `git.add`, `git.unstage`, `git.restore` | קטלוג פקודות + פאנל Git | חלקית | PRESERVE. אין commit. זה מכוון |
| Gates, eval, artifacts, conflicts, contract, metrics | דפים אמיתיים | אין בתפריט | CONNECT. לא לבנות מחדש |
| שורת Companion | AppShell | כן, בכל עמוד | לא למזג עם `psa:<ownerId>` |

## מה לא בונים מחדש

התחברות וסשן. קישור תיקייה. בידוד פרויקט ו־`?project=` / `?file=` אחרי שהמזהה כבר ב־URL. עץ, חיפוש, breadcrumbs. טרמינל. קטלוג `workspace.build` ו־`vitest.run`. Git המאושר. Checks. הצעת CODE_ENGINEER. Apply → Verify → Rollback ששוחזר על `hello.ts` מקומית. רשומת ה־PSA. זיכרון לפי `ownerId`. קטלוג 16 המומחים. הכלל ש־`ATLAS_SKIP_AUDIT_LOG` אסור ב־production.

העורך נשאר ומשתפר במקומו. הוא textarea עם הדגשה, לא מוצר עורך חדש. המתאר הוא regex על הקובץ הפתוח.

## סביבת עבודה ובדיקות

הבדיקות המתקדמות כבר יושבות בחדר, לא בתפריט נפרד:

- Test ו־Build: פקודות מורשות, זהות שנייה.
- Checks: QA, Process Audit, Readiness, Health, Truth, Observer, Sentinel.
- Verify של patch: הנתיב המוכח ב־Studio.

הסוכן האישי עומד מעל הרצף הזה. הוא לא מריץ את הבדיקה בעצמו ולא מאשר אותה. הוא מביא הקשר, זיכרון, והפניה למומחה. המומחה מציע. האדם והזהות השנייה מחליטים.

צילום 2026-09-25 נשאר נקודת הייחוס הוויזואלית: עברית, RTL, חדר אחד, והודעת הממשל גלויה.
