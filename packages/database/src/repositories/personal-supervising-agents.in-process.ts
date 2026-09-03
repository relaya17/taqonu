import type { PersonalSupervisingAgentRecord } from "@atlas/shared";
import type { PersonalSupervisingAgentStore } from "./personal-supervising-agents.js";

/**
 * Isolated durable Map for tests. Sharing one store across repository
 * instances simulates API process restart. A new store is a new process.
 */
export function createInProcessPersonalSupervisingAgentStore(): PersonalSupervisingAgentStore {
  const rows = new Map<string, PersonalSupervisingAgentRecord>();
  return {
    async getByOwner(ownerId: string): Promise<PersonalSupervisingAgentRecord | null> {
      return rows.get(ownerId) ?? null;
    },
    async upsert(
      record: PersonalSupervisingAgentRecord,
    ): Promise<PersonalSupervisingAgentRecord> {
      rows.set(record.scope.ownerId, record);
      return record;
    },
  };
}
