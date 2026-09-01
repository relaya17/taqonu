# Atlas — Final Implementation Plan (Phase 1): `apps/api` Approval Fulfillment Improvement + Intelligence Audit Gap

**Status: PLAN ONLY. Repository remains frozen. No production code modified.** Prepared against the validated baseline (`atlas-live-enforcement-integration-review.md`, accepted). This document proposes **two** bounded changes for current implementation (Part A and Part C below) and separately **documents, without proposing to solve, one architectural gap** (Part B) that the Owner asked to have made explicit. Per the Owner's boundaries: this plan does not migrate the 32+ enforcement call sites, does not perform a broad Control Plane rollout, does not restructure Admin, does not implement internal second-opinion review, and does not implement external Managed-System supervision.

**Validation Pass 2 — 2026-09-01.** The Owner asked for a first architecture clarification: the exact relationship between `apps/control-plane`'s gateway (`gateway/ops`, `atlas-gateway.ts`) and `apps/api`'s gateway (`gateway/fulfill`, `executeGovernedAction`), and whether the proposed `/api/v1/approvals/:id/fulfill` route connects to, bypasses, or duplicates Control Plane governance. That pass (findings kept below, unchanged) found no code-level connection between the two services. The recommendation not to build `governed-call-client.ts` and not to touch `apps/control-plane` was accepted as the factual baseline.

**Validation Pass 3 — 2026-09-01.** The Owner then flagged that the plan's prior wording risked *implying* the new route connects `apps/control-plane` to live execution, even though the underlying findings said otherwise. This revision does three things, and nothing else: (1) states the three-way architecture distinction explicitly, up front, rather than leaving it to be inferred from the validation-pass narrative; (2) re-describes the proposed route as an `apps/api`-only improvement, never as Control Plane integration; (3) promotes the "Control Plane decision → execution handoff is unwired" observation from a footnote (previously buried in AC3's "documentation-accuracy note") into its own named, structured architectural gap — Part B — that is explicitly **not** solved, scheduled, or scoped by this plan. No production code, routes, `approvals.ts`, `control-plane-bridge.ts`, `apps/control-plane/*`, policy logic, registries, Admin, or Agent Fabric were modified in this revision — only this document.

---

## Architecture boundary — three things this plan distinguishes

The Owner asked that these three be kept explicitly separate throughout, rather than blended into one narrative of "the gateway." They are:

1. **The `apps/control-plane` Operating Cycle** — `gateway/ops → evaluateOperatingCycle → ALLOW / DENY / REQUIRE_APPROVAL`. Lives entirely inside the separate `apps/control-plane` service (port 3100). Governs external Managed Applications. Detailed in AC1/AC3/AC5 (Pipeline 2) below.
2. **The `apps/api` execution/governance pipeline** — `executeGovernedAction → authorization/policy/risk → execution → evidence/audit/memory`. Lives entirely inside `apps/api`. Governs Atlas's own agents acting on Atlas itself. Detailed in AC2/AC5 (Pipeline 1) below.
3. **The boundary between them, as it exists today: disconnected.** No code calls from (1) into (2), or from (2) into (1), for decisions or execution — only two unrelated, non-gating side-channels cross the process boundary (fire-and-forget telemetry, and a one-way audit-log sync). Detailed in AC3 and Part B below.

Everything below is organized to keep these three separate. **Part A concerns (2) only. Part B concerns the missing link between (1) and (2), and is not proposed for implementation. Part C concerns neither — it is an unrelated `apps/api` authorization/audit fix.**

---

## Important scope clarification, surfaced before anything else

Tracing `POST /api/v1/gateway/fulfill` one level deeper than the validation pass did reveals something the Owner should see explicitly before approving: **`gateway/fulfill` and the `executeGovernedAction` pipeline it calls both live entirely inside `apps/api`.** `apps/api/src/routes/gateway-fulfill.ts` is gated by `requireOperator` (an `apps/api`-local role check) — not by any Control-Plane-issued token or signature. `executeGovernedAction`'s policy/risk stage calls `dispatchAgentAction`, which calls `authorizeEntityAction` — both `packages/agent-core`, not the separate `apps/control-plane` service's `evaluateGatewayRequest`/13-stage Operating Cycle.

**Consequence: Part A of this plan does not call, connect to, or depend on the separate `apps/control-plane` service (port 3100) at all, and must not be described as Control Plane integration.** It is an `apps/api`-only improvement to `apps/api`'s own already-built, already-tested governed-execution pipeline. That pipeline is architecturally *positioned* to be a future execution target for Control Plane decisions (per the `governedHandoff` shape produced in `atlas-gateway.ts`, see Part B), but nothing in this plan builds, wires, or advances that connection — Part A stands entirely on its own, in-process, and closes only the gap identified in validation (§3B of the review: approved formal `ApprovalRequest`s currently have no execution step at all). Whether and how to eventually connect Control Plane decisions to this pipeline is Part B's question, not Part A's, and Part B is explicitly out of scope here.

Because there is no cross-service call in Part A, **§17's recommendation to build a separate `governed-call-client.ts` does not apply to Part A** — that recommendation was for *synchronous calls to the separate Control Plane service*, which Part A does not make. No such client is built in Phase 1. Building the actual Control Plane → `apps/api` execution handoff (Part B) is a materially larger, different, and riskier change than Part A, explicitly out of scope per the Owner's boundary #10; if and when it is undertaken, `governed-call-client.ts` would be evaluated then, as part of that separate, future-scoped effort — not as part of, or a consequence of, this plan.

