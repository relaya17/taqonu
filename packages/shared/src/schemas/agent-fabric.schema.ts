import { z } from "zod";
import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const fabricAgentIdSchema = z.enum(FABRIC_AGENT_IDS);

export const fabricAgentPublicSchema = z.object({
  id: fabricAgentIdSchema,
  title: z.string(),
  titleHe: z.string().optional(),
  titleAr: z.string().optional(),
  specialty: z.string(),
  category: z.string().optional(),
  allowedTools: z.array(z.string()),
  forbiddenTools: z.array(z.string()),
  evidenceRequirements: z.array(z.string()),
  maxCostUsd: z.number(),
  timeoutMs: z.number().int(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  canWriteCode: z.boolean(),
  evaluationSuite: z.string(),
  trustLevel: z.enum(["LAB", "BETA", "GA"]).default("LAB"),
  costHintEn: z.string().optional(),
  costHintHe: z.string().optional(),
  costHintAr: z.string().optional(),
  strengthsEn: z.array(z.string()).optional(),
  strengthsHe: z.array(z.string()).optional(),
  strengthsAr: z.array(z.string()).optional(),
  weaknessesEn: z.array(z.string()).optional(),
  weaknessesHe: z.array(z.string()).optional(),
  weaknessesAr: z.array(z.string()).optional(),
});

export const agentPlanRequestSchema = z.object({
  request: z.string().min(1).max(8000),
  projectId: uuidSchema.nullable().optional(),
  agentIds: z.array(fabricAgentIdSchema).min(1).max(8).optional(),
  maxAgents: z.number().int().min(1).max(8).default(5),
  budgetUsd: z.number().min(0).max(20).default(2),
});

export const agentPlanStepSchema = z.object({
  agentId: fabricAgentIdSchema,
  rationale: z.string(),
  requiredEvidence: z.array(z.string()),
  parallelGroup: z.number().int().min(0),
  estimatedCostUsd: z.number(),
});

export const agentPlanSchema = z.object({
  id: uuidSchema,
  request: z.string(),
  projectId: uuidSchema.nullable(),
  steps: z.array(agentPlanStepSchema).min(1),
  routerHints: z.array(z.string()),
  estimatedTotalCostUsd: z.number(),
  createdAt: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
});

export const agentDispatchRequestSchema = z.object({
  planId: uuidSchema.optional(),
  request: z.string().min(1).max(8000),
  projectId: uuidSchema.nullable().optional(),
  agentIds: z.array(fabricAgentIdSchema).min(1).max(8).optional(),
  maxAgents: z.number().int().min(1).max(8).default(5),
  budgetUsd: z.number().min(0).max(20).default(2),
  runJudge: z.boolean().default(true),
});

export const agentRunResultSchema = z.object({
  agentId: fabricAgentIdSchema,
  status: z.enum(["COMPLETED", "SKIPPED", "FAILED", "NEEDS_EVIDENCE"]),
  summary: z.string(),
  claims: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  epistemicState: epistemicStateSchema,
  costUsd: z.number(),
  durationMs: z.number().int(),
});

export const judgeDecisionSchema = z.enum([
  "APPROVE",
  "REJECT",
  "REQUEST_MORE_EVIDENCE",
  "ESCALATE_HUMAN",
]);

export const judgeResultSchema = z.object({
  decision: judgeDecisionSchema,
  confidence: z.number().min(0).max(1),
  contradictions: z.array(z.string()).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  rationale: z.string(),
  epistemicState: epistemicStateSchema,
});

export const agentDispatchResultSchema = z.object({
  id: uuidSchema,
  plan: agentPlanSchema,
  runs: z.array(agentRunResultSchema),
  judge: judgeResultSchema.nullable(),
  traceId: z.string(),
  createdAt: isoDateTimeSchema,
});

export const judgeEvaluateRequestSchema = z.object({
  runs: z.array(agentRunResultSchema).min(1),
  request: z.string().min(1).max(8000).optional(),
});

export const knowledgeSearchRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  projectId: uuidSchema.nullable().optional(),
  maxResults: z.number().int().min(1).max(50).default(20),
  minAuthority: z.number().min(0).max(1).default(0.4),
  allowStale: z.boolean().default(false),
});

export const knowledgeHitSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceClass: z.string(),
  authority: z.number().min(0).max(1),
  url: z.string().nullable(),
  retrievedAt: isoDateTimeSchema,
  sourceUpdatedAt: isoDateTimeSchema.nullable(),
  freshness: z.enum(["CURRENT", "STALE", "UNKNOWN"]),
  excerpt: z.string(),
  contentHash: z.string(),
  epistemicState: epistemicStateSchema,
});

export const knowledgeSearchResultSchema = z.object({
  query: z.string(),
  hits: z.array(knowledgeHitSchema),
  filteredOut: z.number().int().min(0),
  plainLanguage: z.string(),
  /** pgvector when live DB answered; local = file corpus + local embeddings. */
  retrievalBackend: z.enum(["pgvector", "local"]).optional(),
});

export const lessonLearnedSchema = z.object({
  id: uuidSchema,
  pattern: z.string(),
  title: z.string(),
  evidenceProjectSlug: z.string().nullable(),
  applicableDomains: z.array(z.string()),
  summary: z.string(),
  createdAt: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
});

export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type AgentDispatchResult = z.infer<typeof agentDispatchResultSchema>;
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;
export type JudgeResult = z.infer<typeof judgeResultSchema>;
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>;
