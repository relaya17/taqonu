import type { Memory } from "@atlas/shared";
import { memorySchema } from "@atlas/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Durable memory persistence — mirrors `apps/api/src/store/os-store.ts`'s
 * local `memories` map into `public.memories` (+ `public.memory_evidence`)
 * when Supabase is live. Schema: `supabase/migrations/20260811000000_init.sql`,
 * `supabase/migrations/20260812010000_memories_created_by.sql`.
 */
export class MemoryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(memory: Memory, ownerId: string): Promise<Memory> {
    const { data, error } = await this.client
      .from("memories")
      .insert({
        id: memory.id,
        owner_id: ownerId,
        project_id: memory.projectId,
        type: memory.type,
        statement: memory.statement,
        reason: memory.reason,
        status: memory.status,
        confidence: memory.confidence,
        category: memory.category,
        epistemic_state: memory.epistemicState,
        observation_mode: memory.observationMode,
        source: memory.source,
        source_type: memory.sourceType,
        source_id: memory.sourceId,
        superseded_by: memory.supersededBy,
        valid_from: memory.validFrom,
        valid_until: memory.validUntil,
        observed_at: memory.observedAt,
        scope: memory.scope,
        priority: memory.priority,
        created_by: memory.createdBy,
        created_at: memory.createdAt,
        updated_at: memory.updatedAt,
      })
      .select("*")
      .single();

    if (error) throw error;

    if (memory.evidence.length > 0) {
      const { error: evidenceError } = await this.client.from("memory_evidence").insert(
        memory.evidence.map((item) => ({
          id: item.id,
          memory_id: memory.id,
          kind: item.kind,
          reference: item.reference,
          excerpt: item.excerpt ?? null,
        })),
      );
      // Non-fatal: the memory row itself is the source of truth; evidence
      // rows are supplementary provenance.
      if (evidenceError) {
        console.warn("memory_evidence insert failed", evidenceError.message);
      }
    }

    return mapMemory(data, memory.evidence, memory.createdBy);
  }

  /**
   * Apply the same approve transition the local pipeline applies
   * (`apps/api/src/services/memory-pipeline.ts#approveMemory`) to the cloud row.
   */
  async approve(
    memoryId: string,
    patch: {
      epistemicState: string;
      observationMode: string;
      confidence: number;
      reason: readonly string[];
      updatedAt: string;
    },
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from("memories")
      .update({
        epistemic_state: patch.epistemicState,
        observation_mode: patch.observationMode,
        confidence: patch.confidence,
        reason: [...patch.reason],
        updated_at: patch.updatedAt,
      })
      .eq("id", memoryId)
      .select("id");

    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async listPending(ownerId: string): Promise<readonly { id: string }[]> {
    const { data, error } = await this.client
      .from("memories")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("status", "ACTIVE")
      .in("epistemic_state", ["PROPOSED", "INFERRED", "UNVERIFIED", "ASSUMED"]);
    if (error) throw error;
    return data ?? [];
  }

  /**
   * List memories for startup hydrate. Evidence junction rows are omitted
   * (empty evidence) — statement/status/epistemic fields are enough to recover.
   */
  async listForHydrate(ownerId?: string | null): Promise<readonly Memory[]> {
    let query = this.client.from("memories").select("*").order("updated_at", {
      ascending: false,
    });
    if (ownerId) {
      query = query.eq("owner_id", ownerId);
    }
    const { data, error } = await query.limit(2000);
    if (error) throw error;
    return (data ?? []).map((row) =>
      mapMemory(row as Record<string, unknown>, [], String(row.created_by ?? "system")),
    );
  }
}

function mapMemory(
  row: Record<string, unknown>,
  evidence: Memory["evidence"],
  createdBy: string,
): Memory {
  return memorySchema.parse({
    id: row.id,
    // Tenant boundary (P0 fix): memorySchema.ownerId is now mandatory —
    // carry the Supabase row's owner_id through on hydrate, same column
    // already used for the .eq("owner_id", ownerId) filters in this file.
    ownerId: row.owner_id,
    type: row.type,
    projectId: row.project_id,
    statement: row.statement,
    reason: row.reason ?? [],
    status: row.status,
    confidence: row.confidence,
    category: row.category,
    epistemicState: row.epistemic_state,
    observationMode: row.observation_mode,
    source: row.source,
    sourceType: row.source_type,
    sourceId: row.source_id ?? null,
    evidence,
    supersededBy: row.superseded_by ?? null,
    validFrom: row.valid_from ?? null,
    validUntil: row.valid_until ?? null,
    observedAt: row.observed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? createdBy,
    scope: row.scope,
    priority: row.priority,
  });
}
