# Atlas — Final Implementation Plan: Item 1 (`intelligence.ts` defect) + Item 2 (ApprovalRequest fulfillment)

**Status: PLAN ONLY. Repository remains frozen. No production code, tests, routes, schemas, or registries were modified to produce this document.** This plan covers exactly the two items the Owner approved for planning — `intelligence.ts`'s governance defect, and the ApprovalRequest execution trigger (Part A). Nothing else. Items 3–8 from the prior proposal catalog are untouched, unreferenced, and not implied by anything below. No code is authorized to be written until the Owner explicitly approves this plan.

This plan required re-reading the exact current source of every file it touches — in the process it found and corrects two factual errors that had been carried forward from earlier documents in this review (both disclosed in place below, not silently fixed): Item 1's defect is in **four** routes, not two; and the "six `dispatchAgentAction` call sites" figure used throughout the prior review and implementation-plan documents is wrong — the real number of direct callers is three, and none of them cleanly supports fulfillment as originally assumed (see Item 2, "Task 0 findings").

---

## Item 1 — `intelligence.ts` governance defect

### Correction to prior scope (found this pass, disclosed before anything else)

Every prior document in this review, including the Verification Status / Baseline Report, described this defect as affecting **two** routes: `POST /hypotheses` and `PATCH /hypotheses/:id/status`. Reading the full route file for this plan found **two more mutating routes with the identical gap, previously unexamined**: `POST /hypotheses/:id/evidence/supporting` and `POST /hypotheses/:id/evidence/contradicting` — both call `addSupportingEvidence`/`addContradictingEvidence` (`hypothesis-engine.ts`) with **no auth check at all beyond the global `requireUser` hook**, not even the inline check `POST /hypotheses` has. This plan scopes Item 1 to all four routes; treating it as two would leave two reachable, unaudited mutation paths unfixed while believing the defect closed.

### Exact files to modify

`apps/api/src/routes/intelligence.ts` — the only file. No change to `apps/api/src/services/hypothesis-engine.ts` (the mutation logic itself is correct and untouched), no change to any policy file, no new file.

### Exact functions/routes affected

| Route | Handler (current, `intelligence.ts`) | Underlying service call (unchanged) |
|---|---|---|
| `POST /api/v1/intelligence/hypotheses` | inline `if (!user?.id)` check via a raw `(request as {user?:{id:string}}).user` cast | `createHypothesis()` |
| `PATCH /api/v1/intelligence/hypotheses/:id/status` | **no check at all** beyond the global hook — does not even read `user` | `updateHypothesisStatus()` |
| `POST /api/v1/intelligence/hypotheses/:id/evidence/supporting` | **no check at all** | `addSupportingEvidence()` |
| `POST /api/v1/intelligence/hypotheses/:id/evidence/contradicting` | **no check at all** | `addContradictingEvidence()` |

The two read-only routes (`GET /hypotheses`, and the golden-projects/agent-marketplace routes elsewhere in the same file) are unaffected and out of scope — they are reads, not writes, and the defect is specifically about ungoverned writes.

### Current behavior

```ts
app.post("/api/v1/intelligence/hypotheses", async (request, reply) => {
  const user = (request as { user?: { id: string } }).user;
  if (!user?.id) {
    return reply.status(401).send({ error: "Authentication required" });
  }
  const body = hypothesisCreateSchema.parse(request.body);
  const hypothesis = createHypothesis({ ...body, createdBy: user.id });
  return reply.status(201).send(hypothesis);
});

app.patch("/api/v1/intelligence/hypotheses/:id/status", async (request, reply) => {
  const { id } = request.params as { id: string };
  const { status } = z.object({ status: hypothesisStatusSchema }).parse(request.body);
  const updated = updateHypothesisStatus(id, status);
  // no user extracted, no auth check, no policy check, no audit entry
  ...
});

// POST .../evidence/supporting and .../evidence/contradicting: identical
// shape to PATCH /status — id + body parsed, service called, no user
// extracted, no check, no audit entry.
```

