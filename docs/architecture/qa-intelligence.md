# QA Intelligence — Architecture

**Status:** NORMATIVE (v1.1 amendment via ADR-009)  
**Product:** ArletOS = Engineering Intelligence + Adaptive QA Intelligence OS

---

## Positioning

```
ArletOS ≠ coding agent
ArletOS  = the engineer who remembers + the QA lead who verifies
```

Natural language entry:

```
"QA על BrokerOS לעומק"
"QA על כל התיק"
"תבדוק רק מה שהשתנה מאז אתמול"
```

The system chooses tests — the user chooses scope/profile, not 30 individual suites.

---

## Domains

| Domain | Question |
| --- | --- |
| Functional | Do features actually work? |
| API | Contracts, statuses, auth, errors |
| UI/UX | Flows, RTL (he/ar), responsive, a11y |
| Security | Permissions, RLS, secrets, injection |
| Database | Migrations, constraints, integrity |
| Integration | GitHub, Supabase, Stripe, Vercel, … |
| E2E | Playwright journeys |
| Unit/Integration | Vitest |
| Regression | Did a change break existing behavior? |
| Performance | Latency, load, Core Web Vitals |
| AI | Hallucination, grounding, citations, prompt injection, tool auth |
| Deployment | Post-deploy smoke (staging / prod-safe) |
| Architecture | Drift vs intended design |
| Portfolio | Repeated weaknesses across apps |

---

## Engines

```
Test Planner          → what to run given risk + change + history
Test Generator        → propose missing tests (PROPOSED until approved)
Test Executor         → run suites in LOCAL / STAGING / PRODUCTION_SAFE
Failure Analyzer      → root cause + dependency chain + history
Regression Intelligence → bug→fix→test→rule memory
Portfolio QA Brain    → cross-project pattern detection
```

---

## Adaptive algorithm

```
Change detected / user request
      ↓
Change impact analysis (engineering graph)
      ↓
Risk classification (auth/payments/migrations = CRITICAL…)
      ↓
Select relevant tests (profile + history + flaky quarantine)
      ↓
Execute
      ↓
Analyze failures → root cause
      ↓
Generate fix plan (PROPOSED)
      ↓
Human APPROVE
      ↓
Apply fix (write-gate)
      ↓
Re-test + regression verification
      ↓
LEARN (pattern + regression rule)
```

---

## Graph extension

```
Project → Feature → Component → API → Database
       → Test → Failure → RootCause → Fix → RegressionTest
```

Edges: `COVERS`, `FAILED_ON`, `CAUSED_BY`, `FIXED_BY`, `PREVENTS`, `RECURRED_IN`

---

## What was missing in the first draft (upgrades)

1. **Flaky-test intelligence** — quarantine, flake rate, don’t treat flakes as CRITICAL forever  
2. **False-positive / feedback loop** — user marks “not a bug” → LEARN reduces noise  
3. **Cost & time budget** — QA runs have token/minute caps; CHANGED_ONLY default after commits  
4. **Contract testing** (OpenAPI/Zod consumer-provider) as a first-class domain  
5. **Accessibility evidence** (axe/playwright a11y) — RTL + WCAG as FACT signals  
6. **Environment policy matrix** — Stripe/live payments never on PRODUCTION_SAFE without explicit profile  
7. **Test debt** — orphan tests, snapshots stale, untested critical paths  
8. **Severity calibration** — user can demote/promote; Portfolio Brain uses calibrated severity  
9. **Idempotent QA runs** — same commit+profile ⇒ reproducible report id / cache  
10. **Golden-path catalog** per project (must-pass journeys) separate from full suite  
11. **Compliance gates** (optional) — WCAG / data residency as PRE-DEPLOY blockers  
12. **Mutation / chaos** — deferred; signal only after DEEP is stable  
13. **Fix vs Test dual write-gates** — generating a test ≠ applying a production fix  
14. **PII/fixture hygiene** — QA must not leak real user data into reports or LLM context  
15. **Multi-locale QA dimension** — he/ar/en string/RTL regressions as portfolio pattern  

---

## Report contract (user-facing)

```
CRITICAL / HIGH / MEDIUM / LOW counts
Evidence-backed readiness (not vanity):
  Test Coverage · Critical Paths · Security · Production
Top Risks (≤5) with provenance
Learned patterns touched
Next recommended actions (PROPOSED)
```

---

## Non-goals

- Not replacing Vitest/Playwright tooling itself  
- Not autonomous production hotfixes  
- Not running destructive chaos on PRODUCTION  
