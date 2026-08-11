import {
  AtlasError,
  PLAN_AXIS_LIMITS,
  PLAN_CLOUD_LIMITS,
  STUB_OWNER_ID,
  accountPlanSchema,
  type AccountPlan,
  type PlanTier,
} from "@atlas/shared";
import { countCloudProjects, isLiveSupabase } from "@atlas/database";
import type { ServerEnv } from "@atlas/config";
import { osStore } from "../store/os-store.js";

type EnvSlice = Pick<
  ServerEnv,
  | "SUPABASE_URL"
  | "SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "ATLAS_PLAN"
  | "ATLAS_CLOUD_PROJECT_LIMIT"
  | "ATLAS_OWNER_ID"
>;

export function resolveOwnerId(env: EnvSlice): string {
  return env.ATLAS_OWNER_ID ?? STUB_OWNER_ID;
}

export function resolveTier(env: EnvSlice): {
  tier: PlanTier;
  source: AccountPlan["source"];
} {
  if (env.ATLAS_PLAN) {
    return { tier: env.ATLAS_PLAN, source: "env" };
  }
  const stored = osStore.getPlan();
  if (stored) {
    return { tier: stored.tier, source: "store" };
  }
  return { tier: "free", source: "default" };
}

export function resolveCloudLimit(env: EnvSlice, tier: PlanTier): number {
  if (env.ATLAS_CLOUD_PROJECT_LIMIT) {
    return env.ATLAS_CLOUD_PROJECT_LIMIT;
  }
  return PLAN_CLOUD_LIMITS[tier];
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function getAccountPlan(env: EnvSlice): Promise<AccountPlan> {
  osStore.ensureLoaded();
  const { tier, source } = resolveTier(env);
  const limit = resolveCloudLimit(env, tier);
  const ownerId = resolveOwnerId(env);
  const cloudConfigured = isLiveSupabase(env);
  const axisLimits = PLAN_AXIS_LIMITS[tier];

  let cloudCount = osStore.countCloudLinkedProjects();
  if (cloudConfigured) {
    const remote = await countCloudProjects(env, ownerId);
    if (remote !== null) {
      cloudCount = Math.max(cloudCount, remote);
    }
  }

  const remaining = Math.max(0, limit - cloudCount);
  const stored = osStore.getPlan();

  return accountPlanSchema.parse({
    tier,
    cloudProjectLimit: limit,
    cloudProjectCount: cloudCount,
    remainingCloudSlots: remaining,
    cloudConfigured,
    ownerId,
    source,
    updatedAt: stored?.updatedAt ?? new Date().toISOString(),
    axes: {
      evidenceRecords: {
        used: osStore.countEvidenceRecords(),
        limit: axisLimits.evidenceRecords,
      },
      evalRunsPerDay: {
        used: osStore.getEvalRunsToday(dayKey()),
        limit: axisLimits.evalRunsPerDay,
      },
      integrations: {
        used: osStore.countConnectedIntegrations(),
        limit: axisLimits.integrations,
      },
      retentionDays: {
        limit: axisLimits.retentionDays,
      },
    },
  });
}

export async function assertCloudSlotAvailable(env: EnvSlice): Promise<AccountPlan> {
  const plan = await getAccountPlan(env);
  if (!plan.cloudConfigured) {
    throw new AtlasError(
      "CONFIG_ERROR",
      "Cloud database is not configured. Set live SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      { statusCode: 503 },
    );
  }
  if (plan.remainingCloudSlots <= 0) {
    throw new AtlasError(
      "QUOTA_EXCEEDED",
      `Cloud project limit reached (${plan.cloudProjectCount}/${plan.cloudProjectLimit} on ${plan.tier}). Upgrade to pro for more slots.`,
      {
        statusCode: 402,
        details: {
          tier: plan.tier,
          cloudProjectLimit: plan.cloudProjectLimit,
          cloudProjectCount: plan.cloudProjectCount,
          upgradeHint:
            'POST /api/v1/billing/plan { "tier": "pro" } or set ATLAS_PLAN=pro',
        },
      },
    );
  }
  return plan;
}

export function assertEvalQuota(env: EnvSlice): void {
  const { tier } = resolveTier(env);
  const limit = PLAN_AXIS_LIMITS[tier].evalRunsPerDay;
  const used = osStore.getEvalRunsToday(dayKey());
  if (used >= limit) {
    throw new AtlasError(
      "QUOTA_EXCEEDED",
      `Eval compute quota reached (${used}/${limit} runs today on ${tier}).`,
      { statusCode: 402, details: { axis: "evalRunsPerDay", used, limit, tier } },
    );
  }
}

export function recordEvalRunUsage(): void {
  osStore.incrementEvalRunMeter(dayKey());
}
