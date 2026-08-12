import {
  AtlasError,
  PLAN_AXIS_LIMITS,
  PLAN_CLOUD_LIMITS,
  STUB_OWNER_ID,
  accountPlanSchema,
  accountUsageSchema,
  type AccountPlan,
  type AccountUsage,
  type PlanTier,
} from "@atlas/shared";
import {
  countCloudProjects,
  isLiveSupabase,
  tryPersistAccountPlanToSupabase,
} from "@atlas/database";
import type { ServerEnv } from "@atlas/config";
import {
  osStore,
  type StoredTenantSubscription,
  type TenantSubscriptionStatus,
} from "../store/os-store.js";

type EnvSlice = Pick<
  ServerEnv,
  | "SUPABASE_URL"
  | "SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "ATLAS_PLAN"
  | "ATLAS_CLOUD_PROJECT_LIMIT"
  | "ATLAS_OWNER_ID"
>;

/**
 * Resolve the tenant/owner id for a cloud write.
 *
 * `requestOwnerId` — the signed-in user's own id (from Auth-first
 * `getRequestUser` / `resolveRequestIdentity`) — takes priority so each
 * authenticated user's rows are tagged with *their* id, which is what
 * Supabase RLS policies (`auth.uid() = owner_id`) check. `ATLAS_OWNER_ID`/
 * `STUB_OWNER_ID` remain as the legacy fallback for unauthenticated/
 * system-initiated writes (personal single-owner deployments, background jobs).
 */
export function resolveOwnerId(env: EnvSlice, requestOwnerId?: string | null): string {
  return requestOwnerId ?? env.ATLAS_OWNER_ID ?? STUB_OWNER_ID;
}

export function resolveTier(
  env: EnvSlice,
  ownerId?: string | null,
): {
  tier: PlanTier;
  source: AccountPlan["source"];
  subscriptionStatus?: AccountPlan["subscriptionStatus"];
  stripeCustomerId?: string | null;
  cloudSlotLimit?: number;
  updatedAt?: string;
} {
  if (env.ATLAS_PLAN) {
    return { tier: env.ATLAS_PLAN, source: "env" };
  }

  const resolvedOwner = ownerId ?? resolveOwnerId(env);
  const tenant = osStore.getTenantSubscription(resolvedOwner);
  if (tenant) {
    return {
      tier: tenant.tier,
      source: "tenant",
      subscriptionStatus: tenant.status,
      stripeCustomerId: tenant.stripeCustomerId,
      cloudSlotLimit: tenant.cloudSlotLimit,
      updatedAt: tenant.updatedAt,
    };
  }

  // Legacy single-instance plan only applies to the env/stub owner — never
  // bleed Owner A's Stripe upgrade into Owner B's free default.
  const legacyOwner = resolveOwnerId(env);
  if (resolvedOwner === legacyOwner) {
    const stored = osStore.getPlan();
    if (stored) {
      return { tier: stored.tier, source: "store", updatedAt: stored.updatedAt };
    }
  }

  return { tier: "free", source: "default", subscriptionStatus: "none" };
}

