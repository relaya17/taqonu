import type { IncomingMessage } from "node:http";
import { Router, json, readJsonBody } from "./router.js";
import {
  listRegisteredAgents,
  getRegisteredAgent,
  getRegistryStats,
  setAgentRuntimeStatus,
} from "../services/agent-registry.js";
import { getFabricProjection } from "../services/fabric-projection.js";
import { getControlPlanePortfolioView } from "../services/portfolio-governance-view.js";
import {
  listAuditEntries,
  getAuditEntryCount,
  listPolicies,
  getPolicyForAction,
  listApprovalRecords,
  computeHealthMetrics,
  verifyAuditChain,
} from "../services/governance-state.js";
import {
  applicationIntegrationContract,
  getRegisteredApplication,
  listRegisteredApplications,
} from "../services/application-registry.js";
import {
  dispatchGatewayOperation,
  ingestGatewayEvent,
} from "../services/atlas-gateway.js";
import { ownerBrief, runSelfAudit } from "../services/self-audit.js";
import { buildControlSupervisionSnapshot } from "../services/supervision-snapshot.js";
import {
  buildControlOperationalFoundation,
  listSupervisedProcesses,
} from "../services/operational-foundation.js";
import {
  issueReauthTicket,
  resolveControlPlanePrincipal,
  verifyReauthTicket,
} from "../control-plane-auth.js";
import {
  hashIdempotencyBody,
  lookupIdempotency,
  storeIdempotentResponse,
} from "../services/control-plane-hardening.js";

/**
 * Control Plane API routes.
 *
 * All routes are prefixed with `/api/v1/` and return JSON.
 * The control plane is a governance surface. Reads are unrestricted to
 * authenticated operators. Writes go through the Atlas Gateway and are
 * ALLOW / DENY / REQUIRE_APPROVAL — never a silent self-mutation.
 *
 * ── Route inventory ────────────────────────────────────────────────────
 *
 * Applications:
 *   GET /api/v1/applications
 *   GET /api/v1/applications/:id
 *
 * Agent Registry (legacy oversight list — not Fabric execution):
 *   GET /api/v1/agents
 *   GET /api/v1/agents/:id
 *   GET /api/v1/agents/stats
 *   GET /api/v1/agents/fabric-projection  — FABRIC_AGENT_CATALOG projection
 *
 * Portfolio Governance (observability; writes stay on Atlas API):
 *   GET /api/v1/portfolio-governance
 *
 * Gateway:
 *   POST /api/v1/gateway/events   — application → Atlas (X-Atlas-Reason)
 *   POST /api/v1/gateway/ops      — Atlas → application (governed)
 *
 * Audit Trail (append/read/verify only — DELETE/PUT/PATCH → 405):
 *   GET /api/v1/audit
 *   GET /api/v1/audit/count
 *   GET /api/v1/audit/verify
 *
 * Self-governance:
 *   GET /api/v1/self-audit
 *   GET /api/v1/owner/brief
 *
 * Policies:
 *   GET /api/v1/policies         — all policy definitions
 *   GET /api/v1/policies/:entityType/:action — single policy lookup
 *
 * Approvals:
 *   GET /api/v1/approvals        — approval records
 *
 * Health & Cost:
 *   GET /api/v1/health           — computed health metrics
 *   GET /api/v1/status           — service liveness check
 *
 * Platform supervision (consumed by Atlas Admin — not a dashboard clone):
 *   GET /api/v1/supervision
 *   GET /api/v1/operational-foundation
 *   GET /api/v1/processes          — empty contract; not live supervision
 */

