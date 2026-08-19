import { domainEventBus } from "@atlas/agent-core";
import type { DomainEvent } from "@atlas/shared";
import {
  registerAutomationRule,
  resetAutomationEngineForTests,
  type AutomationRule,
} from "./automation-engine.js";
import { appendUnifiedAuditEntry } from "./audit-log.js";

/**
 * Built-in Automation Engine rules (roadmap: "invoice.overdue -> notify ->
 * escalate -> audit"). These are the first two rules registered as
 * *declarative data* through `registerAutomationRule()` rather than
 * hand-written subscribers — the pattern
 * apps/api/src/services/event-rules.ts already proved out for
 * `patch.applied`. Both target events that are ACTUALLY published today
 * (verified by grepping real `appendDomainEvent({ type: "...", ... })` call
 * sites) and both react only when the payload signals a genuinely bad
 * outcome, not on every occurrence of the event type.
 *
 * Actions are intentionally limited to `appendUnifiedAuditEntry` — the only
 * safe, already-built action primitive in this codebase. No notifications,
 * emails, or external calls are invented here.
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
    actorKind: "AGENT",
    reason: `release gate graph ${String(payload.graphId ?? "unknown")} has ${blocked.length} blocked/failed node(s): ${blocked.join(", ")}`,
    input: { graphId: payload.graphId ?? null, summary: payload.summary ?? null },
    output: { statuses, blockedNodeIds: blocked },
    policy: "gate.release-block",
    risk: "HIGH",
    approval: "PENDING",
    result: "FAILURE",
    projectId: event.projectId ?? undefined,
    correlationId: event.correlationId,
    causationId: event.causationId,
  });
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
    correlationId: event.correlationId,
    causationId: event.causationId,
  });
}

export const readinessCertificateBlockedAutomationRule: AutomationRule = {
  id: "readiness-certificate-blockers-audit",
  description:
    "evaluation.completed (production-readiness-certificate) -> CRITICAL-risk audit entry when blockers are present.",
  on: "evaluation.completed",
  condition: readinessCertificateHasBlockers,
  action: onReadinessCertificateBlocked,
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
}

/** Test helper — undo registerBuiltinAutomationRules() so a test can start clean. */
export function resetAutomationRulesForTests(): void {
  registered = false;
  resetAutomationEngineForTests();
  domainEventBus.clear();
}
