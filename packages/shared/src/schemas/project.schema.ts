import { z } from "zod";
import { uuidSchema, isoDateTimeSchema } from "./common.schema.js";

export const projectStatusSchema = z.enum([
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
  "PLANNED",
]);

export const projectSchema = z.object({
  id: uuidSchema,
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable(),
  status: projectStatusSchema,
  techStack: z.array(z.string().min(1).max(64)).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createProjectSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  techStack: z.array(z.string().min(1).max(64)).optional(),
  /** When true, dual-write to external Supabase and consume a cloud slot. */
  syncToCloud: z.boolean().optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  status: projectStatusSchema.optional(),
});

export const projectHealthDimensionSchema = z.object({
  key: z.enum([
    "architecture",
    "security",
    "testing",
    "documentation",
    "deployment",
    "observability",
  ]),
  score: z.number().min(0).max(100),
  notes: z.string().max(1000).optional(),
});

export const projectHealthSchema = z.object({
  projectId: uuidSchema,
  dimensions: z.array(projectHealthDimensionSchema),
  overall: z.number().min(0).max(100),
  computedAt: isoDateTimeSchema,
  epistemicState: z.literal("INFERRED"),
});

/** Resume pack is derived from Current State — not a separate truth source. */
export const projectResumeSchema = z.object({
  projectId: uuidSchema,
  stateSnapshotId: uuidSchema.nullable(),
  currentState: z.string(),
  lastActivity: z.string().nullable(),
  lastDecision: z.string().nullable(),
  lastSuccessfulDeployment: z.string().nullable(),
  lastFailedTest: z.string().nullable(),
  openTasks: z.array(z.string()),
  recommendedNextAction: z.string().nullable(),
  relevantMemories: z.array(z.string()),
  relevantRepositoryChanges: z.array(z.string()),
  conflictCount: z.number().int().min(0).default(0),
  epistemicState: z.enum(["FACT", "INFERRED", "UNKNOWN", "CONFLICTED"]),
});

export type Project = z.infer<typeof projectSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
export type ProjectHealth = z.infer<typeof projectHealthSchema>;
export type ProjectResume = z.infer<typeof projectResumeSchema>;
