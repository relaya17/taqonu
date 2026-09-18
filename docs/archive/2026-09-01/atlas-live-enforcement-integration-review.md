# Atlas — Live Enforcement Integration Review

**Status: ARCHITECTURE REVIEW / PRE-IMPLEMENTATION. No production code modified, refactored, moved, or deleted. No routes changed. No registries merged. No agents created. No Control Plane wiring performed.** Original pass: 2026-09-01. **Validation pass: 2026-09-01 (same day, deeper trace)** — resolves the four items the Owner required before implementation approval. Validated findings are marked **[VALIDATED]**; everything else is carried over unchanged from the accepted baseline.

This document builds on `atlas-product-boundary-architecture-review.md` and `atlas-architecture-decision-lock.md`. The validation pass below corrects two specific claims from the original pass of this document: the shape of `agent-dispatch-guard.ts` (§3), and the correctness of the `remediation.ts → approvals.ts` pilot mapping onto `gateway/ops`/`gateway/fulfill` (§3B, §11, §15–16). Everything else from the original pass stands.

---

## 1. Current live execution architecture

Unchanged from the original pass: three distinct, real mechanisms currently govern actions in production —

| Mechanism | Defined in | Governs | Confirmed live callers |
|---|---|---|---|
| **Tool-call authorization** | `packages/agent-core/src/policies/authorization.ts` — `authorizeToolCall` | What a running agent is technically permitted to do (read/write/execute a tool) during a live session | `apps/api/src/routes/agent.ts`, `apps/api/src/routes/conversation.ts` |
| **Entity-action authorization** | `packages/agent-core/src/policies/entity-policies.ts` — `authorizeEntityAction` | Whether a specific business action against a typed business entity is permitted | 23 route files (§2) |
| **Entity-write enforcement** | `apps/api/src/services/risk-audit.ts` — `enforceEntityWrite` | The write-side enforcement wrapper around entity-action authorization (risk scoring + audit), for signed-in humans calling a write endpoint directly (a "self-approved write") | 10 route files (§2) |

The `geal-live-path.integration.test.ts` finding also stands unchanged: the receiving end of the Control Plane gateway (`gateway/fulfill` → `executeGovernedAction`) is proven correct under a real, non-mocked integration test. **The validation pass below adds important precision to what that pipeline actually composes — see §3B.**

---

## 2. Complete enforcement-path inventory — every previously "not verified" route, individually classified [VALIDATED]

The original pass flagged ~21 routes as not individually verified. Each is now classified into exactly one of the four categories the Owner specified, verified from the actual code (not inferred). The single most important new fact underlying this table: **`apps/api/src/create-app.ts` registers a global `onRequest` hook — `if (isPublicAtlasRoute(request.method, request.url)) return; await requireUser(app, request);` — applied to every route in the application.** This is documented in the code itself as **ADR-021: "explicit PUBLIC allow-list. Everything else requires a session."** (`apps/api/src/middleware/public-routes.ts`). The public allow-list (`PUBLIC_EXACT`/`PUBLIC_PREFIXES`) contains exactly: `GET /`, `GET /health`, `GET /favicon.ico`, `GET /api/v1/health`, the unauthenticated auth endpoints (`/api/v1/auth/providers|session|me|register|login|mfa/verify|logout|oauth/sync|password/forgot|password/reset`), `POST /api/v1/github/webhooks`, `POST /api/v1/billing/stripe/webhook`, `POST /api/v1/contact`, `GET /api/v1/legal-media/sources`, `GET /api/v1/knowledge`, `GET /api/v1/knowledge/verified-sources`, `GET /api/v1/billing/credit-packs`, `GET /api/v1/onboarding/storage-policy`, `GET`+`POST /api/v1/knowledge/refresh` (cron, authenticates via `CRON_SECRET` inside the handler instead), `GET /api/v1/github/install*`, `GET /api/v1/knowledge/verified-sources/download*`. Every route not on this list — including every route in the table below — requires at least an authenticated session by default, before its own handler runs.

