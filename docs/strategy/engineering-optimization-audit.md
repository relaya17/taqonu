# ביקורת ייעול הנדסי — Atlas Core

**תאריך:** 2026-08-17
**היקף:** `apps/api`, `apps/web`, `packages/*` (715 קבצים במעקב git, ~80K שורות TS/TSX)

בדיקה ידנית של המבנה, לא הרצת פרופיילר חי — לכן הממצאים מבוססי-קוד (סטטיים), לא מדידות זמן ריצה בפועל.

---

## 1. הממצא הכי חשוב: המצב המרכזי של האפליקציה לא באמת נמצא במסד נתונים

`apps/api/src/store/os-store.ts` (1,351 שורות, 107 מתודות) הוא ה"מוח" שמחזיק את כל היישויות המרכזיות — Projects, Evidence, Claims, Memories, Decisions, AgentRuns, Patches, GateGraphs, EvalRuns ועוד. כל האובייקט הזה נטען ונשמר כקובץ JSON יחיד: `.atlas/store.json` (כרגע 75KB בסביבת הפיתוח).

הבעיה: `persist()` (שורה 400) נקרא **44 פעמים** מכל מיני מתודות מוטציה קטנות (`addEvidence`, `recordDecision` וכו'), וכל קריאה כזו:

1. הופכת **את כל האובייקט** (כל הפרויקטים, כל ה-Evidence, כל ה-Decisions...) ל-JSON string.
2. כותבת אותו לדיסק בצורה **סינכרונית** (`writeFileSync`).
3. מעתיקה עוד עותק גיבוי (`copyFileSync`) — עוד כתיבה סינכרונית שלמה.

כלומר: הוספת רשומת Evidence אחת מפעילה שכתוב מלא של כל מסד הנתונים לדיסק, פעמיים, וחוסמת את ה-event loop של Node עד שזה נגמר. זה עובד היום כי הקובץ קטן, אבל זו עלות שגדלה ליניארית עם כמות הנתונים — ולא לינארית עם גודל השינוי. ברגע שיהיו כמה פרויקטים אמיתיים עם היסטוריית Evidence ארוכה, כל בקשת API שכותבת משהו תאט.

זה גם אומר שאי אפשר להריץ יותר מ-instance אחד של ה-API (אין נעילה, אין טרנזקציות — שני processes יכתבו ל-store.json ויתנגשו).

**מה שמעניין:** `DATABASE_URL`/Supabase Postgres כבר מוגדרים ומחוברים בפרויקט (`apps/api/.env.example`, `apps/web/lib/supabase.ts`) — אבל משמשים היום כמעט רק ל-auth/session/identity ול-`knowledge_chunks`. שכבת ה-`PersistedShape` ב-`os-store.ts` היא בעצם כבר סכימת טבלאות מוכנה (projects, evidence, claims, memories, decisions...) — פשוט לא ב-Postgres. זה בדיוק העניין ששאלת עליו קודם ("הכל יהיה מאוחסן במסד נתונים") — התשתית קיימת, רק לא מחוברת ליישויות הליבה.

**המלצה בעדיפות ראשונה:** להעביר את היישויות ב-`OsStore` לטבלאות Postgres אמיתיות (יש כבר חיבור Supabase), עם כתיבה אינקרמנטלית במקום שכתוב-כל-הקובץ. זה גם פותר את הביצועים וגם נותן לאטלס בסיס נתונים אמיתי לשאילתות/ידע מצטבר.

---

## 2. קבצים מונוליטיים ("God objects")

כמה קבצים ריכזו הרבה מדי אחריות, מה שמקשה לתחזק ולבדוק בבידוד:

| קובץ | שורות | הערה |
| --- | --- | --- |
| `apps/api/src/store/os-store.ts` | 1,351 | 107 מתודות — כל ה-state באובייקט אחד |
| `packages/code-intelligence/src/constitution-runner.ts` | 1,313 | לוגיקת הרצה מרכזית |
| `apps/web/app/[locale]/projects/page.tsx` | 1,017 | קומפוננטת עמוד יחידה |
| `apps/web/components/layout/AppShell.tsx` | 991 | shell גלובלי |
| `apps/web/app/[locale]/truth/page.tsx` | 935 | |
| `apps/web/app/[locale]/integrations/page.tsx` | 923 | |

**המלצה:** לפצל בהדרגה — קודם `os-store.ts` (הכי משתלם, גם מבחינת תחזוקה וגם ביצועים אם עוברים ל-DB), אחר כך את עמודי ה-web הגדולים לתת-קומפוננטות (גם מוריד גודל bundle ב-client, כי כל אלה מסומנים `"use client"`).

---

## 3. אוספים שגדלים בלי גבול

בתוך `persist()` רואים שחלק מהמערכים כבר נחתכים בכוונה לפני שמירה (`events.slice(-500)`, `assistRuns.slice(-200)`, `audit.slice(-AUDIT_MEMORY_RING)` וכו') — כלומר מישהו כבר ידע שצריך למנוע גדילה בלתי מוגבלת. אבל **evidence, claims, memories, decisions, snapshots** (המפות לפי `projectId`) לא עוברות שום חיתוך — הן גדלות ללא הגבלה לאורך חיי כל פרויקט, בלי ארכיון או TTL. זה עוד סיבה שהמעבר ל-Postgres דחוף: שם אפשר לשמור הכל בלי לדאוג לגודל קובץ JSON יחיד בזיכרון.

---

## 4. Front-end — עמודים כבדים בצד לקוח

כמה מהעמודים הגדולים ביותר (`projects/page.tsx`, `truth/page.tsx`, `integrations/page.tsx`, `qa/page.tsx`, `workbench/page.tsx` — כולם 600–1,000+ שורות) מסומנים `"use client"` עם ייבוא ישיר של MUI מלא + react-query. זה אומר bundle גדול יותר בצד לקוח ו-hydration איטי יותר. מועמדים טובים ל-`next/dynamic` / פיצול קומפוננטות פנימיות שלא חייבות לרנדר מיד.

**עדיפות:** נמוכה יחסית להיום — כדאי לטפל אחרי הליבה (#1), לא לפניה.

---

## סדר עדיפויות מומלץ

1. **os-store → Postgres** (העלות הכי גבוהה כרגע, גם ביצועים וגם עונה על הצורך ב"אטלס עם ידע במסד נתונים" שעלה קודם)
2. חיתוך/ארכוב ל-evidence/claims/memories/decisions עד שהמעבר ל-DB יושלם (מדיד, זול, עוצר את גדילת קובץ ה-JSON בינתיים)
3. פיצול `os-store.ts` ו-`constitution-runner.ts` למודולים קטנים יותר
4. פיצול עמודי ה-web הגדולים + lazy-loading

רוצה שאתחיל בסעיף 1 — כלומר לתכנן/לבנות סכימת Postgres ל-Evidence/Projects/Decisions ולהעביר את הכתיבות אליה בהדרגה?
