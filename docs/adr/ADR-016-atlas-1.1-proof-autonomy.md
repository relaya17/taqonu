# ADR-016: Atlas 1.1 — Proof & Autonomy

## Status

ACCEPTED (Phase 2 MVP)

## Context

Phase 1 delivered foundation: Evidence, Memory, Experts, QA, Security,
governed Patches, Gates, Eval, adapters. The next proof is not more UI —
it is a measurable engineering loop on a real Golden Project.

## Decision

### Golden Project

**BrokerOS** (`brokerOS-main`) is the Golden Project for Atlas 1.1.

Configure via:

- `ATLAS_GOLDEN_PROJECT_ROOT`
- `ATLAS_GOLDEN_PROJECT_SLUG=brokeros`

### End-to-End Engineering Loop

```
understand → evidence → impact → plan → generate → patch
 → unit → integration → typecheck → lint → security
 → experts → risk → HUMAN APPROVAL → apply → regression
 → evidence update → decision log
```

Only human approval may authorize WRITE. Heavy checks are optional
(`runHeavyChecks`) so CI/dev can stay fast.

### Action Engine

Every request is classified before coding:

`CODE_CHANGE | TEST_CHANGE | DOCUMENTATION | CONFIGURATION |
 INFRASTRUCTURE | EXTERNAL_INTEGRATION | HUMAN_ACTION | UNKNOWN`

Atlas must not default every problem to a code patch.

### Benchmark Suite (`atlas-evals/`)

Permanent tasks with acceptance criteria. BrokerOS Tasks A–F ship in MVP.
Target: grow toward 100 tasks with pass/fail + unauthorized-write = 0.

### Regression Intelligence

Compare suite pass rates. Drop or task PASS→FAIL ⇒ **BLOCKED**.

### Product KPIs

| Metric | Meaning |
| --- | --- |
| Truth | Claims backed by evidence |
| Engineering success | Tasks solved |
| QA accuracy | Relevant/correct findings |
| Autonomy | Lifecycle without unauthorized writes |

## Non-goals (later phases)

- Portfolio Intelligence dashboard (Phase 3)
- Autonomous GitHub PR merge (Phase 4)
- Full self-audit corpus (Phase 5)
- Multi-tenant enterprise (Phase 6)

## Consequences

- UI: `/he/proof`
- APIs: `/api/v1/engineering/loop*`, `/api/v1/benchmarks*`, `/api/v1/actions/classify`, `/api/v1/golden/project`
- Package: `@atlas/engineering-loop`
- Docs: `atlas-evals/README.md`
