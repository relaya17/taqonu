import { tryFetchCloudDurabilityBundle, type CloudHydrateEnv } from "@atlas/database";
import { PLAN_CLOUD_LIMITS } from "@atlas/shared";
import {
  osStore,
  type StoredTenantSubscription,
} from "../store/os-store.js";

export interface StoreHydrateResult {
  readonly attempted: boolean;
  readonly hydrated: boolean;
  readonly projects: number;
  readonly memories: number;
  readonly decisions: number;
  readonly plans: number;
  readonly reason?: string;
}

/**
 * When local osStore is empty and Supabase is live, pull critical domains
 * (projects, memories, decisions, account_plans) and merge once.
 * QA portfolio patterns ride the local atomic store (+ optional heartbeat
 * backups); cross-project lessons also dual-write as memories.
 */
export async function hydrateOsStoreFromCloudIfEmpty(
  env: CloudHydrateEnv,
  options?: { readonly ownerId?: string | null },
): Promise<StoreHydrateResult> {
  osStore.ensureLoaded();
  if (!osStore.isEssentiallyEmpty()) {
    return {
      attempted: false,
      hydrated: false,
      projects: 0,
      memories: 0,
      decisions: 0,
      plans: 0,
      reason: "local_store_not_empty",
    };
  }

  const bundle = await tryFetchCloudDurabilityBundle(env, {
    ownerId: options?.ownerId ?? null,
  });
  if (!bundle) {
    return {
      attempted: true,
      hydrated: false,
      projects: 0,
      memories: 0,
      decisions: 0,
      plans: 0,
      reason: "cloud_unavailable",
    };
  }

  const tenantSubscriptions: StoredTenantSubscription[] = bundle.accountPlans.map(
    (plan) => ({
      ownerId: plan.ownerId,
      tier: plan.tier,
      status: plan.tier === "pro" ? "active" : "none",
      cloudSlotLimit: plan.cloudProjectLimit || PLAN_CLOUD_LIMITS[plan.tier],
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      updatedAt: plan.updatedAt,
    }),
  );

  const counts = osStore.applyCloudHydration({
    projects: bundle.projects,
    memories: bundle.memories,
    decisions: bundle.decisions,
    tenantSubscriptions,
  });

  const hydrated =
    counts.projects + counts.memories + counts.decisions + counts.plans > 0;

  return {
    attempted: true,
    hydrated,
    ...counts,
    reason: hydrated ? "ok" : "cloud_empty",
  };
}
