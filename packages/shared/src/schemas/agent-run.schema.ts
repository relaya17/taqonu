import { z } from "zod";
import { AGENT_MODES, MVP_AGENT_MODES } from "../constants/tools.js";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const agentModeSchema = z.enum(AGENT_MODES);
export const mvpAgentModeSchema = z.enum(MVP_AGENT_MODES);

export const agentRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "AWAITING_APPROVAL",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export const agentStepKindSchema = z.enum([
  "INTENT_CLASSIFICATION",
  "AUTHORIZATION",
  "RETRIEVAL",
  "PLAN",
  "TOOL_EXECUTION",
  "VALIDATION",
  "ANSWER",
  "MEMORY_EXTRACTION",
  "AUDIT",
]);

export const agentStepSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  kind: agentStepKindSchema,
  status: z.enum(["STARTED", "SUCCEEDED", "FAILED", "SKIPPED"]),
  inputSummary: z.string().max(2000).optional(),
  outputSummary: z.string().max(2000).optional(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});

export const toolCallSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  tool: z.string().min(1).max(120),
  projectId: uuidSchema.nullable(),
  authorization: z.enum(["ALLOWED", "DENIED", "APPROVAL_REQUIRED"]),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  result: z.enum(["SUCCESS", "FAILURE", "CANCELLED"]).nullable(),
  errorCode: z.string().max(64).nullable(),
});

export const agentRunSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  mode: agentModeSchema,
  status: agentRunStatusSchema,
  userRequest: z.string().min(1).max(10000),
  answer: z.string().max(50000).nullable(),
  epistemicState: epistemicStateSchema.nullable(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  createdBy: z.string().min(1).max(200),
});

/** MVP accepts only READ/ANALYZE/PLAN. WRITE requires eval gate + approval. */
export const createAgentRunSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  /** Default scope is portfolio when projectId omitted. */
  mode: mvpAgentModeSchema.default("READ"),
  userRequest: z.string().min(1).max(10000),
  /** Catalog id from AI_PROVIDER_CATALOG — agent-capable providers only */
  aiProviderId: z
    .enum([
      "arletos-included",
      "claude-haiku",
      "deepseek-chat",
      "gpt-4o-mini",
      "gemini-flash",
      "llama-groq",
      "llama-local",
      "claude-sonnet",
      "gpt-4o",
      "gemini-pro",
      "claude-opus",
      "o3-mini",
    ])
    .optional(),
  engineeringMode: z
    .enum([
      "analyze",
      "plan",
      "generate",
      "fix",
      "refactor",
      "test",
      "secure",
      "optimize",
      "implement",
    ])
    .optional(),
  /** When true and mode proposes patch, create Patch Artifact (not apply). */
  proposePatch: z.boolean().optional(),
  workspaceRoot: z.string().max(1000).optional(),
});

export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type CreateAgentRun = z.infer<typeof createAgentRunSchema>;
