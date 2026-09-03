/**
 * Phase 13 — Atlas-self mutations reuse live approvals + live-human
 * execution. No second policy/approval/audit engine.
 */
import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { BusinessEntityType, EntityAction } from "@atlas/agent-core";
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_PROJECT_ID,
  ATLAS_SELF_TENANT_ID,
  AtlasError,
  CONTROL_PLANE_SERVICE_ID,
  atlasSelfApprovalContext,
  atlasSelfArtifactHash,
  atlasSelfControlArtifactHash,
  isAtlasSelfApprovalContext,
  isAtlasSelfProjectId,
  isAtlasSelfProjectSlug,
  type ApprovalRequest,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { createApprovalRequest, getApprovalRequest } from "./approvals.js";
import {
  runLiveHumanDecisionExecution,
  type RunLiveHumanDecisionExecutionInput,
} from "./live-human-execution.js";
import type {
  GovernedExecuteOnceResult,
  HelperResult,
} from "./governed-claimed-execution.js";
import { findAtlasSelfProjectId } from "./observe-system-facets.js";

export function hashAtlasSelfFileArtifact(input: {
  readonly projectId: string;
  readonly path: string;
  readonly content: string;
}): string {
  return atlasSelfArtifactHash({
    applicationId: ATLAS_SELF_APPLICATION_ID,
    projectId: input.projectId,
    path: input.path,
    contentHash: createHash("sha256").update(input.content).digest("hex"),
  });
}

export function isAtlasSelfStudioProject(projectId: string): boolean {
  if (isAtlasSelfProjectId(projectId)) return true;
  const project = osStore.getProject(projectId);
  if (project && isAtlasSelfProjectSlug(project.slug)) return true;
  const selfId = findAtlasSelfProjectId();
  if (!selfId) return false;
  const selfRoot = osStore.getWorkspaceRoot(selfId);
  const thisRoot = osStore.getWorkspaceRoot(projectId);
  if (!selfRoot || !thisRoot) return false;
  return selfRoot === thisRoot;
}

function normalizeStudioWritePath(relativePath: string): string {
  // Mirror `packages/code-intelligence/src/workspace-browser.ts` normalization:
  // Studio paths are treated as workspace-relative POSIX-like strings.
  return relativePath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
}

/**
 * Atlas-self must not be able to rewrite governance-critical runtime/implementation
 * artifacts (directly or via rebuild). This is enforced as an allow/deny boundary
 * at Studio write time, before any approval verification executes.
 */
export function atlasSelfStudioWriteDeniedReason(
  relativePath: string,
): string | null {
  const cleaned = normalizeStudioWritePath(relativePath);

  const segs = cleaned.split("/");
  const last = segs[segs.length - 1] ?? "";

  // Build/configuration inputs that can redirect the build output (rebuild-based
  // governance modification).
  if (last === "package.json") {
    return "writes to package.json are governance-critical build/config modifications";
  }
  if (last === "pnpm-lock.yaml") {
    return "writes to pnpm-lock.yaml are governance-critical build dependency modifications";
  }
  if (last === "pnpm-workspace.yaml") {
    return "writes to pnpm-workspace.yaml are governance-critical workspace configuration modifications";
  }
  if (/^tsconfig(\..*)?\.json$/.test(last)) {
    return "writes to tsconfig*.json are governance-critical build configuration modifications";
  }
  if (last === ".env") {
    return "writes to .env are governance-critical runtime configuration modifications";
  }

  const isPrefix = (prefix: string): boolean =>
    cleaned === prefix || cleaned.startsWith(prefix + "/");

  // osStore durable substrate (used to resolve workspaceRoots / identity state).
  if (
    cleaned === ".atlas/store.json" ||
    cleaned === ".atlas/store.json.bak" ||
    isPrefix(".atlas/store-backups")
  ) {
    return "writes to .atlas store state (store.json / store-backups) are governance-critical runtime state modifications";
  }

  // Offline auth substrate (used when Supabase auth is not live/usable).
  if (cleaned === ".atlas/users.json" || cleaned === ".atlas/sessions.json") {
    return "writes to .atlas users/sessions are governance-critical authorization substrate modifications";
  }

  // Runtime dependency substrate (loaded via node resolution).
  if (isPrefix("node_modules")) {
    return "writes to node_modules/** are governance-critical runtime dependency modifications";
  }

  // Direct runtime artifacts (loaded by `node dist/...` start scripts).
  if (isPrefix("apps/api/dist")) {
    return "writes to apps/api/dist/** are governance-critical runtime artifacts";
  }
  if (isPrefix("apps/control-plane/dist")) {
    return "writes to apps/control-plane/dist/** are governance-critical runtime artifacts";
  }

  // DB-level governance enforcement (SQL functions/migrations applied on redeploy).
  if (isPrefix("supabase/migrations")) {
    return "writes to supabase/migrations/** are governance-critical DB enforcement artifacts";
  }

  // Implementation source that can become runtime artifacts after rebuild.
  if (isPrefix("apps/api/src")) {
    return "writes to apps/api/src/** are governance-critical implementation artifacts";
  }
  if (isPrefix("apps/control-plane/src")) {
    return "writes to apps/control-plane/src/** are governance-critical implementation artifacts";
  }

  // packages/<pkg>/(src|dist)/...
  if (segs[0] === "packages" && segs.length >= 3) {
    const kind = segs[2];
    if (kind === "src") {
      return `writes to packages/**/src/** (e.g. packages/${segs[1]}/src/...) are governance-critical implementation artifacts`;
    }
    if (kind === "dist") {
      return `writes to packages/**/dist/** are governance-critical runtime artifacts`;
    }
  }

  return null;
}

