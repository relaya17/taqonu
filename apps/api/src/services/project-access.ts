/**
 * G5 / P1.5 — project write access + isolation audit.
 * Local store binds ownerId on create/claim; mismatched owners are denied + audited.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, type AuthUser } from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

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
export function assertProjectWriteAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  projectId: string,
): AuthUser {
  const user = requireSignedInForWrite(app, request);
  const project = osStore.getProject(projectId);
  if (!project) {
    throw new AtlasError("NOT_FOUND", "Project not found", { statusCode: 404 });
  }

  if (user.role === "admin") {
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
