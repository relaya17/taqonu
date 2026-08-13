# Design Partner Playbook

**Execution pack (READY — awaiting human outreach):**  
[`design-partner-truth10-early-access.md`](./design-partner-truth10-early-access.md) (TRUTH-10 G1) ·  
[`design-partner-audit-runbook.md`](./design-partner-audit-runbook.md) (1-week · URLs/APIs) ·  
[`design-partner-execution-checklist.md`](./design-partner-execution-checklist.md) ·  
[`design-partner-tracker.md`](./design-partner-tracker.md) ·  
[`case-study-template.md`](./case-study-template.md) · fill-in [`../case-studies/_partner-fill-in.md`](../case-studies/_partner-fill-in.md)

## Goal

Prove Atlas finds **unknown or under-verified** engineering risk — not to close a deal.

## Pitch (30 seconds)

We built an **Engineering Truth Layer**. Coding agents stay where they are
(Cursor / Claude Code / Copilot). Atlas connects to the repo and issues a
**Production Readiness Certificate** with every score backed by Evidence.

We’re looking for **5 design partners**. No invoice. One repo. **One week**
(or two if they can deepen). You get the findings; we get truth about whether
this saves senior time.

## Qualification

- 5–40 engineers  
- Weekly deploys (or want to)  
- GitHub (or local monorepo)  
- Willing to share non-secret architecture context  
- One technical champion (Staff/TL) + optional founder

## One-week motion (default)

See the full click/API map: [`design-partner-audit-runbook.md`](./design-partner-audit-runbook.md).

| Day | Action |
| --- | --- |
| 0 | NDA optional · repo access · Day-0 questions · storage mode |
| 1 | Connect at `/partners` · Verdict + Certificate baseline |
| 2 | `/health` Constitution audit · capture omissions / UNKNOWNs |
| 3–4 | Deepen Evidence · previously-known? per finding |
| 5 | Optional: one governed Patch / risk drill |
| 6 | Internal readout rehearsal |
| 7 | Champion readout · case-study fill-in · tracker row |

## Two-week motion (optional deepen)

| Day | Action |
| --- | --- |
| 0 | NDA optional · repo access · golden path agreed |
| 1 | Connect GitHub/local · Discover · Certificate v0 |
| 2–5 | Deepen Evidence · blockers · UNKNOWN claims |
| 6–8 | Optional: one governed Patch / risk drill |
| 9 | Readout with champion |
| 10 | Capture metrics for case study |

## Questions to ask on Day 0

1. What would “production ready” mean for this product in one sentence?  
2. What are you least sure about in production?  
3. Last incident — what was unverified before it happened?  
4. How many hours/week do seniors spend on release review / regression?  
5. Which coding agents do you already use?

## Success criteria (partner)

At least **one** of:

- ≥1 previously unknown HIGH/CRITICAL risk with Evidence  
- ≥1 production blocker made explicit (BLOCKED/UNKNOWN → owned)  
- Stale architecture claim detected  
- Regression risk caught before a planned deploy  

## Success criteria (us)

- Certificate generated with drill-down Evidence  
- Champion quotes time/risk impact  
- Written permission to anonymize as Case Study  
- Decision: continue / pause / expand to second repo  

## Do / Don’t

**Do:** show Evidence paths, epistemic labels, approval gates.  
**Don’t:** demo chat that “sounds smart”, silent WRITE, vanity health %.

## Outreach email (EN)

Subject: Production readiness with Evidence — design partner?

Hi {Name},

We’re validating Atlas (ArletOS): an engineering truth / governance layer that
sits above coding agents (Cursor, Claude Code, Copilot, etc.). The first
workflow is a **Production Readiness Certificate** — scores for security,
reliability, testing, infra, observability, docs — each openable to Evidence —
plus a Release Verdict and a System Health / Constitution audit.

Would you be open to connecting **one** production repository for a **one-week**,
no-cost design partner audit? Goal: see if Atlas surfaces risks your team
doesn’t already track. No invoice; you keep the findings.

Happy to start with a 20-minute call.

{You}

---

## Outreach email (HE)

נושא: מוכנות לפרודקשן עם Evidence — שותף עיצוב?

שלום {Name},

אנחנו מאמתים את Atlas (ArletOS): שכבת אמת והנדסת ממשל מעל סוכני קוד
(Cursor / Claude Code / Copilot וכו'). הזרימה הראשונה היא **תעודת מוכנות
לייצור** — ציונים לאבטחה, אמינות, בדיקות, תשתית, תצפיתיות ותיעוד — כל ציון
נפתח ל־Evidence — בנוסף לפסק דין לשחרור וביקורת בריאות מערכת / חוקה.

האם תהיו פתוחים לחבר **מאגר ייצור אחד** לביקורת שותף עיצוב של **שבוע**, ללא
עלות? המטרה: לבדוק אם Atlas מציף סיכונים שהצוות עדיין לא עוקב אחריהם.
אין חשבונית; הממצאים נשארים אצלכם.

אשמח להתחיל בשיחת 20 דקות.

{You}

---

## After they say yes

1. Log a row in [`design-partner-tracker.md`](./design-partner-tracker.md) (no invented names).  
2. Run [`design-partner-audit-runbook.md`](./design-partner-audit-runbook.md).  
3. Capture with [`../case-studies/_partner-fill-in.md`](../case-studies/_partner-fill-in.md).
