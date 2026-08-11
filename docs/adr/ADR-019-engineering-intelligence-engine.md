# ADR-019 — Engineering Intelligence Engine (Continuous System Audit)

**Status:** Accepted  
**Date:** 2026-08-11  
**Product:** Atlas / ArletOS

## Context

Commercial strength is not “another bug scanner.” Atlas sells **Continuous AI
Engineering Audit**: understand the system, detect issues/drift/debt, remediate
under guardrails — always Evidence-backed.

## Decision

Three product pillars:

1. **Understand** — structure, deps, contracts, architecture  
2. **Detect** — bugs, vulnerabilities, drift, coverage gaps, debt  
3. **Remediate** — recommend → patch/PR → tests → verify  

### Engineering Issue contract

Every finding carries category, severity, components, rootCause, evidence[],
confidence, recommendedFix, proposedPatch, tests, regressionResult,
approvalStatus, remediationPolicy.

### Remediation guardrails

| Severity | Policy |
| --- | --- |
| LOW | AUTO_FIX (still logged) |
| MEDIUM | PR_REVIEW |
| HIGH | RECOMMENDATION_ONLY |
| CRITICAL | HUMAN_APPROVAL |

### Architecture Drift

Architecture Contract defines allowed/forbidden layer edges (e.g. Frontend ↛
Database). Violations are first-class CRITICAL issues, not lint noise.

### System Health

Dashboard dimensions (architecture, security, dependencies, codeQuality,
testing, performance, observability) — each score cites Evidence refs.

## APIs

- `POST /api/v1/audit-engine/run`
- `GET /api/v1/audit-engine/reports`
- `GET /api/v1/audit-engine/contract/default`
- UI: `/he/health`

## Related

ADR-014 Evidence · ADR-015 Code · ADR-017 Fabric · ADR-018 Kernel
