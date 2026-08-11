import { z } from "zod";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";
import {
  auditSeveritySchema,
  engineeringIssueSchema,
  remediationPolicySchema,
} from "./audit-engine.schema.js";

/** Atlas Engineering Constitution domains (ADR-020). */
export const constitutionDomainSchema = z.enum([
  "ARCHITECTURE",
  "SECURITY",
  "NAVIGATION",
  "FOOTER",
  "ACCESSIBILITY",
  "RESPONSIVE",
  "UI_CONSISTENCY",
  "UX",
  "PERFORMANCE",
  "DATABASE",
  "API",
  "TESTING",
  "DEPENDENCIES",
  "CONFIGURATION",
  "DEPLOYMENT",
  "OBSERVABILITY",
  "RELIABILITY",
  "EXTERNAL_APIS",
  "DOCUMENTATION",
  "CODE_HYGIENE",
  "I18N",
  "LEGAL_PRIVACY",
  "AI_SAFETY",
]);

export const productProfileSchema = z.enum([
  "ALL",
  "WEB_APP",
  "SAAS",
  "PAYMENTS",
  "API_SERVICE",
  "MARKETING_SITE",
  "INTERNAL_TOOL",
  "AI_PRODUCT",
]);

export const checklistItemStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "WARN",
  "SKIPPED_NOT_APPLICABLE",
  "UNKNOWN",
]);

export const constitutionChecklistItemSchema = z.object({
  id: z.string().min(1).max(80),
  domain: constitutionDomainSchema,
  title: z.string().min(1).max(300),
  description: z.string().max(2000),
  severityIfMissing: auditSeveritySchema,
  profiles: z.array(productProfileSchema).min(1),
  detectorKey: z.string().min(1).max(80),
  remediationHint: z.string().max(2000),
});

export const constitutionCheckResultSchema = z.object({
  itemId: z.string(),
  domain: constitutionDomainSchema,
  title: z.string(),
  status: checklistItemStatusSchema,
  severity: auditSeveritySchema.nullable(),
  evidenceRefs: z.array(z.string()).default([]),
  notes: z.string(),
  epistemicState: epistemicStateSchema,
});

export const omissionFindingSchema = z.object({
  id: uuidSchema,
  itemId: z.string().nullable(),
  domain: constitutionDomainSchema,
  title: z.string(),
  whyCritical: z.string(),
  evidenceGap: z.string(),
  suggestedCheck: z.string(),
  severity: auditSeveritySchema,
  confidence: z.number().min(0).max(1),
  remediationPolicy: remediationPolicySchema,
  epistemicState: epistemicStateSchema,
});

export const constitutionDomainScoreSchema = z.object({
  domain: constitutionDomainSchema,
  score: z.number().min(0).max(100),
  applicable: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  warned: z.number().int().min(0),
  unknown: z.number().int().min(0),
  evidenceRefs: z.array(z.string()).default([]),
});

export const constitutionReportSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  projectName: z.string(),
  workspaceRoot: z.string().nullable(),
  detectedProfiles: z.array(productProfileSchema),
  overallScore: z.number().min(0).max(100),
  domainScores: z.array(constitutionDomainScoreSchema),
  results: z.array(constitutionCheckResultSchema),
  omissions: z.array(omissionFindingSchema),
  issues: z.array(engineeringIssueSchema),
  plainLanguageSummary: z.string(),
  createdAt: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
});

export const runConstitutionRequestSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  projectName: z.string().min(1).max(200).optional(),
  workspaceRoot: z.string().max(1000).optional(),
  /** Optional user intent — feeds Omission Detector. */
  intent: z.string().max(4000).optional(),
  profiles: z.array(productProfileSchema).optional(),
});

export type ConstitutionDomain = z.infer<typeof constitutionDomainSchema>;
export type ProductProfile = z.infer<typeof productProfileSchema>;
export type ConstitutionChecklistItem = z.infer<
  typeof constitutionChecklistItemSchema
>;
export type ConstitutionReport = z.infer<typeof constitutionReportSchema>;
export type OmissionFinding = z.infer<typeof omissionFindingSchema>;
