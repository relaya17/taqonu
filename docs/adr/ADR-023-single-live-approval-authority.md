# ADR-023 — Single live approval authority (scope-polymorphic)

**Status:** Accepted  
**Date:** 2026-09-03  
**Product:** Atlas / ArletOS

## Context

Phase 3F made PostgreSQL table `live_approval_requests` (via `approvals.ts` and
`LiveApprovalRequestRepository`) the live approval authority. That contract
does not require `tenantId` or `projectId`.

Live mint sites already produce three first-class scopes:

1. Project-scoped execution (no Atlas tenant model)
2. Project-optional / system-scoped execution
3. Platform-wide execution (`CONFIGURATION.EXECUTE` / admin `run-checks`)

A future tenant+project class may exist. It is not a current invariant.

Unit 2 (`approval_requests`, `ApprovalExecutionRepository`) and
`ExecutionApprovalEnvelopeV1` require both `tenantId` and `projectId`. Atlas
has no authoritative tenant ID. Fabricating tenant or project IDs is forbidden.

Using Unit 2 for some scopes and Phase 3F for others would be dual authority.

## Decision

**Option 2 (Phase 4.5): evolve Phase 3F in place as the single live SoR.**

- Live authority remains `live_approval_requests` + `approvals.ts` for all
  current first-class scopes.
- When needed, that same store and service may later gain first-class scope
  fields, claim/redemption, finalization, execution receipts, and
  `OUTCOME_UNKNOWN` — without introducing a second approval table as SoR.
- Unit 2 remains non-live prepared infrastructure. It must not become a
  second approval authority.
- `ExecutionApprovalEnvelopeV1` is unchanged. It is a future tenant+project
  execution contract, not the universal Atlas approval contract.

## Invariants

- Exactly one live approval source of truth
- No dual-write
- No scope-based split between Phase 3F and Unit 2
- No fallback between stores
- No fabricated `tenantId`
- No fabricated `projectId`
- No changes to Envelope V1 in this decision
- No tenant-system implementation from this decision
- No claim/finalize implementation from this decision

## Consequences

- Phase 3E consume → `consumedApproval` → dispatch re-check → Policy/Risk →
  execute continues against the Phase 3F record for every current scope.
- Unit 2 claim/receipt/envelope validation stay unused by the live path until
  a later, separately authorized design copies *concepts* into Phase 3F or
  introduces a real tenant+project class.
- This ADR does not authorize schema or service changes. Implementation of
  in-place evolution requires a later explicit authorization.

## Not decided here

- Concrete columns or RPCs for scope / claim / finalize
- Tenant architecture
- Envelope V1 changes
- Whether a future tenant+project class will ever mint Envelope V1
