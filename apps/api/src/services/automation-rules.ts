import { domainEventBus } from "@atlas/agent-core";
import type { DomainEvent } from "@atlas/shared";
import {
  registerAutomationRule,
  resetAutomationEngineForTests,
  type AutomationRule,
} from "./automation-engine.js";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { dispatchAgentAction } from "./agent-dispatch-guard.js";

/**
 * Built-in Automation Engine rules (roadmap: "invoice.overdue -> notify ->
 * escalate -> audit"). These are rules registered as *declarative data*
 * through `registerAutomationRule()` rather than hand-written subscribers —
 * the pattern apps/api/src/services/event-rules.ts already proved out for
 * `patch.applied`. All three target events that are ACTUALLY published today
 * (verified by grepping real `appendDomainEvent({ type: "...", ... })` call
 * sites) and all three react only when the payload signals a genuinely bad
 * (or genuinely notable) outcome, not on every occurrence of the event type.
 *
 * Rule 1 and Rule 2's actions are intentionally limited to
 * `appendUnifiedAuditEntry` — the only safe, already-built AUDIT-ONLY action
 * primitive in this codebase. No notifications, emails, or external calls
 * are invented for those two. Rule 3 (below, after Rule 2) is the first
 * built-in rule to go further: it dispatches a genuine state-mutating
 * CREATE action through `dispatchAgentAction` (agent-dispatch-guard.ts) with
 * an `AUTOMATION` actor, exercising — for the first time via a real,
 * live automation rule rather than only a synthetic unit test — the
 * automation-actor CREATE/UPDATE/DELETE risk floor that function enforces.
 */

/**
 * Rule 1: gate.evaluated -> HIGH-risk audit entry when the release-gate
 * graph contains a blocked or failed node.
 *
 * Trigger: `gate.evaluated`, published from
 * apps/api/src/routes/gates.ts's POST /api/v1/gates/evaluate, with
 * `payload.statuses` a map of gate-node-id -> GateStatus
 * ("PASS" | "FAIL" | "BLOCKED" | "WAIVED", see
 * apps/api/src/services/gate-engine.ts).
 *
 * Condition: at least one node's status is "FAIL" or "BLOCKED" — i.e. the
 * release is genuinely gated, not a clean evaluation.
 *
 * Action: a HIGH-risk, PENDING-approval, FAILURE-result audit entry naming
 * the blocked/failed node ids, so a blocked release always leaves a durable,
 * queryable trail even though nothing in gates.ts itself knows about the
 * audit schema.
 */
function blockedGateNodeIds(statuses: Record<string, unknown>): string[] {
  return Object.entries(statuses)
    .filter(([, status]) => status === "FAIL" || status === "BLOCKED")
    .map(([nodeId]) => nodeId);
}

function gateHasBlockedNode(event: DomainEvent): boolean {
  const payload = event.payload as { statuses?: unknown };
  if (!payload.statuses || typeof payload.statuses !== "object") return false;
  return blockedGateNodeIds(payload.statuses as Record<string, unknown>).length > 0;
}

/**
 * `payload.actorId` is threaded through by the publisher
 * (apps/api/src/routes/gates.ts's POST /api/v1/gates/evaluate) when an
 * authenticated caller is available. As of this fix, that route has no auth
 * guard at all, so `actorId` is genuinely null here today — a separate,
 * distinct gap from the one this function used to hardcode (see
 * event-rules.ts's onPatchApplied for the threaded case). Falls back to null
 * defensively rather than assuming the key is always present.
 *
 * Per-owner tagging (P1 fix): no `ownerId` is threaded through either, for
 * the same reason — there is no authenticated caller on this route today to
 * resolve a tenant from. Left explicitly null rather than fabricated (e.g.
 * from `event.projectId`, which has no owner field on `Project` today — see
 * packages/shared/src/schemas/project.schema.ts).
 */
function onGateBlocked(event: DomainEvent): void {
  const payload = event.payload as {
    graphId?: unknown;
    summary?: unknown;
    statuses?: unknown;
    actorId?: unknown;
  };
  const statuses = (payload.statuses ?? {}) as Record<string, unknown>;
  const blocked = blockedGateNodeIds(statuses);
  const actorId = typeof payload.actorId === "string" ? payload.actorId : null;

  appendUnifiedAuditEntry({
    type: "gate.evaluated",
    actorId,
    ownerId: null,
    actorKind: "AGENT",
    reason: `release gate graph ${String(payload.graphId ?? "unknown")} has ${blocked.length} blocked/failed node(s): ${blocked.join(", ")}`,
    input: { graphId: payload.graphId ?? null, summary: payload.summary ?? null },
    output: { statuses, blockedNodeIds: blocked },
    policy: "gate.release-block",
    risk: "HIGH",
    approval: "PENDING",
    result: "FAILURE",
    projectId: event.projectId ?? undefined,
    correlationId: event.correlationId,  });
}

