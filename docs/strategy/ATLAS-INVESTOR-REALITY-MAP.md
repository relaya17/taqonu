# Atlas Investor Reality Map

**Status:** internal + sendable memo  
**Date:** 2026-09-20  
**Audience:** founder first; selected investors second  
**Rule:** market numbers are cited; Atlas claims are only what is locally proven. Production is **not** proven. No Atlas valuation is asserted.

---

## How to use this

| Copy | Who sees it | Purpose |
| --- | --- | --- |
| [`ATLAS-INVESTOR-ONE-PAGER.md`](./ATLAS-INVESTOR-ONE-PAGER.md) | Google Docs | Paste and share a link |
| [`ATLAS-INVESTOR-ONE-PAGER.html`](./ATLAS-INVESTOR-ONE-PAGER.html) | PDF | Open in Chrome → Ctrl+P → Save as PDF (A4; page 1 EN, 1–2 bilingual) |
| [`ATLAS-INVESTOR-OUTREACH.md`](./ATLAS-INVESTOR-OUTREACH.md) | You | First email; no amount; three thesis families |
| English one-pager (below) | Same text as the dedicated one-pager | Kept here so this file still stands alone |
| Full Hebrew memo | You + Israeli investors | Positioning, map, proofs, dilution math |
| Competitive table | Any investor who asks “is this Cursor?” | Category, not feature list |
| Proof stack | Diligence | What is proven vs missing |
| Fundraising tracks | You only until a round is designed | Do not open with “what % do I give” |

**Do not send** a feature inventory (IDE + LSP + PTY + Git + CaseFlow + Vantera + …). That reads as ten products.

---

## English one-pager (send this)

**Atlas is the trust, memory, evidence and control layer for AI-native software systems. Arlet Studio is the first environment where that infrastructure is tangible to a developer.**

AI is making software cheaper to write. It is not making software cheaper to trust. Stack Overflow (2025) reports ~84% of developers using or planning to use AI tools, while 46% distrust output accuracy and 66% are frustrated by “almost right” answers. The bottleneck is moving from generation to **verification, authority, memory and audit**.

That second-order market is already being priced:

- Cognition (Devin) raised **$2B at $48B** (Reuters, 8 Sep 2026); company-reported run-rate revenue **~$900M**.
- Factory raised **$200M at $5B** (Reuters, 15 Sep 2026).
- CodeRabbit raised **$143M at $1.5B** (Reuters, 12 Aug 2026) and now sells **Agentic Change Management** — “code is abundant, judgment is scarce.”
- LangChain raised **$125M at $1.25B** (Oct 2025) as **agent engineering infrastructure**, not an IDE.

Atlas is not a better Cursor. Cursor sells speed of writing. Atlas sells **whether an Agent may act, on what evidence, under whose authority, and whether the result was verified**.

**What exists today (local, not production):** a governed Agent path — proposal → deterministic Guardian (`CONSISTENT` / `CONFLICT` / `UNKNOWN`) → human SoD approval → Apply → Verify → scoped memory. Agent ≠ Model. Agent ≠ unrestricted shell. Control is a separate trust plane from Studio.

**What does not exist yet:** production proof, paying customers, a measured Proof-of-Value, cloud memory sync, a debugger.

**Ask:** not a priced round this week. First: finish the eight proofs on real work, then a small paid design-partner, then a raise sized to the next 18 months of evidence — not to a feature list.

---

## 1. המשפט האחד

> AI יודע לייצר תוכנה מהר יותר ממה שבני אדם יודעים לאמת אותה.  
> Atlas נבנה כשכבת **ראיות, זיכרון ושליטה** שהופכת עבודה של Agent לניתנת לאמון ולניהול.  
> Arlet Studio הוא היישום הראשון שמוכיח את התזה.

זה הסיפור. לא “IDE עם AI”.

---

## 2. מה באמת קורה בשוק (ולמה זה שלך)

השוק כבר לא שואל אם AI משנה פיתוח תוכנה. הוא שואל **איזה חלק מה-stack יהפוך לתשתית חובה**.

שתי שכבות מקבילות:

