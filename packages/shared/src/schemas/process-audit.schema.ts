import { z } from "zod";
import {
  PROCESS_APP_PROFILES,
  PROCESS_DIMENSIONS,
  PROCESS_GATES,
  PROCESS_ITEM_KINDS,
  PROCESS_PROVIDER_TARGETS,
  PROCESS_SPECIALIST_EXPERTS,
  PROCESS_VERDICTS,
} from "../constants/process-audit.js";
import { EXPERT_IDS } from "../constants/experts.js";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";
import { qaSeveritySchema } from "./qa.schema.js";

export const processAppProfileSchema = z.enum(PROCESS_APP_PROFILES);
export const processGateIdSchema = z.enum(PROCESS_GATES);
export const processVerdictSchema = z.enum(PROCESS_VERDICTS);
export const processItemKindSchema = z.enum(PROCESS_ITEM_KINDS);
export const processDimensionSchema = z.enum(PROCESS_DIMENSIONS);
export const processProviderTargetSchema = z.enum(PROCESS_PROVIDER_TARGETS);

export const processAuditItemSchema = z.object({
  id: uuidSchema,
  kind: processItemKindSchema,
  gateId: processGateIdSchema.nullable(),
  dimension: processDimensionSchema,
  severity: qaSeveritySchema,
  title: z.string().min(1).max(300),
  detail: z.string().min(1).max(4000),
  expected: z.string().max(2000).nullable(),
  actual: z.string().max(2000).nullable(),
  specialist: z.enum(EXPERT_IDS).nullable(),
  epistemicState: epistemicStateSchema,
  evidenceNotes: z.array(z.string().max(500)).default([]),
  recommendedNext: z.string().max(2000).nullable(),
});

export const processGateResultSchema = z.object({
  gateId: processGateIdSchema,
  title: z.string().min(1).max(200),
  status: z.enum(["PASS", "FAIL", "PARTIAL", "NOT_RUN", "UNKNOWN"]),
  summary: z.string().min(1).max(2000),
  journeys: z.array(z.string().max(300)).default([]),
  itemIds: z.array(uuidSchema).default([]),
});

export const processProviderStatusSchema = z.object({
  provider: processProviderTargetSchema,
  adapterStatus: z.enum(["live", "feed", "mvp", "planned", "missing"]),
  relevant: z.boolean(),
  note: z.string().max(500),
});

export const createProcessAuditSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  /** Override or leave null for auto-detect from request + workspace. */
  appProfile: processAppProfileSchema.nullable().optional(),
  userRequest: z.string().min(1).max(4000).optional(),
  environment: z.enum(["LOCAL", "STAGING", "PRODUCTION_SAFE"]).default("LOCAL"),
  includeProviders: z.boolean().default(true),
  includeUiUx: z.boolean().default(true),
  includePerformance: z.boolean().default(true),
  specialists: z.array(z.enum(PROCESS_SPECIALIST_EXPERTS)).optional(),
});

export const processAuditDocumentSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  appProfile: processAppProfileSchema,
  appProfileSource: z.enum(["USER", "AUTO_DETECT", "DEFAULT"]),
  verdict: processVerdictSchema,
  verdictReason: z.string().min(1).max(2000),
  gates: z.array(processGateResultSchema),
  items: z.array(processAuditItemSchema),
  specialistsEngaged: z.array(z.enum(EXPERT_IDS)),
  providers: z.array(processProviderStatusSchema),
  /** Markdown document for download / share. */
  markdownReport: z.string().min(1).max(200_000),
  /** Plain structured sections for UI. */
  sections: z.object({
    executiveSummary: z.string().max(4000),
    defects: z.array(z.string().max(1000)),
    blockers: z.array(z.string().max(1000)),
    futureChecks: z.array(z.string().max(1000)),
    recommendations: z.array(z.string().max(1000)),
  }),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema,
});

export type ProcessAuditItem = z.infer<typeof processAuditItemSchema>;
export type ProcessGateResult = z.infer<typeof processGateResultSchema>;
export type ProcessProviderStatus = z.infer<typeof processProviderStatusSchema>;
export type CreateProcessAudit = z.infer<typeof createProcessAuditSchema>;
export type ProcessAuditDocument = z.infer<typeof processAuditDocumentSchema>;
