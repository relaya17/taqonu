# CP7.2 — ניתוח שני החוסמים שהעלית + הצעת DB/RPC מינימלית
**תאריך: 2026-09-03**
**סטטוס: ניתוח בלבד, כפי שביקשת. עצרתי לפני יישום נוסף.**

---

## מה כבר בוצע (uncommitted, לא נגעתי בזה שוב מאז הודעתך)

1. `apps/api/src/services/agent-dispatch-guard.ts` — הוספת `DispatchActorKind: "HUMAN"`, ענף HUMAN ב-`claimedApprovalMatchesGovernedAction`, ה-`needsApproval` carve-out הצר. **החלק הזה נשאר תקף ברמת העיקרון**, אבל ה-branch שבודק `decidedBy`/`requestedBy` יזדקק לעדכון קטן ברגע שהתשתית ב-DB תשתנה (למטה).
2. `apps/api/src/services/live-human-execution.ts` (קובץ חדש) — **הגרסה הזו שגויה בדיוק כפי שהצבעת עליה** (decide() נפרד ואז `runGovernedClaimedExecution` נפרד, עם `executorId: requestedBy` המסווה את הזהות האמיתית). לא מחקתי אותה — היא תיכתב מחדש לגמרי ברגע שתאשר את הפתרון למטה.

לא נגעתי ב-`admin-ops.ts`, `code.ts`, טסטים, או ב-SQL. אין commit.

---

## חוסם 1: חלון APPROVED בר-מימוש-חוזר

### מעברי המצב הקיימים בפועל — התמונה המלאה (לא רק מה שב-schema comment)

בדקתי את שני ה-migrations (`20260902230000`, `20260903010000`) ומצאתי **trigger ברמת ה-DB** (`live_approval_protect`, `before update or delete`) שאוכף רשימת מעברים חוקית — נפרד לגמרי מהאכיפה ברמת האפליקציה:

```sql
(old.status = 'PENDING'  and new.status in ('APPROVED', 'REJECTED', 'REVOKED'))
or (old.status = 'APPROVED' and new.status in ('CONSUMED', 'CLAIMED', 'REVOKED'))
or (old.status = 'CLAIMED'  and new.status = 'CLAIMED')
or (old.status = 'CLAIMED'  and new.status in ('FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN'))
```

**`PENDING -> CLAIMED` ישיר אינו קיים ברשימה. זה לא רק "לא ממומש בקוד האפליקציה" — זה נאכף ברמת ה-DB (trigger, לא רק RPC), כך שאי אפשר לעקוף את זה בלי migration.** זה בדיוק החוסם שביקשת שאזהה.

### מה קורה בפועל אם קורס תהליך אחרי decide() אבל לפני claim() — בעיצוב המקורי (השגוי) שלי

1. `decide_live_approval_request` (ה-RPC, `20260902230000` שורות 150-176) הוא **עסקה בודדת, אטומית** — `select ... for update` ואז `update` באותה קריאה. אין "half-decided". אחרי commit: הרשומה durably APPROVED, `decided_by`/`decided_at` מלאים.
2. אם התהליך קורס **בדיוק כאן** (לפני שה-claim() הבא רץ): הרשומה נשארת APPROVED, `decided_by` מוגדר.
3. בעיצוב המקורי שלי, `runLiveHumanDecisionExecution` בודק `existing.status !== "PENDING"` **בתחילת** הקריאה — אז ניסיון retry של אותה קריאה יכשל (403, "not PENDING"). **אין נתיב resume דרך השירות שלי.**
4. האם זה "reusable execution authority"? בדקתי את `dispatchAgentAction` (אחרי התיקון שכבר הכנסתי): נתיב ה-`?approvalId=` הישן *כן* יכול לתפוס claim על הרשומה הזו (executorId===requestedBy, כרגיל) — אבל בפועל **לא יכול לבצע**, כי ה-carve-out ל-HUMAN_ONLY מותנה ב-`actor.kind === "HUMAN"`, וזה נקבע **רק** על ידי `runLiveHumanDecisionExecution` — קורא AGENT/AUTOMATION שתופס claim על הרשומה הזו עדיין ייחסם (ה-claim שלו יישרף כ-FAILED, בדיוק כמו היום). **אז אין כאן חור אבטחה של ביצוע לא-מורשה.**
5. **אבל יש כאן בעיה אמיתית שהעלית בצדק:** הרשומה נשארת תקועה ב-APPROVED לצמיתות — לא ניתנת ל-claim מחדש דרך השירות שלי (חוסם ב-PENDING check), ולא ניתנת לביצוע דרך אף נתיב אחר. זו לא "unauthorized execution" — זו "denial", approval יתום שדורש `revokeApprovalRequest` ידני כדי לנקות. **זה עדיין לא מספיק טוב** — בדיוק כמו שאמרת, "לחסום את הנתיב הישן" לא מספיק; העיצוב חייב למנוע את החלון הזה מלכתחילה, לא רק להבטיח שהוא לא מנוצל.

