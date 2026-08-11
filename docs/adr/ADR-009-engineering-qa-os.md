# ADR-009: Engineering + QA Intelligence OS

## Status

ACTIVE

## Context

ArletOS began as Engineering Intelligence (truth, memory, evidence, graph, portfolio).  
The personal instance also needs a **QA Lead** layer: plan → execute → analyze → learn — without becoming an IDE or autonomous production mutator.

## Decision

**ArletOS = Engineering Intelligence OS + Adaptive QA Intelligence OS.**

Differentiation vs Cursor / Claude Code / Codex:

```
Editors          → write code
ArletOS          → understand system + verify quality + remember failures
```

### Sixth investment pillar (v1.1)

6. **QA Intelligence** — adaptive, risk-based, portfolio-aware verification with a LEARN loop

### Five QA engines + Portfolio QA Brain

```
QA Intelligence Engine
├── Test Planner
├── Test Generator
├── Test Executor
├── Failure Analyzer
└── Regression Intelligence

Portfolio QA Brain  (cross-project pattern memory)
```

### Adaptive loop (normative)

```
OBSERVE → UNDERSTAND → ASSESS RISK → PLAN TESTS → EXECUTE → ANALYZE
→ ROOT CAUSE → PROPOSE FIX → APPROVE → FIX → RETEST → REGRESSION → LEARN
```

WRITE (apply fix / open PR) remains behind the existing write-gate + human APPROVE.

### QA scope

```
Single Project | Selected Projects | Entire Portfolio
```

### QA profiles

```
QUICK | STANDARD | DEEP | SECURITY | REGRESSION | PRE-DEPLOY
| PRODUCTION-SAFE | PORTFOLIO | FULL_AUDIT | CHANGED_ONLY
```

### Environments

```
LOCAL | STAGING | PRODUCTION_SAFE
```

Dangerous checks MUST NOT run against production.

### Epistemic discipline for QA claims

Findings are labeled FACT / INFERRED / PROPOSED.  
Scores (coverage, readiness) MUST cite evidence counts — no vanity AI scores.

## Consequences

- New package `@atlas/qa-core` and shared Zod contracts under `qa.schema.ts`
- Agent intents include QA runs; default mode remains READ/ANALYZE/PLAN
- Portfolio pattern mining treats QA findings as first-class memory
- Does not replace Vitest/Playwright — orchestrates and learns from them