This is a scope clarification, not a request for a new decision — flagged so the Owner is approving what this plan actually does, not a mental model of "wiring the separate Control Plane service," which this plan does not do.

---

## Architecture Clarification — Control Plane Operating Cycle vs. `apps/api` Gateway Fulfillment (Validation Pass 2)

This section answers the six specific points the Owner asked to have verified directly from the repository, not inferred. Every claim below is grounded in the exact file/line evidence cited.

### AC1. Does `gateway/fulfill` execute the Control Plane Operating Cycle, or is it an API-side receiver?

**It is an API-side fulfillment/execution mechanism, and it does not execute — or consume the output of — the Control Plane Operating Cycle.** The Operating Cycle (`evaluateOperatingCycle`) is invoked only from `evaluateGatewayRequest`/`dispatchGatewayOperation` in `apps/control-plane/src/services/atlas-gateway.ts`, reached only via `apps/control-plane`'s own HTTP route `POST /api/v1/gateway/ops` (`apps/control-plane/src/routes/api.ts:269`) — a different process, a different port (3100), with its own identity resolution (`resolveControlPlanePrincipal`, `control-plane-auth.ts`). `apps/api/src/routes/gateway-fulfill.ts` never calls that route, never imports anything from `apps/control-plane`, and its request body (`applicationId`, `agentId`, `operation`, `toolArgs`, `artifact`, `approvalRequestId`) contains no field that could carry a Control Plane decision, receipt, or signature — only an optional `approvalRequestId`, which references `apps/api`'s **own** `ApprovalRequest` store (`getApprovalRequest` in `apps/api/src/services/approvals.ts`), not anything in Control Plane's `governance-state.ts`. So it is neither "running the Operating Cycle" nor "consuming a previously governed decision" in the sense of consuming Control Plane's output — it is a self-contained fulfillment endpoint that happens to share a name and an intended purpose with Control Plane's write-op handoff, documented only in comments (see AC3).

### AC2. Is `executeGovernedAction` the Control Plane governance mechanism, or only execution/fulfillment?

**Neither framing is exactly right — `executeGovernedAction` is `apps/api`'s own, separate governance-and-execution mechanism, not a downstream executor of Control Plane's decision.** Its own docstring calls it "the single transactional execution gate," and its six stages (`apps/api/src/services/governed-execution.ts:100-330`) are: (1) tool authorization (`enforceAgentToolAuthorization`), (2/3) approval consumption bound to the artifact (`consumeApprovalRequest`, only if an `approvalRequestId` was supplied), (4) **policy + risk gate** (`dispatchAgentAction` → `authorizeEntityAction`, from `packages/agent-core`), (5) execution (`executeTool`), (6) audit (`appendUnifiedAuditEntry`, unconditionally on every branch). Stage 4 runs on *every* call, regardless of whether an approval was supplied — so a caller cannot skip risk evaluation simply by omitting `approvalRequestId`; if the entity-action's risk bucket requires approval, `dispatchAgentAction` returns `APPROVAL_REQUIRED` and execution is refused. None of these six stages call, check, or depend on `apps/control-plane`'s `evaluateOperatingCycle`. So `executeGovernedAction` performs real governance (authorization, policy, risk, approval-binding) — it is just a **different, `apps/api`-local governance mechanism** from Control Plane's, not merely the execution arm of it.

### AC3. What role does `apps/control-plane/src/services/atlas-gateway.ts` actually play relative to `gateway/fulfill`?

`atlas-gateway.ts` is the real implementation of Control Plane's Operating Cycle for governing an **external Managed Application** (an `applicationId` registered in `application-registry.ts` — today, only `def-000`/Atlas itself, per the earlier P0 finding). Its `dispatchGatewayOperation` evaluates ALLOW/DENY/REQUIRE_APPROVAL; for a write-type operation that evaluates ALLOW, it explicitly does **not** execute — `fulfillAllow()` returns a receipt with `executionKind: "HANDED_OFF_GOVERNED"` and `verification.detail: "Handed off to executeGovernedAction in apps/api — Control Plane does not run tools"`, plus a `governedHandoff` object (`entityType`/`action`/`toolName`, from a local `mapControlPlaneHandoff` function). A code comment on `dispatchGatewayOperation` states the intended next step in plain words: *"REQUIRE_APPROVAL is a decision, not a second queue. Consume via apps/api/src/services/approvals.ts then POST /api/v1/gateway/fulfill."* **This is a documented design intent, not a live call.** Nothing in `atlas-gateway.ts`, or anywhere else searched in either service, issues an HTTP request from `apps/control-plane` to `apps/api/.../gateway/fulfill` (or vice versa) carrying this receipt or handoff. The `mapControlPlaneHandoff` table itself is a hand-maintained copy of `mapGatewayHandoff` in `packages/shared/src/constants/atlas-gateway.ts` — the comment above it says so explicitly ("Keep aligned with `mapGatewayHandoff`... Copied so this process stays free of a compile-time shared coupling"), which is itself evidence the two services are deliberately decoupled at build time, kept in sync only by developer discipline. The only two things that actually cross the process boundary today are unrelated to this decision/execution path: `control-plane-bridge.ts` (`apps/api` → Control Plane, fire-and-forget telemetry *after* an action, already documented as untouched in this plan) and `audit-sync.ts` (`apps/control-plane` → `apps/api`, a periodic one-directional push of Control Plane's *own* audit-log entries into `apps/api`'s audit trail for record-keeping — it moves log rows, not decisions, and does not touch `ApprovalRequest`, `executeGovernedAction`, or `gateway/fulfill` in any way).

### AC4. What does `requireOperator` actually check?

