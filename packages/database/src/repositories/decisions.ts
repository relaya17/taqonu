import type { Decision } from "@atlas/shared";
import { decisionSchema } from "@atlas/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Durable decisions persistence — mirrors local `osStore.decisions` into
 * `public.decisions` when Supabase is live (schema: init migration).
 */
export class DecisionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(decision: Decision, ownerId: string): Promise<Decision> {
    const { data, error } = await this.client
      .from("decisions")
      .upsert(
        {
          id: decision.id,
          owner_id: ownerId,
          project_id: decision.projectId,
          decision: decision.decision,
          reason: decision.reason,
          alternatives: decision.alternatives,
          trade_offs: decision.tradeOffs,
          evidence: decision.evidence,
          status: decision.status,
          confidence: decision.confidence,
          epistemic_state: decision.epistemicState,
          superseded_by: decision.supersededBy,
          adr_path: decision.adrPath,
          decided_at: decision.decidedAt,
          created_at: decision.createdAt,
          updated_at: decision.updatedAt,
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();

    if (error) throw error;
    return mapDecision(data);
  }

  async listByOwner(ownerId?: string | null): Promise<readonly Decision[]> {
    let query = this.client.from("decisions").select("*").order("updated_at", {
      ascending: false,
    });
    if (ownerId) {
      query = query.eq("owner_id", ownerId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => mapDecision(row));
  }
}

function mapDecision(row: Record<string, unknown>): Decision {
  return decisionSchema.parse({
    id: row.id,
    projectId: row.project_id ?? null,
    decision: row.decision,
    reason: row.reason ?? [],
    alternatives: row.alternatives ?? [],
    tradeOffs: row.trade_offs ?? [],
    evidence: row.evidence ?? [],
    status: row.status,
    confidence: Number(row.confidence ?? 1),
    epistemicState: row.epistemic_state,
    supersededBy: row.superseded_by ?? null,
    adrPath: row.adr_path ?? null,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
