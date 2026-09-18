# Atlas — Implementation Proposal Catalog: Remaining Work

**Status: PROPOSAL ONLY. Repository remains frozen. No production code, tests, routes, schemas, registries, Control Plane, Admin boundaries, or mappings were modified to produce this document.** This is architectural validation output, not implementation. Nothing in this catalog is authorized to be built until the Owner explicitly approves a specific item.

This document does not invent new architecture. Every item below is derived from: the accepted baseline (`atlas-live-enforcement-integration-review.md`), the accepted architecture lock (`atlas-architecture-decision-lock.md`), the accepted prior implementation plan's Parts A/B/C (`atlas-implementation-plan-fulfillment-and-intelligence-gap.md`, Validation Passes 2–3), the pre-existing repository verification report (`docs/verification/ATLAS_VERIFICATION_REPORT_2026-08-28.md`), and the read-only Reconciliation Pass and Verification Status / Baseline Report produced earlier in this review. No new investigation was performed to produce this catalog beyond re-deriving proposal structure from that already-verified evidence.

## Governing frame for every item below

Every proposed change is checked against the same fixed chain, and against whether it preserves or bypasses it:

```
Identity → Tool Authorization → Entity Authorization → Risk/Approval → Governed Execution → Audit/Evidence → Verification → Memory
```

Control Plane is treated as a governance boundary throughout — no item below proposes routing around it, weakening its decision authority, or treating it as a convenience call. Where an item does not touch Control Plane at all (most of them), that is stated explicitly as a boundary-preservation fact, not left implicit.

---

## Item 1 — `intelligence.ts` hypothesis authorization/audit gap

**Classification: DEFECT. Priority: P1.**

- **Current behavior.** `POST /api/v1/intelligence/hypotheses` and `PATCH /api/v1/intelligence/hypotheses/:id/status` (`apps/api/src/routes/intelligence.ts`) mutate persisted `Hypothesis` records after only an inline `user?.id` check (POST) or no check beyond the global `requireUser` hook at all (PATCH). Neither route calls `authorizeEntityAction`/`enforceEntityWrite`, and neither produces an audit entry. Confirmed by direct grep of `hypothesis-engine.ts`: zero matches for `audit`, `authorizeEntity`, or `enforceEntityWrite`.
- **Intended target behavior.** Both routes gate their write through `enforceEntityWrite`, exactly like the ten other route files that already use it, so every hypothesis mutation is policy-checked and produces an audit entry.
- **Why current behavior is insufficient.** Every other business-entity write in Atlas (`RECORD`, `DOCUMENT`, `CASE`, etc.) is policy-checked and audited by the same mechanism. Hypothesis mutations are a silent exception — reachable by any signed-in user, with no audit trail and no policy evaluation. This directly contradicts the standing invariant (restated by the Owner this pass) that a reachable write must not lack auditability or bypass an authorization boundary.
- **Exact architectural boundary affected.** Entity Authorization → Audit, inside `apps/api` only. Does not touch Identity, Tool Authorization, Risk/Approval, Governed Execution, Verification, Memory, or Control Plane.
- **Files/components that would change.** `apps/api/src/routes/intelligence.ts` only — two call sites (`POST /hypotheses`, `PATCH /hypotheses/:id/status`). No new file.
- **Existing mechanisms that must be preserved.** `enforceEntityWrite` itself (`apps/api/src/services/risk-audit.ts`) — unmodified, reused as-is. The pre-existing policy entries `RECORD.CREATE` (`LOW_RISK_WRITE`, `requiresApproval: false`) and `RECORD.UPDATE` (`HIGH_RISK_WRITE`, `requiresApproval: true`) in `packages/agent-core/src/policies/entity-policies.ts` — unmodified, reused as-is; **no new policy is added anywhere**. `hypothesis-engine.ts`'s own create/update logic — unmodified; only what gates the call changes.
- **Security/governance implications.** Closes a real, live gap: today, hypothesis mutations are reachable with authentication but no authorization decision and no audit record. After the fix, every such mutation is policy-evaluated (fails closed on `DENIED`, per `enforceEntityWrite`'s already-tested behavior) and audited like the rest of the system. No new privilege is granted to anyone; the fix can only make an action harder to perform, never easier.
- **Audit/evidence implications.** A `RECORD.CREATE` / `RECORD.UPDATE` audit entry now exists for every hypothesis mutation, via the same `appendUnifiedAuditEntry` path `enforceEntityWrite` already calls elsewhere. No new evidence/verification machinery — hypotheses are not part of the epistemic memory system today, and this fix does not change that.
- **Failure and recovery behavior.** `enforceEntityWrite` already throws `AtlasError("FORBIDDEN", ...)` (403) on `DENIED`, and fails safe (logs as rejection) on any unexpected non-`ALLOWED` outcome — inherited unmodified. `RECORD.UPDATE`'s `requiresApproval: true` is satisfied the same way every other human-direct write route already satisfies it: `enforceEntityWrite` is called with `approved: true` (the standing "self-approved write" pattern for a signed-in human's own direct action), so the route's user-facing behavior does not change for a legitimate caller — only the previously-missing audit/policy trail is added.
- **Required tests.** New tests for both routes: a signed-in user succeeds and produces an audit entry; confirm `RECORD.CREATE`/`RECORD.UPDATE` are the recorded policy/audit labels. No existing test was found asserting the old inline-check behavior specifically, so no existing test is expected to need updating — this should be confirmed by running the existing `intelligence`-related suite before merging, not assumed.
- **Dependencies on other changes.** None. Fully independent of Items 2–8.
- **P-level rationale.** P1, not P0: the gap is real and live, but the entity type (`RECORD`, hypothesis) is not itself financially or destructively sensitive, and the global auth hook still requires a valid signed-in session — this is a missing authorization/audit *layer*, not an open authentication bypass. It should be the first item addressed once implementation is authorized, ahead of Items 2–3, because it is the only item in this catalog classified as a defect rather than a gap.

