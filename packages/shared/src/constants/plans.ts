/** Freemium quotas — ADR-011 + ADR-014 multi-axis */
export const PLAN_TIERS = ["free", "pro"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const PLAN_CLOUD_LIMITS: Record<PlanTier, number> = {
  free: 3,
  pro: 100,
};

/** Metering axes beyond cloud projects (ADR-014 §12). */
export const PLAN_AXIS_LIMITS: Record<
  PlanTier,
  {
    evidenceRecords: number;
    evalRunsPerDay: number;
    integrations: number;
    retentionDays: number;
  }
> = {
  free: {
    evidenceRecords: 200,
    evalRunsPerDay: 20,
    integrations: 2,
    retentionDays: 30,
  },
  pro: {
    evidenceRecords: 10_000,
    evalRunsPerDay: 500,
    integrations: 20,
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