export const gateBlockedAutomationRule: AutomationRule = {
  id: "gate-blocked-audit",
  description:
    "gate.evaluated -> HIGH-risk audit entry when the gate graph has a FAIL or BLOCKED node.",
  on: "gate.evaluated",
  condition: gateHasBlockedNode,
  action: onGateBlocked,
};

/**
 * Rule 2: evaluation.completed -> CRITICAL-risk audit entry when a
 * production-readiness certificate is issued with outstanding blockers.
 *
 * Trigger: `evaluation.completed`, published from
 * apps/api/src/routes/readiness.ts's POST /api/v1/readiness/certificate,
 * with `payload.kind === "production-readiness-certificate"` and
 * `payload.blockers` a numeric count of gate-fail nodes (see
 * apps/api/src/services/readiness-certificate.ts's
 * `issueProductionReadinessCertificate`, where `blockers = gateFail.length`).
 * `evaluation.completed` is also published for several unrelated report
 * kinds (kernel runs, engineering audits, agent dispatch, executive/evidence
 * reports) — the condition below filters to the readiness-certificate kind
 * specifically so this rule never misfires on those.
 *
 * Condition: `kind === "production-readiness-certificate"` and `blockers`
 * is a positive number — i.e. the project is certified NOT production-ready.
 *
 * Action: a CRITICAL-risk, PENDING-approval, FAILURE-result audit entry
 * naming the blocker count, so an unready certificate is never silently
 * issued without a durable trail.
 */
function readinessCertificateHasBlockers(event: DomainEvent): boolean {
  const payload = event.payload as { kind?: unknown; blockers?: unknown };
  return (
    payload.kind === "production-readiness-certificate" &&
    typeof payload.blockers === "number" &&
    payload.blockers > 0
  );
}

/**
 * `payload.actorId` is threaded through by the publisher
 * (apps/api/src/routes/readiness.ts's POST /api/v1/readiness/certificate)
 * when an authenticated caller is available. As of this fix, that route has
 * no auth guard at all, so `actorId` is genuinely null here today — a
 * separate, distinct gap from the one this function used to hardcode (see
 * event-rules.ts's onPatchApplied for the threaded case). Falls back to null
 * defensively rather than assuming the key is always present.
 *
 * Per-owner tagging (P1 fix): no `ownerId` is threaded through either, for
 * the same reason — no authenticated caller on this route today to resolve
 * a tenant from. Left explicitly null rather than fabricated.
 */
function onReadinessCertificateBlocked(event: DomainEvent): void {
  const payload = event.payload as {
    certificateId?: unknown;
    overallScore?: unknown;
    blockers?: unknown;
    unknownClaims?: unknown;
    actorId?: unknown;
  };
  const blockers = typeof payload.blockers === "number" ? payload.blockers : 0;
  const actorId = typeof payload.actorId === "string" ? payload.actorId : null;

  appendUnifiedAuditEntry({
    type: "evaluation.completed",
    actorId,
    ownerId: null,
    actorKind: "AGENT",
    reason: `production-readiness certificate ${String(payload.certificateId ?? "unknown")} issued with ${blockers} blocker(s) (score ${String(payload.overallScore ?? "unknown")})`,
    input: { certificateId: payload.certificateId ?? null },
    output: {
      overallScore: payload.overallScore ?? null,
      blockers,
      unknownClaims: payload.unknownClaims ?? null,
    },
    policy: "readiness.certificate",
    risk: "CRITICAL",
    approval: "PENDING",
    result: "FAILURE",
    projectId: event.projectId ?? undefined,
    correlationId: event.correlationId,  });
}

export const readinessCertificateBlockedAutomationRule: AutomationRule = {
  id: "readiness-certificate-blockers-audit",
  description:
    "evaluation.completed (production-readiness-certificate) -> CRITICAL-risk audit entry when blockers are present.",
  on: "evaluation.completed",
  condition: readinessCertificateHasBlockers,
  action: onReadinessCertificateBlocked,
};

