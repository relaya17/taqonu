import type { Decision, Memory, Project } from "@atlas/shared";
import { createDatabaseClients } from "./client.js";
import { isLiveSupabase } from "./persist.js";
import {
  AccountPlanRepository,
  type AccountPlanRecord,
} from "./repositories/account-plans.js";
import { DecisionRepository } from "./repositories/decisions.js";
import { MemoryRepository } from "./repositories/memories.js";
import { ProjectRepository } from "./repositories/projects.js";

export type CloudHydrateEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export interface CloudDurabilityBundle {
  readonly projects: readonly Project[];
  readonly memories: readonly Memory[];
  readonly decisions: readonly Decision[];
  readonly accountPlans: readonly AccountPlanRecord[];
}

/**
 * Fetch critical durability domains from live Supabase for startup recovery.
 * Uses the service-role client (bypass RLS) so a wiped local `.atlas/store.json`
 * can be rebuilt without a user session. Returns null when cloud is offline
 * or the fetch fails — callers keep an empty local store.
 *
 * When `ownerId` is set, scopes projects/memories/decisions to that tenant;
 * account_plans are always listed (small table) and filtered client-side.
 */
export async function tryFetchCloudDurabilityBundle(
  env: CloudHydrateEnv,
  options?: { readonly ownerId?: string | null },
): Promise<CloudDurabilityBundle | null> {
  if (!isLiveSupabase(env)) return null;
  try {
    const service = createDatabaseClients({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    }).service;

    const projectsRepo = new ProjectRepository(service);
    const memoriesRepo = new MemoryRepository(service);
    const decisionsRepo = new DecisionRepository(service);
    const plansRepo = new AccountPlanRepository(service);

    const ownerId = options?.ownerId ?? null;
    const [projects, memories, decisions, accountPlans] = await Promise.all([
      ownerId ? projectsRepo.listByOwner(ownerId) : projectsRepo.list(),
      memoriesRepo.listForHydrate(ownerId),
      decisionsRepo.listByOwner(ownerId),
      plansRepo.listAll(),
    ]);

    const plans = ownerId
      ? accountPlans.filter((p) => p.ownerId === ownerId)
      : accountPlans;

    return {
      projects,
      memories,
      decisions,
      accountPlans: plans,
    };
  } catch {
    return null;
  }
}
