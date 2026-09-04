/**
 * Stage 19 — Intelligence Roadmap Routes.
 *
 * Exposes hypothesis engine, golden projects, and agent marketplace.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, requireAdmin } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";
import {
  createHypothesis,
  listHypotheses,
  updateHypothesisStatus,
  addSupportingEvidence,
  addContradictingEvidence,
  hypothesisStatusSchema,
} from "../services/hypothesis-engine.js";
import {
  listGoldenProjects,
  registerGoldenProject,
  updateGoldenProjectStatus,
  updateGoldenProjectScores,
  findExemplarsForDomain,
  getGoldenRoot,
  goldenProjectStatusSchema,
} from "../services/golden-projects.js";
import {
  getAgentMarketplace,
  recommendAgentsForTask,
  compareAgents,
} from "../services/agent-marketplace.js";
import {
  computeAgentReputation,
  computeExpertBattleMetrics,
  computeAgentRankings,
} from "../services/agent-reputation.js";
import {
  recommendFromVerificationHistory,
  scoreHistoricalOutcomes,
} from "../services/verification-learning.js";
import { listUnifiedAuditEntries } from "../services/audit-log.js";
import { FABRIC_AGENT_IDS, type FabricAgentId, type AgentMode, AGENT_MODES } from "@atlas/shared";

const hypothesisCreateSchema = z.object({
  projectId: z.string().uuid().nullish(),
  statement: z.string().min(10).max(1000),
  domain: z.enum([
    "PERFORMANCE",
    "RELIABILITY",
    "SECURITY",
    "CORRECTNESS",
    "ARCHITECTURE",
    "INTEGRATION",
  ]),
  verificationCriteria: z.array(z.string()).min(1),
  tags: z.array(z.string()).optional(),
  parentId: z.string().uuid().nullish(),
});

const goldenProjectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  rootPath: z.string(),
  goldenReason: z.string().min(10).max(1000),
  domains: z.array(z.enum([
    "API_DESIGN",
    "DATABASE_SCHEMA",
    "SECURITY",
    "TESTING",
    "DOCUMENTATION",
    "PERFORMANCE",
    "ARCHITECTURE",
    "ERROR_HANDLING",
  ])).min(1),
});

export async function registerIntelligenceRoutes(app: FastifyInstance): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────────
  // Hypothesis Engine
  // ─────────────────────────────────────────────────────────────────────────────

  app.get("/api/v1/intelligence/hypotheses", async (request) => {
    const query = request.query as { projectId?: string; status?: string; domain?: string };
    const filter: Parameters<typeof listHypotheses>[0] = {};
    if (query.projectId) filter.projectId = query.projectId;
    if (query.status) filter.status = query.status as typeof filter.status;
    if (query.domain) filter.domain = query.domain as typeof filter.domain;
    return listHypotheses(filter);
  });

  app.post("/api/v1/intelligence/hypotheses", async (request, reply) => {
    const user = await requireUser(app, request);
    const body = hypothesisCreateSchema.parse(request.body);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "intelligence.hypotheses.create",
      actorId: user.id,
      input: { statement: body.statement, domain: body.domain },
    });
    const hypothesis = createHypothesis({
      projectId: body.projectId ?? null,
      statement: body.statement,
      domain: body.domain,
      verificationCriteria: body.verificationCriteria,
      tags: body.tags ?? [],
      parentId: body.parentId ?? null,
      createdBy: user.id,
    });
    return reply.status(201).send(hypothesis);
  });

  app.patch("/api/v1/intelligence/hypotheses/:id/status", async (request, reply) => {
    const user = await requireUser(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { status } = z.object({ status: hypothesisStatusSchema }).parse(request.body);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "UPDATE",
      routeLabel: "intelligence.hypotheses.updateStatus",
      actorId: user.id,
      input: { hypothesisId: id, status },
    });
    const updated = updateHypothesisStatus(id, status);
    if (!updated) {
      return reply.status(404).send({ error: "Hypothesis not found" });
    }
    return updated;
  });

  app.post("/api/v1/intelligence/hypotheses/:id/evidence/supporting", async (request, reply) => {
    const user = await requireUser(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.body);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "UPDATE",
      routeLabel: "intelligence.hypotheses.addSupportingEvidence",
      actorId: user.id,
      input: { hypothesisId: id, evidenceId },
    });
    const updated = addSupportingEvidence(id, evidenceId);
    if (!updated) {
      return reply.status(404).send({ error: "Hypothesis not found" });
    }
    return updated;
  });

  app.post("/api/v1/intelligence/hypotheses/:id/evidence/contradicting", async (request, reply) => {
    const user = await requireUser(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.body);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "UPDATE",
      routeLabel: "intelligence.hypotheses.addContradictingEvidence",
      actorId: user.id,
      input: { hypothesisId: id, evidenceId },
    });
    const updated = addContradictingEvidence(id, evidenceId);
    if (!updated) {
      return reply.status(404).send({ error: "Hypothesis not found" });
    }
    return updated;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Golden Projects
  // ─────────────────────────────────────────────────────────────────────────────

  app.get("/api/v1/intelligence/golden-projects", async (request) => {
    const query = request.query as { status?: string; domain?: string };
    const filter: Parameters<typeof listGoldenProjects>[0] = {};
    if (query.status) filter.status = query.status as typeof filter.status;
    if (query.domain) filter.domain = query.domain as typeof filter.domain;
    return listGoldenProjects(filter);
  });

  app.post("/api/v1/intelligence/golden-projects", async (request, reply) => {
    const user = await requireAdmin(app, request);
    const body = goldenProjectCreateSchema.parse(request.body);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "CREATE",
      routeLabel: "intelligence.goldenProjects.register",
      actorId: user.id,
      input: { name: body.name, domains: body.domains },
    });
    const project = registerGoldenProject({
      name: body.name,
      description: body.description ?? "",
      rootPath: body.rootPath,
      goldenReason: body.goldenReason,
      domains: body.domains,
    });
    return reply.status(201).send(project);
  });

  app.patch("/api/v1/intelligence/golden-projects/:id/status", async (request, reply) => {
    const user = await requireAdmin(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { status } = z.object({ status: goldenProjectStatusSchema }).parse(request.body);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      routeLabel: "intelligence.goldenProjects.updateStatus",
      actorId: user.id,
      input: { goldenProjectId: id, status },
    });
    const updated = updateGoldenProjectStatus(id, status);
    if (!updated) {
      return reply.status(404).send({ error: "Golden project not found" });
    }
    return updated;
  });

  app.patch("/api/v1/intelligence/golden-projects/:id/scores", async (request, reply) => {
    const user = await requireAdmin(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      codeQuality: z.number().min(0).max(1).optional(),
      testCoverage: z.number().min(0).max(1).optional(),
      documentation: z.number().min(0).max(1).optional(),
      security: z.number().min(0).max(1).optional(),
      maintainability: z.number().min(0).max(1).optional(),
    }).parse(request.body);
    
    const scores: Partial<{
      codeQuality: number;
      testCoverage: number;
      documentation: number;
      security: number;
      maintainability: number;
    }> = {};
    if (body.codeQuality !== undefined) scores.codeQuality = body.codeQuality;
    if (body.testCoverage !== undefined) scores.testCoverage = body.testCoverage;
    if (body.documentation !== undefined) scores.documentation = body.documentation;
    if (body.security !== undefined) scores.security = body.security;
    if (body.maintainability !== undefined) scores.maintainability = body.maintainability;

    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      routeLabel: "intelligence.goldenProjects.updateScores",
      actorId: user.id,
      input: { goldenProjectId: id },
    });
    const updated = updateGoldenProjectScores(id, scores);
    if (!updated) {
      return reply.status(404).send({ error: "Golden project not found" });
    }
    return updated;
  });

  app.get("/api/v1/intelligence/golden-projects/exemplars/:domain", async (request) => {
    const { domain } = request.params as { domain: string };
    return findExemplarsForDomain(domain as "API_DESIGN" | "DATABASE_SCHEMA" | "SECURITY" | "TESTING" | "DOCUMENTATION" | "PERFORMANCE" | "ARCHITECTURE" | "ERROR_HANDLING");
  });

  app.get("/api/v1/intelligence/golden-root", async () => ({
    path: getGoldenRoot(),
  }));

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Marketplace & Reputation
  // ─────────────────────────────────────────────────────────────────────────────

  app.get("/api/v1/intelligence/marketplace", async () => getAgentMarketplace());

  app.get("/api/v1/intelligence/marketplace/recommend", async (request) => {
    const { task } = request.query as { task?: string };
    if (!task) {
      return getAgentMarketplace().slice(0, 5);
    }
    return recommendAgentsForTask(task);
  });

  app.get("/api/v1/intelligence/marketplace/compare", async (request) => {
    const { agents } = request.query as { agents?: string };
    if (!agents) {
      return [];
    }
    const agentIds = agents.split(",").filter(id => 
      (FABRIC_AGENT_IDS as readonly string[]).includes(id)
    ) as FabricAgentId[];
    return compareAgents(agentIds);
  });

  app.get("/api/v1/intelligence/reputation", async (request) => {
    const { modes } = request.query as { modes?: string };
    if (!modes) {
      return computeAgentReputation();
    }
    const modeList = modes.split(",").filter(m => 
      (AGENT_MODES as readonly string[]).includes(m)
    ) as AgentMode[];
    return computeAgentReputation({ modes: modeList });
  });

  app.get("/api/v1/intelligence/reputation/battle-metrics", async () => 
    computeExpertBattleMetrics()
  );

  app.get("/api/v1/intelligence/reputation/rankings/:domain", async (request) => {
    const { domain } = request.params as { domain: string };
    return computeAgentRankings(domain);
  });

  app.get("/api/v1/intelligence/verification-lessons", async () => {
    const entries = listUnifiedAuditEntries();
    return recommendFromVerificationHistory(
      entries.map((entry) => ({
        ...(typeof entry.input["requestId"] === "string"
          ? { requestId: entry.input["requestId"] }
          : {}),
        verificationVerdict: entry.verificationVerdict,
        regressionVerdict: entry.regressionVerdict,
        result: entry.result,
      })),
    );
  });

  app.get("/api/v1/intelligence/outcome-signals", async () => {
    const entries = listUnifiedAuditEntries();
    return scoreHistoricalOutcomes(
      entries.map((entry) => ({
        result: entry.result,
        verificationVerdict: entry.verificationVerdict,
        agentId: entry.agentId,
      })),
    );
  });
}
