# CP7.1 — ממצא ארכיטקטוני (Read-Only): האם `HUMAN_ONLY` בכלל ניתן לביצוע היום?
**תאריך: 2026-09-03**
**סטטוס: קריאה/ניתוח קוד בלבד. אין שינוי קוד, אין commit, אין push.**

---

## 0. ממצא דחוף שקדם לניתוח — טיוטת מיגרציה לא-committed כבר יושבת ב-working tree

לפני שנכנסתי לניתוח, מצאתי:

```
git status --short
 M apps/api/src/routes/admin-ops.ts
?? Claude outputs/
```

- `apps/api/src/routes/admin-ops.ts` **שונה, לא committed**, mtime `2026-09-03 07:30:08 UTC` (כמה דקות לפני שהתחלתי לבדוק) — **לא אני ערכתי אותו** בפעולות הנראות של הסשן הזה, והוא לא מוזכר באף אחד מהדוחות מ-2026-09-02 (שדיווחו `git status` נקי).
- השינוי עצמו הוא **בדיוק** מיגרציית ה-lifecycle של CP7.2: מחליף `consumeApprovalRequest` + `authorizeEntityAction(..., approved: true)` הישנים ב-`runGovernedClaimedExecution` (אותו pattern כמו ב-`code.ts`).
- יש גם תיקייה untracked בשם `Claude outputs/` (לא `/home/claude/work/` — מוסכמת שם שונה משלי) שמכילה עותק של דוח הסגירה מ-2026-09-02.

**המשמעות הסבירה ביותר:** בדיוק כמו ב-Phase 3E, נראה שסוכן/סשן Claude נוסף עובד על אותו ריפו, ישירות מהמחשב שלך, ללא תיאום עם הסשן הזה. **לא נגעתי בשינוי הזה** — לא stash, לא commit, לא discard. הוא נשאר כפי שהוא עד שתחליט מה לעשות איתו. חשוב: כפי שמפורט בסעיף 2, **הטיוטה הזו לא פותרת את שאלת ה-HUMAN_ONLY** — היא בדיוק התרחיש שהזהרת מפניו: מיגרציה נכונה מבחינת lifecycle שתיתקע ב-policy.

---

## 1. השאלה שנשאלה

אם `admin.automation.run-checks` (`CONFIGURATION.EXECUTE`) יעבור ל-`runGovernedClaimedExecution`, האם הוא ייחסם לצמיתות ב-`HUMAN_ONLY` גם עם אישור תקין? ואם כן — האם יש היום *any* מסלול לגיטימי שבו פעולת `HUMAN_ONLY` בכלל מסתיימת בביצוע?

## 2. תשובה: לא. אין היום אף מסלול שמבצע פעולת HUMAN_ONLY. זו התנהגות מכוונת ומתועדת בטסטים — לא רק תיאוריה

### 2.1 חישוב ה-score בפועל

`packages/agent-core/src/policies/entity-policies.ts`: `CONFIGURATION.EXECUTE` → `DESTRUCTIVE`, `requiresApproval: true`.

`packages/agent-core/src/policies/risk-score.ts`, `computeActionRiskScore`:
```
base(DESTRUCTIVE)        = 75
confidence penalty        = round((1 - 0.5) * 20) = 10   (ברירת מחדל, אין אף קורא שמעביר confidence)
evidence penalty          = (3 - 0) * 5           = 15   (ברירת מחדל, אין אף קורא שמעביר evidenceCount)
subtotal                  = 100  →  clamp(100)  →  bucket = HUMAN_ONLY (80–100)
```

### 2.2 אין שום צנרת (plumbing) ל-confidence/evidenceCount דרך ה-wrapper

`RunGovernedClaimedExecutionInput` (`governed-claimed-execution.ts`, שורה 81) — הטיפוס שגם `code.ts` וגם טיוטת `admin-ops.ts` קוראים לו — **לא כולל בכלל שדות `confidence`/`evidenceCount`**. גם `runPolicy` הפנימי (שורה 221) שקורא ל-`dispatchAgentAction` לא מעביר אותם. כלומר זו לא בעיה ספציפית ל-`admin-ops.ts` — **אין כיום שום דרך להזרים confidence/evidence דרך ה-wrapper הזה, לאף קורא**.

### 2.3 `HUMAN_ONLY` לא ניתן לסיפוק גם ע"י claimed approval תואם — וזה הורס את האישור הקיים

