/**
 * G5 / P1.5 — project write access + isolation audit.
 * Local store binds ownerId on create/claim; mismatched owners are denied + audited.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, isControlPlaneRole, type AuthUser } from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { checkResourceAccess } from "./resource-access.js";

const OWNERS_META = "g5.projectOwners.v1";
const AUDIT_META = "g5.isolationAudit.v1";
const AUDIT_CAP = 200;

export interface IsolationAuditEntry {
  readonly at: string;
  readonly action:
    | "denied"
    | "claimed"
    | "bound_on_create"
    | "workspace_rejected";
  readonly projectId: string;
  readonly actorId: string;
  readonly detail: string;
}

function readOwners(): Record<string, string> {
  osStore.ensureLoaded();
  const raw = osStore.getMeta(OWNERS_META);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeOwners(owners: Record<string, string>): void {
  osStore.setMeta(OWNERS_META, JSON.stringify(owners));
}

function readAudit(): IsolationAuditEntry[] {
  osStore.ensureLoaded();
  const raw = osStore.getMeta(AUDIT_META);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as IsolationAuditEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function listIsolationAudit(limit = 40): readonly IsolationAuditEntry[] {
  return readAudit().slice(-limit).reverse();
}

export function isolationAuditSummary(): {
  readonly denied: number;
  readonly claimed: number;
  readonly bound: number;
  readonly total: number;
} {
  const items = readAudit();
  return {
    denied: items.filter((e) => e.action === "denied").length,
    claimed: items.filter((e) => e.action === "claimed").length,
    bound: items.filter((e) => e.action === "bound_on_create").length,
    total: items.length,
  };
}

export function appendIsolationAudit(
  entry: Omit<IsolationAuditEntry, "at"> & { readonly at?: string },
): void {
  const next: IsolationAuditEntry = {
    at: entry.at ?? new Date().toISOString(),
    action: entry.action,
    projectId: entry.projectId,
    actorId: entry.actorId,
    detail: entry.detail,
  };
  const items = [...readAudit(), next].slice(-AUDIT_CAP);
  osStore.setMeta(AUDIT_META, JSON.stringify(items));
}

export function getProjectOwnerId(projectId: string): string | null {
  return readOwners()[projectId] ?? null;
}

/**
 * Governance-boundary existence check for `resolveAgentIdentity` —
 * deliberately NOT an ownership check.
 *
 * `assertProjectWriteAccess`/`assertProjectReadAccess` above already
 * exempt admin/control-plane roles from ownership matching, and the one
 * caller reaching this check today (`/api/v1/gateway/fulfill`, via
 * `resolveAgentIdentity`) is operator-only (`requireOperator`). Adding
 * ownership matching here would therefore be a no-op for the only current
 * caller, and silently reproduce the existing bypass under a new name.
 *
 * What was actually missing was cheaper and unconditional: nothing verified
 * the referenced project exists at all before an `AuthenticatedAgentIdentity`
 * — and therefore a governed execution and its persisted `GovernanceDecision`
 * — could be built around it. This closes that gap only. Ownership matching
 * for this path remains an open architectural question (Phase 2 discovery,
 * §G) for whenever non-operator callers might reach this identity path.
 */
export function assertGovernedProjectExists(projectId: string | null): void {
  if (projectId === null) return;
  if (!osStore.getProject(projectId)) {
    throw new AtlasError("NOT_FOUND", `Project not found: ${projectId}`, {
      statusCode: 404,
    });
  }
}

export function bindProjectOwner(
  projectId: string,
  ownerId: string,
  reason: IsolationAuditEntry["action"],
): void {
  const owners = readOwners();
  owners[projectId] = ownerId;
  writeOwners(owners);
  appendIsolationAudit({
    action: reason,
    projectId,
    actorId: ownerId,
    detail: `owner bound (${reason})`,
  });
}

/**
 * Canonical absolute workspace path — rejects missing paths and null bytes.
 */