| Route | HTTP methods | Classification | Verified basis |
|---|---|---|---|
| `artifacts.ts` | GET, POST | Protected by another mechanism | `requireUser` called explicitly inside the route (in addition to the global hook); mutations gated by user identity, not entity-policy — no evidence found that artifact writes are business-entity-typed in the `entity-policies.ts` taxonomy |
| `eval.ts` | GET, POST | Protected by another mechanism | POST `/api/v1/eval/runs` is not in the public allow-list (global `requireUser` applies); handler additionally calls `assertEvalQuota`, persists via `osStore.addEvalRun`, emits `appendDomainEvent({type:"evaluation.completed"})` — which **is** one of the five event types `control-plane-bridge.ts` forwards to Control Plane — and writes `osStore.appendAudit`. Fully audited and telemetry-visible; not entity-policy-gated because it does not mutate a typed business entity, it runs a self-contained eval suite |
| `eval-ci-gate.ts` | GET, POST | Expected read-only / no mutation | Both verbs call the same handler, which runs `runCiGate()` and returns a computed result; no persisted business-entity write found |
| `exemplars.ts` | GET, POST | Protected by another mechanism | `requireUser` called explicitly inside the route (same pattern as `artifacts.ts`) |
| `qa.ts` | GET, POST, DELETE | Protected by another mechanism | `requireSignedInForWrite` imported and used for the mutating verbs |
| `research.ts` | POST | Expected read-only / no mutation | Handler takes a question, searches `VERIFIED_LEGAL_MEDIA_SOURCES`, returns matches — a query shaped as POST (has a body), not a persisted mutation |
| `portfolio-governance.ts` | GET, POST | Protected by another mechanism | `requireOwner` called explicitly (verified in the original pass, restated here) |
| `systems.ts` | GET, PUT | Protected by another mechanism | `requireUser` called explicitly at multiple points |
| `ai-providers.ts` | GET only | Expected read-only / no mutation | No mutating verb exists |
| `audit.ts` | GET, POST | Protected by another mechanism | `requireAdmin` called explicitly — code comment confirms this is deliberate: cross-tenant audit data needs `requireAdmin`, not just `requireUser` |
| `auth.ts` | GET, POST, PATCH, DELETE | Identity route (mixed) | Login/register/session endpoints are the explicit public allow-list exceptions by design (identity must be establishable before a session exists); admin-scoped auth operations (user management) call `requireAdmin`/`requireUser` explicitly |
| `contact.ts` | GET, POST | Identity/public + protected (mixed) | `POST /api/v1/contact` is the public allow-list exception (a contact form must be reachable unauthenticated); the GET (presumably listing submissions) calls `requireAdmin` explicitly |
| `cost-intelligence.ts` | GET only | Expected read-only / no mutation | No mutating verb exists |
| `decisions.ts` | GET, POST | Protected by another mechanism | `requireUser` called explicitly at multiple points |
| `events.ts` | GET only | Protected by another mechanism | `requireAdmin` called explicitly — comment confirms deliberate: "cross-tenant surface behind `requireAdmin`" |
| `health.ts` | GET only | Identity/health/non-action route | Public by design (`GET /`, `GET /health`, `GET /api/v1/health` are all on the explicit allow-list) — liveness/readiness probes must be reachable without a session |
| `integrations.ts` | GET only | Expected read-only / no mutation | No mutating verb exists |
| `intelligence.ts` | GET, POST, PATCH | **Genuine gap** | POST `/api/v1/intelligence/hypotheses` and PATCH `/…/status` create and mutate a persisted `Hypothesis` record (`apps/api/src/services/hypothesis-engine.ts`, explicitly self-documented as "Stage 19 — a scaffold... without yet implementing the full automated verification pipeline"). The route only checks `request.user?.id` inline (a hand-rolled, redundant re-check of what the global hook already guarantees) and calls neither `authorizeEntityAction`/`enforceEntityWrite` nor any audit-log function — confirmed by grep: zero matches for `audit`, `authorizeEntity`, or `enforceEntityWrite` anywhere in `hypothesis-engine.ts`. This is a real, specific, currently-unaudited business-record mutation, not merely an unverified one |
| `metrics.ts` | GET, POST | Protected by another mechanism (with a caveat) | `POST /api/v1/metrics/record` writes a named telemetry metric, not a business entity — global `requireUser` applies, no explicit additional gate found; low-risk by nature (a metric name/value/tags, not a business record), but any authenticated user can currently record metrics under any tag — not flagged as a genuine gap given what's actually being written, but worth noting as looser than `intelligence.ts`'s case |
| `performance.ts` | GET, POST | Protected by another mechanism (with a caveat) | `POST /api/v1/performance/cache/clear` clears an in-memory cache — operational/maintenance, global `requireUser` applies, no `requireAdmin`. Arguably any authenticated user (not just an operator) can currently clear the shared read cache — a minor hardening observation, not classified as a genuine authorization/enforcement gap in the entity-policy sense, since no business data is read, written, or exposed by this action |
| `knowledge.ts` | GET only | Expected read-only / no mutation (partially public) | `GET /api/v1/knowledge` and `GET /api/v1/knowledge/verified-sources` are explicit public allow-list entries; no mutating verb exists in this route file |