`agent-dispatch-guard.ts`, שורה ~465:
```ts
const needsApproval =
  bucket === "HUMAN_ONLY" ||
  (!approvalSatisfied && (bucket === "APPROVAL" || entityAuthz.decision === "APPROVAL_REQUIRED"));
```
הענף `bucket === "HUMAN_ONLY"` הוא **ללא תנאי** — לא בודק `approvalSatisfied`. גם כשיש claim תואם ומאומת.

וב-`governed-claimed-execution.ts` (שורה ~360): כשה-gate מחזיר `APPROVAL_REQUIRED` בזמן שכבר יש `claimed` record —
```ts
if (claimed) {
  await finalizeClaimed(claimed, "FAILED", { reason: `approval ${gate.approvalRequestId} required; existing claim cannot satisfy this gate` });
}
```
**האישור הקיים מסתיים כ-`FAILED` (מצב טרמינלי, לא ניתן לשימוש חוזר)**, ומונפק אישור PENDING חדש. כלומר זו לא רק תקיעות — כל ניסיון חוזר **שורף** את האישור הקודם ומחזיר `202 APPROVAL_REQUIRED` עם id חדש, לנצח.

### 2.4 זו התנהגות מכוונת, מתועדת בטסטים קיימים — כולל ב-`code.ts` שכבר "מיגרו במלואו"

- `agent-dispatch-guard.test.ts`, טסט #7: *"HUMAN_ONLY stays blocked even with a matching claimed approval"*
- `governed-claimed-execution.test.ts`: *"HUMAN_ONLY after claim does not execute and finalizes the existing claim FAILED"*
- `code.test.ts`: *"blocks a HIGH-risk patch with 202, then holds HUMAN_ONLY after claim instead of consuming"* — כולל ההערה המפורשת בראש הקובץ: *"DOCUMENT.EXECUTE after claim is still subject to Phase 3E HUMAN_ONLY."*

`DOCUMENT.EXECUTE` (המסלול ש-`code.ts` כבר משתמש בו ל-apply/rollback של patch) הוא `HIGH_RISK_WRITE` — base 55, ועם אותם ברירות מחדל (+10 +15) מגיע בדיוק ל-**80 = סף ה-HUMAN_ONLY**. כלומר **גם ה-flow של `code.ts`, ש"עבר מיגרציה מלאה", לא מסוגל היום לבצע patch ברמת סיכון HIGH/CRITICAL בפועל** — ה-202 הראשון נוצר, האישור מתקבל, אבל הביצוע בפועל נחסם וה-claim נשרף. זה מוצג בטסט כהתנהגות **מצופה** (`expect(claimed?.status).toBe("FAILED")`), לא כבאג — אבל זה אומר של-`code.ts` עצמו יש היום את אותה מגבלה מהותית, לא רק ל-`admin-ops.ts` העתידי.

### 2.5 בדקתי: אין שום מסלול חלופי ל-ביצוע חי (live human decision)