| שכבה | שאלה | מי מתומחר שם עכשיו | מה Atlas **לא** |
| --- | --- | --- | --- |
| A. Generation | איך לכתוב / לבצע מהר יותר | Cursor, Cognition/Devin, Factory, Replit | לא זה הקרב |
| B. Trust / Control | מתי זה נכון, למי מותר, מה קרה, למה אפשר לסמוך | CodeRabbit (change mgmt), LangChain (build agents), Mem0 (memory), Onyx/Mind (security) | זה הצומת |

הנתונים שחשובים לתזה — לא לשווי של Atlas:

- שימוש ב-AI עולה; **אמון בפלט לא**. ~84% משתמשים/מתכננים; 46% לא סומכים על דיוק; 66% מתוסכלים מ”כמעט נכון” (Stack Overflow 2025).
- כלי AI מגדילים פעילות קידוד יותר מאשר shipping בפועל (NBER 2026, מדגם גדול). **Writing is cheap. Shipping correct software is still expensive.**
- Gartner: עד 2027, בצוותים agentic, ה-IDE עלול להפוך לאופציונלי; control / governance / validation עוברים לפלטפורמות.
- McKinsey: שימוש נרחב ב-gen AI בלי השפעה מקבילה על השורה התחתונה. Insight: המעבר מ-“how do we build agents” ל-“how do we govern them in production”.
- Carta Q1 2026: יותר מ-**60%** מהון ה-VC בחברות על Carta זרם ל-AI — **ועם זאת תווית AI לבדה לא נותנת שווי.**

**עדכון חד יותר מהמחקר שצירפת (אימות מקורות, 8–15 בספטמבר 2026):**

| חברה | סבב | שווי | מקור | למה זה חשוב ל-Atlas |
| --- | --- | --- | --- | --- |
| Cognition (Devin) | $2B Series E, 8 Sep 2026 | **$48B** | Reuters | שכבת ה-Agent-as-engineer כבר עם run-rate ~$900M. אל תתחרו בהם על “המהנדס”. |
| Factory | $200M, 15 Sep 2026 | **$5B** (מ-$1.5B באפריל) | Reuters + Factory | כוח עבודה agentic לארגונים. **Insight Partners בפנים** — אם פונים אליהם, Atlas חייב להיות משלים, לא תחרות. |
| CodeRabbit | $143M Series C, 12 Aug 2026 | **$1.5B** | Reuters | המוצר הכי קרוב נרטיבית: יותר קוד AI → צוואר בקבוק של שיפוט. הם review/change management. Atlas הוא evidence + authority + verify. |
| LangChain | $125M Series B, Oct 2025 | **$1.25B** | TechCrunch | תשתית לבניית Agents. Atlas שואל מה Agent **יודע / מורשה / אימת**. |
| Replit | $400M, Mar 2026 | **$9B** | דיווחים 2026 | Workspace/generation. לא הקטגוריה. |

Cognition כמעט הכפילה שווי מ-$26B במאי ל-$48B בספטמבר, עם run-rate מ-$492M ל-~$900M. זה מוכיח שהשוק משלם על **ביצוע**. הוא עדיין לא סגר את שכבת **האמון**.

CodeRabbit כבר אומרת בקול את המשפט שלך: *“Code is abundant. Judgment is scarce.”* זה לא אומר שהקטגוריה תפוסה. זה אומר שהמשקיע כבר שמע את כאב ה-second-order. ה-whitespace הוא החיבור Memory × Evidence × Policy × Execution × Verify — לא עוד review bot.

---

## 3. מיקום Atlas (לא Cursor)

```
Human
  → Agent          (role + tools + budget + policy — not the LLM)
    → Guardian     (CONSISTENT / CONFLICT / UNKNOWN, no LLM)
      → Approval   (SoD, human authority)
        → Apply    (governed write)
          → Verify (system checks reality)
            → Evidence
              → Memory (scoped: owner + project + provenance)
```

| שכבה | תפקיד | Buyer |
| --- | --- | --- |
| **Atlas** | Truth / memory / evidence / governance | ליבת החברה |
| **Arlet Studio** | Workspace אנושי + Personal Agent | מפתח / צוות (wedge) |
| **Control** | מדיניות, זהות, audit, פיקוח ארגוני | ארגון (expansion) |
| **Verticals** (CaseFlow, Vantera, LexStudy, …) | סביבות אמיתיות שבהן Atlas נבחן | Proof points — לא חברות נפרדות |

