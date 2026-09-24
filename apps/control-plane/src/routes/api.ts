import type { IncomingMessage, ServerResponse } from "node:http";
import { Router, json, readJsonBody, readRawBody } from "./router.js";
import {
  listRegisteredAgents,
  getRegisteredAgent,
  getRegistryStats,
} from "../services/agent-registry.js";
import {
  applyAtlasSelfAgentControl,
  isAgentControlAction,
  mintAtlasSelfControlApprovalViaApi,
  verifyIndependentAtlasSelfControlApproval,
} from "../services/atlas-self-agent-control.js";
import { getFabricProjection } from "../services/fabric-projection.js";
import {
  getControlAgentProfile,
  listControlAgentProfiles,
  unprovenCaseflowAgent,
} from "../services/agent-identity-profile.js";
import {
  createDraftRelease,
  draftReleaseInputSchema,
  entitlementInputSchema,
  evaluateEntitlementAccess,
  getMarketplaceListing,
  getMarketplaceRelease,
  inspectMarketplaceEligibility,
  issueEntitlement,
  listMarketplaceEntitlements,
  listMarketplaceListings,
  listMarketplaceReleases,
  marketplaceEvidenceForListing,
  mutatePublishedRelease,
  publicationInputSchema,
  publishRelease,
  registerProvider,
  registerPublisher,
  requestListingPublication,
  revokeEntitlement,
  unpublishListing,
} from "../services/professional-agent-marketplace.js";
import { isControlAgentIdentitySource } from "@atlas/shared";
import { getControlPlanePortfolioView } from "../services/portfolio-governance-view.js";
import {
  listAuditEntries,
  getAuditEntryCount,
  listPolicies,
  getPolicyForAction,
  computeHealthMetrics,
  appendAuditEntry,
} from "../services/governance-state.js";
import {
  fetchCanonicalApprovals,
  decideCanonicalApproval,
} from "../services/approval-control.js";
import {
  applicationIntegrationContract,
  decideApplicationTrust,
  getRegisteredApplication,
  listRegisteredApplications,
} from "../services/application-registry.js";
import {
  dispatchGatewayOperation,
  ingestGatewayEvent,
} from "../services/atlas-gateway.js";
import { ownerBrief, runSelfAudit } from "../services/self-audit.js";
import {
  fetchKillSwitchStatus,
  setKillSwitchOverride,
} from "../services/kill-switch-control.js";
import { fetchCanonicalAuditVerification } from "../services/audit-verify-control.js";
import { fetchCanonicalExecutions } from "../services/execution-control.js";
import { fetchErrorAggregates } from "../services/error-aggregate-control.js";
import { buildControlSupervisionSnapshot } from "../services/supervision-snapshot.js";
import {
  buildControlOperationalFoundation,
  listSupervisedProcesses,
} from "../services/operational-foundation.js";
import {
  buildCivioConnectorContract,
  headerString,
  ingestCivioConnectorEvent,
} from "../services/civio-connector.js";
import { listSupervisedGovernanceDecisions } from "../services/supervised-governance.js";
import {
  CIVIO_NONCE_HEADER,
  CIVIO_SIGNATURE_HEADER,
  CIVIO_TIMESTAMP_HEADER,
} from "@atlas/shared";
import {
  issueReauthTicket,
  requireOwnerRole,
  resolveControlPlanePrincipal,
  verifyReauthTicket,
} from "../control-plane-auth.js";
import {
  hashIdempotencyBody,
  lookupIdempotency,
  resolveRequestId,
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
 *   POST /api/v1/applications/:id/decide  — approve/reject pending registration
 *
 * Live execution:
 *   GET /api/v1/executions
 *
 * Agent Registry (legacy oversight list — not Fabric execution):
 *   GET /api/v1/agents
 *   GET /api/v1/agents/:id
 *   GET /api/v1/agents/stats
 *   GET /api/v1/agents/fabric-projection  — FABRIC_AGENT_CATALOG projection
 *   GET /api/v1/agent-profiles           — governance identity; not execution
 *   GET /api/v1/agent-profiles/:source/:id
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
 *   GET /api/v1/processes          — supervised processes (application-scoped)
 *   GET /api/v1/governance/decisions — Event → Policy → Risk → Decision (no execute)
 *   GET /api/v1/connectors/civio   — Civio connector contract (operator)
 *   POST /api/v1/connectors/civio/events — HMAC Civio ingress
 */

async function readMarketplaceBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | undefined> {
  try {
    return await readJsonBody(req);
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "invalid json" }, 400);
    return undefined;
  }
}

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

  router.get("/api/v1/agent-profiles", (_req, res) => {
    json(res, {
      executionAuthorityGrantedByProfile: false,
      portfolioIsRuntime: false,
      caseflow: unprovenCaseflowAgent(),
      items: listControlAgentProfiles(),
    });
  });

  router.get("/api/v1/agent-profiles/:source/:id", (_req, res, params) => {
    const source = params["source"];
    const agentId = params["id"];
    if (!source || !agentId) {
      json(res, { error: "identity source and agent id required" }, 400);
      return;
    }
    if (!isControlAgentIdentitySource(source)) {
      json(res, { error: "unknown identity source" }, 400);
      return;
    }
    const profile = getControlAgentProfile(source, agentId);
    if (!profile) {
      json(res, { error: "agent profile not found" }, 404);
      return;
    }
    json(res, profile);
  });

  router.get("/api/v1/marketplace/eligibility", (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const source = url.searchParams.get("source");
    const agentId = url.searchParams.get("agentId");
    if (!source || !agentId || !isControlAgentIdentitySource(source)) {
      json(res, { error: "source and agentId required" }, 400);
      return;
    }
    json(res, inspectMarketplaceEligibility({
      agentId,
      identitySource: source,
      releaseId: url.searchParams.get("releaseId"),
      publisherId: url.searchParams.get("publisherId"),
    }));
  });

  router.get("/api/v1/marketplace/releases", (_req, res) => {
    json(res, listMarketplaceReleases());
  });

  router.get("/api/v1/marketplace/releases/:id", (_req, res, params) => {
    const release = params["id"] ? getMarketplaceRelease(params["id"]) : null;
    if (!release) {
      json(res, { error: "release not found" }, 404);
      return;
    }
    json(res, release);
  });

  router.post("/api/v1/marketplace/publishers", (_req, res) => {
    json(res, registerPublisher(), 201);
  });

  router.post("/api/v1/marketplace/providers", (_req, res) => {
    json(res, registerProvider(), 201);
  });

  router.post("/api/v1/marketplace/releases", async (req, res) => {
    const body = await readMarketplaceBody(req, res);
    if (body === undefined) return;
    const parsed = draftReleaseInputSchema.safeParse(body);
    if (!parsed.success) {
      json(res, { error: "invalid release" }, 400);
      return;
    }
    const created = createDraftRelease(parsed.data);
    json(res, created, created.ok ? 201 : 400);
  });

  router.post("/api/v1/marketplace/releases/:id/publish", (_req, res, params) => {
    const id = params["id"];
    if (!id) {
      json(res, { error: "release id required" }, 400);
      return;
    }
    const published = publishRelease(id);
    json(res, published, published.ok ? 200 : 400);
  });

  router.post("/api/v1/marketplace/releases/:id/mutate", async (req, res, params) => {
    const id = params["id"];
    const body = await readMarketplaceBody(req, res);
    if (!id || body === undefined) return;
    if (typeof body !== "object" || body === null || !("versionLabel" in body) || typeof body.versionLabel !== "string") {
      json(res, { error: "versionLabel required" }, 400);
      return;
    }
    const mutated = mutatePublishedRelease(id, body.versionLabel);
    json(res, mutated, mutated.ok ? 200 : 409);
  });

  router.get("/api/v1/marketplace/listings", (_req, res) => {
    json(res, listMarketplaceListings());
  });

  router.get("/api/v1/marketplace/listings/:id", (_req, res, params) => {
    const listing = params["id"] ? getMarketplaceListing(params["id"]) : null;
    if (!listing) {
      json(res, { error: "listing not found" }, 404);
      return;
    }
    json(res, listing);
  });

  router.get("/api/v1/marketplace/listings/:id/evidence", (_req, res, params) => {
    const evidence = params["id"] ? marketplaceEvidenceForListing(params["id"]) : null;
    if (!evidence) {
      json(res, { error: "listing not found" }, 404);
      return;
    }
    json(res, evidence);
  });

  router.post("/api/v1/marketplace/listings/publish", async (req, res) => {
    const body = await readMarketplaceBody(req, res);
    if (body === undefined) return;
    const parsed = publicationInputSchema.safeParse(body);
    if (!parsed.success) {
      json(res, { error: "invalid publication" }, 400);
      return;
    }
    const published = requestListingPublication(parsed.data);
    json(res, published, published.ok ? 201 : 403);
  });

  router.post("/api/v1/marketplace/listings/:id/unpublish", async (req, res, params) => {
    const id = params["id"];
    const body = await readMarketplaceBody(req, res);
    if (!id || body === undefined) return;
    if (typeof body !== "object" || body === null || !("actorId" in body) || typeof body.actorId !== "string") {
      json(res, { error: "actorId required" }, 400);
      return;
    }
    const updated = unpublishListing({ listingId: id, actorId: body.actorId });
    json(res, updated, updated.ok ? 200 : 403);
  });

  router.get("/api/v1/marketplace/entitlements", (_req, res) => {
    json(res, listMarketplaceEntitlements());
  });

  router.post("/api/v1/marketplace/entitlements", async (req, res) => {
    const body = await readMarketplaceBody(req, res);
    if (body === undefined) return;
    const parsed = entitlementInputSchema.safeParse(body);
    if (!parsed.success) {
      json(res, { error: "invalid entitlement" }, 400);
      return;
    }
    const issued = issueEntitlement(parsed.data);
    json(res, issued, issued.ok ? 201 : 400);
  });

  router.post("/api/v1/marketplace/entitlements/:id/revoke", async (req, res, params) => {
    const id = params["id"];
    const body = await readMarketplaceBody(req, res);
    if (!id || body === undefined) return;
    if (
      typeof body !== "object" ||
      body === null ||
      !("actorId" in body) ||
      typeof body.actorId !== "string" ||
      !("actorRole" in body) ||
      (body.actorRole !== "ISSUER" && body.actorRole !== "HOLDER" && body.actorRole !== "CONTROL" && body.actorRole !== "PUBLISHER")
    ) {
      json(res, { error: "actorId and actorRole required" }, 400);
      return;
    }
    const revoked = revokeEntitlement({
      entitlementId: id,
      actorId: body.actorId,
      actorRole: body.actorRole,
    });
    json(res, revoked, revoked.ok ? 200 : 403);
  });

  router.post("/api/v1/marketplace/access-evaluation", async (req, res) => {
    const body = await readMarketplaceBody(req, res);
    if (body === undefined) return;
    if (
      typeof body !== "object" ||
      body === null ||
      !("entitlementId" in body) ||
      typeof body.entitlementId !== "string" ||
      !("policyAllows" in body) ||
      typeof body.policyAllows !== "boolean" ||
      !("riskAllows" in body) ||
      typeof body.riskAllows !== "boolean" ||
      !("approvalSatisfied" in body) ||
      typeof body.approvalSatisfied !== "boolean" ||
      !("preflightCleared" in body) ||
      typeof body.preflightCleared !== "boolean" ||
      !("killSwitchActive" in body) ||
      typeof body.killSwitchActive !== "boolean"
    ) {
      json(res, { error: "invalid access evaluation" }, 400);
      return;
    }
    json(res, evaluateEntitlementAccess({
      entitlementId: body.entitlementId,
      policyAllows: body.policyAllows,
      riskAllows: body.riskAllows,
      approvalSatisfied: body.approvalSatisfied,
      preflightCleared: body.preflightCleared,
      killSwitchActive: body.killSwitchActive,
    }));
  });

  // ── Audit Trail ─────────────────────────────────────────────────────

  router.get("/api/v1/audit/count", (_req, res) => {
    json(res, { count: getAuditEntryCount() });
  });

  router.get("/api/v1/audit", (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const actorId = url.searchParams.get("actorId") ?? undefined;
    const ownerId = url.searchParams.get("ownerId") ?? undefined;
    const type = url.searchParams.get("type") ?? undefined;
    const risk = url.searchParams.get("risk") ?? undefined;
    const result = url.searchParams.get("result") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    json(
      res,
      listAuditEntries({
        ...(actorId ? { actorId } : {}),
        ...(ownerId ? { ownerId } : {}),
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
  // Canonical store is apps/api's live approval repository. This route
  // projects that store through the existing CP → API SERVICE hop rather
  // than returning the unused in-memory `addApprovalRecord` list.

  router.get("/api/v1/approvals", async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const status = url.searchParams.get("status") ?? undefined;
    const agentId = url.searchParams.get("agentId") ?? undefined;
    const result = await fetchCanonicalApprovals({
      ...(status ? { status } : {}),
      ...(agentId ? { agentId } : {}),
    });
    if (!result.ok) {
      json(res, { error: result.reason }, result.httpStatus);
      return;
    }
    json(res, result.data);
  });

  router.post("/api/v1/approvals/:id/decide", async (req, res, params) => {
    const reason = headerReason(req);
    if (!reason) {
      json(res, { error: "X-Atlas-Reason is required (minimum 8 characters)" }, 400);
      return;
    }
    const id = params["id"];
    if (!id) {
      json(res, { error: "approval id is required" }, 400);
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
    if (typeof record["approve"] !== "boolean") {
      json(res, { error: "approve must be a boolean" }, 400);
      return;
    }
    const principal = resolveControlPlanePrincipal(req);
    const result = await decideCanonicalApproval({
      id,
      approve: record["approve"],
      decidedBy: principal.id,
      reason,
    });
    if (!result.ok) {
      json(res, { error: result.reason }, result.httpStatus);
      return;
    }
    json(res, result.data);
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

  router.get("/api/v1/governance/decisions", (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const applicationId = url.searchParams.get("applicationId") ?? undefined;
    const tenantId = url.searchParams.get("tenantId") ?? undefined;
    const processId = url.searchParams.get("processId") ?? undefined;
    const eventId = url.searchParams.get("eventId") ?? undefined;
    json(
      res,
      {
        items: listSupervisedGovernanceDecisions({
          ...(applicationId ? { applicationId } : {}),
          ...(tenantId ? { tenantId } : {}),
          ...(processId ? { processId } : {}),
          ...(eventId ? { eventId } : {}),
        }),
      },
    );
  });

  router.get("/api/v1/connectors/civio", (_req, res) => {
    json(res, buildCivioConnectorContract());
  });

  router.post("/api/v1/connectors/civio/events", async (req, res) => {
    let rawBody: string;
    try {
      rawBody = await readRawBody(req);
    } catch (error) {
      json(
        res,
        {
          accepted: false,
          disposition: "REJECTED",
          reason: error instanceof Error ? error.message : "invalid body",
          execution: "NOT_IMPLEMENTED",
        },
        400,
      );
      return;
    }
    const result = await ingestCivioConnectorEvent({
      rawBody,
      timestamp: headerString(req.headers, CIVIO_TIMESTAMP_HEADER),
      nonce: headerString(req.headers, CIVIO_NONCE_HEADER),
      signature: headerString(req.headers, CIVIO_SIGNATURE_HEADER),
    });
    json(res, result.body, result.status);
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

  router.post("/api/v1/applications/:id/decide", async (req, res, params) => {
    const reason = headerReason(req);
    if (!reason) {
      json(res, { error: "X-Atlas-Reason is required (minimum 8 characters)" }, 400);
      return;
    }
    const id = params["id"];
    if (!id) {
      json(res, { error: "Application ID required" }, 400);
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
    if (typeof record["approve"] !== "boolean") {
      json(res, { error: "approve must be a boolean" }, 400);
      return;
    }
    const principal = resolveControlPlanePrincipal(req);
    const result = decideApplicationTrust({
      applicationId: id,
      approve: record["approve"],
      decidedBy: principal.id,
      reason,
    });
    if (!result.ok) {
      json(res, { error: result.reason }, result.status);
      return;
    }
    const seq = Date.now();
    appendAuditEntry({
      seq,
      timestamp: new Date().toISOString(),
      type: record["approve"] ? "application.approved" : "application.rejected",
      actorId: principal.id,
      actorKind: "USER",
      reason,
      policy: "application.registration",
      risk: "MEDIUM",
      approval: record["approve"] ? "APPROVED" : "REJECTED",
      result: "SUCCESS",
      ownerId: principal.id,
      projectId: null,
      hash: `app-trust-${seq}`,
      prevHash: "000",
    });
    json(res, result.application);
  });

  router.get("/api/v1/executions", async (_req, res) => {
    const result = await fetchCanonicalExecutions();
    if (!result.ok) {
      json(res, { error: result.reason }, result.httpStatus);
      return;
    }
    json(res, result.data);
  });

  router.get("/api/v1/error-aggregates", async (_req, res) => {
    const result = await fetchErrorAggregates();
    if (!result.ok) {
      json(res, { error: result.reason }, result.httpStatus);
      return;
    }
    json(res, result.data);
  });

  router.get("/api/v1/audit/verify", async (_req, res) => {
    const result = await fetchCanonicalAuditVerification();
    if (!result.ok) {
      json(res, { error: result.reason }, result.httpStatus);
      return;
    }
    json(res, result.data);
  });

  router.get("/api/v1/self-audit", (_req, res) => {
    json(res, runSelfAudit());
  });

  router.get("/api/v1/owner/brief", (req, res) => {
    if (!requireOwnerRole(req, res)) return;
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
    const payload =
      record["payload"] && typeof record["payload"] === "object"
        ? (record["payload"] as Record<string, unknown>)
        : undefined;
    const result = ingestGatewayEvent({
      type,
      applicationId,
      ...(typeof record["agentId"] === "string"
        ? { agentId: record["agentId"] }
        : typeof payload?.["agentId"] === "string"
          ? { agentId: payload["agentId"] }
          : {}),
      ...(typeof record["occurredAt"] === "string"
        ? { occurredAt: record["occurredAt"] }
        : typeof payload?.["occurredAt"] === "string"
          ? { occurredAt: payload["occurredAt"] }
          : {}),
      ...(typeof record["riskLevel"] === "string"
        ? { riskLevel: record["riskLevel"] }
        : typeof payload?.["riskLevel"] === "string"
          ? { riskLevel: payload["riskLevel"] }
          : {}),
      ...(payload ? { payload } : {}),
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
    const principal = resolveControlPlanePrincipal(req);
    const boundEvidenceIds = stringArray(record["boundEvidenceIds"]);
    const conflictingClaimIds = stringArray(record["conflictingClaimIds"]);
    const evaluation = await dispatchGatewayOperation({
      actorId: principal.id,
      actorKind: principal.actorKind,
      applicationId,
      operation,
      reason,
      requiresReauth: needsReauth,
      reauthenticated,
      requestId: resolveRequestId(req),
      ...(typeof record["agentId"] === "string" ? { agentId: record["agentId"] } : {}),
      ...(record["approved"] === true && applicationId !== "def-000"
        ? { approved: true }
        : {}),
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
    const record = body as Record<string, unknown>;
    const rawAction = record["action"];
    const action = typeof rawAction === "string" ? rawAction : "";
    if (!isAgentControlAction(action)) {
      json(res, { error: "action must be pause|resume|disable|quarantine|revoke|retire" }, 400);
      return;
    }
    const principal = resolveControlPlanePrincipal(req);
    const presentedApprovalId =
      typeof record["approvalId"] === "string" ? record["approvalId"].trim() : "";
    const independentlyVerified =
      presentedApprovalId.length > 0 &&
      (await verifyIndependentAtlasSelfControlApproval({
        approvalId: presentedApprovalId,
        agentId: id,
        action,
      }));
    let mintedApprovalId: string | null = null;
    if (!presentedApprovalId) {
      mintedApprovalId = await mintAtlasSelfControlApprovalViaApi({
        agentId: id,
        action,
      });
    }
    const approvalId = presentedApprovalId || mintedApprovalId || "";
    const result = await applyAtlasSelfAgentControl({
      actorId: principal.id,
      agentId: id,
      action,
      reason,
      reauthenticated: true,
      independentApprovalVerified: independentlyVerified,
      ...(approvalId ? { approvalId } : {}),
    });
    if (!result.agent && result.decision === "DENY" && /not found/i.test(result.reason)) {
      json(res, { error: result.reason, applicationId: result.applicationId }, 404);
      return;
    }
    const status =
      result.decision === "DENY" ? 403 : result.decision === "REQUIRE_APPROVAL" ? 202 : 200;
    json(
      res,
      {
        ...result,
        ...(approvalId ? { approvalId } : {}),
        reasonHeader: reason,
      },
      status,
    );
  });

  // ── Task 7: Runtime Kill Switch Control ────────────────────────────
  //
  // Control never reads/writes `osStore` directly and never decides
  // authorization -- every call here is a real HTTP round-trip to
  // apps/api's `KILL_SWITCH_CONTROL_PATH` route (Control-Plane-service
  // bearer, the same boundary as `/api/v1/agents/:id/control` and durable
  // agent runtime controls). A failed API call is surfaced as a failure
  // here, never rewritten into a synthetic success -- the dashboard must
  // never claim success on its own if apps/api did not confirm it.

  router.get("/api/v1/kill-switches", async (_req, res) => {
    const result = await fetchKillSwitchStatus();
    if (!result.ok) {
      json(res, { error: result.reason }, result.httpStatus);
      return;
    }
    json(res, result.data);
  });

  router.post("/api/v1/kill-switches/:category", async (req, res, params) => {
    const category = params["category"];
    if (!category) {
      json(res, { error: "category is required" }, 400);
      return;
    }
    const reason = headerReason(req);
    if (!reason) {
      json(res, { error: "X-Atlas-Reason is required (minimum 8 characters)" }, 400);
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
    const rawAction = record["action"];
    const action = rawAction === "activate" || rawAction === "deactivate" ? rawAction : null;
    if (!action) {
      json(res, { error: "action must be activate|deactivate" }, 400);
      return;
    }
    const principal = resolveControlPlanePrincipal(req);
    const result = await setKillSwitchOverride({
      category,
      action,
      setBy: principal.id,
      reason,
    });
    if (!result.ok) {
      json(res, { error: result.reason }, result.httpStatus);
      return;
    }
    json(res, result.data);
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
