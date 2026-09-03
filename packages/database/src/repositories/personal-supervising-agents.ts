import {
  personalSupervisingAgentRecordSchema,
  type PersonalSupervisingAgentRecord,
} from "@atlas/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PersonalSupervisingAgentStore = {
  getByOwner(ownerId: string): Promise<PersonalSupervisingAgentRecord | null>;
  upsert(
    record: PersonalSupervisingAgentRecord,
  ): Promise<PersonalSupervisingAgentRecord>;
};

export class PsaPersistenceError extends Error {
  readonly kind: "CONFLICT" | "UNAVAILABLE";

  constructor(kind: "CONFLICT" | "UNAVAILABLE", message: string) {
    super(message);
    this.name = "PsaPersistenceError";
    this.kind = kind;
  }
}

export class PersonalSupervisingAgentRepository {
  constructor(private readonly store: PersonalSupervisingAgentStore) {}

  static fromSupabase(client: SupabaseClient): PersonalSupervisingAgentRepository {
    return new PersonalSupervisingAgentRepository(createPostgresPsaStore(client));
  }

  async getByOwner(ownerId: string): Promise<PersonalSupervisingAgentRecord | null> {
    try {
      return await this.store.getByOwner(ownerId);
    } catch (error) {
      throw wrapStoreError(error);
    }
  }

  async save(record: PersonalSupervisingAgentRecord): Promise<PersonalSupervisingAgentRecord> {
    const parsed = personalSupervisingAgentRecordSchema.parse(record);
    let existing: PersonalSupervisingAgentRecord | null;
    try {
      existing = await this.store.getByOwner(parsed.scope.ownerId);
    } catch (error) {
      throw wrapStoreError(error);
    }
    const next = existing ? mergeExisting(existing, parsed) : parsed;
    try {
      return await this.store.upsert(next);
    } catch (error) {
      throw wrapStoreError(error);
    }
  }
}

function mergeExisting(
  existing: PersonalSupervisingAgentRecord,
  incoming: PersonalSupervisingAgentRecord,
): PersonalSupervisingAgentRecord {
  if (existing.scope.ownerId !== incoming.scope.ownerId) {
    throw new PsaPersistenceError(
      "CONFLICT",
      "Personal Supervising Agent owner cannot be changed",
    );
  }
  if (existing.status === "REVOKED" && incoming.status !== "REVOKED") {
    throw new PsaPersistenceError(
      "CONFLICT",
      "A revoked Personal Supervising Agent cannot be recreated or reactivated",
    );
  }
  return personalSupervisingAgentRecordSchema.parse({
    ...incoming,
    agentClass: existing.agentClass,
    agentId: existing.agentId,
    scope: existing.scope,
    createdAt: existing.createdAt,
  });
}

function wrapStoreError(error: unknown): PsaPersistenceError {
  if (error instanceof PsaPersistenceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/revoked|immutable|cannot be deleted|cannot be changed/i.test(message)) {
    return new PsaPersistenceError("CONFLICT", message);
  }
  return new PsaPersistenceError("UNAVAILABLE", message);
}

export function createPostgresPsaStore(client: SupabaseClient): PersonalSupervisingAgentStore {
  return {
    async getByOwner(ownerId: string): Promise<PersonalSupervisingAgentRecord | null> {
      const { data, error } = await client
        .from("personal_supervising_agents")
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as Record<string, unknown>) : null;
    },
    async upsert(record: PersonalSupervisingAgentRecord): Promise<PersonalSupervisingAgentRecord> {
      const { data, error } = await client
        .from("personal_supervising_agents")
        .upsert(toRow(record), { onConflict: "owner_id" })
        .select("*")
        .single();
      if (error) throw error;
      return mapRow(data as Record<string, unknown>);
    },
  };
}

function toRow(record: PersonalSupervisingAgentRecord): Record<string, unknown> {
  return {
    owner_id: record.scope.ownerId,
    agent_id: record.agentId,
    agent_class: record.agentClass,
    tenant_id: record.scope.tenantId,
    project_ids: [...record.scope.projectIds],
    application_ids: [...record.scope.applicationIds],
    status: record.status,
    recommendations: [...record.recommendations],
    escalations: [...record.escalations],
    created_at: record.createdAt,
    last_activity_at: record.lastActivityAt,
    updated_at: record.lastActivityAt,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mapRow(row: Record<string, unknown>): PersonalSupervisingAgentRecord {
  return personalSupervisingAgentRecordSchema.parse({
    agentClass: row.agent_class,
    agentId: row.agent_id,
    scope: {
      ownerId: row.owner_id,
      tenantId: row.tenant_id,
      projectIds: asStringArray(row.project_ids),
      applicationIds: asStringArray(row.application_ids),
    },
    status: row.status,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    recommendations: row.recommendations ?? [],
    escalations: row.escalations ?? [],
  });
}