export function createApiRouter(): Router {
  const router = new Router();

  // ── Agent Registry ──────────────────────────────────────────────────

  router.get("/api/v1/agents/stats", (_req, res) => {
    json(res, getRegistryStats());
  });

  router.get("/api/v1/agents/fabric-projection", (_req, res) => {
    json(res, getFabricProjection());
  });

  router.get("/api/v1/portfolio-governance", (_req, res) => {
    json(res, getControlPlanePortfolioView());
  });

  router.get("/api/v1/agents/:id", (_req, res, params) => {
    const agentId = params["id"];
    if (!agentId) {
      json(res, { error: "Agent ID required" }, 400);
      return;
    }
    const agent = getRegisteredAgent(agentId);
    if (!agent) {
      json(res, { error: `Agent "${agentId}" not found` }, 404);
      return;
    }
    json(res, agent);
  });

  router.get("/api/v1/agents", (_req, res) => {
    json(res, listRegisteredAgents());
  });

  // ── Audit Trail ─────────────────────────────────────────────────────

  router.get("/api/v1/audit/count", (_req, res) => {
    json(res, { count: getAuditEntryCount() });
  });

  router.get("/api/v1/audit", (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const actorId = url.searchParams.get("actorId") ?? undefined;
    const type = url.searchParams.get("type") ?? undefined;
    const risk = url.searchParams.get("risk") ?? undefined;
    const result = url.searchParams.get("result") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    json(
      res,
      listAuditEntries({
        ...(actorId ? { actorId } : {}),
        ...(type ? { type } : {}),
        ...(risk ? { risk } : {}),
        ...(result ? { result } : {}),
        limit,
        offset,
      }),
    );
  });

  // ── Policies ────────────────────────────────────────────────────────

  router.get("/api/v1/policies/:entityType/:action", (_req, res, params) => {
    const entityType = params["entityType"];
    const action = params["action"];
    if (!entityType || !action) {
      json(res, { error: "entityType and action required" }, 400);
      return;
    }
    const policy = getPolicyForAction(entityType, action);
    if (!policy) {
      json(res, { error: `No policy for ${entityType}.${action}` }, 404);
      return;
    }
    json(res, policy);
  });

  router.get("/api/v1/policies", (_req, res) => {
    json(res, listPolicies());
  });

  // ── Approvals ───────────────────────────────────────────────────────

  router.get("/api/v1/approvals", (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const status = url.searchParams.get("status") ?? undefined;
    const agentId = url.searchParams.get("agentId") ?? undefined;
    json(
      res,
      listApprovalRecords({
        ...(status ? { status } : {}),
        ...(agentId ? { agentId } : {}),
      }),
    );
  });

  // ── Health & Status ─────────────────────────────────────────────────

  router.get("/api/v1/health", (_req, res) => {
    json(res, computeHealthMetrics());
  });

  router.get("/api/v1/status", (_req, res) => {
    json(res, {
      service: "atlas-control-plane",
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/api/v1/supervision", (_req, res) => {
    json(res, buildControlSupervisionSnapshot());
  });

  router.get("/api/v1/operational-foundation", (_req, res) => {
    json(res, buildControlOperationalFoundation());
  });

  router.get("/api/v1/processes", (_req, res) => {
    json(res, listSupervisedProcesses());
  });

  router.get("/api/v1/applications", (_req, res) => {
    json(res, { items: listRegisteredApplications() });
  });

  router.get("/api/v1/applications/:id", (_req, res, params) => {
    const id = params["id"];
    if (!id) {
      json(res, { error: "Application ID required" }, 400);
      return;
    }
    const app = getRegisteredApplication(id);
    if (!app) {
      json(res, { error: `Application "${id}" not found` }, 404);
      return;
    }
    json(res, { ...app, contract: applicationIntegrationContract(app) });
  });

  router.get("/api/v1/audit/verify", (_req, res) => {
    json(res, verifyAuditChain());
  });

  router.get("/api/v1/self-audit", (_req, res) => {
    json(res, runSelfAudit());
  });

  router.get("/api/v1/owner/brief", (_req, res) => {
    json(res, ownerBrief());
  });

  router.post("/api/v1/gateway/events", async (req, res) => {
    const reason = headerReason(req);
    if (!reason) {
      json(res, { error: "X-Atlas-Reason is required for gateway writes" }, 400);
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      json(
        res,
        { error: error instanceof Error ? error.message : "invalid json" },
        400,
      );
      return;
    }
    const record = body as Record<string, unknown>;
    const type = typeof record["type"] === "string" ? record["type"] : "";
    const applicationId =
      typeof record["applicationId"] === "string" ? record["applicationId"] : "";
    if (!type || !applicationId) {
      json(res, { error: "type and applicationId are required" }, 400);
      return;
    }
    const result = ingestGatewayEvent({
      type,
      applicationId,
      ...(typeof record["agentId"] === "string" ? { agentId: record["agentId"] } : {}),
      ...(record["payload"] && typeof record["payload"] === "object"
        ? { payload: record["payload"] as Record<string, unknown> }
        : {}),
    });
    json(res, { ...result, reasonHeader: reason }, result.accepted ? 202 : 400);
  });

  router.post("/api/v1/gateway/ops", async (req, res) => {
    const reason = headerReason(req);
    if (!reason) {
      json(res, { error: "X-Atlas-Reason is required for gateway writes" }, 400);
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      json(
        res,
        { error: error instanceof Error ? error.message : "invalid json" },
        400,
      );
      return;
    }
    const record = body as Record<string, unknown>;
    const idempotencyKey = headerValue(req, "x-idempotency-key");
    const bodyHash = hashIdempotencyBody(record);
    const idempotent = lookupIdempotency(idempotencyKey, bodyHash);
    if (idempotent.kind === "replay") {
      json(res, idempotent.body, idempotent.status);
      return;
    }
    if (idempotent.kind === "conflict") {
      json(res, { error: "Idempotency-Key reused with a different body" }, 409);
      return;
    }
    const operation =
      typeof record["operation"] === "string" ? record["operation"] : "";
    const applicationId =
      typeof record["applicationId"] === "string" ? record["applicationId"] : "";
    if (!operation || !applicationId) {
      json(res, { error: "operation and applicationId are required" }, 400);
      return;
    }
    const writeOps = new Set([
      "request_agent_run",
      "request_test",
      "request_verify",
      "request_remediation",
    ]);
    const reauthHeader = headerValue(req, "x-atlas-reauth");
    const needsReauth = writeOps.has(operation);
    const reauthenticated = needsReauth ? verifyReauthTicket(reauthHeader) : true;
    const principal = resolveControlPlanePrincipal();
    const boundEvidenceIds = stringArray(record["boundEvidenceIds"]);
    const conflictingClaimIds = stringArray(record["conflictingClaimIds"]);
    const evaluation = dispatchGatewayOperation({
      actorId: principal.id,
      actorKind: principal.actorKind,
      applicationId,
      operation,
      reason,
      requiresReauth: needsReauth,
      reauthenticated,
      ...(typeof record["agentId"] === "string" ? { agentId: record["agentId"] } : {}),
      ...(record["approved"] === true ? { approved: true } : {}),
      ...(record["verificationPlanPresent"] === true
        ? { verificationPlanPresent: true }
        : {}),
      ...(typeof record["delegationHopCount"] === "number"
        ? { delegationHopCount: record["delegationHopCount"] }
        : {}),
      ...(record["evidenceConflicting"] === true ? { evidenceConflicting: true } : {}),
      ...(typeof record["evidenceCount"] === "number"
        ? { evidenceCount: record["evidenceCount"] }
        : {}),
      ...(boundEvidenceIds ? { boundEvidenceIds } : {}),
      ...(conflictingClaimIds ? { conflictingClaimIds } : {}),
    });
    const status =
      evaluation.decision === "DENY"
        ? 403
        : evaluation.decision === "REQUIRE_APPROVAL"
          ? 202
          : 200;
    storeIdempotentResponse(idempotencyKey, bodyHash, status, evaluation);
    json(res, evaluation, status);
  });

  router.post("/api/v1/auth/reauth", (_req, res) => {
    json(res, issueReauthTicket());
  });

  router.post("/api/v1/agents/:id/control", async (req, res, params) => {
    const reason = headerReason(req);
    if (!reason) {
      json(res, { error: "X-Atlas-Reason is required" }, 400);
      return;
    }
    if (!verifyReauthTicket(headerValue(req, "x-atlas-reauth"))) {
      json(res, { error: "Recent re-authentication required" }, 401);
      return;
    }
    const id = params["id"];
    if (!id) {
      json(res, { error: "Agent ID required" }, 400);
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      json(
        res,
        { error: error instanceof Error ? error.message : "invalid json" },
        400,
      );
      return;
    }
    const rawAction = (body as Record<string, unknown>)["action"];
    const action = typeof rawAction === "string" ? rawAction : "";
    const statusMap: Record<string, "PAUSED" | "ACTIVE" | "DISABLED" | "QUARANTINED" | "REVOKED"> = {
      pause: "PAUSED",
      resume: "ACTIVE",
      disable: "DISABLED",
      quarantine: "QUARANTINED",
      revoke: "REVOKED",
    };
    const next = statusMap[action];
    if (!next) {
      json(res, { error: "action must be pause|resume|disable|quarantine|revoke" }, 400);
      return;
    }
    const agent = setAgentRuntimeStatus(id, next);
    if (!agent) {
      json(res, { error: `Agent "${id}" not found` }, 404);
      return;
    }
    json(res, { agent, reason });
  });

  return router;
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return items.length > 0 ? items : undefined;
}

function headerValue(
  req: { headers: IncomingMessage["headers"] },
  name: string,
): string | null {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

function headerReason(req: { headers: IncomingMessage["headers"] }): string | null {
  const value = headerValue(req, "x-atlas-reason");
  if (!value) return null;
  const reason = value.trim();
  return reason.length >= 8 ? reason : null;
}