export type AtlasSelfControlVerifyInput = {
  readonly agentId: string;
  readonly action: string;
};

export type AtlasSelfControlVerifyResult = {
  readonly verified: boolean;
  readonly reason: string;
  readonly approvalId: string | null;
  readonly approvalStatus: string | null;
};

function controlVerifyFail(
  reason: string,
  record?: ApprovalRequest,
): AtlasSelfControlVerifyResult {
  return {
    verified: false,
    reason,
    approvalId: record?.id ?? null,
    approvalStatus: record?.status ?? null,
  };
}

/**
 * Server-side binding check against the live approval row.
 * Client-supplied metadata is never authority — only the stored record is.
 */
export function evaluateStoredAtlasSelfControlApproval(
  record: ApprovalRequest | undefined,
  expected: AtlasSelfControlVerifyInput,
): AtlasSelfControlVerifyResult {
  if (!record) {
    return controlVerifyFail("approval missing");
  }
  if (record.status === "PENDING") {
    return controlVerifyFail("PENDING", record);
  }
  if (record.status === "REJECTED") {
    return controlVerifyFail("DENIED", record);
  }
  if (record.status === "REVOKED") {
    return controlVerifyFail("REVOKED", record);
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    return controlVerifyFail("EXPIRED", record);
  }
  if (record.status !== "APPROVED") {
    return controlVerifyFail(`not APPROVED (${record.status})`, record);
  }
  if (!isAtlasSelfApprovalContext(record.context)) {
    return controlVerifyFail("identity mismatch", record);
  }
  const context = record.context;
  if (context["applicationId"] !== ATLAS_SELF_APPLICATION_ID) {
    return controlVerifyFail("application mismatch", record);
  }
  if (context["projectId"] !== ATLAS_SELF_PROJECT_ID) {
    return controlVerifyFail("project mismatch", record);
  }
  if (context["tenantId"] !== ATLAS_SELF_TENANT_ID) {
    return controlVerifyFail("tenant mismatch", record);
  }
  if (record.entityType !== "CONFIGURATION" || record.action !== "UPDATE") {
    return controlVerifyFail("operation mismatch", record);
  }
  if (context["agentId"] !== expected.agentId) {
    return controlVerifyFail("target mismatch", record);
  }
  if (context["controlAction"] !== expected.action) {
    return controlVerifyFail("operation mismatch", record);
  }
  const expectedHash = atlasSelfControlArtifactHash(
    expected.agentId,
    expected.action,
  );
  if (record.artifactHash !== expectedHash) {
    return controlVerifyFail("binding mismatch", record);
  }
  if (!record.decidedBy) {
    return controlVerifyFail("identity mismatch", record);
  }
  if (record.decidedBy === record.requestedBy) {
    return controlVerifyFail("separation of duties", record);
  }
  return {
    verified: true,
    reason: "independent Atlas-self approval verified",
    approvalId: record.id,
    approvalStatus: record.status,
  };
}

export async function verifyAtlasSelfControlApproval(
  approvalId: string,
  expected: AtlasSelfControlVerifyInput,
): Promise<AtlasSelfControlVerifyResult> {
  const record = await getApprovalRequest(approvalId);
  return evaluateStoredAtlasSelfControlApproval(record, expected);
}

export async function mintAtlasSelfControlApproval(input: {
  readonly agentId: string;
  readonly action: string;
  readonly reason: string;
}): Promise<ApprovalRequest> {
  return mintAtlasSelfApproval({
    entityType: "CONFIGURATION",
    action: "UPDATE",
    requestedBy: CONTROL_PLANE_SERVICE_ID,
    reason: input.reason,
    route: "agents.control",
    artifactHash: atlasSelfControlArtifactHash(input.agentId, input.action),
    extraContext: {
      agentId: input.agentId,
      controlAction: input.action,
    },
  });
}

export async function mintAtlasSelfApproval(input: {
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  readonly requestedBy: string;
  readonly reason: string;
  readonly route: string;
  readonly artifactHash?: string;
  readonly extraContext?: Record<string, unknown>;
  readonly expiresAt?: string | null;
}): Promise<ApprovalRequest> {
  return createApprovalRequest({
    entityType: input.entityType,
    action: input.action,
    requestedBy: input.requestedBy,
    reason: input.reason,
    artifactHash: input.artifactHash ?? null,
    context: atlasSelfApprovalContext({
      route: input.route,
      ...(input.extraContext ?? {}),
    }),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  });
}

