import { z } from "zod";
import { PLAN_TIERS } from "../constants/plans.js";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const planTierSchema = z.enum(PLAN_TIERS);

export const planAxesSchema = z.object({
  evidenceRecords: z.object({
    used: z.number().int().min(0),
    limit: z.number().int().positive(),
  }),
  evalRunsPerDay: z.object({
    used: z.number().int().min(0),
    limit: z.number().int().positive(),
  }),
  integrations: z.object({
    used: z.number().int().min(0),
    limit: z.number().int().positive(),
  }),
  retentionDays: z.object({
    limit: z.number().int().positive(),
  }),
});

export const accountPlanSchema = z.object({
  tier: planTierSchema,
  cloudProjectLimit: z.number().int().positive(),
  cloudProjectCount: z.number().int().min(0),
  remainingCloudSlots: z.number().int().min(0),
  cloudConfigured: z.boolean(),
  ownerId: uuidSchema,
  source: z.enum(["env", "store", "default"]),
  updatedAt: isoDateTimeSchema,
  axes: planAxesSchema,
});

export const setPlanSchema = z.object({
  tier: planTierSchema,
});

export const cloudUploadResultSchema = z.object({
  projectId: uuidSchema,
  cloudProjectId: uuidSchema,
  syncedAt: isoDateTimeSchema,
  plan: accountPlanSchema,
});

export type AccountPlan = z.infer<typeof accountPlanSchema>;
export type SetPlan = z.infer<typeof setPlanSchema>;
export type CloudUploadResult = z.infer<typeof cloudUploadResultSchema>;
