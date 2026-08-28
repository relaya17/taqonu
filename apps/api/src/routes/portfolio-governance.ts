import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  applyGovernanceDecision,
  buildPortfolioSummary,
  portfolioGovernanceDecisionRequestSchema,
  requiresOwnerAndCatalogChange,
} from "@atlas/shared";
import { requireOperator, requireOwner } from "../middleware/auth-guards.js";
import { appendUnifiedAuditEntry } from "../services/audit-log.js";
import {
  getPortfolioSnapshot,
  loadPortfolioOverlay,
  savePortfolioOverlay,
} from "../services/portfolio-governance-store.js";

/**
 * Portfolio Governance — observability and owner decisions only.
 *
 * Does not: ingest knowledge, probe/start sibling apps, mutate FABRIC_AGENT_CATALOG,
 * inherit source WRITE/secrets, or create Atlas specialists.
 */
export async function registerPortfolioGovernanceRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/portfolio-governance", async (request) => {
    await requireOperator(app, request);
    const snapshot = getPortfolioSnapshot();
    return {
      snapshot,
      summary: buildPortfolioSummary(snapshot),
      notAnAgentRegistry: true,
      observational: true,
      governance: {
        executionRegistry: "FABRIC_AGENT_CATALOG",
        controlPlaneAgentDefinitionsAreNotExecution: true,
        knowledgeIngested: false,
        fabricCatalogMutated: false,
        ingestEnabled: false,
        sourceExecutionEnabled: false,
        sourceRuntimeDefault: "UNKNOWN",
      },
    };
  });

  app.post("/api/v1/portfolio-governance/decisions", async (request) => {
    const user = await requireOwner(app, request);
    const body = portfolioGovernanceDecisionRequestSchema.parse(request.body ?? {});

    if (
      body.verdict === "APPROVED" &&
      requiresOwnerAndCatalogChange(body.action) &&
      user.role !== "owner"
    ) {
      throw new AtlasError(
        "FORBIDDEN",
        "CREATE_NEW_ATLAS_SPECIALIST and ADAPT_INTO_EXISTING_ATLAS_CAPABILITY require Owner approval and a separate Fabric catalog code change",
        { statusCode: 403 },
      );
    }

    const overlay = loadPortfolioOverlay();
    const snapshot = getPortfolioSnapshot();
    let result: ReturnType<typeof applyGovernanceDecision>;
    try {
      result = applyGovernanceDecision({
        snapshot,
        overlay,
        action: body.action,
        verdict: body.verdict,
        rationale: body.rationale,
        actorId: user.id,
        applicationId: body.applicationId ?? null,
        sourceAgentId: body.sourceAgentId ?? null,
        capabilityId: body.capabilityId ?? null,
      });
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid governance decision",
        { statusCode: 400 },
      );
    }

    savePortfolioOverlay(result.overlay);

    appendUnifiedAuditEntry({
      type: "portfolio.governance.decided",
      actorId: user.id,
      actorKind: "USER",
      reason: body.rationale,
      intent: "Record portfolio governance decision without ingest or catalog mutation",
      entityType: "PORTFOLIO_GOVERNANCE",
      action: body.action,
      risk: requiresOwnerAndCatalogChange(body.action) ? "HIGH" : "MEDIUM",
      approval: body.verdict === "APPROVED" ? "APPROVED" : "REJECTED",
      result: "SUCCESS",
      decision: body.verdict === "DENIED" ? "DENY" : "ALLOW",
      input: {
        action: body.action,
        verdict: body.verdict,
        applicationId: body.applicationId ?? null,
        sourceAgentId: body.sourceAgentId ?? null,
        capabilityId: body.capabilityId ?? null,
      },
      output: {
        decisionId: result.decision.id,
        status: result.decision.status,
        fabricCatalogMutated: false,
        knowledgeIngested: false,
        ingestExecuted: false,
        catalogCodeChangeRequired: result.decision.status === "APPROVED_PENDING_FABRIC_CHANGE",
      },
    });

    const next = getPortfolioSnapshot();
    return {
      decision: result.decision,
      summary: buildPortfolioSummary(next),
      governance: {
        executionRegistry: "FABRIC_AGENT_CATALOG",
        fabricCatalogMutated: false,
        knowledgeIngested: false,
        ingestExecuted: false,
      },
    };
  });
}
