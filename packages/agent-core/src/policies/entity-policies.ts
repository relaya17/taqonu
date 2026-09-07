import { AtlasError, type AgentMode, type ToolRisk } from "@atlas/shared";

/**
 * Business-entity taxonomy for the entity-centric policy layer.
 *
 * Atlas is a control plane consumed by multiple downstream vertical apps
 * (hotel-ops, real-estate/broker, legal-case, etc.), so this taxonomy is
 * deliberately domain-agnostic rather than modeling any one vertical's
 * nouns directly. Each vertical entity (a "guest", a "listing", a "matter")
 * should map onto one of these generic buckets:
 *
 * - CUSTOMER: the external party the business serves (guest, client,
 *   tenant, buyer, patient, etc.) and their PII.
 * - RECORD: a general operational/business record that isn't better
 *   described by a more specific bucket below (a booking, a listing,
 *   a ticket, an inventory row, ...).
 * - DOCUMENT: unstructured or semi-structured content/files (contracts,
 *   uploaded attachments, generated reports).
 * - FINANCIAL_TRANSACTION: anything that moves or represents money
 *   (payments, invoices, refunds, ledger entries) — held to a higher bar.
 * - CASE: a tracked unit of work with a lifecycle and often legal/
 *   compliance weight (a legal matter, a support case, an incident).
 * - COMMUNICATION: messages sent to or on behalf of a real person
 *   (email, SMS, chat) — irreversible once delivered, so treated
 *   similarly to financial actions for write-type actions.
 * - CONFIGURATION: control-plane/system settings that change how the
 *   platform or an agent itself behaves (policies, integrations,
 *   feature flags) rather than domain data.
 */
export type BusinessEntityType =
  | "CUSTOMER"
  | "RECORD"
  | "DOCUMENT"
  | "FINANCIAL_TRANSACTION"
  | "CASE"
  | "COMMUNICATION"
  | "CONFIGURATION";

/**
 * The set of CRUD-ish actions an agent can attempt against a business
 * entity, independent of which literal tool call implements it. This is
 * the entity-centric analog of a tool name in `tool-policies.ts`.
 */
export type EntityAction = "READ" | "CREATE" | "UPDATE" | "DELETE" | "EXECUTE";

/**
 * Entity-centric policy record, parallel to `ToolPolicy` in
 * `@atlas/shared` / `tool-policies.ts`. It intentionally reuses the same
 * `ToolRisk` tier type ("READ_ONLY" | "LOW_RISK_WRITE" | "HIGH_RISK_WRITE"
 * | "DESTRUCTIVE") so that a tool-level policy and an entity-level policy
 * can be compared/combined (e.g. "take whichever of the two is stricter")
 * instead of maintaining two unrelated risk vocabularies.
 */
export type EntityPolicy = {
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  readonly risk: ToolRisk;
  readonly requiresApproval: boolean;
  /**
   * Universal Permanent Prohibition (FORBIDDEN): when true, this
   * entity/action combination has NO execution path at all -- not "needs
   * a stricter approval", not "needs Dual Control", not "needs a live
   * human" -- it is structurally non-executable. `authorizeEntityAction`
   * checks this before it ever looks at `agentContext.approved`, before
   * the write-gate check, before `requiresApproval`, so no approval
   * (an ordinary `decide()`, an independent Dual-Control-approved
   * `decide()`, or a live-human `claimAsLiveHuman()`) can ever satisfy
   * it. This is the single authoritative representation of "permanently
   * prohibited" in Atlas -- deliberately NOT a second, independent
   * `RiskBucket` value (`RiskBucket` in `risk-score.ts` is a *derived*,
   * per-request numeric classification computed from confidence/evidence/
   * trust-level signals, not a static declaration of an entity/action's
   * intrinsic properties; `EntityPolicy` already IS that static
   * declaration) -- so there is exactly one place this fact lives and no
   * way for two representations of the same fact to drift apart.
   * Defaults to `false` for every existing policy; introducing this
   * field changes no existing behavior.
   */
  readonly forbidden?: boolean;
};