/**
 * Rule 3: gate.evaluated -> automation-initiated CASE.CREATE (through
 * `dispatchAgentAction`, gated by the AUTOMATION-actor CREATE/UPDATE/DELETE
 * floor in `agent-dispatch-guard.ts`) when the SAME release-gate graph has
 * been blocked or failed on `GATE_PERSISTENT_BLOCK_STREAK` CONSECUTIVE
 * evaluations.
 *
 * Trigger: `gate.evaluated`, the same real, already-published event Rule 1
 * above reacts to (apps/api/src/routes/gates.ts's
 * POST /api/v1/gates/evaluate). `graph.id` is stable across repeated
 * evaluations of the same project (see `evaluateReleaseGateGraph` in
 * gate-engine.ts: `id: prior?.id ?? crypto.randomUUID()`), so tracking a
 * per-graphId streak genuinely measures "this release has stayed blocked",
 * not "a gate was blocked once."
 *
 * Condition: this is a DIFFERENT, new condition from Rule 1's
 * `gateHasBlockedNode` (which fires on every single blocked/failed
 * evaluation) — `gatePersistentlyBlocked` only returns true on the
 * evaluation where a graph's blocked/failed streak first REACHES
 * `GATE_PERSISTENT_BLOCK_STREAK` consecutive evaluations, and the streak
 * resets to zero the moment that graph evaluates clean again. This keeps
 * the rule from firing on a single transient blip (matching Rule 1/Rule 2's
 * own discipline of reacting to something "genuinely bad," not every event)
 * and from re-firing on every one of the N+1th, N+2th, ... blocked
 * evaluations once the threshold has already been crossed once for the
 * current streak.
 *
 * Action: unlike Rule 1/Rule 2 (whose only action primitive is
 * `appendUnifiedAuditEntry`), this is the first built-in rule that attempts
 * a genuine state-mutating action: it calls `dispatchAgentAction` with
 * `actor.kind: "AUTOMATION"` and `entityType: "CASE"`, `action: "CREATE"` —
 * "file a CASE recording that this release-gate graph has been stuck
 * blocked for N straight evaluations, for human triage." CASE.CREATE is
 * LOW_RISK_WRITE / `requiresApproval:false` by default policy
 * (`DEFAULT_ENTITY_POLICIES` in entity-policies.ts) — genuinely the
 * lowest-risk real CREATE available for an operational "please look at
 * this" record; nothing about CASE.CREATE itself is dangerous. The point of
 * exercising it here is exactly that: even the lowest-risk CREATE, taken by
 * an AUTOMATION actor with no live human in the loop, must still clear
 * `dispatchAgentAction`'s automation floor (`floorBucketForAutomationActor`
 * in agent-dispatch-guard.ts) rather than silently auto-executing — and in
 * fact `authorizeEntityAction` itself (entity-policies.ts) already forces
 * every non-READ_ONLY action called with `approved:false` to
 * APPROVAL_REQUIRED before that floor is even reached, so the two
 * mechanisms combine to make silent auto-apply doubly impossible here.
 *
 * Outcome handling: `dispatchAgentAction` never executes the underlying
 * action itself — callers execute on ALLOWED and record what actually
 * happened otherwise (see that function's own doc comment). Given the floor
 * above, ALLOWED cannot occur for this entity/action pair under the current
 * policy table; APPROVAL_REQUIRED is the expected, ordinary outcome
 * (`dispatchAgentAction` has already created a real `approvals.ts` approval
 * request and written its own PARTIAL/PENDING audit entry by the time this
 * rule's action returns), and DENIED is handled the same honest way.
 * Neither outcome is treated as an error or silently swallowed. ALLOWED is
 * deliberately NOT treated as "case created" — there is no real
 * case-creation write primitive in this codebase yet (the same limitation
 * Rule 1/Rule 2's own doc comment already calls out for actions in
 * general) — instead it is logged loudly as the unexpected state it would
 * be, so a future change that weakens the floor can never silently start
 * fabricating "success."
 */
const GATE_PERSISTENT_BLOCK_STREAK = 3;

/**
 * Per-graphId consecutive blocked/failed evaluation count. Module-level
 * state (same pattern as `automation-engine.ts`'s `firedIdempotencyKeys`)
 * because "consecutive" is inherently a property of the *sequence* of
 * `gate.evaluated` events for one graph, not of any single event's payload.
 * Reset for tests by `resetAutomationRulesForTests()` below, same as the
 * engine's own tracked state.
 */
const gateBlockStreaks = new Map<string, number>();

function gatePersistentlyBlocked(event: DomainEvent): boolean {
  const payload = event.payload as { graphId?: unknown; statuses?: unknown };
  const graphId = typeof payload.graphId === "string" ? payload.graphId : null;
  if (!graphId) return false;
  const statuses = (payload.statuses ?? {}) as Record<string, unknown>;
  const blocked = blockedGateNodeIds(statuses).length > 0;

  if (!blocked) {
    gateBlockStreaks.delete(graphId);
    return false;
  }

  const streak = (gateBlockStreaks.get(graphId) ?? 0) + 1;
  gateBlockStreaks.set(graphId, streak);
  return streak === GATE_PERSISTENT_BLOCK_STREAK;
}

