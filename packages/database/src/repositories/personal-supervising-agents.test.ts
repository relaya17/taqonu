import { describe, expect, it, vi } from "vitest";
import {
  PERSONAL_SUPERVISING_AGENT_CLASS,
  personalSupervisingAgentId,
  type PersonalSupervisingAgentRecord,
} from "@atlas/shared";
import { createDatabaseClients } from "../client.js";
import { createInProcessPersonalSupervisingAgentStore } from "./personal-supervising-agents.in-process.js";
import {
  PersonalSupervisingAgentRepository,
  PsaPersistenceError,
} from "./personal-supervising-agents.js";

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  ownerId: string,
  overrides: Partial<PersonalSupervisingAgentRecord> = {},
): PersonalSupervisingAgentRecord {
  const now = "2026-09-03T12:00:00.000Z";
  return {
    agentClass: PERSONAL_SUPERVISING_AGENT_CLASS,
    agentId: personalSupervisingAgentId(ownerId),
    scope: {
      ownerId,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha"],
      applicationIds: ["civio"],
    },
    status: "ACTIVE",
    createdAt: now,
    lastActivityAt: now,
    recommendations: [],
    escalations: [],
    ...overrides,
  };
}

describe("PersonalSupervisingAgentRepository", () => {
  it("resolves the same owner to the same identity after repository restart", async () => {
    const durable = createInProcessPersonalSupervisingAgentStore();
    const first = new PersonalSupervisingAgentRepository(durable);
    const created = await first.save(record(OWNER_A));
    const second = new PersonalSupervisingAgentRepository(durable);
    const loaded = await second.getByOwner(OWNER_A);
    expect(loaded?.agentId).toBe(created.agentId);
    expect(loaded?.createdAt).toBe(created.createdAt);
    expect(loaded?.scope.ownerId).toBe(OWNER_A);
    const isolated = new PersonalSupervisingAgentRepository(
      createInProcessPersonalSupervisingAgentStore(),
    );
    expect(await isolated.getByOwner(OWNER_A)).toBeNull();
  });

  it("isolates owners", async () => {
    const store = createInProcessPersonalSupervisingAgentStore();
    const repository = new PersonalSupervisingAgentRepository(store);
    await repository.save(record(OWNER_A));
    await repository.save(
      record(OWNER_B, {
        scope: {
          ownerId: OWNER_B,
          tenantId: "tenant-beta",
          projectIds: ["project-beta"],
          applicationIds: ["hotelos"],
        },
      }),
    );
    expect((await repository.getByOwner(OWNER_A))?.scope.tenantId).toBe("tenant-alpha");
    expect((await repository.getByOwner(OWNER_B))?.scope.ownerId).toBe(OWNER_B);
    expect((await repository.getByOwner(OWNER_A))?.scope.ownerId).not.toBe(OWNER_B);
  });

  it("keeps REVOKED terminal and preserves identity fields", async () => {
    const repository = new PersonalSupervisingAgentRepository(
      createInProcessPersonalSupervisingAgentStore(),
    );
    const created = await repository.save(record(OWNER_A));
    const revoked = await repository.save({ ...created, status: "REVOKED" });
    await expect(repository.save({ ...revoked, status: "ACTIVE" })).rejects.toBeInstanceOf(
      PsaPersistenceError,
    );
    const loaded = await repository.getByOwner(OWNER_A);
    expect(loaded?.status).toBe("REVOKED");
    const touched = await repository.save({
      ...revoked,
      status: "REVOKED",
      lastActivityAt: "2026-09-03T13:00:00.000Z",
      scope: {
        ownerId: OWNER_A,
        tenantId: "tenant-beta",
        projectIds: ["other"],
        applicationIds: ["other-app"],
      },
    });
    expect(touched.scope.tenantId).toBe("tenant-alpha");
    expect(touched.agentId).toBe(created.agentId);
    expect(touched.createdAt).toBe(created.createdAt);
  });

  it("writes snake_case owner/scope columns to postgres", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: urlStr, body });
      if (urlStr.includes("maybeSingle") || urlStr.includes("personal_supervising_agents")) {
        if (init?.method === "GET" || !init?.method) {
          return new Response("null", {
            status: 200,
            headers: { "content-type": "application/json", "content-range": "*/0" },
          });
        }
        const row = Array.isArray(body) ? body[0] : body;
        return new Response(JSON.stringify(row), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    try {
      const client = createDatabaseClients({
        url: "https://example.supabase.co",
        anonKey: "anon",
        serviceRoleKey: "service-role-key-that-is-long-enough",
      }).service;
      const repository = PersonalSupervisingAgentRepository.fromSupabase(client);
      await repository.save(record(OWNER_A));
      const write = requests.find((item) => {
        const payload = item.body as Record<string, unknown> | null;
        return payload != null && "owner_id" in payload;
      });
      expect(write).toBeDefined();
      const row = write?.body as Record<string, unknown>;
      expect(row.owner_id).toBe(OWNER_A);
      expect(row.agent_id).toBe(personalSupervisingAgentId(OWNER_A));
      expect(row.agent_class).toBe(PERSONAL_SUPERVISING_AGENT_CLASS);
      expect(row.tenant_id).toBe("tenant-alpha");
      expect(row.project_ids).toEqual(["project-alpha"]);
      expect(row.application_ids).toEqual(["civio"]);
      expect(row.status).toBe("ACTIVE");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
