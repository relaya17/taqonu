# Design Partner Case Study — Fill-in

**Status:** Empty template for a *real* partner run. Do not invent customers.  
**Publish only** after written permission (named or anonymized).

**Copy from:** [`docs/strategy/case-study-template.md`](../strategy/case-study-template.md)  
**Lab format reference (not a customer):** [`001-brokeros.md`](./001-brokeros.md) · live `GET /api/v1/case-studies/brokeros-001`  
**When approved:** save as `docs/case-studies/00X-{slug}.md` and link from the partner tracker.

---

## Meta

| Field | Value |
| --- | --- |
| Partner slot (A–E) | |
| Anonymize as | Company A / named |
| Publish permission | yes · anonymize-only · no |
| Audit dates | |
| Atlas instance / locale | |
| Project id (uuid) | |
| Repo source | local · github · remote |

---

## Baseline (Day 1)

Paste from UI/API after import:

| Metric | Value | Source |
| --- | --- | --- |
| Verdict status | | `/` or `GET …/verdict` |
| Production readiness /100 | | Certificate / Verdict |
| Critical blockers | | Verdict |
| High risks | | Verdict |
| Unverified claims | | Verdict |
| Health overall /100 | | `/health` · `POST …/audit-engine/run` |
| Constitution omissions | | Health report |
| Files analyzed (if any) | | Import / analyze |

---

## Day-0 context (from playbook questions)

- Production-ready means:  
- Least sure about in production:  
- Last incident / unverified before:  
- Senior hrs/week on release / regression / arch:  
- Coding agents in use:  

---

## Findings (Evidence-backed)

| # | Finding | Severity | Previously known? | Evidence (path / claim / check id) |
| ---: | --- | --- | --- | --- |
| 1 | | | Yes / No | |
| 2 | | | | |
| 3 | | | | |

---

## Certificate snapshot (end of week)

```
{Product name}
Production Readiness     {score} / 100
Security … Reliability … Testing … Infra … Observability … Docs
BLOCKERS {b} · HIGH RISKS {h} · UNKNOWN CLAIMS {u}
Last verified: {date}
Verdict: READY | CONDITIONAL | BLOCKED
```

---

## ROI sketch (partner-approved numbers only)

| | Before | After (observed) |
| --- | --- | --- |
| Senior hrs/week on release/regression/architecture | | |
| Unknown production assumptions | | |
| Blockers made explicit | | |

---

## Quote

> “…” — {Role}, {Company or anon}

## Decision

continue · pause · expand to second repo

## What we did *not* claim

No silent WRITE. No “AI fixed production.” Epistemic labels preserved.

## Internal learning for Atlas

- False positives:  
- Missing adapters:  
- Certificate / Constitution notes:  
