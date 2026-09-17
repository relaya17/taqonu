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

- **Historical (at ADR write time):** Phase 3E consume → `consumedApproval` →
  dispatch re-check → Policy/Risk → execute against the Phase 3F record.
- **Live occupancy (matching entity/action):** `runGovernedClaimedExecution`
  is the acceptance target:
  `claim → policy/risk re-check → durable STARTED → execute → finalize`
  (`FULFILLED` | `FAILED` | `OUTCOME_UNKNOWN` | `FINALIZE_INCOMPLETE`).
  Do not rewrite this path back to consume-before-policy.
- **Live gateway mismatch (still present):** when the operation pair and the
  fabric tool pair differ (`request_agent_run` is `RECORD.EXECUTE` even if the
  tool is `analyze_repo` / `DOCUMENT.READ`), `gateOperationApproval` still
  calls `consumeApprovalRequest` *before* `executeGovernedAction` and does
  **not** pass `approvalRequestId` into the claim helper. That is one-shot
  redemption of the *operation* approval, not a second occupancy engine.
- This occupancy is **at-most-once attempt** after STARTED. It does not prove
  exactly-once Git, payment, or other external side effects.
- Unit 2 claim/receipt/envelope validation stay unused by the live path until
  a later, separately authorized design copies *concepts* into Phase 3F or
  introduces a real tenant+project class.

## Implementation status (2026-09-17)

Claim/finalize **was later implemented** on the live Phase 3F path
(`apps/api/src/services/governed-claimed-execution.ts`). That does not
amend the original “not decided here” list; it records that subsequent
authorized work landed occupancy. The original ADR text above is preserved
as history. The live ordering is the acceptance target.

## Not decided here

- Concrete columns or RPCs for scope / claim / finalize
- Tenant architecture
- Envelope V1 changes
- Whether a future tenant+project class will ever mint Envelope V1