### הפתרון: RPC חדש, ייעודי, שעובר ישירות PENDING → CLAIMED

מוסיף (migration חדשה, **לא נוגעת בשום RPC/trigger קיים** — רק מוסיפה):

1. **תוספת אחת לרשימת המעברים החוקית ב-trigger:** `or (old.status = 'PENDING' and new.status = 'CLAIMED')`.
2. **RPC חדש**, למשל `claim_live_approval_request_as_live_human(p_id, p_entity_type, p_action, p_decided_by, p_decision_reason, p_artifact_hash, p_request_id)`:
   - `select ... for update` על הרשומה.
   - דורש `status = 'PENDING'` (לא APPROVED — זו הנקודה: הביצוע היחיד שקורה כאן הוא PENDING→CLAIMED).
   - אוכף את אותם בדיקות entity/action/artifact/expiry כמו `claim_live_approval_request` הקיים.
   - **אוכף separation-of-duties ברמת ה-DB עצמה** (לא רק ב-TypeScript): `if p_decided_by = v_row.requested_by then raise exception ...`.
   - `update` **אחד**, אטומי: `status='CLAIMED', decided_by=p_decided_by, decided_at=now(), decision_reason=p_decision_reason, claimed_by=p_decided_by, claimed_at=now(), live_execution_id=gen_random_uuid(), ...`.
3. **תוספת מקבילה ל-in-process test backend** (`live-approval-requests.in-process.ts`) — `case` חדש שממפה לאותה לוגיקה, כדי שהטסטים (שרצים נגד ה-backend הזה, לא נגד Postgres אמיתי) יוכלו לתרגל את הנתיב החדש.

