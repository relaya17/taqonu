import {
  authorizeEntityAction,
  type BusinessEntityType,
  type EntityAction,
} from "@atlas/agent-core";
import type { AuthorizationTrace, SyntheticActorId, SyntheticEntityKind } from "./types.js";

const KIND_TO_ENTITY: Readonly<Record<SyntheticEntityKind, BusinessEntityType>> = {
  COMPANY: "RECORD",
  EMPLOYEE: "RECORD",
  AGENT: "RECORD",
  CUSTOMER: "CUSTOMER",
  PROPERTY: "RECORD",
  LEAD: "RECORD",
  DEAL: "RECORD",
  CONTRACT: "DOCUMENT",
  RESERVATION: "RECORD",
  MAINTENANCE: "CASE",
  INVOICE: "FINANCIAL_TRANSACTION",
  PAYMENT: "FINANCIAL_TRANSACTION",
  TASK: "RECORD",
  EVENT: "RECORD",
};

export function atlasEntityTypeFor(kind: SyntheticEntityKind): BusinessEntityType {
  return KIND_TO_ENTITY[kind];
}

/**
 * Reuses the existing entity-policy table. Does not invent a second IAM.
 * Synthetic operator is a test actor with an open write gate; unauthorized
 * agents are fail-closed.
 */
export function authorizeSyntheticAction(input: {
  readonly kind: SyntheticEntityKind;
  readonly action: EntityAction;
  readonly actorId: SyntheticActorId;
}): AuthorizationTrace {
  const entityType = atlasEntityTypeFor(input.kind);
  const context =
    input.actorId === "SYNTHETIC_OPERATOR"
      ? { mode: "WRITE" as const, writeGateOpen: true, approved: true }
      : { mode: "WRITE" as const, writeGateOpen: false, approved: false };
  const result = authorizeEntityAction(entityType, input.action, context);
  const reason =
    result.decision === "DENIED"
      ? result.reason
      : result.decision === "APPROVAL_REQUIRED"
        ? `${entityType}.${input.action} requires approval`
        : `${entityType}.${input.action} allowed`;
  return {
    entityType,
    action: input.action,
    decision: result.decision,
    reason,
    actorId: input.actorId,
  };
}
