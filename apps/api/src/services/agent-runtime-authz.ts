import {
  AtlasError,
  FABRIC_AGENT_IDS,
  FABRIC_AGENT_CATALOG,
  type FabricAgentId,
} from "@atlas/shared";
import { assertGovernedProjectExists } from "./project-access.js";

/**
 * P0.2 — Agent Identity + Runtime Authorization Enforcement.
 *
 * The distinction this file exists to enforce:
 *
 *   FABRIC_AGENT_CATALOG  declares what an agent MAY do.
 *   This module            enforces it at execution time.
 *   The session            is the only source of WHO is asking.
 *
 * Those three must stay separate. Collapsing them is how an agent ends up
 * authorizing itself.
 *
 * ── Why identity is not a parameter ──────────────────────────────────
 *
 * A tempting shape for this is a single `context: { agentId, role, tenantId,
 * projectId }` handed in by the caller, with the guard comparing that
 * context against a `payload`. That shape cannot work, and the reason is
 * worth stating plainly because it looks secure:
 *
 * If the caller supplies BOTH the context and the payload, an attacker
 * simply declares the context it wants (`role: "SECURITY"`) and leaves the
 * payload alone. Every comparison passes — context matches itself — and the
 * guard waves through a fully escalated request. Comparing two values that
 * came from the same untrusted source proves nothing about either.
 *
 * So `AuthenticatedAgentIdentity` is constructed ONLY by
 * `resolveAgentIdentity()`, from a server-derived session `ownerId` and a
 * `FabricAgentId` validated against the closed catalog. The payload is
 * checked against it, never the reverse, and the payload can never widen it.
 */

/** Identity resolved server-side. Never constructed from request data alone. */
export interface AuthenticatedAgentIdentity {
  readonly agentId: FabricAgentId;
  /** The signed-in human this agent acts for — from the session, not the body. */
  readonly ownerId: string;
  /** Server-resolved project scope; null for cross-project/system work. */
  readonly projectId: string | null;
  /**
   * Authority scope — the bounded context within which this agent may act.
   * Derived from the agent catalog and session context.
   * Examples: "project:abc123", "tenant:xyz", "global:read-only"
   */
  readonly authorityScope?: string;
  /**
   * Trust level of this agent session.
   * FULL: direct human-initiated, verified session
   * DELEGATED: called by another agent (authority attenuation applies)
   * LAB: development/testing context
   */
  readonly trustLevel?: "FULL" | "DELEGATED" | "LAB";
  /**
   * Runtime status from Control Plane. Used for circuit-breaking.
   */
  readonly runtimeStatus?:
    | "ACTIVE"
    | "PAUSED"
    | "DISABLED"
    | "REVOKED"
    | "QUARANTINED"
    | "SUSPENDED"
    | "DEGRADED"
    | "UNKNOWN";
}

/**
 * Values a tool payload may legitimately carry. `unknown`-free and
 * `any`-free on purpose: `any` here would silently disable the type checking
 * that keeps a forged nested object from looking like a valid scalar.
 */
export type ToolPayloadValue =
  | string
  | number
  | boolean
  | null
  | readonly ToolPayloadValue[]
  | { readonly [key: string]: ToolPayloadValue };

export interface ToolExecutionPayload {
  /** If present, must equal the identity's ownerId. Cannot widen it. */
  readonly targetOwnerId?: string;
  /** If present, must equal the identity's projectId. Cannot widen it. */
  readonly targetProjectId?: string;
  /** If present, must equal the identity's agentId. Cannot impersonate. */
  readonly targetAgentId?: string;
  readonly [key: string]: ToolPayloadValue | undefined;
}

export interface AgentToolAttempt {
  readonly identity: AuthenticatedAgentIdentity;
  readonly requestedTool: string;
  readonly payload?: ToolExecutionPayload;
}

/**
 * Build a trusted identity. `ownerId` MUST come from the authenticated
 * session (e.g. `requireSignedInForWrite`), never from a request body.
 *
 * Throws when `fabricAgentId` is not one of the catalog's closed set — an
 * unknown agent id is rejected rather than defaulted, so a typo or an
 * invented agent cannot acquire an empty (and therefore unconstrained)
 * policy.
 */