function policy(
  entityType: BusinessEntityType,
  action: EntityAction,
  risk: ToolRisk,
  requiresApproval: boolean,
  forbidden = false,
): EntityPolicy {
  return { entityType, action, risk, requiresApproval, forbidden };
}

/**
 * Default least-privilege entity policy table, keyed by entity type and
 * then by action.
 *
 * Design intent (mirrors the roadmap's own example: "an agent may Read a
 * customer record but may not Delete one"):
 *   - READ is generally low risk and does not require approval, except
 *     for CONFIGURATION (reading live system config is treated as
 *     sensitive because it can reveal control-plane internals) and CASE
 *     (case data often carries legal/compliance sensitivity).
 *   - CREATE is usually LOW_RISK_WRITE and does not require approval,
 *     except where creating the entity has real-world side effects
 *     (FINANCIAL_TRANSACTION, COMMUNICATION, CONFIGURATION).
 *   - UPDATE is HIGH_RISK_WRITE and requires approval across the board,
 *     since mutating existing business data can silently corrupt state.
 *   - DELETE is DESTRUCTIVE and requires approval for every entity type
 *     — there is no entity for which silent deletion is acceptable.
 *   - EXECUTE (e.g. "run this transaction", "send this communication",
 *     "apply this configuration") is treated as at least HIGH_RISK_WRITE,
 *     and DESTRUCTIVE with mandatory approval for FINANCIAL_TRANSACTION,
 *     COMMUNICATION and CONFIGURATION, since those actions are typically
 *     irreversible once executed.
 */
export const DEFAULT_ENTITY_POLICIES: Record<
  BusinessEntityType,
  Record<EntityAction, EntityPolicy>
> = {
  CUSTOMER: {
    READ: policy("CUSTOMER", "READ", "READ_ONLY", false),
    CREATE: policy("CUSTOMER", "CREATE", "LOW_RISK_WRITE", false),
    UPDATE: policy("CUSTOMER", "UPDATE", "HIGH_RISK_WRITE", true),
    DELETE: policy("CUSTOMER", "DELETE", "DESTRUCTIVE", true),
    EXECUTE: policy("CUSTOMER", "EXECUTE", "HIGH_RISK_WRITE", true),
  },
  RECORD: {
    READ: policy("RECORD", "READ", "READ_ONLY", false),
    CREATE: policy("RECORD", "CREATE", "LOW_RISK_WRITE", false),
    UPDATE: policy("RECORD", "UPDATE", "HIGH_RISK_WRITE", true),
    DELETE: policy("RECORD", "DELETE", "DESTRUCTIVE", true),
    EXECUTE: policy("RECORD", "EXECUTE", "HIGH_RISK_WRITE", true),
  },
  DOCUMENT: {
    READ: policy("DOCUMENT", "READ", "READ_ONLY", false),
    CREATE: policy("DOCUMENT", "CREATE", "LOW_RISK_WRITE", false),
    UPDATE: policy("DOCUMENT", "UPDATE", "HIGH_RISK_WRITE", true),
    DELETE: policy("DOCUMENT", "DELETE", "DESTRUCTIVE", true),
    EXECUTE: policy("DOCUMENT", "EXECUTE", "HIGH_RISK_WRITE", true),
  },
  FINANCIAL_TRANSACTION: {
    READ: policy("FINANCIAL_TRANSACTION", "READ", "READ_ONLY", false),
    CREATE: policy("FINANCIAL_TRANSACTION", "CREATE", "HIGH_RISK_WRITE", true),
    UPDATE: policy("FINANCIAL_TRANSACTION", "UPDATE", "DESTRUCTIVE", true),
    DELETE: policy("FINANCIAL_TRANSACTION", "DELETE", "DESTRUCTIVE", true),
    EXECUTE: policy("FINANCIAL_TRANSACTION", "EXECUTE", "DESTRUCTIVE", true),
  },
  CASE: {
    READ: policy("CASE", "READ", "LOW_RISK_WRITE", false),
    CREATE: policy("CASE", "CREATE", "LOW_RISK_WRITE", false),
    UPDATE: policy("CASE", "UPDATE", "HIGH_RISK_WRITE", true),
    DELETE: policy("CASE", "DELETE", "DESTRUCTIVE", true),
    EXECUTE: policy("CASE", "EXECUTE", "HIGH_RISK_WRITE", true),
  },
  COMMUNICATION: {
    READ: policy("COMMUNICATION", "READ", "READ_ONLY", false),
    CREATE: policy("COMMUNICATION", "CREATE", "HIGH_RISK_WRITE", true),
    UPDATE: policy("COMMUNICATION", "UPDATE", "HIGH_RISK_WRITE", true),
    DELETE: policy("COMMUNICATION", "DELETE", "DESTRUCTIVE", true),
    EXECUTE: policy("COMMUNICATION", "EXECUTE", "DESTRUCTIVE", true),
  },
  CONFIGURATION: {
    READ: policy("CONFIGURATION", "READ", "LOW_RISK_WRITE", false),
    CREATE: policy("CONFIGURATION", "CREATE", "HIGH_RISK_WRITE", true),
    UPDATE: policy("CONFIGURATION", "UPDATE", "DESTRUCTIVE", true),
    DELETE: policy("CONFIGURATION", "DELETE", "DESTRUCTIVE", true),
    EXECUTE: policy("CONFIGURATION", "EXECUTE", "DESTRUCTIVE", true),
  },
};