export function resolveCloudLimit(
  env: EnvSlice,
  tier: PlanTier,
  tenantSlotLimit?: number,
): number {
  if (env.ATLAS_CLOUD_PROJECT_LIMIT) {
    return env.ATLAS_CLOUD_PROJECT_LIMIT;
  }
  if (tenantSlotLimit && tenantSlotLimit > 0) {
    return tenantSlotLimit;
  }
  return PLAN_CLOUD_LIMITS[tier];
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function upsertTenantSubscription(input: {
  ownerId: string;
  tier: PlanTier;
  status?: TenantSubscriptionStatus;
  cloudSlotLimit?: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): StoredTenantSubscription {
  const existing = osStore.getTenantSubscription(input.ownerId);
  const next: StoredTenantSubscription = {
    ownerId: input.ownerId,
    tier: input.tier,
    status: input.status ?? existing?.status ?? (input.tier === "pro" ? "active" : "none"),
    cloudSlotLimit:
      input.cloudSlotLimit ??
      existing?.cloudSlotLimit ??
      PLAN_CLOUD_LIMITS[input.tier],
    stripeCustomerId:
      input.stripeCustomerId !== undefined
        ? input.stripeCustomerId
        : (existing?.stripeCustomerId ?? null),
    stripeSubscriptionId:
      input.stripeSubscriptionId !== undefined
        ? input.stripeSubscriptionId
        : (existing?.stripeSubscriptionId ?? null),
    updatedAt: new Date().toISOString(),
  };
  osStore.setTenantSubscription(next);
  // Best-effort cloud mirror — never blocks billing transitions.
  void tryPersistAccountPlanToSupabase(
    {
      SUPABASE_URL: process.env.SUPABASE_URL ?? "",
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    },
    {
      ownerId: next.ownerId,
      tier: next.tier,
      cloudProjectLimit: next.cloudSlotLimit,
      updatedAt: next.updatedAt,
    },
  ).catch(() => undefined);
  return next;
}

export async function getAccountPlan(
  env: EnvSlice,
  identity?: { readonly ownerId?: string | null; readonly userAccessToken?: string | null },
): Promise<AccountPlan> {
  osStore.ensureLoaded();
  const ownerId = resolveOwnerId(env, identity?.ownerId);
  const resolved = resolveTier(env, ownerId);
  const { tier, source } = resolved;
  const limit = resolveCloudLimit(env, tier, resolved.cloudSlotLimit);
  const cloudConfigured = isLiveSupabase(env);
  const axisLimits = PLAN_AXIS_LIMITS[tier];

  let cloudCount = osStore.countCloudLinkedProjects();
  if (cloudConfigured) {
    const remote = await countCloudProjects(env, ownerId, identity?.userAccessToken);
    if (remote !== null) {
      cloudCount = Math.max(cloudCount, remote);
    }
  }

  const remaining = Math.max(0, limit - cloudCount);

  return accountPlanSchema.parse({
    tier,
    cloudProjectLimit: limit,
    cloudProjectCount: cloudCount,
    remainingCloudSlots: remaining,
    cloudConfigured,
    ownerId,
    source,
    updatedAt: resolved.updatedAt ?? new Date().toISOString(),
    subscriptionStatus: resolved.subscriptionStatus ?? "none",
    stripeCustomerId: resolved.stripeCustomerId ?? null,
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

export async function getAccountUsage(
  env: EnvSlice,
  identity?: { readonly ownerId?: string | null; readonly userAccessToken?: string | null },
): Promise<AccountUsage> {
  const plan = await getAccountPlan(env, identity);
  return accountUsageSchema.parse({
    ownerId: plan.ownerId,
    tier: plan.tier,
    cloudProjectLimit: plan.cloudProjectLimit,
    cloudProjectCount: plan.cloudProjectCount,
    remainingCloudSlots: plan.remainingCloudSlots,
    subscriptionStatus: plan.subscriptionStatus,
    axes: plan.axes,
    updatedAt: plan.updatedAt,
  });
}

/** Persist a manual/staging tier change onto the tenant subscription row. */
export function setTenantPlanTier(
  env: EnvSlice,
  tier: PlanTier,
  ownerId?: string | null,
): void {
  const resolvedOwner = resolveOwnerId(env, ownerId);
  upsertTenantSubscription({
    ownerId: resolvedOwner,
    tier,
    status: tier === "pro" ? "active" : "none",
    cloudSlotLimit: PLAN_CLOUD_LIMITS[tier],
  });
}

export async function assertCloudSlotAvailable(
  env: EnvSlice,
  identity?: { readonly ownerId?: string | null; readonly userAccessToken?: string | null },
): Promise<AccountPlan> {
  const plan = await getAccountPlan(env, identity);
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
          ownerId: plan.ownerId,
          upgradeHint:
            'POST /api/v1/billing/stripe/checkout { "tier": "pro" } (or staging POST /billing/plan)',
        },
      },
    );
  }
  return plan;
}

/**
 * Pure quota check used by tests — does not require live Supabase.
 * Returns true when another cloud slot may be consumed.
 */
export function hasRemainingCloudSlots(input: {
  tier: PlanTier;
  cloudProjectCount: number;
  cloudProjectLimit?: number;
}): boolean {
  const limit = input.cloudProjectLimit ?? PLAN_CLOUD_LIMITS[input.tier];
  return input.cloudProjectCount < limit;
}

export function assertEvalQuota(env: EnvSlice, ownerId?: string | null): void {
  const { tier } = resolveTier(env, ownerId);
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
