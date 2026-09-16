import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Step 4 Decision B — the durable subset of agent runtime status, owned by
 * apps/api's own database. SUSPENDED/DEGRADED are deliberately absent: they
 * remain Control Plane's own ephemeral, in-memory overlay, unchanged by
 * this repository. Absence of a row is "no durable override" -- callers
 * treat that as ACTIVE-for-this-subset, not as UNKNOWN/failure.
 */
export const DURABLE_AGENT_RUNTIME_STATUSES = [
  "PAUSED",
  "QUARANTINED",
  "REVOKED",
  "DISABLED",
] as const;

export type DurableAgentRuntimeStatus = (typeof DURABLE_AGENT_RUNTIME_STATUSES)[number];

export function isDurableAgentRuntimeStatus(
  value: string,
): value is DurableAgentRuntimeStatus {
  return (DURABLE_AGENT_RUNTIME_STATUSES as readonly string[]).includes(value);
}

export interface AgentRuntimeControlRecord {
  readonly agentId: string;
  readonly status: DurableAgentRuntimeStatus;
  readonly setBy: string;
  readonly reason: string;
  readonly setAt: string;
  readonly expiresAt: string | null;
}

export type AgentRuntimeControlStore = {
  get(agentId: string): Promise<AgentRuntimeControlRecord | null>;
  upsert(record: AgentRuntimeControlRecord): Promise<AgentRuntimeControlRecord>;
  clear(agentId: string): Promise<void>;
};

export class AgentRuntimeControlPersistenceError extends Error {
  readonly kind: "UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeControlPersistenceError";
    this.kind = "UNAVAILABLE";
  }
}

/**
 * The durable subset's single writer/reader boundary. Not a second
 * approval-style authority -- this is a plain status overlay, shaped like
 * `ApprovalRequest`'s own owner/reason/expiry pattern, deliberately simpler
 * (no lifecycle state machine) because a runtime-control override has no
 * claim/consume/finalize semantics.
 */
export class AgentRuntimeControlRepository {
  constructor(private readonly store: AgentRuntimeControlStore) {}

  static fromSupabase(client: SupabaseClient): AgentRuntimeControlRepository {
    return new AgentRuntimeControlRepository(createPostgresAgentRuntimeControlStore(client));
  }

  async get(agentId: string): Promise<AgentRuntimeControlRecord | null> {
    try {
      return await this.store.get(agentId);
    } catch (error) {
      throw wrapStoreError(error);
    }
  }

  async set(record: AgentRuntimeControlRecord): Promise<AgentRuntimeControlRecord> {
    try {
      return await this.store.upsert(record);
    } catch (error) {
      throw wrapStoreError(error);
    }
  }

  async clear(agentId: string): Promise<void> {
    try {
      await this.store.clear(agentId);
    } catch (error) {
      throw wrapStoreError(error);
    }
  }
}

function wrapStoreError(error: unknown): AgentRuntimeControlPersistenceError {
  if (error instanceof AgentRuntimeControlPersistenceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AgentRuntimeControlPersistenceError(message);
}

export function createPostgresAgentRuntimeControlStore(
  client: SupabaseClient,
): AgentRuntimeControlStore {
  return {
    async get(agentId: string): Promise<AgentRuntimeControlRecord | null> {
      const { data, error } = await client
        .from("agent_runtime_controls")
        .select("*")
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as Record<string, unknown>) : null;
    },
    async upsert(record: AgentRuntimeControlRecord): Promise<AgentRuntimeControlRecord> {
      const { data, error } = await client
        .from("agent_runtime_controls")
        .upsert(toRow(record), { onConflict: "agent_id" })
        .select("*")
        .single();
      if (error) throw error;
      return mapRow(data as Record<string, unknown>);
    },
    async clear(agentId: string): Promise<void> {
      const { error } = await client
        .from("agent_runtime_controls")
        .delete()
        .eq("agent_id", agentId);
      if (error) throw error;
    },
  };
}

function toRow(record: AgentRuntimeControlRecord): Record<string, unknown> {
  return {
    agent_id: record.agentId,
    status: record.status,
    set_by: record.setBy,
    reason: record.reason,
    set_at: record.setAt,
    expires_at: record.expiresAt,
  };
}

function mapRow(row: Record<string, unknown>): AgentRuntimeControlRecord {
  const status = row.status as string;
  return {
    agentId: row.agent_id as string,
    status: isDurableAgentRuntimeStatus(status) ? status : "PAUSED",
    setBy: row.set_by as string,
    reason: row.reason as string,
    setAt: row.set_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
  };
}