/**
 * Looks up the default policy for a given entity type + action, without
 * throwing. Returns `undefined` for any combination not present in
 * `DEFAULT_ENTITY_POLICIES` (fail-safe: callers must treat "no policy" as
 * "not allowed", never as an implicit ALLOWED — see `authorizeEntityAction`).
 */
export function getEntityPolicy(
  entityType: BusinessEntityType,
  action: EntityAction,
): EntityPolicy | undefined {
  return DEFAULT_ENTITY_POLICIES[entityType]?.[action];
}

/**
 * Minimal agent-context shape mirroring the parameters accepted by
 * `authorizeToolCall` in `./authorization.js`. `authorization.ts` does not
 * currently export a standalone type for its `input` parameter (it's an
 * inline object type on the function signature), so this is defined
 * locally. TODO: once `authorization.ts` exports a named context type,
 * replace this with that shared type so the tool- and entity-centric
 * authorization paths take the exact same context shape.
 */
export type EntityAgentContext = {
  readonly mode: AgentMode;
  readonly approved?: boolean;
  readonly writeGateOpen?: boolean;
};

/**
 * Result of an entity-action authorization check. Structurally identical
 * in spirit to `AuthorizationDecision` from `./authorization.js` (same
 * three decisions, same `policy`/`reason` fields) so that call sites can
 * handle a tool-call decision and an entity-action decision the same way,
 * even though the `policy` payload type differs (`EntityPolicy` here vs.
 * `ToolPolicy` there).
 */
export type EntityAuthorizationDecision =
  | { readonly decision: "ALLOWED"; readonly policy: EntityPolicy }
  | { readonly decision: "DENIED"; readonly reason: string; readonly forbidden?: true }
  | { readonly decision: "APPROVAL_REQUIRED"; readonly policy: EntityPolicy };

const READ_LIKE_MODES: ReadonlySet<AgentMode> = new Set([
  "READ",
  "ANALYZE",
  "VERIFY",
]);

/**
 * Entity-centric counterpart to `authorizeToolCall` from `./authorization.js`.
 *
 * Where `authorizeToolCall` answers "is this literal tool call allowed
 * right now?", `authorizeEntityAction` answers the higher-level question
 * "is this agent allowed to READ/CREATE/UPDATE/DELETE/EXECUTE this class
 * of business entity right now?", independent of which tool implements
 * it. The two are meant to be used together: a tool invocation that acts
 * on a business entity should pass BOTH `authorizeToolCall` (is this tool
 * itself permitted) AND `authorizeEntityAction` (is this action on this
 * entity type permitted), and be allowed only if neither returns DENIED
 * and any APPROVAL_REQUIRED from either path is honored.
 *
 * Mirrors `authorizeToolCall`'s gating rules for consistency:
 *   - Unknown entity type/action combinations fail safe as DENIED (never
 *     default to ALLOWED).
 *   - In a read-like mode (READ, ANALYZE, VERIFY), only READ_ONLY-tier
 *     entity actions are allowed.
 *   - In PLAN mode, non-READ_ONLY actions are proposals only:
 *     APPROVAL_REQUIRED, never auto-executed.
 *   - APPROVE is a human gate, not an execution mode: always DENIED here.
 *   - Non-READ_ONLY actions additionally require the write gate to be
 *     open, and then either pre-approval or an APPROVAL_REQUIRED result.
 *   - A policy's own `requiresApproval` flag is honored even if the risk
 *     tier alone would not have forced an approval step.
 */