export function resolveAgentIdentity(input: {
  readonly fabricAgentId: string;
  readonly sessionOwnerId: string;
  readonly projectId: string | null;
  /** Optional trust level override (defaults to FULL — session-backed human). */
  readonly trustLevel?: "FULL" | "DELEGATED" | "LAB";
  /** Optional runtime status from Control Plane. */
  readonly runtimeStatus?:
    | "ACTIVE"
    | "PAUSED"
    | "DISABLED"
    | "REVOKED"
    | "QUARANTINED"
    | "SUSPENDED"
    | "DEGRADED"
    | "UNKNOWN";
}): AuthenticatedAgentIdentity {
  if (!(FABRIC_AGENT_IDS as readonly string[]).includes(input.fabricAgentId)) {
    throw new AtlasError(
      "FORBIDDEN",
      `Unknown fabric agent "${input.fabricAgentId}" — not in the agent catalog`,
      { statusCode: 403 },
    );
  }
  if (!input.sessionOwnerId || input.sessionOwnerId.trim().length === 0) {
    throw new AtlasError(
      "FORBIDDEN",
      "Agent identity requires an authenticated session owner",
      { statusCode: 403 },
    );
  }

  // Governance-boundary existence check (Phase 2 discovery) — an identity
  // must not be built around a projectId that refers to nothing. See
  // `assertGovernedProjectExists` for why this is existence-only, not an
  // ownership check.
  assertGovernedProjectExists(input.projectId);

  // Compute authority scope based on project context
  const authorityScope = input.projectId
    ? `project:${input.projectId}`
    : `tenant:${input.sessionOwnerId}`;

  return {
    agentId: input.fabricAgentId as FabricAgentId,
    ownerId: input.sessionOwnerId,
    projectId: input.projectId,
    authorityScope,
    trustLevel: input.trustLevel ?? "FULL",
    runtimeStatus: input.runtimeStatus ?? "ACTIVE",
  };
}

/**
 * Enforce the catalog at execution time.
 *
 * Deliberately reuses `FABRIC_AGENT_CATALOG`'s existing
 * `allowedTools`/`forbiddenTools` rather than introducing a parallel
 * role→tool table. A second vocabulary would drift from the first, and the
 * two would disagree exactly when it mattered — the duplication failure this
 * codebase has already been bitten by elsewhere.
 *
 * Throws `AtlasError` (this repo's Fastify-native error type) on any
 * violation; returns silently when the attempt is authorized.
 */
export function enforceAgentToolAuthorization(attempt: AgentToolAttempt): void {
  const { identity, requestedTool, payload } = attempt;

  // ── 1. Anti-impersonation ───────────────────────────────────────────
  // The payload may RESTATE the identity but never contradict it. Note the
  // asymmetry that makes this meaningful: `identity` came from the session,
  // `payload` came from the request. This compares trusted against
  // untrusted, not untrusted against itself.
  if (payload?.targetOwnerId !== undefined && payload.targetOwnerId !== identity.ownerId) {
    throw new AtlasError(
      "FORBIDDEN",
      "SECURITY VIOLATION: agent attempted cross-tenant boundary escape",
      { statusCode: 403 },
    );
  }
  if (payload?.targetProjectId !== undefined && payload.targetProjectId !== identity.projectId) {
    throw new AtlasError(
      "FORBIDDEN",
      "SECURITY VIOLATION: agent attempted cross-project boundary escape",
      { statusCode: 403 },
    );
  }
  if (payload?.targetAgentId !== undefined && payload.targetAgentId !== identity.agentId) {
    throw new AtlasError(
      "FORBIDDEN",
      "SECURITY VIOLATION: agent attempted to act as another agent",
      { statusCode: 403 },
    );
  }

  const definition = FABRIC_AGENT_CATALOG[identity.agentId];

  // ── 2. Explicit denial beats permission ─────────────────────────────
  // `forbiddenTools` is checked FIRST and independently. If a tool ever
  // appears in both lists, the safe reading of a contradictory policy is
  // "denied" — never "allowed because it also appeared over here".
  if (definition.forbiddenTools.includes(requestedTool)) {
    throw new AtlasError(
      "FORBIDDEN",
      `POLICY DENIAL: agent ${identity.agentId} is explicitly forbidden from executing tool "${requestedTool}"`,
      { statusCode: 403 },
    );
  }

  // ── 3. Allow-list ───────────────────────────────────────────────────
  // No wildcard is honoured. A catalog entry cannot grant "*": an agent
  // with unbounded tool access is indistinguishable from an ungoverned one,
  // which is the thing this whole layer exists to prevent.
  if (!definition.allowedTools.includes(requestedTool)) {
    throw new AtlasError(
      "FORBIDDEN",
      `POLICY DENIAL: tool "${requestedTool}" is not in agent ${identity.agentId}'s allowedTools`,
      { statusCode: 403 },
    );
  }
}
