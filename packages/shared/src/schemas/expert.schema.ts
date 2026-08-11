import { z } from "zod";
import { EXPERT_IDS } from "../constants/experts.js";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const expertIdSchema = z.enum(EXPERT_IDS);

export const expertSelectionSchema = z.object({
  primary: expertIdSchema,
  supporting: z.array(expertIdSchema).max(4).default([]),
  rationale: z.string().max(500),
});

export const createEditorBriefSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  userRequest: z.string().min(1).max(4000),
  experts: z.array(expertIdSchema).max(5).optional(),
  includeState: z.boolean().default(true),
  includeDecisions: z.boolean().default(true),
  includeQaHints: z.boolean().default(true),
});

export const editorBriefSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  title: z.string().min(1).max(200),
  markdown: z.string().min(1),
  experts: z.array(expertIdSchema),
  createdAt: isoDateTimeSchema,
  /** Hint for humans — paste into their editor / coding agent */
  editorHint: z.literal(
    "Paste into your editor or coding agent. ArletOS provides the brief — coding stays in your tools.",
  ),
});

export type ExpertSelection = z.infer<typeof expertSelectionSchema>;
export type CreateEditorBrief = z.infer<typeof createEditorBriefSchema>;
export type EditorBrief = z.infer<typeof editorBriefSchema>;

export const createExpertReviewSchema = z.object({
  expertId: expertIdSchema,
  projectId: uuidSchema.nullable().optional(),
  userRequest: z.string().min(3).max(4000),
});

export const expertFindingStatusSchema = z.enum([
  "PASS",
  "WARN",
  "FAIL",
  "UNKNOWN",
]);

export const expertFindingSchema = z.object({
  id: uuidSchema,
  checklistItem: z.string().min(1).max(200),
  status: expertFindingStatusSchema,
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  note: z.string().min(1).max(1000),
  epistemicState: z.enum([
    "FACT",
    "CONFIRMED",
    "INFERRED",
    "PROPOSED",
    "UNKNOWN",
  ]),
});

export const expertReviewSchema = z.object({
  id: uuidSchema,
  expertId: expertIdSchema,
  projectId: uuidSchema.nullable(),
  userRequest: z.string(),
  summary: z.string().min(1).max(4000),
  findings: z.array(expertFindingSchema).min(1),
  recommendations: z.array(z.string().min(1).max(500)).max(12),
  statusCounts: z.object({
    PASS: z.number().int().min(0),
    WARN: z.number().int().min(0),
    FAIL: z.number().int().min(0),
    UNKNOWN: z.number().int().min(0),
  }),
  epistemicState: z.enum(["INFERRED", "UNKNOWN"]),
  createdAt: isoDateTimeSchema,
});

export type CreateExpertReview = z.infer<typeof createExpertReviewSchema>;
export type ExpertFinding = z.infer<typeof expertFindingSchema>;
export type ExpertReview = z.infer<typeof expertReviewSchema>;
