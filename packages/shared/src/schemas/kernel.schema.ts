import { z } from "zod";
import { fabricAgentIdSchema } from "./agent-fabric.schema.js";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const agentRegistryStatusSchema = z.enum([
  "DRAFT",
  "LAB",
  "BETA",
  "GA",
  "DISABLED",
]);

/** Phase 1 — full Agent Registry contract (ADR-018). */
export const registeredAgentSchema = z.object({
  id: fabricAgentIdSchema,
  name: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: agentRegistryStatusSchema,
  capabilities: z.array(z.string().min(1).max(64)).min(1),
  tools: z.array(z.string().min(1).max(64)),
  forbiddenTools: z.array(z.string().min(1).max(64)),
  permissions: z.array(
    z.enum([
      "READ_REPO",
      "READ_EVIDENCE",
      "WRITE_EVIDENCE",
      "PROPOSE_PATCH",
      "APPLY_PATCH",
      "CALL_EXTERNAL",
      "ESCALATE",
      "JUDGE",
      "ORCHESTRATE",
    ]),
  ),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  evidencePolicy: z.object({
    minAuthority: z.number().min(0).max(1),
    requireFreshness: z.boolean(),
    allowInsufficient: z.literal(true),
    refuseHallucination: z.literal(true),
  }),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  costBudgetUsd: z.number().min(0),
  timeoutMs: z.number().int().positive(),
  evaluationSuite: z.string(),
  canWriteCode: z.boolean(),
  trustLevel: z.enum(["LAB", "BETA", "GA"]),
});

/** Phase 2 — TaskPlan (Orchestrator). */
export const taskSubtaskSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  agentId: fabricAgentIdSchema,
  dependsOn: z.array(z.string()).default([]),
  requiredEvidence: z.array(z.string()).default([]),
  parallelGroup: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0),
});

export const taskPlanSchema = z.object({
  id: uuidSchema,
  objective: z.string().min(1).max(4000),
  projectId: uuidSchema.nullable(),
  subtasks: z.array(taskSubtaskSchema).min(1),
  dependencies: z.array(
    z.object({ from: z.string(), to: z.string() }),
  ),
  requiredAgents: z.array(fabricAgentIdSchema).min(1),
  requiredEvidence: z.array(z.string()),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  budgetUsd: z.number().min(0),
  successCriteria: z.array(z.string()).min(1),
  simulationRequired: z.boolean(),
  modelHint: z.enum(["cheap", "strong", "vision", "local", "multi+human"]),
  routerHints: z.array(z.string()),
  createdAt: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
});

export const createTaskPlanRequestSchema = z.object({
  request: z.string().min(1).max(8000),
  projectId: uuidSchema.nullable().optional(),
  maxAgents: z.number().int().min(1).max(8).default(5),
  budgetUsd: z.number().min(0).max(20).default(2),
});

/** Phase 3 — Evidence Bus envelope. */
export const evidenceBusSourceTypeSchema = z.enum([
  "REPOSITORY",
  "TEST",
  "CI",
  "OFFICIAL_DOCS",
  "STANDARD",
  "SECURITY_ADVISORY",
  "DECISION",
  "AGENT_OBSERVATION",
  "HUMAN",
  "LLM_INFERENCE",
]);

export const evidenceBusItemSchema = z.object({
  id: uuidSchema,
  claim: z.string().min(1).max(2000),
  source: z.string().min(1).max(500),
  sourceType: evidenceBusSourceTypeSchema,
  authorityScore: z.number().min(0).max(1),
  retrievedAt: isoDateTimeSchema,
  sourceUpdatedAt: isoDateTimeSchema.nullable(),
  contentHash: z.string().min(8).max(128),
  confidence: z.number().min(0).max(1),
  supports: z.array(z.string()).default([]),
  epistemicState: epistemicStateSchema,
  agentId: fabricAgentIdSchema.nullable(),
  projectId: uuidSchema.nullable(),
});

export const evidenceBusEventSchema = z.object({
  id: uuidSchema,
  type: z.enum([
    "evidence.published",
    "evidence.insufficient",
    "handoff.requested",
    "handoff.completed",
    "simulation.completed",
    "judge.decided",
  ]),
  traceId: z.string(),
  taskPlanId: uuidSchema.nullable(),
  agentId: fabricAgentIdSchema.nullable(),
  evidence: z.array(evidenceBusItemSchema).default([]),
  payload: z.record(z.unknown()).default({}),
  createdAt: isoDateTimeSchema,
});

