import { z } from "zod";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const auditIssueCategorySchema = z.enum([
  "DEPENDENCY",
  "CODE",
  "ARCHITECTURE",
  "SECURITY",
  "TESTING",
  "PERFORMANCE",
  "OBSERVABILITY",
  "VERSIONS",
  "NAVIGATION",
  "ACCESSIBILITY",
  "UX",
  "UI_CONSISTENCY",
  "DATABASE",
  "API",
  "CONFIGURATION",
  "DEPLOYMENT",
  "DOCUMENTATION",
  "CODE_HYGIENE",
  "I18N",
  "LEGAL",
  "AI_SAFETY",
  "RELIABILITY",
  "EXTERNAL_API",
  "OMISSION",
  "CONSTITUTION",
]);

export const auditSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const remediationPolicySchema = z.enum([
  "AUTO_FIX",
  "PR_REVIEW",
  "RECOMMENDATION_ONLY",
  "HUMAN_APPROVAL",
]);

export const engineeringIssueSchema = z.object({
  id: uuidSchema,
  category: auditIssueCategorySchema,
  severity: auditSeveritySchema,
  title: z.string().min(1).max(300),
  affectedComponents: z.array(z.string()).default([]),
  rootCause: z.string().max(4000),
  evidence: z.array(
    z.object({
      ref: z.string(),
      note: z.string(),
      epistemicState: epistemicStateSchema,
    }),
  ),
  confidence: z.number().min(0).max(1),
  recommendedFix: z.string().max(4000),
  proposedPatchHint: z.string().nullable(),
  testsSuggested: z.array(z.string()).default([]),
  regressionResult: z
    .enum(["NOT_RUN", "PASS", "FAIL", "UNKNOWN"])
    .default("NOT_RUN"),
  approvalStatus: z.enum([
    "OPEN",
    "PROPOSED",
    "APPROVED",
    "REJECTED",
    "FIXED",
  ]),
  remediationPolicy: remediationPolicySchema,
  architectureViolation: z.boolean().default(false),
  constitutionDomain: z.string().nullable().optional(),
  omission: z.boolean().default(false),
});

export const architectureLayerSchema = z.enum([
  "FRONTEND",
  "API",
  "SERVICE",
  "REPOSITORY",
  "DATABASE",
  "INFRA",
  "UNKNOWN",
]);

export const architectureContractSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  name: z.string(),
  allowedEdges: z.array(
    z.object({
      from: architectureLayerSchema,
      to: architectureLayerSchema,
    }),
  ),
  forbiddenEdges: z.array(
    z.object({
      from: architectureLayerSchema,
      to: architectureLayerSchema,
    }),
  ),
  createdAt: isoDateTimeSchema,
});

export const architectureDriftFindingSchema = z.object({
  id: uuidSchema,
  from: architectureLayerSchema,
  to: architectureLayerSchema,
  pathHint: z.string(),
  severity: auditSeveritySchema,
  evidence: z.array(z.string()),
  epistemicState: epistemicStateSchema,
});

export const systemHealthDimensionSchema = z.object({
  key: z.enum([
    "architecture",
    "security",
    "dependencies",
    "codeQuality",
    "testing",
    "performance",
    "observability",
  ]),
  score: z.number().min(0).max(100),
  epistemicState: epistemicStateSchema,
  evidenceRefs: z.array(z.string()).default([]),
  notes: z.string(),
});

export const systemHealthReportSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  projectName: z.string(),
  workspaceRoot: z.string().nullable(),
  overallScore: z.number().min(0).max(100),
  dimensions: z.array(systemHealthDimensionSchema).min(1),
  criticalIssues: z.number().int().min(0),
  highRisk: z.number().int().min(0),
  medium: z.number().int().min(0),
  low: z.number().int().min(0),
  architectureDriftScore: z.number().min(0).max(100),
  issues: z.array(engineeringIssueSchema),
  driftFindings: z.array(architectureDriftFindingSchema),
  pillars: z.object({
    understand: z.string(),
    detect: z.string(),
    remediate: z.string(),
  }),
  /** Engineering Constitution overlay (ADR-020) — optional for older reports. */
  constitution: z
    .object({
      overallScore: z.number().min(0).max(100),
      detectedProfiles: z.array(z.string()),
      domainScores: z.array(
        z.object({
          domain: z.string(),
          score: z.number(),
          applicable: z.number(),
          failed: z.number(),
        }),
      ),
      omissionCount: z.number().int().min(0),
      failedChecks: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  plainLanguageSummary: z.string(),
  createdAt: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
});

export const runContinuousAuditRequestSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  projectName: z.string().min(1).max(200).optional(),
  workspaceRoot: z.string().max(1000).optional(),
  intent: z.string().max(4000).optional(),
  includeConstitution: z.boolean().default(true),
  /**
   * When true (and signed-in WRITE), LOW AUTO_FIX drafts may auto-apply.
   * Also enabled by ATLAS_AUTO_APPLY_LOW. HIGH/CRITICAL never auto-apply.
   */
  autoApplyLow: z.boolean().optional(),
});

export type EngineeringIssue = z.infer<typeof engineeringIssueSchema>;
export type SystemHealthReport = z.infer<typeof systemHealthReportSchema>;
export type ArchitectureContract = z.infer<typeof architectureContractSchema>;