No route in this set calls `authorizeEntityAction`, `enforceEntityWrite`, or `appendUnifiedAuditEntry`. Confirmed by direct grep of `hypothesis-engine.ts`: zero matches for `audit`, `authorizeEntity`, `enforceEntityWrite`.

### Target behavior

```ts
import { requireUser } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

app.post("/api/v1/intelligence/hypotheses", async (request, reply) => {
  const user = await requireUser(app, request);
  const body = hypothesisCreateSchema.parse(request.body);
  enforceEntityWrite({
    entityType: "RECORD",
    action: "CREATE",
    routeLabel: "intelligence.hypotheses.create",
    actorId: user.id,
    input: { statement: body.statement, domain: body.domain },
  });
  const hypothesis = createHypothesis({ ...body, createdBy: user.id });
  return reply.status(201).send(hypothesis);
});

app.patch("/api/v1/intelligence/hypotheses/:id/status", async (request, reply) => {
  const user = await requireUser(app, request);
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const { status } = z.object({ status: hypothesisStatusSchema }).parse(request.body);
  enforceEntityWrite({
    entityType: "RECORD",
    action: "UPDATE",
    routeLabel: "intelligence.hypotheses.updateStatus",
    actorId: user.id,
    input: { hypothesisId: id, status },
  });
  const updated = updateHypothesisStatus(id, status);
  ...
});

// evidence/supporting and evidence/contradicting: same pattern as PATCH
// /status — requireUser, then enforceEntityWrite(RECORD, UPDATE,
// routeLabel: "intelligence.hypotheses.addSupportingEvidence" /
// "...addContradictingEvidence"), then the existing service call.
```

`hypothesisCreateSchema`'s `.params` currently uses a raw cast (`request.params as {id:string}`) rather than a validated schema for the three `:id`-bearing routes — bringing that in line with the zod-validated pattern already used elsewhere in this same file (e.g. `evidenceId: z.string().uuid()`) is a small, in-scope hygiene improvement bundled with this fix, not a separate item, since these lines are being touched anyway.

### Call sequence — before and after

**Before (all four routes):** `HTTP request → global requireUser hook (session only) → route handler → (weak/no inline check) → service mutation → response.` No policy decision point, no audit entry, for any of the four.

**After (all four routes):** `HTTP request → global requireUser hook → route handler → requireUser(app, request) [redundant with the hook by design — the hook only proves a session exists; requireUser resolves the identity object the route needs, same as every other route in this codebase] → enforceEntityWrite(RECORD, CREATE|UPDATE, routeLabel, actorId) → [ALLOWED] → service mutation → response`. On `DENIED`, `enforceEntityWrite` throws `AtlasError("FORBIDDEN", ...)` before the service mutation is ever called.

### Existing governance mechanisms that remain unchanged

`enforceEntityWrite` itself (`apps/api/src/services/risk-audit.ts`) — not modified, called with its existing signature. The pre-existing policy entries `RECORD.CREATE` (`LOW_RISK_WRITE`, `requiresApproval: false`) and `RECORD.UPDATE` (`HIGH_RISK_WRITE`, `requiresApproval: true`) in `packages/agent-core/src/policies/entity-policies.ts` — **no new policy entry is added; both already exist and are reused verbatim.** `authorizeEntityAction`, `appendUnifiedAuditEntry`, `hypothesis-engine.ts`'s four mutation functions — all unmodified.

### Authorization and policy enforcement points

Two, added in sequence, for each of the four routes: (1) `requireUser` — identity resolution (was already implicitly guaranteed by the global hook; made explicit so the route has a real `AuthUser` to pass an `actorId`); (2) `enforceEntityWrite` — entity-level policy decision + audit, the layer that was entirely missing. No new enforcement point type is introduced — this is the same two-step pattern `apps/api/src/routes/agent-lifecycle.ts` (and nine other route files) already use.

### Approval semantics