export const simulationResultSchema = z.object({
  id: uuidSchema,
  taskPlanId: uuidSchema,
  allowed: z.boolean(),
  blockedActions: z.array(z.string()),
  proposedActions: z.array(z.string()),
  requiresHuman: z.boolean(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  rationale: z.string(),
  epistemicState: epistemicStateSchema,
});

export const kernelRunRequestSchema = z.object({
  request: z.string().min(1).max(8000),
  projectId: uuidSchema.nullable().optional(),
  maxAgents: z.number().int().min(1).max(8).default(5),
  budgetUsd: z.number().min(0).max(20).default(2),
  runSimulation: z.boolean().default(true),
  runJudge: z.boolean().default(true),
});

export const kernelJudgeDecisionSchema = z.enum([
  "APPROVE",
  "REJECT",
  "REQUEST_MORE_EVIDENCE",
  "INSUFFICIENT_EVIDENCE",
  "ESCALATE_HUMAN",
]);

export const kernelJudgeResultSchema = z.object({
  decision: kernelJudgeDecisionSchema,
  confidence: z.number().min(0).max(1),
  contradictions: z.array(z.string()).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  rationale: z.string(),
  epistemicState: epistemicStateSchema,
});

export const kernelRunResultSchema = z.object({
  id: uuidSchema,
  traceId: z.string(),
  plan: taskPlanSchema,
  simulation: simulationResultSchema.nullable(),
  evidenceEvents: z.array(evidenceBusEventSchema),
  evidenceItems: z.array(evidenceBusItemSchema),
  specialistSummaries: z.array(
    z.object({
      agentId: fabricAgentIdSchema,
      status: z.enum([
        "COMPLETED",
        "SKIPPED",
        "FAILED",
        "NEEDS_EVIDENCE",
        "INSUFFICIENT_EVIDENCE",
      ]),
      summary: z.string(),
      evidenceIds: z.array(z.string()),
    }),
  ),
  judge: kernelJudgeResultSchema.nullable(),
  knowledgePackage: z
    .object({
      query: z.string(),
      hitIds: z.array(z.string()),
      filteredOut: z.number().int(),
    })
    .nullable()
    .default(null),
  engineeringLoopBridge: z
    .object({
      recommended: z.boolean(),
      stages: z.array(z.string()),
      note: z.string(),
    })
    .nullable()
    .default(null),
  lessonsApplied: z.array(z.string()).default([]),
  createdAt: isoDateTimeSchema,
});

export const knowledgeIngestRequestSchema = z.object({
  title: z.string().min(1).max(300),
  excerpt: z.string().min(1).max(4000),
  sourceClass: z.string().min(1).max(64),
  url: z.string().url().nullable().optional(),
  sourceUpdatedAt: isoDateTimeSchema.nullable().optional(),
  projectScoped: z.boolean().default(false),
});

export const agentEvalCaseSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  expectAgent: fabricAgentIdSchema.optional(),
  expectDecision: kernelJudgeDecisionSchema.optional(),
  mustNotHallucinate: z.boolean().default(true),
});

export const agentEvalReportSchema = z.object({
  id: uuidSchema,
  agentId: fabricAgentIdSchema.nullable(),
  suite: z.string(),
  casesTotal: z.number().int(),
  casesPassed: z.number().int(),
  accuracy: z.number().min(0).max(1),
  hallucinationRefusals: z.number().int(),
  avgLatencyMs: z.number(),
  costUsd: z.number(),
  createdAt: isoDateTimeSchema,
  details: z.array(
    z.object({
      caseId: z.string(),
      passed: z.boolean(),
      note: z.string(),
    }),
  ),
});

export const engineeringLessonSchema = z.object({
  id: uuidSchema,
  pattern: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  summary: z.string().max(4000),
  evidenceProjectSlug: z.string().nullable(),
  applicableDomains: z.array(z.string()),
  occurrences: z.number().int().min(1).default(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
});

export const improvementRuleSchema = z.object({
  id: uuidSchema,
  pattern: z.string(),
  rule: z.string(),
  sourceLessonIds: z.array(z.string()),
  autoCheckAgents: z.array(fabricAgentIdSchema),
  createdAt: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
});

export const runAgentEvalRequestSchema = z.object({
  agentId: fabricAgentIdSchema.nullable().optional(),
  suite: z.string().default("kernel-smoke-v1"),
});

export type RegisteredAgent = z.infer<typeof registeredAgentSchema>;
export type TaskPlan = z.infer<typeof taskPlanSchema>;
export type EvidenceBusEvent = z.infer<typeof evidenceBusEventSchema>;
export type EvidenceBusItem = z.infer<typeof evidenceBusItemSchema>;
export type KernelRunResult = z.infer<typeof kernelRunResultSchema>;
export type SimulationResult = z.infer<typeof simulationResultSchema>;
export type AgentEvalReport = z.infer<typeof agentEvalReportSchema>;
export type EngineeringLesson = z.infer<typeof engineeringLessonSchema>;
export type ImprovementRule = z.infer<typeof improvementRuleSchema>;