export function assertSafeWorkspaceRoot(workspaceRoot: string): string {
  if (workspaceRoot.includes("\0")) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "workspaceRoot contains illegal characters",
      { statusCode: 400 },
    );
  }
  const root = resolve(workspaceRoot.trim());
  if (!existsSync(root)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `workspaceRoot not found: ${root}`,
      { statusCode: 400 },
    );
  }
  return root;
}

/**
 * WRITE gate for a project: signed-in + ownership (or claim unowned).
 * Admins bypass ownership. Denied attempts are isolation-audited.
 */
export async function assertProjectWriteAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  projectId: string,
): Promise<AuthUser> {
  const user = await requireSignedInForWrite(app, request);
  const project = osStore.getProject(projectId);
  if (!project) {
    throw new AtlasError("NOT_FOUND", "Project not found", { statusCode: 404 });
  }

  if (user.role === "admin" || isControlPlaneRole(user.role)) {
    return user;
  }

  const ownerId = getProjectOwnerId(projectId);
  if (!ownerId) {
    bindProjectOwner(projectId, user.id, "claimed");
    return user;
  }

  if (ownerId !== user.id) {
    appendIsolationAudit({
      action: "denied",
      projectId,
      actorId: user.id,
      detail: `owner mismatch · expected ${ownerId}`,
    });
    throw new AtlasError(
      "FORBIDDEN",
      "Project isolation: you do not own this project",
      { statusCode: 403 },
    );
  }

  return user;
}

/**
 * Shared read-gate ownership check: signed-in `user` vs a resource's
 * (possibly null) owner via `checkResourceAccess`. `"session"` is granted to
 * every signed-in role (see `capabilitiesForRole`), so this call is really
 * just the admin-bypass / owner-match / no-owner-is-public comparison —
 * mirrors `assertProjectWriteAccess`'s ownership branch but never claims the
 * resource (reads must not have side effects) and never binds an owner.
 */
function assertReadOwnership(user: AuthUser, projectId: string): void {
  const ownerId = getProjectOwnerId(projectId);
  const decision = checkResourceAccess({
    actorId: user.id,
    role: user.role,
    requiredCapability: "session",
    resourceOwnerId: ownerId,
  });
  if (decision.decision === "DENIED") {
    appendIsolationAudit({
      action: "denied",
      projectId,
      actorId: user.id,
      detail: `read denied · ${decision.reason}`,
    });
    throw new AtlasError("FORBIDDEN", decision.reason, { statusCode: 403 });
  }
}

/**
 * READ gate for a project: signed-in required (401), project must exist
 * (404), and — unless the project has no bound owner yet, or the caller is
 * admin — the caller must own it (403). Does not claim/bind ownership.
 */
export async function assertProjectReadAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  projectId: string,
): Promise<AuthUser> {
  const user = await requireUser(app, request);
  if (!osStore.getProject(projectId)) {
    throw new AtlasError("NOT_FOUND", "Project not found", { statusCode: 404 });
  }
  assertReadOwnership(user, projectId);
  return user;
}

/**
 * READ gate for a project-scoped entity (Decision/Artifact/PatchArtifact —
 * anything whose schema carries a nullable `projectId`). Only requires
 * sign-in when `projectId` is null (the entity isn't tied to any project);
 * otherwise applies the same ownership check as `assertProjectReadAccess`
 * without a project-existence check (the caller already loaded the entity).
 */
export async function assertEntityReadAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  projectId: string | null,
): Promise<AuthUser> {
  const user = await requireUser(app, request);
  if (projectId) {
    assertReadOwnership(user, projectId);
  }
  return user;
}

/**
 * True when `user` may read a project-scoped entity with the given
 * (possibly null) `projectId` — for filtering list endpoints down to
 * "mine + unowned" (or everything, for admins) without throwing per item.
 */
export function canReadProjectScoped(
  user: AuthUser,
  projectId: string | null,
): boolean {
  if (!projectId) return true;
  if (user.role === "admin" || isControlPlaneRole(user.role)) return true;
  const ownerId = getProjectOwnerId(projectId);
  return !ownerId || ownerId === user.id;
}