`POST /api/v1/approvals/:id/decide` (`apps/api/src/routes/approvals.ts`) קורא רק ל-`decideApprovalRequest` — הופך סטטוס ל-APPROVED/REJECTED. **הוא לא מבצע דבר בעצמו.** אין נקודה בקוד שבה החלטת אישור מתבצעת סינכרונית עם הביצוע. ה-comment ב-`risk-score.ts` אומר במפורש שהכוונה היא ש-HUMAN_ONLY "תמיד דורש החלטת אנוש חיה, אף פעם לא אוטומציה מבוססת-טוקן" — אבל **מסלול "החלטת אנוש חיה" כזה עדיין לא נבנה בקוד**. יש רק את דפוס ה-token replay (approve עכשיו, retry אח"כ) — שהוא בדיוק מה ש-HUMAN_ONLY נועד לחסום.

**לא הרצתי את הטסטים בפועל דרך הגישור הזה** — אותה בעיית `node_modules`/NTFS junction שתועדה בדוח הקודם (`vitest.mjs` לא נמצא) עדיין קיימת מנקודת המבט של ה-bridge; ההרצה הצליחה בעבר רק מהטרמינל שלך ישירות. הממצא לעיל מבוסס על קריאת קוד + קריאת טסטים קיימים (כולל docstring מפורש ב-`code.test.ts` שמצטט את אותה התנהגות), לא על הרצה בפועל. מומלץ להריץ `admin-ops.test.ts` + `code.test.ts` בטרמינל שלך לאימות סופי.

## 3. מה זה אומר לגבי טיוטת ה-CP7.2 שכבר יושבת ב-working tree (סעיף 0)

הטסט המקורי, ה-**committed**, ב-`admin-ops.test.ts` (שורה 78) מצפה ל: *"200s and runs the watchdog once the approval has been decided APPROVED, then consumes it"*. הטיוטה הלא-committed **לא עדכנה את הטסט הזה**. לפי הניתוח לעיל, עם הקוד החדש הקריאה השנייה תחזיר `202 APPROVAL_REQUIRED` (לא `200`), והאישור ייכשל כ-`FAILED` (לא ייצרך) — כלומר **הטסט הקיים כנראה נכשל** אם היה רץ כרגע על הטיוטה. זה עולה בקנה אחד עם החשש שהעלית: מיגרציה נכונה-מבחינת-lifecycle שנתקעת ב-policy.

## 4. השאלה האמיתית ש-CP7.1 צריך להכריע בה (רחבה יותר ממה שנוסח במקור)

זו לא רק "להעביר confidence/evidenceCount" — זו שתי החלטות נפרדות:

**(א) האם `admin.automation.run-checks` בכלל צריך להגיע ל-HUMAN_ONLY?**
פעולת אדמין המופעלת ע"י אופרטור אנושי אמיתי (`requireOperator`) ומאושרת דרך `/decide` ע"י אדם — האם זו "אוטומציה מבוססת-טוקן" שה-HUMAN_ONLY נועד לחסום, או שזו בדיוק "החלטת אנוש חיה" שה-design מתכוון לאפשר? הארכיטקטורה הנוכחית לא מבחינה בין השניים — `claimedApproval` תמיד מטופל כ"טוקן", בלי קשר למי ומתי אישר. זו שאלת מדיניות, לא רק שאלת נתונים חסרים.

**(ב) גם אם ההחלטה היא "לא, השאר ב-HUMAN_ONLY" — עדיין חסרה תשתית**
`RunGovernedClaimedExecutionInput` לא חושף היום שום דרך להעביר confidence/evidenceCount לאף קורא (לא רק ל-admin-ops). זו עבודת תשתית משותפת, לא ספציפית ל-CP7.

## 5. אופציות ל-CP7.1 (לא ממליץ באופן חד-משמעי — לבחירתך, כמו ב-ADR-024)

- **אופציה 1** — להוסיף מסלול "live human execute": `/decide` עם `approve: true` מבצע סינכרונית (באותה טרנזקציה) עבור פעולות HUMAN_ONLY שהאדם המחליט הוא בעל הרשאת operator/admin אמיתית. פותר גם את הבעיה הזהה שכבר קיימת ב-`code.ts`.
- **אופציה 2** — להוסיף שדה מדיניות חדש (למשל `humanOnlyEscapableByOperatorDecision`) ברמת ה-entity-policy עבור `CONFIGURATION.EXECUTE` ספציפית, שמאפשר ל-claimed approval לספק HUMAN_ONLY *רק* כשה-actor הוא human operator מאומת (לא AGENT/AUTOMATION) — שינוי ממוקד יותר, לא גורף.
- **אופציה 3** — להשאיר HUMAN_ONLY כפי שהוא (לא ניתן לעקיפה בשום צורה), ובמקום זאת להוריד את `CONFIGURATION.EXECUTE` של המסלול הזה ספציפית מ-DESTRUCTIVE ל-HIGH_RISK_WRITE + confidence/evidence אמיתיים (base 55, +signal אמיתי יכול לרדת מתחת ל-80) — אבל זה דורש להחליט מה "confidence"/"evidence" אומר עבור טריגר אדמין ידני (אין evidenceRefs טבעי לפעולה הזו כמו שיש לפאץ' קוד).

**המלצה מעשית**: אופציה 1 היא הכי כללית ופותרת גם את המגבלה הקיימת ב-`code.ts`, אבל היא שינוי ארכיטקטוני רחב יותר מ-CP7 (נוגעת ב-`/decide`, ב-gate המשותף). אופציה 2 ממוקדת ל-CP7 בלבד. שתיהן דורשות decision ממך לפני כתיבת קוד — זה בדיוק מה ש-CP7.1 אמור להיות.

---
**STOP.** אין implementation, אין commit, אין push. השינוי הלא-committed שנמצא ב-`admin-ops.ts` (סעיף 0) לא נגעתי בו ולא נבנה עליו — ממתין להנחייתך.