**Local API operator authorization — not Control Plane authorization.** `requireOperator` (`apps/api/src/middleware/auth-guards.ts:42-55`) calls `requireUser` (validates the caller's own `apps/api` session) and then checks `isControlPlaneRole(user.role)`. That function (`packages/shared/src/constants/trust-boundary.ts:25-27`) is simply: `role === "owner" || role === "operator"` — a role-tier check against the role stored on the caller's `apps/api` session. It does not validate a token issued by, a signature from, or any call to, the separate `apps/control-plane` service. The name "Control Plane role" is a naming artifact — it labels a *tier* in the shared role vocabulary (mirroring who Control Plane's dashboard would let act) but the check itself is enforced entirely inside `apps/api`, against `apps/api`'s own session data. Concretely: any user holding `owner`/`operator` role in `apps/api` can call `gateway/fulfill` directly today, whether or not Control Plane's `gateway/ops` was ever called for that operation.

### AC5. Exact current flow, with the `apps/api` / `apps/control-plane` boundary marked

Two structurally separate pipelines exist today; neither calls into the other's decision logic.

**Pipeline 1 — Atlas agents acting on Atlas itself (what this plan's new route joins), entirely inside `apps/api`:**

```
request → identity [apps/api: requireUser / resolveAgentIdentity]
        → authorization [apps/api: enforceAgentToolAuthorization]
        → policy [apps/api ⇄ packages/agent-core: authorizeEntityAction, via dispatchAgentAction]
        → risk [apps/api: risk floors inside dispatchAgentAction]
        → decision [apps/api: ALLOWED / DENIED / APPROVAL_REQUIRED]
        → approval [apps/api: approvals.ts — createApprovalRequest / decideApprovalRequest / consumeApprovalRequest]
        → fulfillment [apps/api: fulfillGatewayHandoff — today via gateway/fulfill; this plan adds a second, approval-gated entry point]
        → execution [apps/api ⇄ packages/agent-core: executeTool]
        → evidence [apps/api: artifactHash, observation]
        → verification [apps/api: verification.ts — compareExpectedActual, regression]
        → audit [apps/api: appendUnifiedAuditEntry]
        → memory [apps/api: appendDomainEvent / memoryEpistemicAfterAction]
```

`apps/control-plane` touches this pipeline only asynchronously and non-gatingly: `control-plane-bridge.ts` fires an unawaited, error-swallowed telemetry event to Control Plane *after* an action, and never blocks or influences the pipeline above.

**Pipeline 2 — Control Plane governing an external Managed Application, entirely inside `apps/control-plane`:**

```
request → identity [apps/control-plane: resolveControlPlanePrincipal]
        → authorization/policy/risk [apps/control-plane: evaluateOperatingCycle]
        → decision [apps/control-plane: ALLOW / DENY / REQUIRE_APPROVAL]
        → (read-like op, ALLOW)  → observation + receipt marked EXECUTED, entirely in apps/control-plane
        → (write op, ALLOW)      → receipt marked NOT executed ("HANDED_OFF_GOVERNED"), governedHandoff object returned to the caller — pipeline ENDS here in code
        → approval [apps/control-plane: REQUIRE_APPROVAL recorded as an audit-log field in Control Plane's own governance-state.ts — not an apps/api ApprovalRequest]
        → fulfillment / execution / evidence / verification / audit(apps/api) / memory: NOT REACHED — no code calls onward into apps/api's approvals.ts or gateway/fulfill from this pipeline
```

For a write operation, Pipeline 2 dead-ends at "decision" from a code-execution standpoint — the comment in `atlas-gateway.ts` describes what a caller (a human operator, or a future orchestration layer) is expected to do next, but nothing in the repository does it automatically. This is also consistent with the standing P0 finding already in the validated review: no real external Managed Application is registered in Control Plane today (only `def-000`), so Pipeline 2 is not currently exercised by anything outside Atlas itself.

### AC6. Does the proposed `POST /api/v1/approvals/:id/fulfill` connect to, merely expose, or newly create a governance boundary?

**It merely exposes an existing `apps/api`-side fulfillment mechanism — the same one `gateway/fulfill` already exposes today. It does not connect to Control Plane's governance (there is nothing live to connect to, per AC1–AC3), and it does not create a new governance/execution boundary.** Concretely:

- It calls the exact same, unmodified `fulfillGatewayHandoff` function that `gateway/fulfill` already calls (Part A, A3/A4 below) — no new authorization, policy, risk, or execution logic is introduced.
- It goes through the exact same, unmodified `executeGovernedAction` six-stage gate as every other caller of `fulfillGatewayHandoff` — including the mandatory stage-4 policy/risk gate that cannot be skipped by omitting an approval (AC2).
- It is **strictly more constrained** than the existing raw `gateway/fulfill` route, not less: today's route accepts an *optional* `approvalRequestId` and will still execute a write with no approval attached at all, provided `dispatchAgentAction`'s risk gate independently allows it. The new route makes an existing, `APPROVED`, unconsumed `ApprovalRequest` a hard precondition (404 / 409 / 422 before `fulfillGatewayHandoff` is ever reached) — it tightens the path into the same pipeline, it does not loosen it.
- It does not touch, call, or depend on `apps/control-plane/*`, `evaluateOperatingCycle`, `gateway/ops`, `atlas-gateway.ts`, or `control-plane-bridge.ts` — none of those are modified, and none are made reachable by the new route.

**One documentation-accuracy note, surfaced for completeness and not acted on in this pass** (no code was changed): the existing comment on `apps/api/src/routes/gateway-fulfill.ts` — *"Operator-only hop: Control Plane ALLOW + handoff → executeGovernedAction"* — describes the aspirational relationship from AC3, not the actual, currently-decoupled behavior verified above. This gap is named and structured as its own item in **Part B** below; whether to correct the comment, and whether/when to build the handoff it describes, are Part B questions and are not decided here.

### Conclusion of this validation pass

Every finding above supports, and none contradicts, this plan's recommendation: Part A's new route is additive, stays entirely inside `apps/api`, requires no `governed-call-client.ts`, and requires no change to `apps/control-plane`. The reason is not merely "no network call happens to be needed today," but that **the fulfillment pipeline Part A extends was already structurally independent of Control Plane's decision-making before this plan, and Part A does not change, weaken, or newly couple that relationship in either direction.** The independent question of whether that relationship *should* eventually be built is Part B, documented next as a gap — not a proposal.

---

## Part B — Architectural gap: Control Plane Decision → Execution Handoff (documented only; not solved; not in scope)

**This is not a proposed change.** It is the Owner-requested, explicit documentation of a real gap surfaced by Validation Pass 2 (AC3 above), written as its own structured item so it cannot be read as part of Part A or as Control Plane integration work this plan performs.

**Current state.** `apps/control-plane`'s Operating Cycle (`gateway/ops → evaluateOperatingCycle`) can reach a real decision — `ALLOW`, `DENY`, or `REQUIRE_APPROVAL` — for an operation against a registered Managed Application. For a write-type operation that evaluates `ALLOW`, `atlas-gateway.ts`'s `fulfillAllow()` produces a receipt (`executionKind: "HANDED_OFF_GOVERNED"`) and a `governedHandoff` object (`entityType`/`action`/`toolName`, via `mapControlPlaneHandoff`). That is where Control Plane's involvement ends in code. `apps/api/src/routes/gateway-fulfill.ts` (`POST /api/v1/gateway/fulfill`) exists, is fully implemented, and is exercised by a real, non-mocked integration test (`geal-live-path.integration.test.ts`) — but that test drives it directly, as an `apps/api`-local operator call; it does not originate from, or carry any payload produced by, `apps/control-plane`. **No code anywhere in the repository calls `gateway/fulfill` (or anything else in `apps/api`) from `apps/control-plane`, or transports a `GatewayEvaluation`/receipt/`governedHandoff` value across the process boundary.** `gateway/fulfill` today has zero live production callers that originate from a Control Plane decision. The comment on `gateway-fulfill.ts` — *"Control Plane ALLOW + handoff → executeGovernedAction"* — and the comment on `dispatchGatewayOperation` — *"Consume via apps/api/src/services/approvals.ts then POST /api/v1/gateway/fulfill"* — both describe this intended future behavior in the present tense, which reads as documentation of current behavior but is not: verified against the actual call graph, it is intended, not implemented.

**Architectural purpose (of the gap, if closed).** To let a Control Plane governance decision over a Managed Application actually cause the corresponding action to run in `apps/api`, rather than ending as an unconsumed receipt — the step that would make Control Plane a live enforcement boundary for Managed Systems rather than an observability/decision surface whose write-op decisions currently go nowhere.

**Exact missing capability.** A caller (service-to-service call, or an equivalent mechanism) that takes a Control Plane `ALLOW` decision's `governedHandoff` output and turns it into an authenticated call into `apps/api`'s fulfillment pipeline — plus, on the `apps/api` side, a way for that pipeline to know the request's authority came from a genuine Control Plane decision rather than merely from an `apps/api`-local operator role (today, `requireOperator` cannot tell the difference, per AC4).

**Dependencies (if this were ever undertaken).** A synchronous, authenticated cross-service call from `apps/control-plane` to `apps/api` (the case §17 of the validated review, and this plan's earlier drafts, correctly identified `governed-call-client.ts` for); a way to carry the Control Plane decision/receipt identity through to `apps/api` so it can be distinguished from a local operator call; and a decision about whether `requireOperator` remains sufficient authorization on the `apps/api` side or needs a Control-Plane-specific check alongside it. None of this is designed here — this paragraph names the shape of the dependency, not a solution.

**Security implications of leaving it unsolved.** None that this plan introduces or worsens: today, a Control Plane `REQUIRE_APPROVAL`/`ALLOW` decision over a Managed Application simply does not result in execution by itself — it dead-ends as a receipt. That is a *capability gap* (a decision that should eventually be actionable currently is not), not an *authorization bypass* (nothing currently reachable skips a check because of this gap — see the No-bypass confirmation section below, which is scoped to Part A only and does not depend on Part B in any way). It is also consistent with, and does not change, the standing P0 finding already in the validated review that no real external Managed Application is registered in Control Plane today, so this gap is not currently being relied on by anything in production.

**In current implementation scope?** **No.** Per the Owner's explicit instruction: this plan does not solve this gap, does not create `governed-call-client.ts`, does not modify `apps/control-plane` or `control-plane-bridge.ts`, and does not propose a timeline for closing it. It is recorded here so the Owner has it as a named, trackable item — distinct from Part A and Part C — for a future, separately-scoped decision.

---

## Part A — `apps/api` approval fulfillment improvement (proposed for this phase)

**This is an `apps/api`-internal improvement only. It is not, and must not be described as, Control Plane integration** — see the architecture boundary section above and Part B for why.

- **Current state.** A formal `ApprovalRequest` can be created (`dispatchAgentAction` → `createApprovalRequest`) and decided (`approvals.ts`'s `/decide` → `decideApprovalRequest`), but an `APPROVED` request has no live code path that executes it — `consumeApprovalRequest` has exactly one caller (`executeGovernedAction`), reached only via `gateway/fulfill`, which nothing currently calls with a matching `approvalRequestId` in practice for this lifecycle (confirmed in the validated review, §3B).
- **Architectural purpose.** Give the existing, already-correct `apps/api` governance pipeline (`executeGovernedAction`) a real trigger for the one case it was missing: turning a human's `APPROVED` decision into an actual execution, deliberately and explicitly, without inventing any new authorization or policy mechanism.
- **Exact missing capability.** (1) An explicit route to invoke `fulfillGatewayHandoff` for a specific, already-`APPROVED` `ApprovalRequest`; (2) the `ApprovalRequest.context` data that fulfillment needs (`applicationId`/`operation`/`toolArgs`/`artifact`), which `agent-dispatch-guard.ts` does not currently record (A1 below).
- **Dependencies.** Only existing, unmodified `apps/api` machinery: `fulfillGatewayHandoff`, `executeGovernedAction`, `approvals.ts`'s existing `ApprovalRequest` store. No dependency on `apps/control-plane`, no new package, no schema migration.
- **Security implications.** Strictly additive gating in front of an already-fail-closed pipeline — see the No-bypass confirmation section below for the full stage-by-stage argument. No existing check is weakened, reordered, or made optional.
- **In current implementation scope?** **Yes.**

### A1. A second finding from deeper tracing, required before this plan is complete

Checking whether an `ApprovalRequest` record actually carries enough data to call `fulfillGatewayHandoff` (the function `gateway/fulfill` calls) found that **it does not, today.** `packages/shared/src/schemas/approval-request.schema.ts`'s `approvalRequestSchema` has `artifactHash`, `expectedObservations`, `baselineObservations`, `entityType`, `action`, `context: Record<string, unknown>` — but no `applicationId`, `operation`, `toolArgs`, or `artifact` (the raw artifact content, not just its hash) fields. Checking what `agent-dispatch-guard.ts`'s `dispatchAgentAction` actually puts into `context` when it creates an approval (line ~318): `routeLabel`, `actorKind`, `agentId`, `onBehalfOfUserId`, `sourceOrigin`, `sourceTrustLevel`, `score`, `bucket`, `projectId`, `input` — **`applicationId`, `operation`, `toolArgs`, and `artifact` are absent.** `DispatchAgentActionOptions` (the input interface to `dispatchAgentAction`) has no fields for these either.

This means: as things stand, even after adding a fulfillment trigger, there would be nothing yet in any `ApprovalRequest`'s `context` for it to act on. This plan includes the small, additive fix needed for that — described in A3 below — scoped precisely to avoid touching `dispatchAgentAction`'s policy/decision logic, per the Owner's boundary #3.

### A2. Design choice: an explicit fulfillment trigger, not an automatic follow-on

Two shapes were possible (flagged as undecided in the validated review): fulfillment triggered automatically the instant an approval is decided `APPROVED`, or fulfillment as its own explicit, separate action. **This plan chooses explicit.** Reasoning: an automatic follow-on means one HTTP call (`/decide`) now has two very different consequences bundled into it — recording a decision, and causing a real tool to run — which is harder to roll back cleanly (disabling it means changing `/decide`'s behavior) and harder to observe in isolation (a bug in fulfillment would surface as a failure of the decide call). An explicit trigger is a strictly additive new capability: if it needs to be disabled, the new route is simply not called; `/decide` is untouched either way. This also directly satisfies the Owner's boundary #6 (`approvals.ts`'s existing `/decide` behavior is not modified to participate in this flow) and boundary #10 (bounded, reversible).

### A3. Exact files to modify / add

| File | Change | Why minimal / non-duplicating |
|---|---|---|
| `apps/api/src/services/agent-dispatch-guard.ts` | **Additive only.** Add three new optional fields to `DispatchAgentActionOptions` (`operation?: string`, `toolArgs?: Record<string, unknown>`, `artifact?: string`). Thread them into the existing `context: {...}` object literal already built inside the `needsApproval` branch (~line 318), alongside the fields already recorded there. **No change to any decision, risk-scoring, or policy logic** — the `authorizeEntityAction` call, the risk floors, the `needsApproval` computation are untouched. | Existing optional-field pattern already used for `confidence`/`evidenceCount`/`delegationHopCount`; purely descriptive data threaded through, not new behavior |
| `apps/api/src/routes/approvals.ts` | Add one new route: `POST /api/v1/approvals/:id/fulfill` (see A4) | Additive; existing routes (`GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id/decide`) are not modified |
| **New file**: none required beyond the route addition above — `fulfillGatewayHandoff` (`apps/api/src/services/gateway-fulfillment.ts`) is reused as-is, unmodified | — | Reuses the exact function `gateway-fulfill.ts`'s existing route already calls; no new execution logic is written |

**Exactly one of the six `dispatchAgentAction` call sites** (`agent-proposal.ts`, `automation-rules.ts`, `code-engineer-dispatch.ts`, `llm-specialist-proposal.ts`, `llm-specialist-run.ts`, `research-analyst-dispatch.ts`) needs to be updated to actually pass the new `operation`/`toolArgs`/`artifact` fields — otherwise the new fulfillment route has no real `ApprovalRequest` to act on yet. **Which one is not decided in this plan** — none of the six have been read in this pass beyond confirming they call `dispatchAgentAction` (§3 of the validated review), and picking the lowest-risk one to pilot requires a short, read-only look at each first. This is proposed as **Task 0** in the sequencing below: a zero-risk reading pass, not an implementation step, producing a one-line recommendation (e.g., "start with `research-analyst-dispatch.ts` because X") for the Owner to confirm before A3's call-site change is written.

### A4. New route: `POST /api/v1/approvals/:id/fulfill`

```
1. requireOperator(app, request)          — same guard gateway/fulfill itself already uses; no new privilege tier invented
2. getApprovalRequest(id)                 — 404 if missing
3. status !== "APPROVED" → 409            — fail closed; do not execute a pending/rejected/already-consumed/revoked approval
4. context missing applicationId/agentId/operation/(toolArgs or artifact) → 422
     "This approval was not created with fulfillable execution data" — fail closed, no guessing, no partial execution
5. fulfillGatewayHandoff({                — in-process call to the EXISTING, unmodified function
     sessionOwnerId: user.id,
     applicationId: context.applicationId,
     agentId: context.agentId,
     operation: context.operation,
     toolArgs: context.toolArgs,           (if present)
     artifact: context.artifact,           (if present)
     projectRoot: findRepoRoot(),
     projectId: context.projectId ?? null,
     requestId: request.id,
     approvalRequestId: id,
     expectedObservations: approval.expectedObservations,   — already on the ApprovalRequest record itself
     baselineObservations: approval.baselineObservations,   — already on the ApprovalRequest record itself
   })
6. Return the GatewayFulfillmentResult as the response body
```
Step 5 is the only step that does real work; everything before it is a guard, and every guard fails closed (denies/refuses) rather than falling through.

### A5. Data/control flow — before and after

**Before:**
```
dispatchAgentAction() → needsApproval → createApprovalRequest()  [ApprovalRequest: PENDING]
    ↓
apps/api/routes/approvals.ts POST /:id/decide → decideApprovalRequest()  [ApprovalRequest: APPROVED or REJECTED]
    ↓
                              [nothing — dead end, confirmed by validation pass §3B]
```

**After:**
```
dispatchAgentAction() → needsApproval → createApprovalRequest()
    [context now additionally carries applicationId/operation/toolArgs-or-artifact, for the one piloted call site]
    ↓                                                          [ApprovalRequest: PENDING]
apps/api/routes/approvals.ts POST /:id/decide → decideApprovalRequest()   [ApprovalRequest: APPROVED or REJECTED]
    ↓ (if APPROVED, a human/operator separately calls the new route — not automatic, per A2)
apps/api/routes/approvals.ts POST /:id/fulfill
    → fulfillGatewayHandoff() → executeGovernedAction()
         1. enforceAgentToolAuthorization (tool-level gate)
         2. computeArtifactHash (pin exactly what runs)
         3. consumeApprovalRequest (ApprovalRequest: APPROVED → CONSUMED; one-time)
         4. dispatchAgentAction / authorizeEntityAction (policy/risk gate, re-checked at execution time)
         5. executeTool (the real action happens)
         6. appendUnifiedAuditEntry (always)
```
Everything from `fulfillGatewayHandoff` downward is existing, unmodified, already-tested code (`geal-live-path.integration.test.ts`). Only the new route (step "apps/api/routes/approvals.ts POST /:id/fulfill") and the context-threading in `agent-dispatch-guard.ts` are new.

### A6. Fail-closed behavior

- Wrong status (not `APPROVED`) → 409, no execution. Covers PENDING, REJECTED, already-CONSUMED, and REVOKED uniformly.
- Missing fulfillment data in `context` → 422, no execution, no guessing at defaults.
- Anything `executeGovernedAction` itself refuses (stale artifact, expired approval, tool-authorization failure, policy re-check failure) → surfaces as that stage's existing refusal; this plan does not change `executeGovernedAction`'s own fail-closed ordering (§3B of the validated review) in any way.
- No network dependency is introduced (per the scope clarification above), so there is no "Control Plane unreachable" failure mode to design for in this plan.

### A7. Approval semantics

Unchanged from what the validation pass already confirmed as correct: `approvals.ts`'s `/decide` remains the sole place a human approval/rejection decision is recorded, exactly as today. This plan adds nothing to that semantics — it only adds what happens *after* `APPROVED`, as a distinct, explicit, separately-authorized (`requireOperator`) action. An approval decided but never fulfilled remains inert, exactly as safe as today's total dead-end, just now with a door out of it that must be deliberately opened.

### A8. Audit / evidence / memory behavior

All handled by the existing, unmodified `executeGovernedAction`: `appendUnifiedAuditEntry` (audit), the artifact-hash pinning and `expectedObservations`/`baselineObservations` verification (evidence/regression, per `governed-execution.ts`'s own composed stages), and — per `gateway-fulfillment.ts`'s imports — `memoryEpistemicAfterAction` (`@atlas/shared`), meaning a memory event is written with the correct epistemic state, exactly as `geal-live-path.integration.test.ts` already verifies. No new audit/evidence/memory code is written; this plan's only job is to get a real caller to that existing machinery.

### A9. Rollback strategy

Because both changes are strictly additive (new optional fields, one new route, one call site passing three new optional arguments), rollback is: stop routing traffic to `POST /api/v1/approvals/:id/fulfill` (remove the route registration, or feature-flag it off) and revert the one pilot call site's three new arguments. `agent-dispatch-guard.ts`'s three new optional fields can remain harmlessly unused if only the route is rolled back — they are not referenced by anything else. No data migration, no schema change to `approvalRequestSchema` itself, nothing to unwind in already-created `ApprovalRequest` records (older ones simply keep failing the A4-step-4 422 check, exactly as they do today by being unreachable at all).

### A10. Tests to add/update

- New unit/integration test for `POST /api/v1/approvals/:id/fulfill`: 404 (missing), 409 (wrong status, all four non-APPROVED statuses), 422 (missing context data), and a success case — extending `geal-live-path.integration.test.ts`'s existing non-mocked pattern rather than building a parallel mocked test.
- Update the pilot call site's existing `*.test.ts` (e.g. `research-analyst-dispatch.test.ts` if that's the one chosen in Task 0) to assert the new `operation`/`toolArgs`/`artifact` arguments are passed through and land correctly in the resulting `ApprovalRequest.context`.
- No existing test should need to change behavior-wise — `agent-dispatch-guard.test.ts` and `approvals`-related existing tests should continue passing unmodified, since nothing existing is being changed, only added to.

---

## Part C — `intelligence.ts` hypothesis authorization/audit gap (separate finding, separate fix, per boundary #8)

This is not bundled with Part A, and has no relationship whatsoever to Part B (the Control Plane handoff gap) or the Control Plane question in general — it is a plain `apps/api` authorization/audit fix, unrelated to gateway fulfillment.

- **Current state.** `POST /intelligence/hypotheses` and `PATCH /intelligence/hypotheses/:id/status` mutate persisted records with only an inline `user?.id` check — no policy check, no audit entry.
- **Architectural purpose (of the fix).** Bring these two routes in line with the ten other route files that already gate writes through `enforceEntityWrite`, so hypothesis mutations are policy-checked and audited like every other business-entity write in the system.
- **Exact missing capability.** A call to `enforceEntityWrite({ entityType: "RECORD", action: "CREATE" | "UPDATE", ... })` in place of (POST) or in addition to (PATCH) the current inline/absent check.
- **Dependencies.** Only pre-existing, already-defined policy entries (`RECORD.CREATE`, `RECORD.UPDATE` in `entity-policies.ts`) and the pre-existing `enforceEntityWrite` function. No new policy, no new mechanism, no dependency on Part A or Part B.
- **Security implications.** Closes a real, currently-live gap: hypothesis mutations are reachable today with no audit trail and no policy check beyond authentication. Fixing it is strictly additive (adds a check that fails closed on `DENIED`); nothing is removed or loosened.
- **In current implementation scope?** **Yes.**

### C1. Exact finding

`apps/api/src/routes/intelligence.ts`'s `POST /api/v1/intelligence/hypotheses` and `PATCH /api/v1/intelligence/hypotheses/:id/status` create and mutate a persisted `Hypothesis` record (`apps/api/src/services/hypothesis-engine.ts`, self-documented as "Stage 19... a scaffold... without yet implementing the full automated verification pipeline"). The route only checks `request.user?.id` inline — a hand-rolled, non-standard re-check of what the global `requireUser` `onRequest` hook (ADR-021) already guarantees — and calls neither `authorizeEntityAction`/`enforceEntityWrite` nor any audit function. Confirmed by direct grep of `hypothesis-engine.ts`: zero matches for `audit`, `authorizeEntity`, or `enforceEntityWrite`.

### C2. Minimal fix — pure reuse, no new policy

Checked `packages/agent-core/src/policies/entity-policies.ts`'s existing policy table: `RECORD.CREATE` (`LOW_RISK_WRITE`, `requiresApproval: false`) and `RECORD.UPDATE` (`HIGH_RISK_WRITE`, `requiresApproval: true`) are **already defined**, pre-existing policy entries — no new policy needs to be added anywhere. A hypothesis (a testable prediction about system behavior) fits the `RECORD` bucket's own definition ("a general operational/business record that isn't better described by a more specific bucket") cleanly.

**Exact change**: in `apps/api/src/routes/intelligence.ts`, replace the current `if (!user?.id) return reply.status(401)...` check in the `POST /hypotheses` handler with `enforceEntityWrite({ entityType: "RECORD", action: "CREATE", routeLabel: "intelligence.hypotheses.create", actorId: user.id })`, and in the `PATCH /hypotheses/:id/status` handler add `enforceEntityWrite({ entityType: "RECORD", action: "UPDATE", routeLabel: "intelligence.hypotheses.updateStatus", actorId: user.id })` (this handler currently has no auth check shown at all beyond the global hook — confirmed by the original grep pass). Both calls use the exact same `enforceEntityWrite` function and pattern already used by ten other route files (§2 of the validated review) — no new mechanism, no new file.

### C3. Data/control flow — before and after

**Before:** `POST /hypotheses` → inline `user?.id` check → `createHypothesis()` → response. No audit entry, no risk evaluation. **PATCH** has no explicit auth check at all beyond the global hook, and no audit entry.

**After:** `POST /hypotheses` → `enforceEntityWrite(RECORD, CREATE)` → (on ALLOWED) `createHypothesis()` → response; a `RECORD.CREATE` audit entry now exists for every hypothesis created. `PATCH /status` → `enforceEntityWrite(RECORD, UPDATE)` → (on ALLOWED — `RECORD.UPDATE` requires approval under the general policy table, but `enforceEntityWrite` calls with `approved: true`, i.e. the same "self-approved write" pattern every other human-direct write endpoint already uses) → `updateHypothesisStatus()` → response; a `RECORD.UPDATE` audit entry now exists.

### C4. Fail-closed behavior

`enforceEntityWrite` already throws `AtlasError("FORBIDDEN", ...)` (HTTP 403) on `DENIED`, and fails safe (logs as rejection, does not silently pass) on any unexpected non-`ALLOWED` outcome (§1 of the validated review, `risk-audit.ts` read in full) — this is existing, already-tested behavior, inherited for free.

### C5. Approval semantics

None introduced — `enforceEntityWrite`'s `approved: true` self-approved-write pattern is identical to how every other human-direct write route already treats a signed-in caller's direct action as its own approval. No new approval workflow, no interaction with Part A.

### C6. Audit/evidence/memory behavior

An audit entry is now written for both hypothesis create and status-update actions, via the same `appendUnifiedAuditEntry` path `enforceEntityWrite` already calls for every other covered route. No memory/evidence behavior is added or changed — hypotheses are not currently part of the epistemic memory system, and this fix does not change that.

### C7. Rollback strategy

Revert the two `enforceEntityWrite` calls back to the prior inline check / no check. No schema change, no data migration — existing `Hypothesis` records are unaffected either way, since `enforceEntityWrite` only gates the write path, it does not alter what's stored.

### C8. Tests to add/update

New tests for `intelligence.ts`'s two mutating routes: a signed-in user succeeds and produces an audit entry (currently untested, since no audit call exists to test); confirm `RECORD.CREATE`/`RECORD.UPDATE` are the policy/audit labels recorded. No existing test for these two routes was found to assert the old inline-check behavior specifically, so no existing test is expected to need updating — this should be independently confirmed by running the existing `intelligence`-related test suite before merging, not assumed.

---

## No-bypass confirmation (Validation Pass 2)

The Owner asked for explicit confirmation that the proposed Approval Fulfillment path (Part A) cannot bypass existing authorization, policy, risk, approval, audit, evidence, or verification requirements. Traced against `executeGovernedAction`'s six fixed stages (AC2 above), for every request that reaches the new route:

- **Authorization** — stage 1, `enforceAgentToolAuthorization`, unchanged, cannot be skipped.
- **Policy** — stage 4, `dispatchAgentAction` → `authorizeEntityAction`, unchanged, runs on every call regardless of whether an approval is present.
- **Risk** — the same stage-4 gate; a high-risk entity-action that requires approval is refused (`APPROVAL_REQUIRED`) even if the caller reached the route, unless a matching consumed approval covers it.
- **Approval** — the new route adds a precondition (`status === "APPROVED"`, then atomically consumed) *in front of* stage 2/3's existing `consumeApprovalRequest` call, which itself remains unchanged; this is strictly additive gating, not a substitute for it.
- **Audit** — stage 6, `appendUnifiedAuditEntry`, unconditional on every branch (including every refusal), unchanged.
- **Evidence / verification** — `fulfillGatewayHandoff`'s existing `expectedObservations`/`baselineObservations`/`compareExpectedActual`/regression logic (unchanged, A5) runs exactly as it does for `gateway/fulfill` today.

No stage is reordered, weakened, made conditional-when-it-wasn't, or bypassed. The new route's only functional difference from calling `gateway/fulfill` directly is that it requires — rather than merely accepts — an existing formal, `APPROVED`, artifact-bound `ApprovalRequest` before it will even attempt fulfillment.

---

## Explicit files that remain untouched (Parts A and C — the two proposed changes; Part B is not implemented at all)

`packages/agent-core/src/policies/entity-policies.ts` and `authorization.ts` (no policy logic changes — Part C reuses an existing policy entry, Part A adds no new one); `apps/api/src/services/risk-audit.ts` (`enforceEntityWrite` itself unmodified); `apps/api/src/services/governed-execution.ts` (`executeGovernedAction` unmodified — reused as-is); `apps/api/src/services/gateway-fulfillment.ts` (`fulfillGatewayHandoff` unmodified — reused as-is); `apps/api/src/routes/gateway-fulfill.ts` (untouched — remains the direct, operator-supplied-data entry point, now joined by, not replaced by, the new approval-aware entry point); `apps/api/src/services/control-plane-bridge.ts` (untouched, per boundary #4 — remains the async fail-open telemetry subscriber, unrelated to any part of this plan); `apps/control-plane/*` in its entirety, including `atlas-gateway.ts` and the `/api/v1/gateway/ops` route (not called, not modified — per the scope clarification above and Part B, which documents but does not act on the gap there); `apps/api/src/routes/approvals.ts`'s existing three routes (`GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id/decide` — only a fourth route is added); all five of the non-piloted `dispatchAgentAction` call sites; `apps/admin/*` and `apps/web/app/admin/*` (Admin boundary, out of scope per boundary #10); `FABRIC_AGENT_CATALOG`, `COGNITIVE_ROLE_CATALOG`, `cannotSelfValidate`, and everything related to internal second-opinion review (out of scope per boundary #10); the portfolio/Managed-System registry and everything related to external supervision (out of scope per boundary #10); the two agent registries (Control Plane legacy + Fabric — not merged, not touched).

---

## Sequencing

**Task 0** (read-only, zero risk): read the six `dispatchAgentAction` call sites to pick the lowest-risk pilot for Part A's call-site change; produce a one-line recommendation for Owner confirmation before writing any code.
**Task 1** (Part C): the `intelligence.ts` fix — fully independent, can happen first, in parallel, or not at all relative to Part A.
**Task 2** (Part A): `agent-dispatch-guard.ts`'s additive context fields, the new `/fulfill` route, and the one pilot call site's three new arguments — in that order, each independently testable before the next.

**Part B is not a task.** It is documented above as a named architectural gap, not proposed for implementation, and has no place in this sequencing — it is neither scheduled, nor a prerequisite, nor a follow-on to Tasks 0–2.

---

# STOP

This is a plan, not implementation. No files listed above have been changed. **Part B is documentation of a gap, not a proposal — it requires no approval to remain undecided, and no approval given here extends to it.** Waiting for explicit Owner approval of Part A and Part C — including confirmation of the A2 design choice (explicit trigger) and, once given, Task 0's pilot-call-site recommendation — before any code is written.
