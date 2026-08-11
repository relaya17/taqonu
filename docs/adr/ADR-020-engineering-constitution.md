# ADR-020 — Atlas Engineering Constitution

**Status:** Accepted  
**Date:** 2026-08-11  
**Product:** Atlas / ArletOS

## Context

Continuous System Audit (ADR-019) detects issues in a repository. Users still
prompt narrowly (“build a booking site”). Critical whole-system concerns
(security baseline, navigation, a11y, footer legal, observability, omissions)
are easy to skip.

## Decision

Add an **Engineering Constitution** overlay:

1. Machine-readable checklist across domains (Architecture → AI Safety).  
2. Applicability by product profile (don’t checkbox-spam irrelevant items).  
3. Runner emits **Engineering Issues** (same contract as ADR-019).  
4. **Omission Detector** specialist asks “what did nobody think of?”  
5. Constitution findings feed System Health + Continuous Audit.  
6. **Admin Necessity** — Admin is a business/security decision, not a default
   scaffold. Detect need → type → separation → **server** AuthZ (see
   `docs/strategy/admin-necessity.md`). Never treat `/admin` UI as security.

Product identity: **AI Engineering Guardian & Partner** — not code generator only.

### APIs

- `GET /api/v1/constitution/checklist`
- `POST /api/v1/constitution/run`
- `GET /api/v1/constitution/reports`
- Audit run includes Constitution by default (`includeConstitution: true`)
- Fabric agent: `OMISSION_DETECTOR`
- UI: `/he/health` Constitution scorecard + intent field

### Implementation

- `@atlas/shared` — `constitution.schema.ts`
- `@atlas/code-intelligence` — checklist + `runEngineeringConstitution`
- Wired into `runContinuousSystemAudit`

## Non-goals

- Replacing Design Partner commercial focus with endless checklist theater  
- Auto-adding irrelevant legal/footer chrome  
- Deleting legitimate TODOs to greenwash hygiene  

## Tracking

[`docs/strategy/living-request-tracker.md`](../strategy/living-request-tracker.md) §E ·
[`docs/strategy/admin-necessity.md`](../strategy/admin-necessity.md).

## Related

ADR-009 QA · ADR-014 Evidence · ADR-018 Kernel · ADR-019 Audit Engine
