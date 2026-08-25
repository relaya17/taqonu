import { Router, json } from "./router.js";
import {
  listRegisteredAgents,
  getRegisteredAgent,
  getRegistryStats,
} from "../services/agent-registry.js";
import {
  listAuditEntries,
  getAuditEntryCount,
  listPolicies,
  getPolicyForAction,
  listApprovalRecords,
  computeHealthMetrics,
} from "../services/governance-state.js";

/**
 * Control Plane API routes.
 *
 * All routes are prefixed with `/api/v1/` and return JSON.
 * The control plane is a READ-ONLY surface — no mutation endpoints.
 *
 * ── Route inventory ────────────────────────────────────────────────────
 *
 * Agent Registry:
 *   GET /api/v1/agents           — list all registered agents
 *   GET /api/v1/agents/:id       — single agent detail + capabilities
 *   GET /api/v1/agents/stats     — registry summary stats
 *
 * Audit Trail:
 *   GET /api/v1/audit            — paginated audit entries (newest first)
 *   GET /api/v1/audit/count      — total entry count
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
 */

export function createApiRouter(): Router {
  const router = new Router();

  // ── Agent Registry ──────────────────────────────────────────────────

  router.get("/api/v1/agents/stats", (_req, res) => {
    json(res, getRegistryStats());
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
      listAuditEntries({ actorId, type, risk, result, limit, offset }),
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
    json(res, listApprovalRecords({ status, agentId }));
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

  return router;
}