export function auditAtlasSelfDecision(input: {
  readonly type: string;
  readonly actorId: string;
  readonly routeLabel: string;
  readonly decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  readonly reason: string;
  readonly approvalId?: string | null;
  readonly approvalStatus?: string | null;
  readonly executed: boolean;
  readonly verificationVerdict?:
    | "VERIFIED"
    | "FAILED"
    | "PARTIAL"
    | "INCONCLUSIVE"
    | "BLOCKED"
    | "NOT_APPLICABLE";
  readonly extra?: Record<string, unknown>;
}): void {
  appendUnifiedAuditEntry({
    type: input.type,
    actorId: input.actorId,
    actorKind: "USER",
    reason: input.reason,
    entityType: "CONFIGURATION",
    action: "UPDATE",
    policy: "CONFIGURATION.UPDATE",
    risk: "CRITICAL",
    approval:
      input.decision === "REQUIRE_APPROVAL"
        ? "PENDING"
        : input.decision === "ALLOW"
          ? "APPROVED"
          : "REJECTED",
    approvalId: input.approvalId ?? null,
    decision: input.decision,
    result: input.executed ? "SUCCESS" : input.decision === "DENY" ? "FAILURE" : "PARTIAL",
    verificationVerdict: input.verificationVerdict ?? (input.executed ? "INCONCLUSIVE" : "NOT_APPLICABLE"),
    projectId: ATLAS_SELF_PROJECT_ID,
    input: {
      applicationId: ATLAS_SELF_APPLICATION_ID,
      tenantId: ATLAS_SELF_TENANT_ID,
      projectId: ATLAS_SELF_PROJECT_ID,
      route: input.routeLabel,
      executed: input.executed,
      verified: input.verificationVerdict === "VERIFIED",
      approvalStatus: input.approvalStatus ?? null,
      ...(input.extra ?? {}),
    },
    output: {
      applicationId: ATLAS_SELF_APPLICATION_ID,
    },
  });
}

export function respondAtlasSelfHelper<T>(
  reply: FastifyReply,
  helper: HelperResult<T>,
): unknown {
  if (helper.status === "EXECUTED") {
    if (helper.gate === undefined) {
      throw new AtlasError(
        "FORBIDDEN",
        helper.approval
          ? `Approval request ${helper.approval.id} is already finalized`
          : "approval already finalized",
        { statusCode: 403 },
      );
    }
    return helper.value;
  }
  if (helper.status === "APPROVAL_REQUIRED") {
    return reply.status(202).send({
      status: "APPROVAL_REQUIRED" as const,
      approvalId: helper.approvalRequestId,
      applicationId: ATLAS_SELF_APPLICATION_ID,
      executed: false,
      verified: false,
      message:
        "Independent live-human decision required. Submit POST …/decide-and-execute with a different authenticated identity.",
    });
  }
  const reason = "reason" in helper ? helper.reason : "governed execution failed";
  if (helper.status === "DENIED" && /not found/i.test(helper.reason)) {
    throw new AtlasError("NOT_FOUND", helper.reason, { statusCode: 404 });
  }
  if (helper.status === "OUTCOME_UNKNOWN" || helper.status === "FINALIZE_INCOMPLETE") {
    throw new AtlasError("CONFLICT", reason, { statusCode: 409 });
  }
  throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
}

export async function executeAtlasSelfLiveHuman<T>(input: {
  readonly approvalId: string;
  readonly deciderId: string;
  readonly decisionReason: string;
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  readonly artifactHash?: string;
  readonly requestId: string;
  readonly routeLabel: string;
  readonly projectId?: string | null;
  readonly dispatchInput?: Record<string, unknown>;
  readonly executeOnce: RunLiveHumanDecisionExecutionInput<T>["executeOnce"];
}): Promise<HelperResult<T>> {
  return runLiveHumanDecisionExecution({
    approvalId: input.approvalId,
    deciderId: input.deciderId,
    decisionReason: input.decisionReason,
    entityType: input.entityType,
    action: input.action,
    ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
    requestId: input.requestId,
    sourceContext: { origin: "user_message", trustLevel: "trusted" },
    routeLabel: input.routeLabel,
    projectId: input.projectId ?? ATLAS_SELF_PROJECT_ID,
    ...(input.dispatchInput !== undefined ? { dispatchInput: input.dispatchInput } : {}),
    executeOnce: input.executeOnce,
  });
}

export function atlasSelfExecutedEvidence<T>(
  value: T,
  extra: Record<string, unknown> = {},
): GovernedExecuteOnceResult<T> {
  return {
    kind: "SUCCESS",
    value,
    outputEvidence: JSON.stringify({
      applicationId: ATLAS_SELF_APPLICATION_ID,
      executed: true,
      verified: false,
      ...extra,
    }),
  };
}
