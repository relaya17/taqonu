import { domainEventBus } from "@atlas/agent-core";
import type { DomainEvent } from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";

/**
 * First real subscriber on the domain-event bus (roadmap step 2, "Event Bus
 * + Audit Log"). This is deliberately small and demonstrates one concrete
 * EVENT -> RULE -> ACTION link end to end: whenever a patch is applied, a
 * standardized (WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/POLICY/RISK/APPROVAL/RESULT)
 * audit entry is written automatically, without the patch-write.ts call site
 * needing to know anything about the audit schema.
 *
 * Known limitation, carried over from the gap-analysis: DomainEvent does not
 * yet carry the human actor's id (its `ownerId` is a project-owner stub, not
 * the acting user) — so `actorId` below is intentionally null until that's
 * threaded through. `actorKind` is "AGENT" because patch application in this
 * codebase is always agent/automation-initiated, never a direct human edit.
 */
function onPatchApplied(event: DomainEvent): void {
  const payload = event.payload as {
    patchId?: unknown;
    sourceIssueId?: unknown;
    applied?: unknown;
    skipped?: unknown;
  };
  const applied = Array.isArray(payload.applied) ? payload.applied : [];
  const skipped = Array.isArray(payload.skipped) ? payload.skipped : [];

  appendUnifiedAuditEntry({
    type: "patch.applied",
    actorId: null,
    actorKind: "AGENT",
    reason: `patch ${String(payload.patchId ?? "unknown")} applied (${applied.length} file(s) changed, ${skipped.length} skipped)`,
    input: {
      patchId: payload.patchId ?? null,
      sourceIssueId: payload.sourceIssueId ?? null,
    },
    output: { applied, skipped },
    policy: "patch.apply",
    risk: skipped.length > 0 ? "MEDIUM" : "LOW",
    approval: "APPROVED",
    result: "SUCCESS",
    projectId: event.projectId ?? undefined,
    correlationId: event.correlationId,
  });
}

let registered = false;

/**
 * Wire every built-in event rule onto the shared `domainEventBus` singleton.
 * Idempotent — safe to call more than once (e.g. across test files that each
 * import the app bootstrap) since it only subscribes the first time.
 */
export function registerEventRules(): void {
  if (registered) return;
  registered = true;
  domainEventBus.subscribe("patch.applied", onPatchApplied);
}

/** Test helper — undo registerEventRules() so a test can start clean. */
export function resetEventRulesForTests(): void {
  registered = false;
  domainEventBus.clear();
}