export function authorizeEntityAction(
  entityType: BusinessEntityType,
  action: EntityAction,
  agentContext: EntityAgentContext,
): EntityAuthorizationDecision {
  const policy = getEntityPolicy(entityType, action);
  if (!policy) {
    return {
      decision: "DENIED",
      reason: `Unknown entity action: ${entityType}.${action}`,
    };
  }

  // Universal Permanent Prohibition (FORBIDDEN) -- see `EntityPolicy.forbidden`
  // above. This MUST run before every other check in this function: before
  // mode checks, before the write-gate check, before `requiresApproval`,
  // and critically before `agentContext.approved` is ever consulted below.
  // A forbidden policy has no execution path -- nothing past this point
  // may ever turn it into ALLOWED or APPROVAL_REQUIRED, regardless of what
  // the caller passes as `approved` (an ordinary decide(), an
  // independent Dual-Control-approved decide(), or a live-human
  // claimAsLiveHuman() all arrive here as `approved: true` from the same
  // upstream call sites -- this check is unconditional and precedes all
  // of them).
  if (policy.forbidden === true) {
    return {
      decision: "DENIED",
      reason: `${entityType}.${action} is permanently forbidden and cannot be authorized by any approval, Dual Control, or live-human decision`,
      forbidden: true,
    };
  }

  if (READ_LIKE_MODES.has(agentContext.mode) && policy.risk !== "READ_ONLY") {
    return {
      decision: "DENIED",
      reason: `${entityType}.${action} is not allowed in ${agentContext.mode} mode`,
    };
  }

  if (agentContext.mode === "PLAN" && policy.risk !== "READ_ONLY") {
    return { decision: "APPROVAL_REQUIRED", policy };
  }

  if (agentContext.mode === "APPROVE") {
    return {
      decision: "DENIED",
      reason: "APPROVE is a human gate, not an entity-action-execution mode",
    };
  }

  if (policy.risk !== "READ_ONLY") {
    if (agentContext.writeGateOpen !== true) {
      return {
        decision: "DENIED",
        reason: "WRITE-tier entity actions blocked until evaluation write gate is open",
      };
    }
    if (agentContext.approved !== true) {
      return { decision: "APPROVAL_REQUIRED", policy };
    }
  }

  if (policy.requiresApproval && agentContext.approved !== true) {
    return { decision: "APPROVAL_REQUIRED", policy };
  }

  return { decision: "ALLOWED", policy };
}

/**
 * Throwing variant of `authorizeEntityAction`, parallel to
 * `assertAuthorized` in `./authorization.js`. Throws the same `AtlasError`
 * codes ("FORBIDDEN" / "APPROVAL_REQUIRED") so callers that already
 * handle `assertAuthorized` failures can handle this the same way.
 */
export function assertEntityAuthorized(
  entityType: BusinessEntityType,
  action: EntityAction,
  agentContext: EntityAgentContext,
): EntityPolicy {
  const result = authorizeEntityAction(entityType, action, agentContext);
  if (result.decision === "DENIED") {
    throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
  }
  if (result.decision === "APPROVAL_REQUIRED") {
    throw new AtlasError(
      "APPROVAL_REQUIRED",
      `${entityType}.${action} requires explicit approval`,
      { statusCode: 403, details: { entityType, action } },
    );
  }
  return result.policy;
}
