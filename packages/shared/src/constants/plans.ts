/** Freemium = Atlas *usage* limits. Customer cloud (Cloudflare) holds data. */

export const PLAN_TIERS = ["free", "pro"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/**
 * Optional Atlas-hosted evidence mirror slots (NOT customer project storage).
 * Free = 0 — we do not subsidize hosted storage. Pro may mirror metadata.
 */
export const PLAN_CLOUD_LIMITS: Record<PlanTier, number> = {
  free: 0,
  pro: 100,
};

/** Product usage axes Atlas meters and sells (ADR-014 §12 + storage policy v2). */
export const PLAN_AXIS_LIMITS: Record<
  PlanTier,
  {
    evidenceRecords: number;
    evalRunsPerDay: number;
    processAuditsPerDay: number;
    agentMessagesPerDay: number;
    integrations: number;
    retentionDays: number;
  }
> = {
  free: {
    evidenceRecords: 200,
    evalRunsPerDay: 20,
    processAuditsPerDay: 5,
    agentMessagesPerDay: 40,
    integrations: 3,
    retentionDays: 30,
  },
  pro: {
    evidenceRecords: 10_000,
    evalRunsPerDay: 500,
    processAuditsPerDay: 100,
    agentMessagesPerDay: 2_000,
    integrations: 25,
    retentionDays: 365,
  },
};

/** Personal-instance owner until real auth (must be valid uuid). */
export const STUB_OWNER_ID = "00000000-0000-4000-8000-000000000001";

/** Paid assists credits — ADR-013 */
export const CREDIT_PACKS = {
  starter: { credits: 50, label: "Starter" },
  growth: { credits: 200, label: "Growth" },
  scale: { credits: 1000, label: "Scale" },
} as const;

export const ASSIST_CREDIT_COST = {
  "local-checklist": 0,
  "gpt-4o-vision": 5,
} as const;

export const FREE_MONTHLY_ASSIST_CREDITS = 5;
export const PRO_MONTHLY_ASSIST_CREDITS = 50;