**Agent ≠ Model.** המודל יכול לומר “נראה לי שזה נכון”. Agent צריך להיות מסוגל לומר: בדקתי את ה-repo, ה-repo אומר X, ה-proposal אומר Y, לכן **CONFLICT** — בלי להאמין למודל.

**Memory ≠ RAG.** זיכרון Atlas הוא עובדה + בעלים + פרויקט + provenance + מצב אפיסטמי + אימות + היסטוריה + מדיניות. לא וקטור-DB עם סיפור יפה.

**Control ≠ Studio.** מישורי אמון נפרדים (ADR-021). אל תמזגו אותם במשפט אחד למשקיע.

**Verticals ≠ “יש לנו הרבה אפליקציות”.**  
Atlas **לא מבצע** את הכלים של האפליקציות המחוברות (ADR-022). הן סביבות שבהן אפשר להראות: איזה Agent, איזה הקשר, איזה HMAC/preflight, איזה חסימה, איזה audit. זה **פיקוח על עולם אמיתי**, לא “עוד SaaS שכתבנו”.

---

## 4. מפת תחרות — מה כל אחד מחזיק

| שחקן | שכבה | מה הם מוכרים | מה הם **לא** | יחס ל-Atlas |
| --- | --- | --- | --- | --- |
| Cursor / Anysphere | Workspace | מהירות כתיבה | סמכות, SoD, verify כמערכת אמת | לא המתחרה האסטרטגי |
| Cognition / Devin | Autonomous engineer | ה-Agent כמהנדס | שכבת אמון חיצונית ל-Agent | משלים אפשרי / איום אם ייכנסו ל-governance |
| Factory | Agentic workforce | Agents לכל ה-SDLC הארגוני | Evidence epistemology | אותו הערה; Insight כבר בפנים |
| CodeRabbit | Quality / change mgmt | Review + ניהול שינוי agentic | Memory עם accountability + Apply/Verify | הכי קרוב נרטיבית; צר יותר |
| LangChain | Agent engineering | לבנות ולהפעיל Agents | “מה נכון במציאות של הפרויקט” | תשתית אחרת |
| Mem0 | Agent memory | זיכרון מתמשך | Provenance + policy + verify | רכיב, לא המערכת |
| E2B / Niteshift | Runtime / sandbox | מחשב ל-Agent | Authority + evidence | Studio/PTY הוא runtime אנושי; execution לבד לא מספיק |
| Onyx / Mind | Security | Control plane / leakage | Verification של שינוי תוכנה | שכבת סיכון, לא Truth |

**Whitespace (לא “אין מתחרים”):** החיבור של memory + evidence + epistemic state + policy + governed execution + verify + audit, מחוץ ל-Agent עצמו.

הניסוח למשקיע:

> AI Agents can now do real work. The infrastructure for knowing **what they know, what they may do, why an action is trusted, and whether the result is correct** is still fragmented. Atlas is that layer.

---

## 5. שמונה הוכחות — מצב אמיתי (לא מצגת)

| # | הוכחה | מה חייבים לראות | מצב נכון להיום (2026-09-20) |
| --- | --- | --- | --- |
| 1 | Agent מול מציאות | הצעה שגויה → **CONFLICT** | **מומש מקומית.** Guardian דטרמיניסטי, בלי LLM. |
| 2 | יודע שהוא לא יודע | חוסר ראיות → **UNKNOWN**, לא ביטחון מזויף | **מומש מקומית.** UNKNOWN לא מומר ל-CONSISTENT. |
| 3 | לא חורג מסמכות | פעולה אסורה → **BLOCK** | **מומש מקומית.** אין shell חופשי ל-Agent; PTY אנושי בלבד. |
| 4 | אדם נשאר הסמכות | בלי approval אין Apply כשהמדיניות דורשת | **מומש מקומית (SoD).** Apply של בעלים עצמי נחסם. **לא** proven בייצור. |
| 5 | המערכת מאמתת את עצמה | Apply → Verify על דיסק/מציאות | **מומש מקומית** על נתיב Path-1. **לא** production. |
| 6 | זיכרון משפר עבודה הבאה | תיקון מאומת חוזר כהקשר | **חלקי.** זיכרון מסוים ל-owner+project; סנכרון ענן **חסום חיצונית**. |
| 7 | בידוד | עובדה מפרויקט A לא זולגת ל-B | **מומש מקומית** בטסטים ובנתיבים חיים מקומיים. |
| 8 | Audit | who / agent / project / proposal / policy / approval / result / verify | **מומש מקומית** (NDJSON/API). Control נפרד. Production audit **לא** proven. |