---

## Item 2 — `ApprovalRequest` lifecycle has no execution trigger

**Classification: ARCHITECTURAL GAP. Priority: P1.**

- **Current behavior.** A formal `ApprovalRequest` can be created (`dispatchAgentAction` → `createApprovalRequest`) and decided (`apps/api/src/routes/approvals.ts`'s `/decide` → `decideApprovalRequest`), but nothing ever calls `consumeApprovalRequest` for it. `consumeApprovalRequest` has exactly one caller repo-wide (`executeGovernedAction`), reached only via `gateway/fulfill`, which nothing currently calls with a matching `approvalRequestId` for this lifecycle. An `APPROVED` request today is a permanent dead end.
- **Intended target behavior.** A human's `APPROVED` decision can be explicitly, deliberately turned into a real execution through the same already-built, already-tested `executeGovernedAction` pipeline that `gateway/fulfill` already uses — via a new, separate trigger, not by changing what `/decide` does.
- **Why current behavior is insufficient.** The formal approval workflow (`ApprovalRequest` creation, human decision, artifact-hash binding, `expectedObservations`/`baselineObservations`) is fully built and fully tested up to the point of decision, and then does nothing. A governance mechanism that computes a decision but can never act on it is not yet functioning as a control — it is functioning as a form that nobody reads.
- **Exact architectural boundary affected.** Risk/Approval → Governed Execution, inside `apps/api` only. Does not touch Identity, Tool Authorization, Entity Authorization (both already correctly gate the *decision*, unchanged), Control Plane, Admin, or any registry.
- **Files/components that would change.** `apps/api/src/services/agent-dispatch-guard.ts` — additive only: three new optional fields on `DispatchAgentActionOptions` (`operation?`, `toolArgs?`, `artifact?`), threaded into the existing `context` object already built in the `needsApproval` branch. `apps/api/src/routes/approvals.ts` — one new route, `POST /api/v1/approvals/:id/fulfill`. Exactly one of the six `dispatchAgentAction` call sites needs to pass the three new fields (which one is deliberately undecided — see Item 2's own "Task 0" below). No new file beyond the route; `fulfillGatewayHandoff` is reused unmodified.
- **Existing mechanisms that must be preserved.** `authorizeEntityAction`, `dispatchAgentAction`'s risk-scoring/`needsApproval` computation, `approvals.ts`'s existing three routes (`GET /approvals`, `GET /approvals/:id`, `POST /:id/decide`), `executeGovernedAction`'s six-stage fail-closed pipeline, `fulfillGatewayHandoff` — all unmodified, all reused as-is. No new authorization mechanism is introduced; the new route is a *trigger* into existing machinery, not a new gate.
- **Security/governance implications.** The new route only ever reaches `fulfillGatewayHandoff`/`executeGovernedAction`, which independently re-runs tool authorization and the policy/risk gate regardless of the approval — so no stage of the existing chain is skipped, reordered, or weakened. It is strictly more constrained than the existing raw `gateway/fulfill` route (which accepts an *optional* `approvalRequestId`): the new route makes an existing, `APPROVED`, unconsumed `ApprovalRequest` a hard precondition (404/409/422) before it will even attempt fulfillment.
- **Audit/evidence implications.** All handled by the existing, unmodified `executeGovernedAction`: `appendUnifiedAuditEntry` (audit), artifact-hash pinning plus `expectedObservations`/`baselineObservations` comparison (evidence/regression), and `memoryEpistemicAfterAction` (memory) — exactly as `geal-live-path.integration.test.ts` already verifies for the existing route. No new audit/evidence/memory code.
- **Failure and recovery behavior.** Wrong status (not `APPROVED`) → 409, no execution — covers PENDING/REJECTED/CONSUMED/REVOKED uniformly. Missing fulfillment data in `context` → 422, no execution, no guessing. Any refusal inside `executeGovernedAction` itself (stale artifact, expired approval, tool-authorization failure, policy re-check failure) surfaces as that stage's existing refusal, unchanged. No network-failure mode to design for — no cross-service call is made (see Item 3 for where that boundary actually lives).
- **Required tests.** New route tests: 404 (missing), 409 (all four non-`APPROVED` statuses), 422 (missing context data), success — extending `geal-live-path.integration.test.ts`'s existing non-mocked pattern. Update the one piloted call site's existing test to assert the three new arguments are threaded through and land in the resulting `ApprovalRequest.context`. No existing test (`agent-dispatch-guard.test.ts`, `approvals.test.ts` ×2) should need to change behavior, only gain coverage.
- **Dependencies on other changes.** None on Items 1, 3–8. Internally, a small "Task 0" (read-only, zero-risk: read the six `dispatchAgentAction` call sites to pick the lowest-risk pilot) must happen before the one call-site change is written — this was already flagged, and remains undecided by design, not by oversight.
- **P-level rationale.** P1: this closes a functional gap in a governance mechanism that is otherwise fully built and tested, and it is the natural next step once the Owner allows implementation — but it is P1, not P0, because the dead end it closes causes no incorrect behavior today (an unfulfillable approval simply stays inert, which is safe, not wrong).

---

## Item 3 — Control Plane decision → `apps/api` execution handoff is not wired

**Classification: ARCHITECTURAL GAP. Priority: P2.**

- **Current behavior.** `apps/control-plane`'s Operating Cycle (`gateway/ops` → `evaluateOperatingCycle`) reaches a real ALLOW/DENY/REQUIRE_APPROVAL decision for an operation against a registered Managed Application. For a write-type ALLOW, `atlas-gateway.ts`'s `fulfillAllow()` explicitly does not execute — it returns a receipt (`executionKind: "HANDED_OFF_GOVERNED"`) plus a `governedHandoff` object, and a code comment states the intended next step ("Consume via approvals.ts then POST /api/v1/gateway/fulfill"). No code anywhere calls from `apps/control-plane` into `apps/api`'s `gateway/fulfill` carrying this decision. `gateway/fulfill` today has zero live production callers that originate from a Control Plane decision; `requireOperator` is a local `apps/api` role check, not verification of Control Plane authority.
- **Intended target behavior.** A Control Plane `ALLOW` decision over a Managed Application actually causes the corresponding action to run in `apps/api`, through an authenticated, synchronous, cross-service call — making Control Plane a live enforcement boundary for Managed Systems rather than a decision surface whose write-op outputs currently go nowhere.
- **Why current behavior is insufficient.** The whole point of registering a Managed Application with Control Plane and having it evaluate operations is for the decision to matter. Today it doesn't reach execution — the Operating Cycle is fully correct and fully tested (`atlas-gateway.test.ts`, 14 tests) as a decision engine, but as an enforcement boundary it currently enforces nothing beyond itself, because there is no live external Managed Application depending on it yet (only `def-000`/Atlas is registered). This is consistent with the Owner's own architecture lock, which named Control Plane as the intended enforcement boundary target precisely because this link does not yet exist.
- **Exact architectural boundary affected.** Control Plane Operating Cycle → Governed Execution, crossing the `apps/control-plane` ⇄ `apps/api` process boundary — the one boundary in this catalog that is genuinely new ground, not an extension of an already-connected path.
- **Files/components that would need to change (sketch only — not designed here).** A new, explicitly separate client (`governed-call-client.ts`, per the already-accepted §17 recommendation) for the synchronous cross-service call, living on the `apps/control-plane` side or as a shared package — not built by extending `control-plane-bridge.ts` (which stays the async, fail-open telemetry subscriber it already is). On the `apps/api` side, a way for `gateway/fulfill` (or a Control-Plane-specific variant of it) to distinguish "this request's authority came from a genuine Control Plane decision" from "this is a local `apps/api` operator call" — today `requireOperator` cannot tell the difference. Likely touches: a new file in `apps/control-plane/src/services/`, `apps/api/src/routes/gateway-fulfill.ts` or a new sibling route, and possibly `packages/shared` for a shared request/response contract. **None of this is specified further here** — per the Owner's explicit instruction not to expand this item's scope in this pass.
- **Existing mechanisms that must be preserved.** `evaluateOperatingCycle`/`evaluateGatewayRequest` (the decision logic itself) — unmodified. `executeGovernedAction`'s own independent six-stage gate — unmodified and still runs in full on the `apps/api` side regardless of who called it, so Control Plane's decision augments, never replaces, `apps/api`'s own authorization/policy/risk checks. `control-plane-bridge.ts` — unmodified, remains the unrelated async telemetry path. `mapControlPlaneHandoff`/`mapGatewayHandoff` — unmodified for this item (see Item 5 for their own, separate, dependent cleanup).
- **Security/governance implications.** This is the highest-stakes item in the catalog precisely because it is a new cross-service trust relationship: it must not become a way for a Control Plane decision to skip `apps/api`'s own authorization/policy/risk gate (it must not — `executeGovernedAction` runs unconditionally regardless of caller), and it must not let something calling itself "Control Plane" impersonate that role without a real, verifiable credential (the credential/signature design is exactly what is deferred, not decided, here). Building this without a resolved answer to both would materially weaken the governance chain rather than complete it — which is precisely why the Owner has correctly kept it out of scope across every prior pass.
- **Audit/evidence implications.** Both sides already audit independently (Control Plane's `governance-state.ts` audit chain for its own decision; `apps/api`'s `appendUnifiedAuditEntry` for execution) — a real design question for this item (not resolved here) is whether/how those two audit records should be correlated (e.g., a shared request/decision id), distinct from whether the two audit *trails* themselves should be merged (a separate, already-deferred question — see Item 4).
- **Failure and recovery behavior.** Not designed here. Open questions for whenever this item is scoped: what happens to a Control Plane `ALLOW` if the cross-service call to `apps/api` fails (network, timeout, `apps/api` down) — almost certainly fail-closed (no silent retry-into-execution), consistent with `executeGovernedAction`'s own "no continue and hope" stance, but this is a decision for that future scoping pass, not asserted here as settled.
- **Required tests.** Not designed here. Would need, at minimum: a real (not mocked) round-trip test analogous to `geal-live-path.integration.test.ts` but crossing the actual process boundary; negative tests for a forged/missing Control Plane credential; a test that `apps/api`'s own gate still refuses an action Control Plane approved but that `apps/api`'s own policy would deny (proving no boundary is bypassed).
- **Dependencies on other changes.** Benefits from, but does not strictly require, Item 5 (deduplicating the handoff-mapping tables) being done at the same time, since this item is the first point where keeping two independently-maintained copies in sync actually matters operationally. Independent of Items 1, 2, 4, 6–8.
- **P-level rationale.** P2: materially larger, riskier, and touches a process boundary that has been deliberately kept out of every implementation pass so far. It matters to Atlas's stated long-term purpose (Control Plane as a real enforcement boundary, not merely an observability surface) but nothing in production depends on it today (no real external Managed Application is registered), so it is not urgent. **This item is documented, not proposed for authorization in this pass** — it would need its own dedicated scoping pass (credential design, failure semantics, audit correlation) before a concrete file-level plan could responsibly be written, exactly as Item 3 in the prior Validation Pass 2/3 document already established.

---

## Item 4 — `audit-sync.ts`: implemented, inactive, unwired

**Classification: MAINTENANCE ITEM. Priority: P3 — no action proposed at this time.**

- **Current behavior.** `apps/control-plane/src/services/audit-sync.ts` fully implements a periodic push of Control Plane's own audit entries into `apps/api`'s audit trail (`POST /api/v1/audit/cp-import`, which does exist and is implemented on the `apps/api` side). Its `startPeriodicSync`/`syncAuditToApi`/`flushAuditSync` functions are never called from `apps/control-plane/src/server.ts` or anywhere else in the repository. It has no test file. It is dead code from a reachability standpoint — correctly classified as `IMPLEMENTED_BUT_NOT_WIRED`, not as an active integration channel.
- **Intended target behavior.** Not proposed here. Per the Owner's explicit instruction, this item is not to be wired "merely because it exists."
- **Why current behavior is insufficient.** It isn't, for anything currently depending on it — nothing does. The only reason this appears in the catalog at all is completeness and honest classification, not because a defect or urgent gap was found.
- **Exact architectural boundary affected.** None currently — the code is unreachable, so it affects no live boundary.
- **Files/components that would change.** None proposed.
- **Existing mechanisms that must be preserved.** The fact that `apps/api`'s own audit trail (`audit-log.ts`) is the canonical system of record (already `VERIFIED`, per the 8/28 report: "API NDJSON is system of record") — whatever happens to this item later must not change that without a separate, explicit decision.
- **Security/governance implications.** None from leaving it as-is. Wiring it without first deciding whether/how it should relate to Item 3 (the Control Plane → execution handoff) would risk conflating "audit-log synchronization" with "decision/execution handoff" — two different concerns that happen to cross the same process boundary. Keeping them separate is itself a governance-hygiene reason not to act on this item in isolation.
- **Audit/evidence implications.** Two audit trails remain separate today, exactly as the 8/28 verification report already stated (that characterization remains accurate in practice, even though the underlying claim "NOT IMPLEMENTED" was itself slightly imprecise — the code exists, it just isn't invoked).
- **Failure and recovery behavior.** N/A — not proposed.
- **Required tests.** N/A — not proposed. If ever taken up: `audit-sync.ts` has zero test coverage today, which would need to be built from scratch, not assumed to inherit coverage from anything else.
- **Dependencies on other changes.** Whether and how to wire this should be decided together with Item 3, not before it — wiring an audit-log sync ahead of deciding the actual decision/execution handoff risks building the wrong shape twice.
- **P-level rationale.** P3 and explicitly not proposed. Recorded for completeness and correct classification only, per the Owner's own instruction this pass.

---

## Item 5 — Duplicate handoff-mapping tables (`mapControlPlaneHandoff` vs. `mapGatewayHandoff`)

**Classification: MAINTENANCE ITEM. Priority: P3 — bundled with Item 3, not standalone.**

- **Current behavior.** `apps/control-plane/src/services/atlas-gateway.ts`'s `mapControlPlaneHandoff` and `packages/shared/src/constants/atlas-gateway.ts`'s `mapGatewayHandoff` are two independently-maintained copies of the same operation → `{entityType, action, toolName}` mapping. A code comment on the former states outright: "Keep aligned with `mapGatewayHandoff`... Copied so this process stays free of a compile-time shared coupling." Both are individually tested (`atlas-gateway.test.ts` in each location) and today are consistent.
- **Intended target behavior.** Not proposed here as a standalone change. If undertaken, the target would be a single shared source of truth, imported by both services, removing the "kept aligned by comment discipline" risk.
- **Why current behavior is insufficient.** It isn't, today — the operation set is small (8 operations) and both copies currently agree, per direct comparison of both files this session. The risk is prospective: if the operation catalog grows, the two copies can silently drift, and nothing would catch it except the deliberately-decoupled build (the same decoupling that is architecturally *correct* for keeping the two services independent — see Item 3).
- **Exact architectural boundary affected.** Control Plane Operating Cycle ⇄ Governed Execution mapping — the same boundary as Item 3, which is exactly why this is proposed as bundled with it rather than separately: deduplicating a mapping table that feeds a handoff which itself doesn't execute yet has limited value in isolation, and touching `apps/control-plane` to do it now would violate the Owner's standing boundary against modifying Control Plane code outside an explicitly scoped effort.
- **Files/components that would change (if bundled with Item 3).** `apps/control-plane/src/services/atlas-gateway.ts`, `packages/shared/src/constants/atlas-gateway.ts` — consolidate to one, imported by both. Not designed further here.
- **Existing mechanisms that must be preserved.** Both existing test suites' assertions (`atlas-gateway.test.ts` in each package) — a consolidation must not silently change what either mapping returns for any of the 8 known operations.
- **Security/governance implications.** Low today; the risk is maintainability drift, not a live security gap — restated so it is not mistaken for urgent.
- **Audit/evidence implications.** None beyond ensuring the (unchanged) mapping output continues to match what `executeGovernedAction`'s policy/risk gate expects.
- **Failure and recovery behavior.** N/A at this scope.
- **Required tests.** If undertaken: a single shared test suite replacing the two current ones, explicitly asserting parity with both prior copies' known outputs before removing either.
- **Dependencies on other changes.** Depends on Item 3's scoping decision — do not do this standalone.
- **P-level rationale.** P3, explicitly deferred to whenever (and if) Item 3 is authorized.

---

## Item 6 — `gateway-fulfill.ts` comment describes intended behavior as current

**Classification: DOCUMENTATION INACCURACY. Priority: P3.**

- **Current behavior.** The comment on `apps/api/src/routes/gateway-fulfill.ts` reads: *"Operator-only hop: Control Plane ALLOW + handoff → executeGovernedAction."* Verified this session: no live call path exists today from a Control Plane decision into this route (see Item 3). The comment describes the intended future shape in the present tense.
- **Intended target behavior.** The comment should describe what the route actually does today (an `apps/api`-local operator-authenticated entry point into `executeGovernedAction`, not currently reachable from Control Plane) and, if useful, note the intended future relationship as explicitly future/aspirational rather than implying it already exists.
- **Why current behavior is insufficient.** A future engineer (human or an Atlas coding agent operating under Atlas's own governance) reading this comment in isolation would reasonably conclude the cross-service link already exists — which is exactly the kind of inference this whole review process exists to prevent. A misleading comment on a security-relevant route is a small but real documentation-integrity issue.
- **Exact architectural boundary affected.** None — this is a comment-only change with zero behavioral effect.
- **Files/components that would change.** `apps/api/src/routes/gateway-fulfill.ts` — the doc comment only, zero lines of logic.
- **Existing mechanisms that must be preserved.** All of them, trivially — nothing behavioral is touched.
- **Security/governance implications.** None from making the change; a small positive from reducing the chance of a future incorrect assumption being built on top of the comment's current wording.
- **Audit/evidence implications.** None.
- **Failure and recovery behavior.** N/A.
- **Required tests.** None — comments are not executable; no test can or should assert comment wording.
- **Dependencies on other changes.** None. Fully independent of every other item — the lowest-risk, smallest possible item in this entire catalog.
- **P-level rationale.** P3: correct and cheap, but cosmetic — sequenced last precisely because it is the only item with zero functional stakes, not because it is unimportant to eventual accuracy.

---

## Item 7 — External Managed Application supervision is not operational

**Classification: ARCHITECTURAL GAP. Priority: P3 — not proposed; dependent on Item 3.**

- **Current behavior.** Only `def-000` (Atlas itself) is registered in `apps/control-plane`'s `application-registry.ts`. No real external Managed System is connected. The registration/evaluation machinery itself is implemented and tested (`atlas-gateway.test.ts`), but has never been exercised against anything but Atlas.
- **Why not proposed here.** This gap cannot be meaningfully closed before Item 3 (the decision → execution handoff) exists and is trusted — supervising an external application's actions is not useful if a resulting ALLOW decision still cannot reach execution. Per the Owner's explicit instruction this pass, this item is recorded for completeness only, not scoped or proposed.
- **Dependencies on other changes.** Item 3, fully.
- **P-level rationale.** P3, correctly out of scope until Item 3 has its own approved design.

---

## Item 8 — Admin boundary consolidation (`apps/web/app/admin/*` → `apps/admin`)

**Classification: ARCHITECTURAL GAP / MAINTENANCE. Priority: P3 — not proposed; needs its own investigation pass.**

- **Current behavior.** `apps/admin` is a dedicated, tested app (`admin-auth.test.ts`, `owner-html.test.ts`). A separate, legacy Admin surface still lives inside `apps/web/app/admin/*` (already identified in the accepted Architecture Decision Lock, e.g. `oracle/page.tsx`, `marketplace/page.tsx`), with **zero test coverage found** this session.
- **Why not proposed here.** This session's evidence for this item is shallow relative to Items 1–3 — confirmed to exist and confirmed to lack tests, but not traced route-by-route the way the governance chain was. Per the same evidence-first discipline used throughout this review, proposing a concrete file-level plan without that tracing would risk exactly the kind of unverified assumption this whole process has been designed to avoid.
- **Dependencies on other changes.** None strictly, but should not be conflated with Items 1–3, which are unrelated to Admin.
- **P-level rationale.** P3, and explicitly flagged as needing its own dedicated read-only investigation pass (route inventory + test-coverage check) before any proposal, not this catalog's job to pre-scope.

---

## Summary table

| Item | Classification | Priority | Proposed for authorization now? | Depends on |
|---|---|---|---|---|
| 1. `intelligence.ts` gap | DEFECT | P1 | Yes | None |
| 2. ApprovalRequest execution trigger | ARCHITECTURAL GAP | P1 | Yes | None (internal Task 0 only) |
| 3. Control Plane → `apps/api` handoff | ARCHITECTURAL GAP | P2 | No — needs its own scoping pass | None |
| 4. `audit-sync.ts` wiring | MAINTENANCE | P3 | No — explicitly deferred | Item 3 |
| 5. Duplicate handoff-mapping tables | MAINTENANCE | P3 | No — bundle with Item 3 | Item 3 |
| 6. `gateway-fulfill.ts` comment | DOCUMENTATION | P3 | Lowest-risk if Owner wants a trivial item | None |
| 7. External Managed App supervision | ARCHITECTURAL GAP | P3 | No | Item 3 |
| 8. Admin boundary consolidation | GAP/MAINTENANCE | P3 | No — needs its own investigation pass | None |

Items 1 and 2 are the only two proposed as ready for an authorization decision now — both are additive, both stay entirely inside `apps/api`, both preserve every existing mechanism unmodified, and both were already carried through two full validation passes in the prior implementation plan. Items 3–8 are recorded for completeness, correct classification, and future planning — none are proposed for implementation in this pass.

---

# STOP

This is a proposal catalog, not implementation. No files have been changed. Waiting for explicit Owner approval — specifying which item(s), if any, to authorize — before any code, test, route, schema, registry, Control Plane, Admin, or mapping is modified.