`enforceEntityWrite` calls `authorizeEntityAction` with `approved: true` — the standing "self-approved write" pattern: a signed-in human's own direct action is treated as its own approval, exactly as every other human-direct write route in the system already works. `RECORD.UPDATE`'s `requiresApproval: true` in the policy table is satisfied by this same mechanism, not by a new approval workflow. No interaction with Item 2 — the ApprovalRequest lifecycle and its formal `PENDING → APPROVED` decision flow is not invoked here and is not relevant to this item.

### Audit/evidence requirements

A `RECORD.CREATE` or `RECORD.UPDATE` audit entry (via `appendUnifiedAuditEntry`, called inside `enforceEntityWrite`) now exists for every hypothesis mutation across all four routes — currently zero exist for any of them. No evidence/verification/memory machinery is added or changed; hypotheses are not part of the epistemic memory system today and this fix does not change that.

### Failure and rollback behavior

**Failure:** `enforceEntityWrite` throws `AtlasError("FORBIDDEN", reason, {statusCode:403})` on `DENIED`, and fails safe on any unexpected non-`ALLOWED` outcome — inherited, unmodified behavior. For a legitimate signed-in caller (today's only real caller population), the self-approved-write pattern means the route's success behavior is unchanged; only the previously-absent audit trail is added.

**Rollback:** Revert the four call sites in `intelligence.ts` to their prior form. No schema change, no data migration — existing `Hypothesis` records are unaffected either way, since `enforceEntityWrite` only gates the write path and does not alter what is stored.

### Idempotency requirements

None beyond what already exists. These are ordinary CRUD writes (create-with-server-generated-id, or set-to-an-exact-target-state), not executions with side effects outside the database — `updateHypothesisStatus`/`addSupportingEvidence`/`addContradictingEvidence` are naturally idempotent in their current form (setting a field to an exact value, or adding an evidence id to a set), and `enforceEntityWrite` introduces no new non-idempotent behavior. No idempotency key is needed or proposed for this item.

### Security implications

Closes four live, reachable, currently-ungoverned write paths (two more than previously documented). The change is strictly restrictive — it can only make an action harder to perform (subject to a policy decision that, for the current caller population, always self-approves), never easier. No new privilege is granted to anyone.

### Required tests

**No test file exists today for this route file or for `hypothesis-engine.ts` — confirmed by direct search this pass.** New file: `apps/api/src/routes/intelligence.test.ts`, covering all four mutating routes: a signed-in user succeeds and produces the expected `RECORD.CREATE`/`RECORD.UPDATE` audit entry (asserted via `appendUnifiedAuditEntry`'s recorded call or the audit log's read-back, matching the pattern other route tests use); an unauthenticated request is rejected by the existing global hook (already covered by `governance-invariants.test.ts`'s "Unauthenticated DENY", but worth one route-specific assertion for completeness).

### Regression tests protecting existing VERIFIED paths

Because no test file exists for this route today, there is no existing coverage to regress for `intelligence.ts` itself. What must be re-run and must continue passing unmodified: `packages/agent-core/src/policies/entity-policies.test.ts` (14 tests — proves `RECORD.CREATE`/`RECORD.UPDATE`'s policy definitions are not altered by this change, since none of their source is touched), `apps/api/src/services/risk-audit.test.ts` (5 tests — proves `enforceEntityWrite`'s own behavior is unmodified), and `apps/api/src/services/audit-log.test.ts` (12 tests — proves the audit-write path this change now exercises for the first time from this file is itself unmodified).

### Expected changes to architecture documentation

None required to implement this item. Once implemented, `atlas-live-enforcement-integration-review.md`'s route-classification table (which currently lists `intelligence.ts` as the one confirmed gap) and the Verification Status / Baseline Report produced earlier in this review should both be updated to reflect closure — a documentation follow-up after implementation, not a precondition for it, and not proposed as part of this plan's code change.

---

## Item 2 — ApprovalRequest execution trigger (Part A)

### Task 0 findings (performed this pass — read-only; supersedes the prior "six call sites" framing)

The prior review and implementation-plan documents stated `dispatchAgentAction` has six direct callers (`agent-proposal.ts`, `automation-rules.ts`, `code-engineer-dispatch.ts`, `llm-specialist-proposal.ts`, `llm-specialist-run.ts`, `research-analyst-dispatch.ts`) and left "pick the lowest-risk one" as an open Task 0. **A direct repo-wide search this pass (`dispatchAgentAction(` as an actual call, not a comment mention) found this is wrong: there are exactly three direct callers** — `apps/api/src/routes/agent-fabric.ts:266` (a pre-flight gate for the SECURITY/LEGAL_MEDIA_COMMS specialists, `CASE`/`EXECUTE`), `apps/api/src/services/agent-proposal.ts:155` (inside `submitAgentProposal()`, the shared translator every LLM-specialist proposal flow funnels through), and `apps/api/src/services/automation-rules.ts:305` (a system-triggered gate, `CASE`/`CREATE`). The other four names in the old list either call `submitAgentProposal()` indirectly (through `runProposalBackedSpecialist()` in `llm-specialist-run.ts`) or don't call `dispatchAgentAction` at all — they only *mention* it in doc comments explaining the architecture, which is what the earlier count actually matched.

**A second, more consequential finding:** `fulfillGatewayHandoff`'s mapping function (`mapGatewayHandoff`, `packages/shared/src/constants/atlas-gateway.ts`) has a **hard type restriction** — `GatewayHandoffMapping.entityType` is `"DOCUMENT" | "RECORD"` only, and `.action` is `"READ" | "UPDATE"` only. This is checked by `consumeApprovalRequest`'s existing `presented.entityType`/`presented.action` match against the `ApprovalRequest`'s own stored values (`apps/api/src/services/approvals.ts`) — a mismatch throws `409 CONFLICT`, **which is an existing safety net, not something this plan needs to add**. But it also means: of the three real call sites, **only the RESEARCHER flow (`research-analyst-dispatch.ts`, which dispatches `DOCUMENT`/`READ`) can be given a real, working `operation` value** (`"request_agent_run"`, which `mapGatewayHandoff("request_agent_run", "RESEARCHER")` correctly maps back to `{toolName:"knowledge_search", entityType:"DOCUMENT", action:"READ"}` — an exact match, verified against `packages/shared/src/constants/atlas-gateway.test.ts`'s own existing assertion for this pair). `automation-rules.ts` (`CASE`/`CREATE`) and `agent-fabric.ts`'s gate (`CASE`/`EXECUTE`) **cannot** be fulfilled this way at all without widening `GatewayHandoffMapping`'s type to include `CASE` — a `packages/shared` schema/type change this plan does not propose, per the Owner's explicit constraint against schema changes not strictly required for these two items.

**Third finding, which changes this plan's recommended scope:** even the RESEARCHER path is not simple plumbing. The call chain is `research-analyst-dispatch.ts` → `runProposalBackedSpecialist()` (`llm-specialist-run.ts`) → `submitAgentProposal()` (`agent-proposal.ts`) → `dispatchAgentAction()` (`agent-dispatch-guard.ts`) — four files, not the two originally assumed. And beyond the plumbing, there is a genuine, undesigned question this plan will not answer: what `toolArgs` a fulfillment call should actually carry for `knowledge_search` (derived from the proposal's `taskId`/`request`/`claims`, in a shape that does not yet exist anywhere in the codebase). Designing that mapping would be inventing new behavior, not deriving it from what exists — exactly what the Owner instructed this plan not to do.

