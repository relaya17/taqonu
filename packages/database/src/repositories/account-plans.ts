import type { SupabaseClient } from "@supabase/supabase-js";

/** Cloud mirror of freemium `tenantSubscriptions` (ADR-011 / account_plans). */
export interface AccountPlanRecord {
  readonly ownerId: string;
  readonly tier: "free" | "pro";
  readonly cloudProjectLimit: number;
  readonly updatedAt: string;
}

/**
 * Dual-write / hydrate for `public.account_plans`. Service-role writes are
 * expected (billing webhooks + startup recovery); RLS has select/update for
 * the owning user but inserts typically go through service role.
 */
export class AccountPlanRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(plan: AccountPlanRecord): Promise<AccountPlanRecord> {
    const { data, error } = await this.client
      .from("account_plans")
      .upsert(
        {
          owner_id: plan.ownerId,
          tier: plan.tier,
          cloud_project_limit: plan.cloudProjectLimit,
          updated_at: plan.updatedAt,
        },
        { onConflict: "owner_id" },
      )
      .select("*")
      .single();

    if (error) throw error;
    return mapPlan(data);
  }

  async listAll(): Promise<readonly AccountPlanRecord[]> {
    const { data, error } = await this.client
      .from("account_plans")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapPlan(row));
  }

  async getByOwner(ownerId: string): Promise<AccountPlanRecord | null> {
    const { data, error } = await this.client
      .from("account_plans")
      .select("*")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPlan(data) : null;
  }
}

function mapPlan(row: Record<string, unknown>): AccountPlanRecord {
  const tier = row.tier === "pro" ? "pro" : "free";
  return {
    ownerId: String(row.owner_id),
    tier,
    cloudProjectLimit: Number(row.cloud_project_limit ?? 3),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}
