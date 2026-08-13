# TRUTH-10 · Design Partner Early Access (G1)

**Status:** READY for human outreach (slots empty until real partners)  
**Parent:** [`ATLAS-TRUTH-10.md`](./ATLAS-TRUTH-10.md)  
**Companions:** [`design-partner-playbook.md`](./design-partner-playbook.md) · [`design-partner-tracker.md`](./design-partner-tracker.md) · [`design-partner-audit-runbook.md`](./design-partner-audit-runbook.md)

## What we sell in Early Access

Not “AI that codes.”  
**Change → Impact → Evidence → Risk → Verification** on one truth model.

Primary surfaces for partners:

| Surface | URL | Purpose |
|---|---|---|
| ATLAS HEALTH | `/truth` | One dashboard: scores, drifts, counters, history |
| Observer | `/observer` | Bugs + cycle detail |
| System Health | `/health` | Constitution / audit |
| Readiness | `/readiness` | Certificate / verdict |

## Isolation (non-negotiable claim)

- Partner code stays in **their** linked workspace / BYO storage.
- Atlas does **not** train models on customer code across tenants.
- Findings and counters may be aggregated anonymously only with permission.
- See Truth UI isolation note + `docs/strategy/byo-storage.md`.

## Offer (what they get)

- Atlas Early Access (no invoice for the pilot week)
- Observer + Knowledge Graph + Expected Behavior Model
- Continuous hooks if GitHub/deploy feeds are connected
- Written readout of findings with epistemic labels

## What we need back

- 1 real repository (local path or GitHub)
- CI/CD context (even if partial)
- 2–3 known past bugs/regressions (for calibration)
- Feedback on false positives / misses
- Permission to count anonymized metrics:
  - changes analyzed
  - meaningful risks
  - confirmed regressions
  - caught before production

## 5-day Truth pilot (lightweight)

| Day | Partner action | Atlas proof |
|---:|---|---|
| 0 | NDA optional · link repo · Day-0 questions | — |
| 1 | Connect project folder/GitHub · open `/truth` · Run observe | Baseline EXPECTED + Graph |
| 2 | Make or replay one real change · Run observe again | EXPECTED vs OBSERVED drift |
| 3 | Review evidenceRefs + risk · optional Promote EXPECTED | Graph-aware risk |
| 4 | Enable webhook/deploy feed if available | Continuous observe |
| 5 | Champion readout · fill tracker + case-study stub | Counters export |

## Success metrics (investor-ready)

Target narrative after 3–5 partners (example shape — replace with real numbers):

```
Atlas analyzed N changes
detected M meaningful risks
K were confirmed regressions
C were caught before production
```

Pull live counters from linked workspaces: `.atlas/metrics/truth-counters.json`  
or Truth UI strip after observe cycles.

## Qualification (same as playbook, Truth-focused)

- 5–40 engineers
- Weekly deploys (or want to)
- Willing to discuss one past behavioral regression
- Technical champion available for 30–60 min readout

## Tracker slots

Use [`design-partner-tracker.md`](./design-partner-tracker.md) rows A–E.  
Add note: `Truth pilot · week of YYYY-MM-DD`.

## Outreach blurb (Hebrew)

אנחנו בונים שכבת אמת הנדסית — לא צ׳אט שכותב קוד.  
Atlas מזהה שינויים משמעותיים, מסביר השפעה עם ראיות, ובודק אם ההתנהגות עדיין נכונה.  
מחפשים 3–5 Design Partners לשבוע אחד על ריפו אמיתי. בלי חשבונית. בתמורה: ממצאים + למידה משותפת.

## Outreach blurb (English)

We built an Engineering Truth Layer — not another coding chatbot.  
Atlas detects meaningful changes, explains impact with evidence, and verifies behavior still holds.  
Looking for 3–5 design partners for a one-week pilot on a real repo. No invoice. You get findings; we get truth.

## Do not

- Promise automatic production fixes
- Train partner A’s code into answers for partner B
- Count BrokerOS / lab fixtures as design partners
