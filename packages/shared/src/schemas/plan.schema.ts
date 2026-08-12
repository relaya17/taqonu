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

export const subscriptionStatusSchema = z.enum([
  "active",
  "canceled",
  "past_due",
  "trialing",
  "incomplete",
  "none",
]);

export const accountPlanSchema = z.object({
  tier: planTierSchema,
  cloudProjectLimit: z.number().int().positive(),
  cloudProjectCount: z.number().int().min(0),
  remainingCloudSlots: z.number().int().min(0),
  cloudConfigured: z.boolean(),
  ownerId: uuidSchema,
  source: z.enum(["env", "store", "tenant", "default"]),
  updatedAt: isoDateTimeSchema,
  subscriptionStatus: subscriptionStatusSchema.optional(),
  stripeCustomerId: z.string().nullable().optional(),
  axes: planAxesSchema,
});

export const setPlanSchema = z.object({
  tier: planTierSchema,
});

/** Usage slice returned by GET /billing/usage (same tenant state as plan). */
export const accountUsageSchema = z.object({
  ownerId: uuidSchema,
  tier: planTierSchema,
  cloudProjectLimit: z.number().int().positive(),
  cloudProjectCount: z.number().int().min(0),
  remainingCloudSlots: z.number().int().min(0),
  subscriptionStatus: subscriptionStatusSchema.optional(),
  axes: planAxesSchema,
  updatedAt: isoDateTimeSchema,
});

export const cloudUploadResultSchema = z.object({
  projectId: uuidSchema,
  cloudProjectId: uuidSchema,
  syncedAt: isoDateTimeSchema,
  plan: accountPlanSchema,
});

export type AccountPlan = z.infer<typeof accountPlanSchema>;
export type AccountUsage = z.infer<typeof accountUsageSchema>;
export type SetPlan = z.infer<typeof setPlanSchema>;
export type CloudUploadResult = z.infer<typeof cloudUploadResultSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
