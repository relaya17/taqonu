import { z } from "zod";
import {
  CUSTOMER_CLOUD_PROVIDERS,
  PLATFORM_VERSION,
  PREFERRED_CUSTOMER_CLOUD,
  STORAGE_MODELS,
  STORAGE_POLICY_VERSION,
} from "../constants/platform.js";
import { PLAN_AXIS_LIMITS, PLAN_CLOUD_LIMITS } from "../constants/plans.js";
import { isoDateTimeSchema } from "./common.schema.js";

export const storageModelSchema = z.enum(STORAGE_MODELS);
export const customerCloudProviderSchema = z.enum(CUSTOMER_CLOUD_PROVIDERS);

export const byoCloudBindingStatusSchema = z.enum([
  "disconnected",
  "connected",
  "error",
]);

/** Customer connects their own Cloudflare (or other) account — Atlas never hosts their blob store. */
export const byoCloudBindingSchema = z.object({
  provider: customerCloudProviderSchema,
  status: byoCloudBindingStatusSchema,
  accountLabel: z.string().max(200).nullable(),
  /** Non-secret account / account-tag id only — never API tokens in responses. */
  externalAccountId: z.string().max(200).nullable(),
  connectedAt: isoDateTimeSchema.nullable(),
  lastError: z.string().max(500).nullable(),
  capabilities: z.array(z.enum(["r2", "d1", "kv", "workers", "pages"])).default([]),
});

export const connectByoCloudSchema = z.object({
  provider: z.literal("cloudflare"),
  accountLabel: z.string().min(1).max(200),
  /**
   * Opaque binding token / API token — accepted for connect, never stored in
   * plaintext responses. Persistence strategy: encrypted at rest (future KV).
   * For v1 we only store that a connection was declared + non-secret metadata.
   */
  apiToken: z.string().min(8).max(2000).optional(),
  externalAccountId: z.string().min(1).max(200).optional(),
  capabilities: z
    .array(z.enum(["r2", "d1", "kv", "workers", "pages"]))
    .max(8)
    .optional(),
});

export const disconnectByoCloudSchema = z.object({
  provider: z.literal("cloudflare"),
});

const usageAxisSummarySchema = z.object({
  evidenceRecords: z.number().int().positive(),
  evalRunsPerDay: z.number().int().positive(),
  processAuditsPerDay: z.number().int().positive(),
  agentMessagesPerDay: z.number().int().positive(),
  integrations: z.number().int().positive(),
  retentionDays: z.number().int().positive(),
});

/**
 * Storage + monetization policy (v2).
 * Free = Cloudflare (customer) + limited Atlas *usage*.
 * Atlas does not give free hosted project storage.
 */
export const storagePolicySchema = z.object({
  model: storageModelSchema,
  policyVersion: z.string().min(1),
  platformVersion: z.string().min(1),
  preferredCustomerCloud: customerCloudProviderSchema,
  atlasStores: z.array(z.string()),
  atlasDoesNotStore: z.array(z.string()),
  /**
   * Optional Atlas evidence-mirror slots (Pro). Free is always 0 —
   * customers use their Cloudflare free tier for data.
   */
  atlasEvidenceMirrorSlots: z.object({
    free: z.number().int().min(0),
    pro: z.number().int().min(0),
  }),
  /** @deprecated Alias of atlasEvidenceMirrorSlots.free for older UIs */
  freeCloudProjectSlots: z.number().int().min(0),
  usageLimits: z.object({
    free: usageAxisSummarySchema,
    pro: usageAxisSummarySchema,
  }),
  customerPaysProvidersFor: z.array(z.string()),
  plainLanguage: z.string(),
});

export const platformInfoSchema = z.object({
  name: z.string(),
  codename: z.string(),
  version: z.string(),
  storagePolicyVersion: z.string(),
  storageModel: storageModelSchema,
  preferredCustomerCloud: customerCloudProviderSchema,
});

export function buildDefaultStoragePolicy(): z.infer<typeof storagePolicySchema> {
  return storagePolicySchema.parse({
    model: "BYO_CUSTOMER_CLOUD",
    policyVersion: STORAGE_POLICY_VERSION,
    platformVersion: PLATFORM_VERSION,
    preferredCustomerCloud: PREFERRED_CUSTOMER_CLOUD,
    atlasStores: [
      "Session + governance events (approvals, audit trail)",
      "Evidence Graph references (not full source trees)",
      "Release Verdict / Readiness summaries",
      "Optional Pro-only evidence metadata mirror",
    ],
    atlasDoesNotStore: [
      "Full source trees / git blobs",
      "Customer Cloudflare R2/D1/KV payloads",
      "Wholesale CI logs",
      "Secrets / API tokens (never echoed back)",
      "Free Atlas-hosted project storage (not offered)",
    ],
    atlasEvidenceMirrorSlots: {
      free: PLAN_CLOUD_LIMITS.free,
      pro: PLAN_CLOUD_LIMITS.pro,
    },
    freeCloudProjectSlots: PLAN_CLOUD_LIMITS.free,
    usageLimits: {
      free: {
        evidenceRecords: PLAN_AXIS_LIMITS.free.evidenceRecords,
        evalRunsPerDay: PLAN_AXIS_LIMITS.free.evalRunsPerDay,
        processAuditsPerDay: PLAN_AXIS_LIMITS.free.processAuditsPerDay,
        agentMessagesPerDay: PLAN_AXIS_LIMITS.free.agentMessagesPerDay,
        integrations: PLAN_AXIS_LIMITS.free.integrations,
        retentionDays: PLAN_AXIS_LIMITS.free.retentionDays,
      },
      pro: {
        evidenceRecords: PLAN_AXIS_LIMITS.pro.evidenceRecords,
        evalRunsPerDay: PLAN_AXIS_LIMITS.pro.evalRunsPerDay,
        processAuditsPerDay: PLAN_AXIS_LIMITS.pro.processAuditsPerDay,
        agentMessagesPerDay: PLAN_AXIS_LIMITS.pro.agentMessagesPerDay,
        integrations: PLAN_AXIS_LIMITS.pro.integrations,
        retentionDays: PLAN_AXIS_LIMITS.pro.retentionDays,
      },
    },
    customerPaysProvidersFor: [
      "Cloudflare (Workers / R2 / D1 / KV / Pages) — free tier is theirs",
      "GitHub / GitLab / Bitbucket hosting",
      "Other cloud compute & databases (AWS / Azure / GCP) if chosen",
      "CI minutes & monitoring",
    ],
    plainLanguage:
      "Your projects live on your external cloud (Cloudflare free tier recommended). Atlas does not host your data for free. Free Atlas = limited product usage (audits, eval, agent). Pro = higher usage limits and optional evidence mirror.",
  });
}

export type ByoCloudBinding = z.infer<typeof byoCloudBindingSchema>;
export type ConnectByoCloud = z.infer<typeof connectByoCloudSchema>;
export type StoragePolicy = z.infer<typeof storagePolicySchema>;
export type PlatformInfo = z.infer<typeof platformInfoSchema>;