**Recommendation:** build the general-purpose fulfillment capability (route + additive context fields) as fully specified below, tested with synthetic/directly-constructed `ApprovalRequest.context` data — the same pattern `geal-live-path.integration.test.ts` already uses for `gateway/fulfill` itself. **Do not wire any real call site to supply `operation`/`toolArgs`/`artifact` as part of this plan.** Connecting a real call site (most plausibly RESEARCHER, for the reasons above) is a small, separate, well-scoped follow-on decision for the Owner once this foundation exists — not bundled into "Item 2" implicitly, and not decided here.

### Exact files to modify

`apps/api/src/services/agent-dispatch-guard.ts` — additive fields only. `apps/api/src/routes/approvals.ts` — one new route. No other file. (No call site is touched, per the Task 0 finding above — this is a deliberate reduction from the prior plan's scope, not an omission.)

### Exact functions/routes affected

| File | Function/route | Change |
|---|---|---|
| `agent-dispatch-guard.ts` | `DispatchAgentActionOptions` (interface, line 84) | Add three optional fields: `operation?: string`, `toolArgs?: Record<string, unknown>`, `artifact?: string` |
| `agent-dispatch-guard.ts` | `dispatchAgentAction()`'s `needsApproval` branch (line ~318, the `context: {...}` object literal passed to `createApprovalRequest`) | Thread the three new fields into the existing object literal, alongside `routeLabel`, `actorKind`, `agentId`, etc. that are already recorded there |
| `approvals.ts` | New route: `POST /api/v1/approvals/:id/fulfill` | New — see call sequence below |

### Current behavior

```ts
// agent-dispatch-guard.ts, inside dispatchAgentAction(), needsApproval branch:
const approvalRequest = createApprovalRequest({
  entityType, action, requestedBy,
  reason: explanation.factors.join("; "),
  context: {
    routeLabel, actorKind: actor.kind, agentId: actor.agentId,
    onBehalfOfUserId: actor.onBehalfOfUserId,
    sourceOrigin: sourceContext.origin, sourceTrustLevel: sourceContext.trustLevel,
    score, bucket, projectId: options.projectId ?? null, input: options.input ?? {},
    // no operation / toolArgs / artifact — nothing here can drive fulfillment
  },
});
```

`approvals.ts` has three routes: `GET /approvals`, `GET /approvals/:id`, `POST /:id/decide`. After `/decide` sets a request to `APPROVED`, nothing in the codebase ever calls `consumeApprovalRequest` for it — confirmed exactly one caller of `consumeApprovalRequest` repo-wide (`executeGovernedAction`), reached only via `gateway/fulfill`, which nothing calls with a matching `approvalRequestId` today. An `APPROVED` request is a permanent dead end.

### Target behavior

```ts
// agent-dispatch-guard.ts — DispatchAgentActionOptions gains:
readonly operation?: string;
readonly toolArgs?: Record<string, unknown>;
readonly artifact?: string;

// ...and the context literal becomes:
context: {
  routeLabel, actorKind: actor.kind, agentId: actor.agentId,
  onBehalfOfUserId: actor.onBehalfOfUserId,
  sourceOrigin: sourceContext.origin, sourceTrustLevel: sourceContext.trustLevel,
  score, bucket, projectId: options.projectId ?? null, input: options.input ?? {},
  ...(options.operation !== undefined ? { operation: options.operation } : {}),
  ...(options.toolArgs !== undefined ? { toolArgs: options.toolArgs } : {}),
  ...(options.artifact !== undefined ? { artifact: options.artifact } : {}),
},
```

```ts
// approvals.ts — new route
app.post("/api/v1/approvals/:id/fulfill", async (request) => {
  const user = await requireOperator(app, request);   // see "Authorization" below — deliberately stricter than the file's other three routes
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const approval = getApprovalRequest(id);
  if (!approval) {
    throw new AtlasError("NOT_FOUND", `Approval request ${id} not found`, { statusCode: 404 });
  }
  if (approval.status !== "APPROVED") {
    throw new AtlasError("CONFLICT",
      `Approval request ${id} is not APPROVED (status=${approval.status})`,
      { statusCode: 409 });
  }
  const ctx = approval.context as {
    applicationId?: string; agentId?: string; operation?: string;
    toolArgs?: Record<string, unknown>; artifact?: string; projectId?: string | null;
  };
  if (!ctx.agentId || !ctx.operation || (!ctx.toolArgs && !ctx.artifact)) {
    throw new AtlasError("VALIDATION_ERROR",
      `Approval request ${id} was not created with fulfillable execution data`,
      { statusCode: 422 });
  }
  return fulfillGatewayHandoff({
    sessionOwnerId: user.id,
    applicationId: ctx.applicationId ?? ATLAS_SELF_APPLICATION_ID,
    agentId: ctx.agentId,
    operation: ctx.operation,
    ...(ctx.toolArgs ? { toolArgs: ctx.toolArgs } : {}),
    ...(ctx.artifact ? { artifact: ctx.artifact } : {}),
    projectRoot: findRepoRoot(),
    projectId: ctx.projectId ?? null,
    requestId: request.id,
    approvalRequestId: id,
    expectedObservations: approval.expectedObservations,
    baselineObservations: approval.baselineObservations,
  });
});
```

(`applicationId` note: the prior implementation-plan draft required `applicationId` in `context`; since no real call site is being wired this pass, and every existing `dispatchAgentAction` caller acts on Atlas itself, defaulting to `ATLAS_SELF_APPLICATION_ID` — the same constant `packages/shared` already exports and `control-plane-bridge.ts` already hardcodes as `"def-000"` — is more accurate than requiring a field nothing yet supplies. This is a one-line simplification versus the earlier draft, not a new capability.)

### Call sequence — before and after

**Before:**
```
dispatchAgentAction() → needsApproval → createApprovalRequest()          [PENDING]
  → POST /approvals/:id/decide → decideApprovalRequest()                 [APPROVED or REJECTED]
      → [dead end — nothing consumes an APPROVED request]
```

**After:**
```
dispatchAgentAction() → needsApproval → createApprovalRequest()          [PENDING]
  → POST /approvals/:id/decide → decideApprovalRequest()                 [APPROVED or REJECTED]
      → (if APPROVED, a human/operator separately calls the new route — not automatic)
      → POST /approvals/:id/fulfill
          → requireOperator (guard)
          → getApprovalRequest (404 if missing)
          → status check (409 if not APPROVED)
          → context completeness check (422 if not fulfillable)
          → fulfillGatewayHandoff()
              → mapGatewayHandoff(operation, agentId)   [existing, unmodified]
              → executeGovernedAction()                 [existing, unmodified — 6 stages]
                  1. enforceAgentToolAuthorization
                  2/3. consumeApprovalRequest — APPROVED → CONSUMED, one-time;
                       also re-validates entityType/action/artifactHash match
                       (existing check in approvals.ts, not new)
                  4. dispatchAgentAction / authorizeEntityAction — policy/risk re-checked
                  5. executeTool
                  6. appendUnifiedAuditEntry — always
```

Everything from `fulfillGatewayHandoff` downward is existing, unmodified, already-tested code, exercised today by `geal-live-path.integration.test.ts` for the structurally identical `gateway/fulfill` route.

### Existing governance mechanisms that remain unchanged

`authorizeEntityAction`, `dispatchAgentAction`'s risk-scoring and `needsApproval` computation, `approvals.ts`'s existing three routes (`GET /approvals`, `GET /approvals/:id`, `POST /:id/decide`), `decideApprovalRequest`, `consumeApprovalRequest` (including its existing revocation/expiry/artifact-binding/entityType-action-match checks — none of which are modified; the new route is simply a caller of the existing function, like `executeGovernedAction` already is), `executeGovernedAction`'s six-stage pipeline, `fulfillGatewayHandoff`, `mapGatewayHandoff`. No new authorization mechanism is introduced anywhere in this item.

### Authorization and policy enforcement points

**A design decision this plan makes explicit rather than silently picking:** the file's three existing routes use `requireAdmin` (`role === "admin"` or Control-Plane-tier). This plan uses **`requireOperator`** (Control-Plane-tier only — `owner`/`operator`, excludes plain `admin`) for the new route instead, matching `gateway/fulfill`'s own guard rather than its siblings in the same file. Reasoning: `/decide` and the two `GET` routes only ever record or read a decision; the new route **causes real execution** through the exact same pipeline `gateway/fulfill` guards with `requireOperator` — using the file's weaker sibling guard for a stronger action than any of its siblings perform would be an inconsistency, not a convenience. Beyond the guard, the policy/risk re-check inside `executeGovernedAction` (stage 4) still runs unconditionally, so this route grants no bypass of the ordinary entity-authorization chain.

### Approval semantics

Unchanged. `/decide` remains the sole place a human approval/rejection decision is recorded. This item adds only what happens *after* `APPROVED` — a distinct, explicitly-triggered, separately-authorized action. An approval decided but never fulfilled remains exactly as inert and safe as it is today; the new route only opens a door that must be deliberately walked through.

### Audit/evidence requirements

Fully inherited from `executeGovernedAction` (audit, via `appendUnifiedAuditEntry`, unconditional on every branch) and `fulfillGatewayHandoff` (artifact-hash pinning, `expectedObservations`/`baselineObservations` comparison, `memoryEpistemicAfterAction`) — identical to what `geal-live-path.integration.test.ts` already verifies for `gateway/fulfill`. No new audit/evidence/memory code.

### Failure and rollback behavior

**Failure:** 404 (missing approval), 409 (wrong status — covers PENDING/REJECTED/CONSUMED/REVOKED uniformly, including the case where `consumeApprovalRequest` itself later refuses on revocation/expiry/artifact-mismatch — that refusal surfaces through `executeGovernedAction`'s existing `APPROVAL`/`DENIED` outcome, not a new error shape), 422 (context missing fulfillable data — fails closed rather than guessing defaults). No network-failure mode to design for — no cross-service call is made (Item 3, not this plan).

**Rollback:** Remove the route registration (or feature-flag it off) and, since no call site is wired, there is nothing else to revert — the three new optional fields on `DispatchAgentActionOptions` remain harmlessly unused if the route is rolled back. No data migration, no schema change to `approvalRequestSchema` itself.

### Idempotency requirements

**Primary protection (existing, not new):** `consumeApprovalRequest`'s one-way `APPROVED → CONSUMED` status transition already prevents double-execution — a second call to the new route for the same approval receives `409 CONFLICT` (`"is not APPROVED (status=CONSUMED)"`), not a silent re-execution. This is safety (never executes twice), not retry-transparency (a client that retries after a timeout sees a 409, not the original success payload).

**Optional enhancement, flagged but not included by default:** `executeGovernedAction` already has a separate, general-purpose idempotency primitive (`idempotencyKey?: string`, an in-memory `Map` keyed by that string plus the artifact hash — same key + same artifact replays the first outcome; same key + different artifact is refused). Neither `fulfillGatewayHandoff` nor `gateway/fulfill` currently uses it — confirmed by reading `gateway-fulfillment.ts`'s call into `executeGovernedAction`, which omits it. This plan **could** pass `idempotencyKey: id` (the approval id itself) through `fulfillGatewayHandoff` → `executeGovernedAction` so a network-retry of the exact same fulfill call returns the original success payload instead of a 409 — but this requires adding a field to `GatewayHandoff`'s interface in `gateway-fulfillment.ts`, which `gateway/fulfill` does not have either today. **This plan does not include that enhancement** — the primary (409-based) protection is sufficient for correctness and safety; the enhancement is a retry-ergonomics improvement the Owner can request separately if wanted, and adding it now would be scope creep on an interface shared with the already-`VERIFIED` `gateway/fulfill` path.

### Security implications

The new route only ever reaches `fulfillGatewayHandoff`/`executeGovernedAction`, which independently re-runs tool authorization and the policy/risk gate regardless of the approval, so no existing stage is skipped, reordered, or weakened. It is **strictly more constrained** than the existing raw `gateway/fulfill` route: that route accepts an *optional* `approvalRequestId` and will still execute a write with none attached, provided `dispatchAgentAction`'s risk gate independently allows it; the new route makes an existing, `APPROVED`, unconsumed `ApprovalRequest` a hard precondition. A mismatched `operation`/`agentId` pair (one that would map to an `entityType`/`action` different from what was actually approved) is caught by `consumeApprovalRequest`'s existing `presented` check — an existing protection, not new logic, but load-bearing and worth naming explicitly here since it is exactly what makes the additive `operation` field safe to add.

### Required unit/integration tests

New route tests (new `describe` block in a new or extended test file — `apps/api/src/routes/approvals.test.ts` already exists at 8 tests and is the natural home): 404 (missing approval), 409 ×4 (PENDING/REJECTED/CONSUMED/REVOKED), 422 (context missing `agentId`/`operation`/toolArgs-or-artifact), and one success case constructed with synthetic context data (an `ApprovalRequest` built directly via `createApprovalRequest`/`decideApprovalRequest` test helpers with `context.operation = "request_agent_run"`, `context.agentId = "RESEARCHER"` — the one pairing already proven consistent by `atlas-gateway.test.ts`'s own existing assertion, used here only as *test data*, not as a live call-site wire-up) — extending `geal-live-path.integration.test.ts`'s existing non-mocked pattern rather than a parallel mocked test. New tests for `agent-dispatch-guard.ts`: confirm the three new optional fields, when supplied, land correctly in the resulting `ApprovalRequest.context`; confirm omitting them changes nothing (regression guard for the 9 existing tests in `agent-dispatch-guard.test.ts`).

### Regression tests protecting existing VERIFIED paths

Must continue passing, unmodified: `apps/api/src/services/agent-dispatch-guard.test.ts` (9 tests — the additive fields must not change any existing risk/approval decision), `apps/api/src/services/approvals.test.ts` (34 tests — `createApprovalRequest`/`decideApprovalRequest`/`consumeApprovalRequest`/`revokeApprovalRequest` themselves are untouched), `apps/api/src/routes/approvals.test.ts` (8 tests — the three existing routes are untouched), `apps/api/src/services/gateway-fulfillment.test.ts` (8 tests) and `apps/api/src/routes/gateway-fulfill.test.ts` (7 tests — `fulfillGatewayHandoff` and its existing route are reused, not modified), `apps/api/src/services/governed-execution.test.ts` (13 tests — the six-stage pipeline is untouched), `apps/api/src/__tests__/geal-live-path.integration.test.ts` (3 tests, non-mocked — the strongest existing proof that this pipeline works end-to-end, must keep passing exactly as-is), `packages/shared/src/constants/atlas-gateway.test.ts` (the `mapGatewayHandoff` assertions this plan's test data relies on, particularly the `"request_agent_run"`/`"RESEARCHER"` case).

### Expected changes to architecture documentation

Once implemented: `atlas-implementation-plan-fulfillment-and-intelligence-gap.md` (Parts A/B) and `atlas-remaining-work-implementation-proposal.md` (Item 2's summary table row) should both be updated to record that Item 2's foundation is built and that "wire a real call site" (most plausibly RESEARCHER) remains a distinct, still-open follow-on decision — not implied as done by this item's completion. `atlas-live-enforcement-integration-review.md`'s §3B ("no live code path exists that executes an approved formal ApprovalRequest") should be updated to note the path now exists for synthetically-constructed context, while the "six call sites" figure it and other documents repeat should be corrected to three, per the Task 0 finding above — a factual correction to an already-accepted document, flagged here rather than made unilaterally.

---

# STOP

This is a plan, not implementation. No files have been changed. Item 1 and Item 2 are each independently ready for an implementation decision — the Owner may approve one, both, or neither. Item 2 is now explicitly scoped to the route and additive fields only, with call-site wiring deliberately excluded and named as a separate future decision. Waiting for explicit Owner approval before any code is written.