**חסר למשקיע רציני, בלי קישוט:**

- לקוחות משלמים / design partner עם שימוש לאורך זמן  
- מדד Before/After (שעות, דחיות, רגרסיות, reuse של memory)  
- Production (AWS עדיין חסום; **PRODUCTION: NOT PROVEN**)  
- Debugger  
- סנכרון זיכרון ענן  

Market thesis: **חזקה**.  
Technical thesis: **מעניינת ומתקדמת מקומית**.  
Product thesis: **מתגבשת**.  
Production + customer proof: **חסרים**.  
Investor readiness: **עוד לא**. זה תקין — קודם המכונה, אחר כך הדלק.

---

## 6. מה משקיע צריך לשמוע — ומה אסור

**כן:**

- בעיה אחת: אמון ושליטה על עבודת Agent במערכות אמיתיות  
- Studio כ-wedge שמוכיח את Atlas  
- Control כשכבה ארגונית מאוחרת יותר  
- Verticals כ-testbed של פיקוח, לא כפורטפוליו מוצרים  
- הוכחות 1–8, עם הפרדה בין local ל-production  

**לא:**

- “בנינו IDE עם AI, LSP, Git, terminal, debugger, Atlas, Control, CaseFlow…”  
- “אנחנו ה-Cursor הבא”  
- “Atlas שווה $X מיליארד”  
- “הענן עובד” כשהסנכרון חסום  
- “ייצור מוכן”  
- “אנחנו מריצים את CaseFlow/Vantera” — Atlas מפקח; הוא לא ממלא את תפקיד האפליקציה (ADR-022)

---

## 7. לקוח ראשון מול שוק סופי

| שלב | מי | למה |
| --- | --- | --- |
| Wedge | מפתח / צוות קטן | Studio כבר מראה Agent, Guardian, Apply, Verify, memory, terminal אנושי |
| Expansion | ארגון הנדסה | Control: מדיניות, זהויות, approvals, audit, בידוד צוותים |
| Long-term | כל מערכת agentic | אותה שכבת אמון מחוץ ל-coding בלבד — **רק אחרי** שה-wedge הוכח במספרים |

GTM שכבר כתוב אצלכם: **Readiness Audit / design partner מקומי**, לא “מושבים בענן” כל עוד אין VM ייצור.

---

## 8. מודל גיוס — קודם סכום ומטרה, אחר כך אחוז

אין משמעות לשאלה “כמה לתת למשקיע?” בלי: כמה כסף, לכמה חודשים, לאילו הוכחות.

**עובדות שוק (לא מחיר של Atlas):**  
Carta, שישה חודשים עד יולי 2026, תוכנה: חציון Seed **$4.1M על $24.3M post-money ≈ 18% דילול**. Q4 2025: חציון Seed post **$24M**. Pre-seed SAFE $1–2.5M נע סביב cap ~$15M ב-2025.  
Carta Q1 2026: >60% מההון ל-AI — **פער עצום בין מי שיש traction לבין השאר.**

Atlas היום: מוצר מקומי חזק, **בלי ייצור ובלי לקוחות**. זה **לא** מצדיק אוטומטית את חציון ה-AI. חציון הוא רצפה של חברות עם סיפור *ו* שימוש, לא תג מחיר על thesis.

### שלושה מסלולים (תרחישים, לא המלצת “תבקשי X”)

דילול ב-SAFE post-money = סכום ÷ post-money.

