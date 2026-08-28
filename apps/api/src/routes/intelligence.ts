/**
 * Stage 19 — Intelligence Roadmap Routes.
 *
 * Exposes hypothesis engine, golden projects, and agent marketplace.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
    const user = (request as { user?: { id: string } }).user;
    if (!user?.id) {
      return reply.status(401).send({ error: "Authentication required" });
    }
    const body = hypothesisCreateSchema.parse(request.body);
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
    const { id } = request.params as { id: string };
    const { status } = z.object({ status: hypothesisStatusSchema }).parse(request.body);
    const updated = updateHypothesisStatus(id, status);
    if (!updated) {
      return reply.status(404).send({ error: "Hypothesis not found" });
    }
    return updated;
  });

  app.post("/api/v1/intelligence/hypotheses/:id/evidence/supporting", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.body);
    const updated = addSupportingEvidence(id, evidenceId);
    if (!updated) {
      return reply.status(404).send({ error: "Hypothesis not found" });
    }
    return updated;
  });

  app.post("/api/v1/intelligence/hypotheses/:id/evidence/contradicting", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(request.body);
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
    const body = goldenProjectCreateSchema.parse(request.body);
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
    const { id } = request.params as { id: string };
    const { status } = z.object({ status: goldenProjectStatusSchema }).parse(request.body);
    const updated = updateGoldenProjectStatus(id, status);
    if (!updated) {
      return reply.status(404).send({ error: "Golden project not found" });
    }
    return updated;
  });

  app.patch("/api/v1/intelligence/golden-projects/:id/scores", async (request, reply) => {
    const { id } = request.params as { id: string };
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
}