**Net result of this classification pass**: of the ~21 originally unverified routes, **1 is a genuine gap** (`intelligence.ts`'s hypothesis create/update — real business-record mutations with no audit trail and no entity-policy check), **2 are worth a minor hardening note but are not classified as gaps** (`metrics.ts`, `performance.ts` — real mutations but of low-risk, non-business-entity state), and the remaining 18 are confirmed either read-only, identity/health/public-by-design, or protected by an explicit mechanism (mostly the global `requireUser`/`requireAdmin`/`requireOwner` hooks, layered on top of the universal `onRequest` session check). No route was found to be silently open with no gate at all.

---

## 3. `agent-dispatch-guard.ts` / `dispatchAgentAction` — fully traced [VALIDATED]

**Answer to the Owner's question: it is a wrapper around existing authorization — specifically, a documented sibling to `enforceEntityWrite`, not an independent fourth choke point.**

The file's own header comment states this precisely: *"Missing sibling to `enforceEntityWrite` (`risk-audit.ts`), for the actor shape that helper was never built for: an AGENT or AUTOMATION initiating an entity action, rather than a signed-in human directly calling a write endpoint."* Both wrap the same underlying `authorizeEntityAction` (`packages/agent-core/src/policies/entity-policies.ts`) — `enforceEntityWrite` calls it with `approved: true` (a human calling the endpoint directly IS the approval — "self-approved write"), `dispatchAgentAction` calls it with `approved: false` (an agent is never its own approval, so `APPROVAL_REQUIRED` is an ordinary, expected outcome it must handle rather than throw on).

**Downstream calls inside `dispatchAgentAction` (confirmed by direct inspection):**
1. `agentMayExecute()` (`@atlas/shared`) — checks the agent's runtime control status (ACTIVE/PAUSED/DISABLED/etc.) before anything else
2. `authorizeEntityAction()` (`packages/agent-core`) — the same entity-policy function every human-write route uses
3. `computeActionRiskScore()`/`bucketForRiskScore()`/`explainRiskScore()` (`packages/agent-core`) — risk scoring, plus two risk *floors* specific to agent/automation actors (untrusted source content, and automation-tier with no live human) that push the minimum achievable bucket to at least APPROVAL regardless of the raw score
4. `createApprovalRequest()` (`apps/api/services/approvals.ts`) — when the decision requires approval, a formal `ApprovalRequest` record is created
5. `appendUnifiedAuditEntry()` (`apps/api/services/audit-log.ts`) — called at multiple points (deny, approval-required, and terminal outcomes), so every dispatch attempt is audited regardless of outcome

**Confirmed callers of `dispatchAgentAction`** (production files, excluding tests): `apps/api/src/routes/agent-fabric.ts`, `apps/api/src/services/agent-proposal.ts`, `apps/api/src/services/automation-rules.ts`, `apps/api/src/services/code-engineer-dispatch.ts`, `apps/api/src/services/llm-specialist-proposal.ts`, `apps/api/src/services/llm-specialist-run.ts`, `apps/api/src/services/research-analyst-dispatch.ts`, and — critically, tracked down in this validation pass — **`apps/api/src/services/governed-execution.ts`**. This last one is the connection that resolves item 3 below.

**Corrected understanding**: `dispatchAgentAction` is real, live, load-bearing infrastructure — it is the actual, already-used policy/risk/audit gate for every Fabric agent's write-shaped action across the routes listed above. It is not a duplicate governance engine; it is `authorizeEntityAction` plus the additional risk floors and audit calls that an agent/automation actor specifically needs, exactly as its own comment describes. The prior document's characterization of it as one of "four potential choke points" undersold that it's already wired into real, active agent-dispatch call sites — it is not merely potential.

---

## 3B. `gateway/ops` / `gateway/fulfill` / `executeGovernedAction` / `remediation.ts` / `approvals.ts` — semantics validated [VALIDATED]

**This section corrects a specific error in the original pass's minimal-pilot proposal (old §15–16). The corrected proposal is in §11 and §15–16 below.**

### What `executeGovernedAction` actually composes

`apps/api/src/services/governed-execution.ts` documents itself explicitly: *"P0.7 — the single transactional execution gate... Everything built before this is an ENGINE... individually correct and individually tested — and none of them called each other... A security module nothing routes through is theatre. This is the one path that composes them, in a fixed order, with no way around it."* The composed, fail-closed order is:

```
1. Tool authorization       (enforceAgentToolAuthorization — may this agent use this tool at all?)
2. Artifact hashing         (computeArtifactHash — pin exactly what is about to run)
3. Approval CONSUMPTION     (consumeApprovalRequest — is there a live, matching, unexpired approval for THIS artifact?)
4. Policy / Risk gate       (dispatchAgentAction, i.e. authorizeEntityAction — does the entity-action itself pass?)
5. Execution                (executeTool — only now does anything actually happen)
6. Audit                    (appendUnifiedAuditEntry — always, including on every refusal above)
```

`apps/api/src/services/gateway-fulfillment.ts` — the module `apps/api/src/routes/gateway-fulfill.ts` calls — documents itself as *"the only Control Plane → execution hop... calls `executeGovernedAction`, which already composes catalog authz → approval → dispatchAgentAction → executeTool → audit."*

### What `remediation.ts` and `approvals.ts` actually do today — traced in full

- **`apps/api/src/routes/remediation.ts`**'s `/drafts/:id/apply` endpoint calls `authorizeEntityAction("DOCUMENT", "EXECUTE", { mode: "WRITE", writeGateOpen: true, **approved: true** })` — `approved: true` is a **hardcoded literal at the call site**, not derived from any `ApprovalRequest` record. If the decision is `ALLOWED`, the route calls `applyApprovedPatch(...)` **directly, inline, in the same request** — it does not create an `ApprovalRequest`, does not call `gateway/ops`, and does not call `gateway/fulfill`. This is architecturally the same "self-approved write" pattern `enforceEntityWrite` uses for humans — the endpoint's own access control (`requireSignedInForWrite`) is treated as the approval, not a separate async decision.
- **`apps/api/src/routes/approvals.ts`**'s `/api/v1/approvals/:id/decide` endpoint calls `decideApprovalRequest(id, {...})` — confirmed by direct read of `apps/api/src/services/approvals.ts`: this **only marks a formal `ApprovalRequest` record as approved or rejected**. It does not call `consumeApprovalRequest`, does not call `executeGovernedAction`, does not call `gateway/fulfill`, and does not execute anything. `enforceEntityWrite` at this call site gates *the act of deciding an approval* (a `CONFIGURATION.EXECUTE` action — is this admin allowed to decide approvals at all), not the underlying action the approval was for.
- **`consumeApprovalRequest`** (`apps/api/src/services/approvals.ts`) — the function that marks a formal `ApprovalRequest` as used at execution time — has exactly one caller in the entire repository: `governed-execution.ts`. Which is reached only via `gateway-fulfillment.ts`. Which is reached only via the `gateway/fulfill` HTTP route. Which, per §3 of the original pass (re-confirmed, unchanged), has zero live callers.

### The specific finding this resolves

**There is currently no live code path anywhere in the repository that takes a human-APPROVED formal `ApprovalRequest` and goes on to execute the action it was approved for.** `remediation.ts`'s `/apply` endpoint bypasses the formal `ApprovalRequest` lifecycle entirely (self-approved, inline execution, for the one specific case it handles). The formal `createApprovalRequest` → `decideApprovalRequest` → `consumeApprovalRequest` lifecycle that `dispatchAgentAction` and `governed-execution.ts` are built around has a complete first half (create, decide) and a complete, tested, but totally unreached second half (consume, execute).

**Consequently, the original pass's pilot proposal — map `remediation.ts` to `gateway/ops` and `approvals.ts` to `gateway/fulfill` — is corrected here, not confirmed:** `approvals.ts` must **not** become `gateway/fulfill`, because doing so would collapse the APPROVAL stage and the EXECUTE stage into one HTTP call (deciding an approval would immediately and synchronously execute the approved action in the same request), which is a different design than what `executeGovernedAction`'s own comment describes (approval consumption and execution as their own explicit, separately-timed stage — relevant for async/queued execution, retries, or re-verifying current state at execution time rather than decide time). The three Operating Cycle stages the Owner asked about map onto existing code as follows, correctly separated:

| Operating Cycle stage | Correct existing code | Notes |
|---|---|---|
| Governance / Decision | `authorizeEntityAction` / `dispatchAgentAction` | Already reused across ~32 routes and 8 agent-dispatch call sites (§2–3) |
| Human Approval | `apps/api/routes/approvals.ts` (`decideApprovalRequest`) | Already correctly scoped — records a decision only, does not execute. **No change needed here.** |
| Fulfillment / Execution | `gateway/fulfill` → `gateway-fulfillment.ts` → `executeGovernedAction` (`consumeApprovalRequest` + `dispatchAgentAction` + `executeTool` + audit) | Fully built, fully tested (`geal-live-path.integration.test.ts`), **currently reachable from nothing** |

The actual gap `gateway/fulfill` needs a live caller for is not "the human-decide step" — it is **"whatever should happen right after an `ApprovalRequest` is decided APPROVED."** Today, nothing happens after that point for the formal-approval lifecycle. `remediation.ts`'s `/apply` endpoint is a separate, already-self-contained flow that does not use the formal lifecycle at all and does not obviously need to be touched by this specific integration.

---

## 4. Every current bypass, restated with the above corrections

Unchanged in substance from the original pass (every route using choke points 1–4 in §3 of the original document bypasses Control Plane's Operating Cycle, total not partial), with one addition from this validation pass: **the formal `ApprovalRequest` → execution handoff bypasses `gateway/fulfill` too, but not because some other mechanism replaces it — because nothing currently replaces it.** This is a stronger statement than "Control Plane is bypassed": for the formal-approval lifecycle specifically, there is no execution step at all today, Control-Plane-routed or otherwise.

## 5. All fail-open paths

Unchanged from the original pass: exactly one, `control-plane-bridge.ts`'s telemetry forwarding.

---

## 6. Atlas Engineering supervision path (corrected)

```
apps/web (workbench/studio/chat/agent) request
   → apps/api/routes/agent.ts or conversation.ts
        → authorizeToolCall()  [tool-level gate]
   → apps/api/routes/{code,engineering-loop,engineering-audit,agent-fabric,agent-lifecycle,experts,kernel}.ts
        → authorizeEntityAction() / enforceEntityWrite()  [human-direct entity-level gate]
   → OR, for agent/automation-initiated actions:
        agent-proposal.ts / automation-rules.ts / code-engineer-dispatch.ts /
        llm-specialist-proposal.ts / llm-specialist-run.ts / research-analyst-dispatch.ts
        → dispatchAgentAction()  [agent-level entity gate + risk floors + audit — §3]
             → if APPROVAL_REQUIRED: createApprovalRequest()
                  → apps/api/routes/approvals.ts: a human decides (decideApprovalRequest)
                       → [GAP, §3B: nothing currently consumes this decision to execute]
   → packages/agent-core Fabric dispatch → runSpecialistStub (14/16 agents) or real model (SECURITY, LEGAL_MEDIA_COMMS)
   → apps/api/audit-log.ts (hash-chained record)
        ⋮ fire-and-forget
   → control-plane-bridge.ts → gateway/events (applicationId="def-000" only) → Control Plane dashboard display
```

## 7. Atlas Protection supervision path (corrected)

```
apps/worker (state.reconcile) → packages/state reconcileProjectState()
   → apps/api observe-cycle.ts / observe-system-facets.ts → packages/observer
   → apps/api routes {systems,portfolio,sentinel,graph,observer}.ts → apps/web {systems,truth,health,sentinel,observer}
   → apps/api routes/remediation.ts
        /apply endpoint: authorizeEntityAction(approved:true, hardcoded) → applyApprovedPatch() executes INLINE, same request
        [does not use the formal ApprovalRequest lifecycle, does not touch gateway/ops or gateway/fulfill — §3B]
   → apps/api audit-log.ts (hash-chained record)
        ⋮ fire-and-forget, same one hardcoded "def-000" bridge as Engineering
```
Corrected from the original pass's diagram, which showed `remediation.ts → authorizeEntityAction → approvals.ts → enforceEntityWrite` as one sequential pipeline. On full trace, `remediation.ts`'s apply path is self-contained and does not call into `approvals.ts` at all for this endpoint. Separately, zero live connection to any of the six Managed Systems' own running agents remains confirmed, unchanged from the original pass.

---

## 8. Internal second-opinion gap

Unchanged from the original pass.

## 9. External-agent supervision gap

Unchanged from the original pass.

## 10. Admin boundary inventory

Unchanged from the original pass (not in scope for this validation pass, which was limited to the four items above).

---

## 11. Minimal integration options — corrected

**Option 1 — Gateway-in-front.** Unchanged in shape from the original pass: insert a `gateway/ops` call ahead of existing choke points, existing choke points remain underneath. Same latency/dependency trade-off as before.

**Option 2 — Gateway-replaces-call-site, corrected scope.** The original pass proposed migrating both `remediation.ts` and `approvals.ts` to Control Plane. **This validation pass narrows that**: `approvals.ts` should not be touched — it is already correctly scoped as the Human Approval stage and re-pointing it at `gateway/fulfill` would conflate Approval and Execute (§3B). The real, precise minimal target for Option 2 is: **give the formal `ApprovalRequest` lifecycle the execution step it is currently missing**, by adding a call to `gateway/fulfill` at the point an `ApprovalRequest` becomes `APPROVED` — either as an explicit new "fulfill" action a human/operator triggers after deciding, or as an automatic follow-on inside `decideApprovalRequest`'s `APPROVED` branch. Which of those two shapes is correct is itself a design question (explicit trigger preserves a human "yes, execute now" moment separate from "yes, approved in principle"; automatic follow-on is simpler but collapses two moments into one) — **not decided here, flagged for Owner input, §20-style, in the sequencing below.**

`remediation.ts`'s `/apply` endpoint is a separate question: it already works, self-contained, for the one case it handles. Migrating it to route through Control Plane is a larger, separate decision (it would mean giving up the "self-approved write, same request" pattern for something async) and is not part of this corrected minimal proposal.

**The third, smaller option from the original pass** (fixing `control-plane-bridge.ts`'s `def-000`-only hardcoding to improve dashboard accuracy, independent of enforcement) still stands, unchanged, and is now more clearly independent of Options 1/2 given §12 below.

## 12. Security implications

Unchanged from the original pass, plus: the newly identified genuine gap (`intelligence.ts`'s hypothesis mutations, §2) is a live, real, unaudited business-record write today, independent of any Control Plane question — worth flagging to the Owner as something that could be fixed on its own schedule, not contingent on the Gap 1 decision.

## 13. Failure-mode analysis

Unchanged in substance. Refined by §3B: since `remediation.ts`'s apply path doesn't touch the formal lifecycle at all, a Control Plane outage would not affect it either way under the corrected minimal proposal — the failure-mode question in §12–13 of the original pass now applies specifically and only to wherever the new "fulfill an approved request" call site ends up living.

## 14. Backward-compatibility risks

Unchanged in substance, narrower in scope: since the corrected proposal touches a currently-dead code path (nothing calls `consumeApprovalRequest`/`gateway/fulfill` today) rather than an already-live one (`approvals.ts`'s existing `/decide` behavior is now confirmed untouched), the backward-compatibility risk of the corrected minimal proposal is lower than the original pass's proposal — there is no existing behavior to regress at the exact new call site, because none exists yet.

## 15. Recommended minimal architecture — corrected

Not a decision — updated description, given §3B: the smallest change that makes Control Plane load-bearing for something real is to add the missing execution step to the formal `ApprovalRequest` lifecycle, calling `gateway/fulfill` when an approval is decided `APPROVED`, fail-closed, for the specific agent/automation-initiated flows that already create formal `ApprovalRequest`s via `dispatchAgentAction` (§3's caller list: `agent-proposal.ts`, `automation-rules.ts`, `code-engineer-dispatch.ts`, `llm-specialist-proposal.ts`, `llm-specialist-run.ts`, `research-analyst-dispatch.ts`). This proves the integration on a code path that is currently provably dead (so there is no regression risk to an existing behavior), on the exact mechanism (`dispatchAgentAction` → formal approval → execution) the codebase already built Control Plane's gateway to serve.

`remediation.ts` is no longer part of the recommended minimal first step — it was based on a mapping this validation pass found to be incorrect.

## 16. Explicit list of files that would need modification (corrected, per §15)

- **One new call site** at the point `decideApprovalRequest` returns an `APPROVED` outcome — exact location (inside `apps/api/src/services/approvals.ts` itself, or a new explicit endpoint in `apps/api/src/routes/approvals.ts`) depends on the explicit-trigger-vs-automatic-follow-on decision flagged in §11, not yet made
- That new call site needs a way to reach `gateway/fulfill` **synchronously, fail-closed** — see §17 below for why this must not be `control-plane-bridge.ts`
- Corresponding `*.test.ts` coverage for the new call site
- **`apps/api/src/services/control-plane-bridge.ts` is explicitly removed from this list** — see §17

## 17. A new, separate governed-call client — not a modification to `control-plane-bridge.ts` [VALIDATED, item 4]

**Answer to the Owner's question: yes, a separate client/path should be used. Confirmed by inspecting `control-plane-bridge.ts` directly, not just by general principle.**

`apps/api/src/services/control-plane-bridge.ts` is a 65-line, single-purpose module built around `domainEventBus.subscribe("*", (event) => {...})` — an event-bus subscriber, not a request/response client. Its call to Control Plane is `void fetch(...)` — the `void` keyword and the absence of any `await` or `.catch()` confirms the failure-handling is not incidental, it is structural: the function that receives a domain event has no return channel back to whatever raised that event, so there is nothing for it to report failure *to*, even if it wanted to. Separately, it wraps its own `assertEgressAllowed` check in a bare `try { } catch { return; }`, silently discarding both policy-denial and any other exception the same way.

This is a different **shape** of call than what `gateway/ops`/`gateway/fulfill` need for real enforcement: a route handler (e.g., wherever the new §16 call site lives) needs to `await` Control Plane's response and *act on it* — proceed on ALLOW, stop and report on DENY, wait on REQUIRE_APPROVAL — within the same request that's asking. That is a fundamentally different control-flow shape from "fire an event, don't wait, don't care." Retrofitting `control-plane-bridge.ts` to also do this would mean either (a) breaking its existing fire-and-forget contract for its existing five telemetry event types, or (b) adding a second, differently-behaved function to a module whose only current job, name, and doc comment describe one job. Recommendation for the implementation phase (not authorized here): a new, small module — e.g. `governed-call-client.ts` — with its own explicit timeout, its own explicit fail-closed error path (an unreachable Control Plane must produce a DENY-shaped result, not a silent pass-through), and no relationship to `domainEventBus`. `control-plane-bridge.ts` itself needs no code change at all under this plan — only, eventually, the earlier-flagged, independent fix to stop hardcoding `applicationId: "def-000"` (§11's "third, smaller option"), which is a one-line data fix, not a reliability-semantics change.

## 18. Implementation sequencing (updated)

1. Item 1 from this validation pass already resolved the "confirm the ~18 unverified routes" step from the original sequencing — done, above. One real follow-up remains: decide whether to fix `intelligence.ts`'s hypothesis-mutation gap (§2) independently, since it has no dependency on the Control Plane decision.
2. Item 2 resolved: `dispatchAgentAction` confirmed as a wrapper, not an independent surface — no further tracing needed there.
3. **New, Owner-input-needed**: explicit-trigger vs. automatic-follow-on for the fulfillment call (§11, §15).
4. Build the new `governed-call-client.ts` (§17) with an explicit fail-closed contract — this is new code, not a modification of existing telemetry code, and should be reviewed as such.
5. If approved: wire the one new call site (§16) using that client, fail-closed, for the `dispatchAgentAction`-originated formal-approval lifecycle only.
6. Observe in production (this exercises a currently-dead path, so "observe" here really means "confirm it starts getting used at all" before deciding whether to extend further, e.g., to `remediation.ts`'s separate self-approved pattern).

## 19. Verification/test strategy (updated)

- `geal-live-path.integration.test.ts` remains the correct baseline and now, per §3B, is understood to test exactly the path this validation pass recommends wiring a real caller to — no other test needs to be built from scratch to prove the receiving end.
- A new test is needed for whichever call site is chosen in §16, asserting: an `APPROVED` `ApprovalRequest` from one of the `dispatchAgentAction` call sites (§3) results in a `gateway/fulfill` call, which results in `consumeApprovalRequest` + `executeTool` + audit — end to end, extending the `geal-live-path` pattern rather than replacing it.
- A fail-closed test for the new client (§17): Control Plane unreachable → the flow denies/holds, does not silently proceed — this recommendation from the original pass stands, and is now sharper: assert specifically that this new client's failure mode is structurally different from, and does not accidentally inherit, `control-plane-bridge.ts`'s fire-and-forget behavior.

---

# STOP

This validation pass is analysis only. No production code has been modified. §2's genuine gap (`intelligence.ts`) has been identified and flagged, not fixed. §17's recommended new client does not exist yet. §16's new call site does not exist yet. Waiting for explicit Owner approval before any of §15–19 begins.
