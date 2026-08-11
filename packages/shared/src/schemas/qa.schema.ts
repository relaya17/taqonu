import { z } from "zod";
import {
  QA_DOMAINS,
  QA_ENVIRONMENTS,
  QA_FINDING_STATUSES,
  QA_PROFILES,
  QA_RISK_CLASSES,
  QA_RUN_STATUSES,
  QA_SCOPES,
  QA_SEVERITIES,
} from "../constants/qa.js";
import { epistemicStateSchema, isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const qaScopeSchema = z.enum(QA_SCOPES);
export const qaProfileSchema = z.enum(QA_PROFILES);
export const qaEnvironmentSchema = z.enum(QA_ENVIRONMENTS);
export const qaDomainSchema = z.enum(QA_DOMAINS);
export const qaSeveritySchema = z.enum(QA_SEVERITIES);
export const qaFindingStatusSchema = z.enum(QA_FINDING_STATUSES);
export const qaRunStatusSchema = z.enum(QA_RUN_STATUSES);
export const qaRiskClassSchema = z.enum(QA_RISK_CLASSES);

export const qaScorecardSchema = z.object({
  testCoveragePercent: z.number().min(0).max(100).nullable(),
  criticalPathsTestedPercent: z.number().min(0).max(100).nullable(),
  securityReadinessPercent: z.number().min(0).max(100).nullable(),
  productionReadinessPercent: z.number().min(0).max(100).nullable(),
  /** Counts behind the percentages — required for non-vanity scores. */
  evidenceSignalCount: z.number().int().min(0),
  inferredSignalCount: z.number().int().min(0).default(0),
});

export const qaFindingSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  projectId: uuidSchema.nullable(),
  domain: qaDomainSchema,
  severity: qaSeveritySchema,
  status: qaFindingStatusSchema,
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(4000),
  epistemicState: epistemicStateSchema,
  riskClass: qaRiskClassSchema.nullable(),
  component: z.string().max(200).nullable(),
  evidenceIds: z.array(uuidSchema).default([]),
  rootCause: z.string().max(4000).nullable(),
  recommendedFix: z.string().max(4000).nullable(),
  relatedHistoricalFindingIds: z.array(uuidSchema).default([]),
  portfolioPatternId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const qaRegressionRuleSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  /** Fingerprint of the weakness (e.g. duplicated Zod contracts). */
  patternKey: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  originFindingId: uuidSchema.nullable(),
  preventingTestIds: z.array(z.string().min(1).max(200)).default([]),
  timesSeen: z.number().int().min(1).default(1),
  projectIdsSeen: z.array(uuidSchema).default([]),
  lastSeenAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const qaPortfolioPatternSchema = z.object({
  id: uuidSchema,
  patternKey: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(4000),
  severity: qaSeveritySchema,
  domain: qaDomainSchema,
  projectIds: z.array(uuidSchema).min(1),
  findingIds: z.array(uuidSchema).default([]),
  epistemicState: epistemicStateSchema.default("INFERRED"),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createQaRunSchema = z.object({
  scope: qaScopeSchema,
  profile: qaProfileSchema.default("STANDARD"),
  environment: qaEnvironmentSchema.default("LOCAL"),
  projectId: uuidSchema.nullable().optional(),
  projectIds: z.array(uuidSchema).max(100).optional(),
  /** Free-text request e.g. "QA על BrokerOS לעומק" */
  userRequest: z.string().min(1).max(4000).optional(),
  changedSince: isoDateTimeSchema.nullable().optional(),
  budgetMinutes: z.number().int().min(1).max(240).optional(),
});

export const qaRunSchema = z.object({
  id: uuidSchema,
  scope: qaScopeSchema,
  profile: qaProfileSchema,
  environment: qaEnvironmentSchema,
  status: qaRunStatusSchema,
  projectIds: z.array(uuidSchema),
  domainsPlanned: z.array(qaDomainSchema),
  userRequest: z.string().max(4000).nullable(),
  scorecard: qaScorecardSchema.nullable(),
  severityCounts: z.object({
    CRITICAL: z.number().int().min(0),
    HIGH: z.number().int().min(0),
    MEDIUM: z.number().int().min(0),
    LOW: z.number().int().min(0),
  }),
  topRiskTitles: z.array(z.string().max(300)).max(10),
  findingIds: z.array(uuidSchema).default([]),
  learnedPatternIds: z.array(uuidSchema).default([]),
  writeGateLocked: z.literal(true).default(true),
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const qaReportSchema = z.object({
  run: qaRunSchema,
  findings: z.array(qaFindingSchema),
  portfolioPatterns: z.array(qaPortfolioPatternSchema),
  regressionRulesTriggered: z.array(qaRegressionRuleSchema),
});

export type QaFinding = z.infer<typeof qaFindingSchema>;
export type QaRun = z.infer<typeof qaRunSchema>;
export type QaReport = z.infer<typeof qaReportSchema>;
export type CreateQaRun = z.infer<typeof createQaRunSchema>;
export type QaScorecard = z.infer<typeof qaScorecardSchema>;
export type QaRegressionRule = z.infer<typeof qaRegressionRuleSchema>;
export type QaPortfolioPattern = z.infer<typeof qaPortfolioPatternSchema>;