/** The dispatching AUTOMATION actor's stable identity for audit/approval trails. */
const GATE_PERSISTENT_BLOCK_AGENT_ID = "automation-engine.gate-persistent-block";

function onGatePersistentlyBlocked(event: DomainEvent): void {
  const payload = event.payload as {
    graphId?: unknown;
    summary?: unknown;
    statuses?: unknown;
  };
  const statuses = (payload.statuses ?? {}) as Record<string, unknown>;
  const blocked = blockedGateNodeIds(statuses);
  const graphId = String(payload.graphId ?? "unknown");

  const result = dispatchAgentAction({
    actor: {
      kind: "AUTOMATION",
      agentId: GATE_PERSISTENT_BLOCK_AGENT_ID,
      onBehalfOfUserId: null,
    },
    entityType: "CASE",
    action: "CREATE",
    routeLabel: "automation.gate-persistent-block.case.create",
    sourceContext: { origin: "system", trustLevel: "trusted" },
    projectId: event.projectId ?? null,
    input: {
      graphId,
      blockedNodeIds: blocked,
      consecutiveBlockedEvaluations: GATE_PERSISTENT_BLOCK_STREAK,
      summary: payload.summary ?? null,
    },
  });

  switch (result.decision) {
    case "APPROVAL_REQUIRED":
      // Expected, ordinary outcome — the AUTOMATION-actor CREATE floor
      // guarantees this can never resolve ALLOWED with an AUTO/AUTO_LOG
      // bucket. `dispatchAgentAction` has already created a real
      // `approvals.ts` approval request (`result.approvalRequestId`) and
      // written its own audit entry; nothing further to do here beyond
      // honoring that this action did NOT execute.
      break;
    case "DENIED":
      // Also handled honestly rather than assumed away: `dispatchAgentAction`
      // has already written a REJECTED/FAILURE audit entry for this. Not
      // expected under the current CASE.CREATE policy (which is
      // ALLOWED-shaped absent the AUTOMATION floor), but if a future policy
      // change denies it outright, this rule must not pretend it succeeded.
      break;
    case "ALLOWED":
      // Should be unreachable under `DEFAULT_ENTITY_POLICIES` +
      // `floorBucketForAutomationActor` today (see doc comment above) — if
      // it ever happens, the floor has silently regressed. This rule does
      // NOT execute a real case-creation write (no such primitive exists in
      // this codebase yet), so record the anomaly loudly instead of
      // fabricating a "case created" success.
      appendUnifiedAuditEntry({
        type: "automation.gate-persistent-block.unexpected-allowed",
        actorId: GATE_PERSISTENT_BLOCK_AGENT_ID,
        ownerId: null,
        actorKind: "AGENT",
        reason: `dispatchAgentAction unexpectedly ALLOWED an AUTOMATION-actor CASE.CREATE for gate graph ${graphId} — the automation-CRUD floor should have forced APPROVAL_REQUIRED`,
        input: { graphId, blockedNodeIds: blocked },
        output: { bucket: result.bucket, score: result.score },
        policy: "CASE.CREATE",
        risk: "CRITICAL",
        approval: "NOT_REQUIRED",
        result: "FAILURE",
        projectId: event.projectId ?? undefined,
        correlationId: event.correlationId,      });
      break;
  }
}

export const gatePersistentBlockAutomationRule: AutomationRule = {
  id: "gate-persistent-block-case",
  description:
    "gate.evaluated -> AUTOMATION-actor CASE.CREATE dispatch (via dispatchAgentAction) when the same gate graph has been blocked/failed on 3 consecutive evaluations.",
  on: "gate.evaluated",
  condition: gatePersistentlyBlocked,
  action: onGatePersistentlyBlocked,
};

let registered = false;

/**
 * Wire every built-in automation rule onto the shared `domainEventBus`
 * singleton via `registerAutomationRule()`. Idempotent — safe to call more
 * than once (e.g. across test files that each import the app bootstrap)
 * since it only subscribes the first time.
 */
export function registerBuiltinAutomationRules(): void {
  if (registered) return;
  registered = true;
  registerAutomationRule(gateBlockedAutomationRule);
  registerAutomationRule(readinessCertificateBlockedAutomationRule);
  registerAutomationRule(gatePersistentBlockAutomationRule);
}

/** Test helper — undo registerBuiltinAutomationRules() so a test can start clean. */
export function resetAutomationRulesForTests(): void {
  registered = false;
  resetAutomationEngineForTests();
  domainEventBus.clear();
  gateBlockStreaks.clear();
}