**זה סוגר את חוסם 1 לגמרי, לא רק "עוקף" אותו:**
- אם קורס **לפני** ה-RPC הזה מסתיים: הרשומה עדיין PENDING (עסקה אטומית — או הכל או כלום). ניסיון live-human decide-and-execute חוזר הוא **retry נקי מאפס**, לא צריך שום לוגיקת resume מיוחדת.
- אם קורס **אחרי** שה-RPC מסתיים: הרשומה כבר CLAIMED. זה בדיוק המצב שמנגנון ה-crash-recovery **הקיים והנבדק** (`claimOrResume`'s "claimed"/"started" branches, `OUTCOME_UNKNOWN`) כבר יודע להתמודד איתו — ללא שינוי נוסף.
- **אין רגע אחד שבו רשומה של live-human decision יושבת ב-APPROVED, חשופה, ניתנת ל-claim על ידי מישהו אחר.** מבחינת ה-state machine, ה"APPROVED" הזה פשוט לא קיים בנתיב הזה.

---

## חוסם 2: זהות המבצע האמיתית

זיהית נכון שהעיצוב המקורי שלי היה שגוי: קבעתי `executorId: requestedBy` (כדי "לספק" את האילוץ הישן) בזמן שהזהות האמיתית (`decidedBy`) הועברה רק כערוץ צדדי (`onBehalfOfUserId`, `dispatchInput.decidedBy`) — כלומר `claimed_by`/`actorId` ב-audit היו מראים את המבקש המקורי, לא את מי שבאמת קיבל את ההחלטה והריץ אותה.

**עם ה-RPC החדש זה נפתר לגמרי, בלי לזייף שום דבר:** `claimed_by = p_decided_by` ישירות. אין יותר צורך "לספר סיפור" עם `requestedBy` בתור executor — ל-RPC החדש יש חוזה משלו (PENDING→CLAIMED דורש decidedBy ≠ requestedBy, לא דורש executorId===requestedBy בכלל, כי זו לא הפונקציה `claim_live_approval_request` הישנה). ברמת ה-TypeScript: `actor.agentId = deciderId`, `executorId` המועבר ל-claim = `deciderId` — עקבי לגמרי, בלי מיפוי-מחדש בשום שכבה. ה-audit (`actorId`) יראה נכון את מי שבאמת ביצע.

---

## תשובות ישירות לכל סעיף שביקשת

1. **מעברי מצב מדויקים** — טבלה מלאה למעלה, כולל ה-trigger (לא רק ה-RPCs).
2. **`claim_live_approval_request` המדויק** — מצוטט/מוסבר למעלה: דורש APPROVED, בודק expiry, entity/action, **`executorId === requestedBy`**, artifact hash; RPC נפרד קיים, לא נוגע בו.
3. **קריסה בין החלטה ל-claim** — בעיצוב המקורי: תקוע ב-APPROVED, לא ניתן לביצוע ע"י אף נתיב (בטוח מבחינת אבטחה, לא בטוח מבחינת זמינות/ניקיון). נפתר לגמרי ב-RPC החדש (retry נקי מ-PENDING, או crash-recovery קיים מ-CLAIMED).
4. **האם APPROVED יכול להיצרך/למוחזר על ידי נתיב production כלשהו** — `consumeApprovalRequest` (ה-CP6-era) **ללא קוראים כלל ב-working tree הנוכחי** (הדראפט הלא-committed הסיר את הקריאה היחידה שהייתה ב-admin-ops.ts). נתיב ה-claim הישן פתוח לכל APPROVED record, אבל HUMAN_ONLY עדיין חסום שם ללא actor.kind==="HUMAN".
5. **קשירת הזהות** — בעיצוב החדש: ישירה, לא דרך תחליף (`claimed_by = decided_by` ברמת ה-DB עצמה).
6. **האם executorId יכול להישאר requestedBy** — **לא**, ותיקנתי: ה-RPC החדש לא צריך את האילוץ הזה בכלל, כי זו לא אותה פונקציה.
7. **השינוי המינימלי הנדרש** — תוספת אחת ל-trigger (סעיף חוקי חדש), RPC חדש אחד (לא משנה קיימים), case מקביל ב-in-process test backend. שום migration/RPC קיים לא משתנה.

---

## מה נשאר להחליט

- שם ה-RPC (`claim_live_approval_request_as_live_human`? שם אחר?).
- לאשר שמותר לי, בסקופ CP7.2, להוסיף migration SQL **חדשה ותוספתית בלבד** (לא לגעת בקיימות) — לפי הנחייתך המפורשת "propose the smallest correct DB/RPC change", אני מניח שכן, אבל מבקש אישור מפורש לפני כתיבת SQL בפועל, בהתחשב בכך שזה חורג מהסקופ המקורי שהוגדר ("packages/database" לא היה ברשימת הקבצים).
- לאחר אישור: אעדכן את `live-human-execution.ts` (מוחלף לגמרי — קורא ל-RPC החדש דרך `packages/database`/`approvals.ts`, לא ל-`decideApprovalRequest`+`runGovernedClaimedExecution` בנפרד), אעדכן את ה-branch ב-`agent-dispatch-guard.ts` בהתאם (`claimed_by`/`decided_by` שניהם = deciderId עכשיו, לא requestedBy), ואמשיך ל-admin-ops.ts/code.ts/טסטים.

**עוצר כאן, כפי שביקשת. לא נגעתי בקבצים נוספים.**