| מסלול | סכום (סדר גודל) | Post-money אינדיקטיבי | דילול גס | למה הכסף | מתי זה לגיטימי |
| --- | --- | --- | --- | --- | --- |
| **A · Lean** | $1.5–2.5M | $12–18M | ~12–18% | סגירת Studio, 8 הוכחות על עבודה אמיתית, 1–3 design partners, מדידת PoV | עכשיו / אחרי העימות הסופי |
| **B · Seed** | $3.5–5M | $20–28M (סביב חציון Carta אם יש PoV) | ~16–20% | צוות קטן, אבטחה, פיילוטים, Control ראשוני | אחרי PoV מדיד, לא לפני |
| **C · Aggressive** | $8–12M | $40–70M | ~15–25% | enterprise, compliance, כמה verticals | רק עם לקוחות + מדדים; אחרת דילול יקר על אוויר |

**דוגמה חשבונית בלבד:** $4M / $20M post = **20%**. $4M / $30M post = **13.3%**.  
Option pool refresh בדרך כלל מוסיף 5–10% דילול למייסדים מעבר לשורה הזו.

**מה מזיז את ה-valuation למעלה (בשליטתך):**  
הוכחות 1–8 בלייב → PoV מספרי → design partner משלם → production plane.  
לא עוד פיצ’ר ב-Studio.

**Insight / a16z / Team8 — התאמת thesis, לא “מי הכי טוב”:**

| משפחה | למה thesis | זהירות |
| --- | --- | --- |
| AI infra / devtools (a16z וכו’) | Agents כמשתמשי תוכנה; תשתית מתחת ל-Agent | הם כבר שמו כסף על Cognition. אל תישמעי כמו Devin. |
| Enterprise AI / governance (Insight וכו’) | lifecycle, אבטחה, production | Insight גם ב-Factory (ספט 2026). מסגור: משלים. |
| ישראל / סייבר (Team8 ודומיה) | identity, governance, enterprise | אל תהפכי את Atlas ל-DLP. Truth ≠ scanner. |

---

## 9. סדר עבודה לפני חדר משקיעים

1. **סגירת נתיב הסוכן** (Guardian → SoD → Apply → Verify → memory) יציב על פרויקט אמיתי  
2. **עימות סופי** — שמונה ההוכחות, בלי פיצ’רים מסיחים  
3. **Proof-of-Value** על צוות קטן: זמן פתרון, דחיות Guardian, כשלי verify, reuse של memory, אישורי אדם  
4. **Investor Reality Room** (המסמך הזה + data room: ארכיטקטורה, ADRs, ראיות, מדדים)  
5. **Fundraising model** — בחירת מסלול A/B/C  
6. **רק אז** סכום, cap, ודילול  

האפליקציות המחוברות נכנסות לחדר כ:

```
Atlas (memory / evidence / policy)
    → CaseFlow / Vantera / LexStudy  (סביבות אמיתיות)
        → Control / Audit
```

לא כרשימת מוצרים.

---

## 10. Positioning hypothesis (לנעול)

**Atlas is building the trust, memory, evidence and control layer for AI-native software systems. Arlet Studio is the first environment where that infrastructure becomes tangible to a developer.**

צומת הקטגוריה:

`AI Developer Infrastructure × Agent Memory × Verification × Governance × Human-in-the-loop`

זה גדול מ-AI IDE. זה עדיין **לא** חברה שמוכנה לסבב רק כי השוק חם.

---

## Sources (market; not Atlas)

- Cognition $2B / $48B, run-rate ~$900M — Reuters, 8 Sep 2026  
- Factory $200M / $5B — Reuters + Factory, 15 Sep 2026  
- CodeRabbit $143M / $1.5B, Agentic Change Management — Reuters, 12 Aug 2026; CodeRabbit: 17k+ customers, ~2M reviews/week (company)  
- LangChain $125M / $1.25B — company + TechCrunch, 20 Oct 2025  
- Carta seed medians and AI share of VC — Carta State of Private Markets Q1 2026; Carta LinkedIn software benchmarks Jul 2026  
- Stack Overflow Developer Survey 2025 (AI trust / usage)  
- Atlas product claims in this memo: local remaining-work + ADRs 017/021/022; production explicitly **NOT PROVEN**
