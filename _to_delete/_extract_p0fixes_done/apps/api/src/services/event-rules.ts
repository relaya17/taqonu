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
 * `DomainEvent.payload` is a freeform record (see
 * packages/shared/src/schemas/domain-event.schema.ts), so the human actor's
 * id is threaded through as `payload.actorId` by the publisher
 * (apps/api/src/services/patch-write.ts's `applyApprovedPatch`, which
 * already has an authenticated `AuthUser` in scope from
 * apps/api/src/routes/code.ts's `requireSignedInForWrite`/`assertPatchWrite`)
 * rather than living on `DomainEvent` itself — `ownerId` on the envelope
 * stays a project-owner stub, not the acting user. `actorId` below falls
 * back to null only defensively, for a publisher that genuinely has no
 * actor to attribute. `actorKind` is "AGENT" because patch application in
 * this codebase is always agent/automation-initiated, never a direct human
 * edit — the human actor approved/triggered it, but did not perform the
 * file mutation by hand.
 */
function onPatchApplied(event: DomainEvent): void {
  const payload = event.payload as {
    patchId?: unknown;
    sourceIssueId?: unknown;
    applied?: unknown;
    skipped?: unknown;
    actorId?: unknown;
  };
  const applied = Array.isArray(payload.applied) ? payload.applied : [];
  const skipped = Array.isArray(payload.skipped) ? payload.skipped : [];
  const actorId = typeof payload.actorId === "string" ? payload.actorId : null;

  appendUnifiedAuditEntry({
    type: "patch.applied",
    actorId,
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
    causationId: event.causationId,
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
