# ADR-014: Evidence-driven governance north star

## Status

ACCEPTED

## Context

ArletOS is a personal instance of **Atlas Core**. The product must not compete as
an AI coding assistant / IDE. The durable differentiation is:

> Atlas knows the state of the software, why we believe it, what is dangerous,
> and what is still unproven.

This ADR locks the north-star architecture described in the 2026-08 product
review (Evidence Model, Expert Evidence Council, Risk Engine, Quality Gate
Graph, event-sourced memory, Conflict Center, Source Authority, WRITE pipeline,
Provider Adapters, Evaluation Engine, data classification, freemium metering,
self-audit).

## Decision

### 1. Product definition (normative)

**Atlas Core** is an evidence-driven engineering governance and adaptive QA
intelligence layer for multi-project software portfolios.

**ArletOS** is the product instance of Atlas Core.

```
ArletOS / Atlas
  Truth + Evidence · QA Intelligence · Expert Council
  Memory + Decisions · Conflicts · Quality Gates
        │
   Git / CI / Cloud / External APIs
        │
   BrokerOS · HotelOS · CaseFlow · Vantera · LexStudy · …
```

Atlas governs truth, risk, and readiness — and may also produce **governed**
code changes (patches) under approval. It is **not** an IDE replacement.
External editors remain first-class execution surfaces (see ADR-015).

### 2. Epistemic core (target Evidence Model)

Current runtime states (v1):

`FACT | CONFIRMED | INFERRED | PROPOSED | UNKNOWN | CONFLICTED`

Target Evidence Model (v2 — migrate carefully, never silently collapse):

| Status | Meaning |
| --- | --- |
| FACT | Immutable observed artifact (hash, log line, test report) |
| VERIFIED | Claim proven by required evidence set |
| OBSERVED | Seen in environment / staging / live |
| INFERRED | Derived with labeled reasoning |
| ASSUMED | Explicit human/product assumption |
| UNVERIFIED | Claimed (e.g. in code/README) without proof |
| CONTRADICTED | Conflict with higher-authority evidence |
| STALE | Was true; superseded by newer observation |
| UNKNOWN | Insufficient evidence to classify |

Every claim carries:

```
Claim
 ├─ epistemicStatus
 ├─ source
 ├─ evidenceIds[]
 ├─ observedAt
 ├─ verifiedAt
 ├─ confidence
 ├─ expiresAt
 └─ derivedFrom[]
```

**Hard rule:** “exists in code” ≠ “proven in production”.
Engineering completeness and production verification are separate scores.

### 3. Expert Council → Evidence Council

Experts keep domains (Engineering, QA, UI/UX, Visual Design, A11y, Security,
Product, DevOps) but each expert must declare a contract:

```
domain · capabilities · requiredEvidence · forbiddenAssumptions
evaluationCriteria · severityModel · scoringModel · escalationRules
```

Experts may not assert unverifiable absolutes (“the system is secure”).
They assert evidence-backed statements or explicit UNKNOWN / UNVERIFIED.

### 4. QA → Adaptive Risk Engine

```
Risk = Impact × Probability × Change Surface × Uncertainty × Missing Evidence
```

QA plans prioritize CRITICAL → HIGH → … automatically (adaptive).

### 5. Quality Gate Graph

Release readiness is a DAG of gates (`PASS | FAIL | BLOCKED | UNKNOWN | STALE | WAIVED`),
not a single health percentage. Atlas must explain blockers in plain language.

### 6. Memory is event-sourced temporal truth

```
Event → Observation → Claim → Decision → Evidence → Evaluation → Resolution
```

Prior claims become STALE when newer verified evidence supersedes them.

### 7. Conflict Center is first-class

Conflicts resolve by **Source Authority** + freshness + reproducibility, not by
LLM preference.

Authority ranking (highest first):

1. Live production observation  
2. Automated verified test  
3. Staging observation  
4. CI artifact  
5. Repository code  
6. Architecture document  
7. Developer statement  
8. LLM inference  

### 8. WRITE pipeline (amended by ADR-015)

```
READ → ANALYZE → PROPOSE → EVALUATE → SIMULATE
  → HUMAN APPROVE → WRITE (apply patch) → VERIFY → ROLLBACK if regression
```

**WRITE is controlled, auditable, reversible, and approval-gated** — not
permanently disabled. Atlas may generate patches, tests, and fixes; apply only
after eval write-gate + human APPROVE (dual approval for dangerous domains).
External workers (Cursor / Claude Code / CI) are optional apply surfaces.
See ADR-015.

### 9. Integrations via Provider Adapter

```
Provider Adapter → Normalized Evidence → Atlas Evidence Graph
```

GitHub is the first adapter — not the architecture. Vercel, Supabase, Sentry,
Stripe, CI, etc. normalize into the same evidence shape.

### 10. Evaluation Engine + self-audit (DEF-000)

`POST /api/v1/eval/runs` grows into a full Evaluation Engine.
**Atlas must discover, analyze, QA, expert-review, and evaluate itself.**

### 11. Security & classification

```
Repo → secret/PII scan → permission filter → context minimization → LLM
```

Every egress has a context manifest. Evidence has classification
(`PUBLIC … RESTRICTED`); providers declare allowed classification.

### 12. Freemium metering axes

Separate quotas for: projects · evidence volume · evaluation compute ·
LLM credits · integrations · retention. “100 projects” alone is insufficient.

## Non-goals

- Becoming a general chatbot / IDE chrome clone
- Silent promotion of INFERRED / ASSUMED / UNVERIFIED to FACT or VERIFIED
- Silent WRITE without Patch Artifact + evaluation + human APPROVE
- Per-vendor one-off evidence logic without adapters

## Migration / priority

| Phase | Deliverable | MVP status |
| --- | --- | --- |
| P0 | Product copy + this ADR · keep WRITE gate · keep secret redaction | Done |
| P1 | Claim schema v2 fields · code-vs-proven matrix UI · authority ranking | Partial (schema + authority resolve) |
| P2 | Expert contracts · risk engine scoring · conflict resolution by authority | Partial |
| P3 | Quality Gate Graph · event-sourced memory pipeline | MVP shipped — see `docs/architecture/p3-p5-mvp.md` |
| P4 | Provider adapters beyond GitHub · Evaluation Engine scorecards | MVP (Vercel + DEF-000) |
| P5 | Data classification → LLM policy · freemium multi-axis · self-audit | Partial (axes + DEF-000; LLM policy later) |

## Consequences

- README and investor narrative lead with governance + epistemic truth, not chat.
- Shared Zod contracts evolve toward Claim + Authority + Gate Graph.
- UI surfaces (dashboard, projects, conflicts, QA) must show verification gaps,
  not vanity health scores alone.
