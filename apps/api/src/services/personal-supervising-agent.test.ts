import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FABRIC_AGENT_IDS,
  PERSONAL_SUPERVISING_AGENT_CLASS,
  memorySchema,
  personalSupervisingAgentId,
  type AgentProposal,
} from "@atlas/shared";
import { PersonalSupervisingAgentRepository } from "@atlas/database";
import { osStore } from "../store/os-store.js";
import {
  listUnifiedAuditEntries,
  setAuditLogPathForTests,
} from "./audit-log.js";
import { resetApprovalsForTests } from "./approvals-test-store.js";
import { createApprovalRequest } from "./approvals.js";
import { bindProjectOwner } from "./project-access.js";
import {
  configurePersonalSupervisingAgentStore,
  coordinateSpecialists,
  createOsStorePersonalSupervisingAgentStore,
  ensurePersonalSupervisingAgent,
  escalateFromPsa,
  explainSupervisedRecord,
  getPersonalSupervisingAgent,
  observePersonalSupervisingAgent,
  readPsaMemory,
  recommendFromPsa,
  requestGovernedAction,
  setPersonalSupervisingAgentStatus,
  setPsaObservationSourceForTests,
} from "./personal-supervising-agent.js";
import {
  createInProcessPersonalSupervisingAgentStore,
  resetPersonalSupervisingAgentForTests,
} from "./psa-test-store.js";

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const EVIDENCE_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_UUID = "33333333-3333-4333-8333-333333333333";

function proposal(ownerId: string, projectId: string | null = PROJECT_UUID): AgentProposal {
  return {
    agentId: "RESEARCHER",
    taskId: TASK_ID,
    projectId,
    action: { entityType: "DOCUMENT", action: "READ" },
    inputs: { note: "psa-test" },
    claims: ["Authorized document read should enter governance"],
    evidence: [
      {
        id: EVIDENCE_ID,
        ownerId,
        projectId,
        source: "psa-test",
        sourceType: "SYSTEM",
        sourceId: TASK_ID,
        uri: null,
        excerpt: "authoritative decision record",
        version: null,
        observedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        confidence: 0.8,
        epistemicState: "OBSERVED",
        category: "DECISIONS",
        classification: "INTERNAL",
        authorityRank: "REPOSITORY_CODE",
        metadata: {},
      },
    ],
    confidence: 0.7,
    rationale: "User asked the supervising agent to request a governed read",
  };
}

describe("Personal Supervising Agent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atlas-psa-"));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();
    resetPersonalSupervisingAgentForTests();
    setPsaObservationSourceForTests({
      async listApplications() {
        return [
          {
            applicationId: "civio",
            name: "Civio",
            tenantId: "tenant-alpha",
            projectId: "project-alpha",
          },
          {
            applicationId: "hotelos",
            name: "HotelOS",
            tenantId: "tenant-beta",
            projectId: "project-beta",
          },
        ];
      },
      async listProcesses() {
        return [
          {
            processId: "proc-1",
            applicationId: "civio",
            tenantId: "tenant-alpha",
            projectId: "project-alpha",
            state: "FAILED",
            lastEventId: "evt-1",
            currentEvent: "civio.legal.ai.failed",
            events: [
              {
                eventId: "evt-1",
                eventType: "civio.legal.ai.failed",
                occurredAt: "2026-09-03T12:00:00.000Z",
              },
            ],
            governance: {
              decision: "DENY",
              reason: "blocked delete",
              evaluatedAt: "2026-09-03T12:00:00.000Z",
            },
          },
          {
            processId: "proc-other",
            applicationId: "hotelos",
            tenantId: "tenant-beta",
            projectId: "project-beta",
            state: "RUNNING",
            lastEventId: "evt-other",
            currentEvent: "hotelos.booking.started",
            events: [
              {
                eventId: "evt-other",
                eventType: "hotelos.booking.started",
                occurredAt: "2026-09-03T12:00:00.000Z",
              },
            ],
            governance: null,
          },
        ];
      },
      async listDecisions() {
        return [
          {
            decision: "REQUIRE_APPROVAL",
            reason: "DOCUMENT.READ observe",
            tenantId: "tenant-alpha",
            projectId: "project-alpha",
            applicationId: "civio",
            processId: "proc-1",
            eventId: "evt-1",
            policy: { entityType: "DOCUMENT", action: "READ", riskTier: "APPROVAL" },
            risk: { tier: "APPROVAL" },
          },
          {
            decision: "ALLOW",
            reason: "other tenant",
            tenantId: "tenant-beta",
            projectId: "project-beta",
            applicationId: "hotelos",
            processId: "proc-other",
            eventId: "evt-other",
            policy: { entityType: "DOCUMENT", action: "READ", riskTier: "AUTO_LOG" },
            risk: { tier: "AUTO_LOG" },
          },
        ];
      },
    });
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    resetPersonalSupervisingAgentForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  async function initA() {
    bindProjectOwner(PROJECT_UUID, OWNER_A, "bound_on_create");
    return ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha", PROJECT_UUID],
      applicationIds: ["civio"],
    });
  }

  it("creates a persistent distinct supervising identity", async () => {
    const first = await initA();
    const second = await ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha"],
      applicationIds: ["civio"],
    });
    expect(first.agentClass).toBe(PERSONAL_SUPERVISING_AGENT_CLASS);
    expect(first.agentId).toBe(personalSupervisingAgentId(OWNER_A));
    expect(first.agentId).toBe(second.agentId);
    expect(FABRIC_AGENT_IDS).not.toContain(first.agentClass);
    expect(first.agentClass).not.toBe("ORCHESTRATOR");
    expect(first.status).toBe("ACTIVE");
  });

  it("does not treat the stable id as authorization", async () => {
    await initA();
    const observed = await observePersonalSupervisingAgent(OWNER_A);
    expect(observed.applications.map((item) => item.applicationId)).toEqual(["civio"]);
    expect(observed.processes.map((item) => item.processId)).toEqual(["proc-1"]);
    expect(observed.decisions.map((item) => item.eventId)).toEqual(["evt-1"]);
    expect(observed.events.map((item) => item.eventId)).toEqual(["evt-1"]);
  });

  it("isolates tenants, projects, and applications", async () => {
    await initA();
    await ensurePersonalSupervisingAgent({
      ownerId: OWNER_B,
      tenantId: "tenant-beta",
      projectIds: ["project-beta"],
      applicationIds: ["hotelos"],
    });
    const a = await observePersonalSupervisingAgent(OWNER_A);
    const b = await observePersonalSupervisingAgent(OWNER_B);
    expect(a.applications[0]?.applicationId).toBe("civio");
    expect(b.applications[0]?.applicationId).toBe("hotelos");
    expect(a.processes.some((item) => item.applicationId === "hotelos")).toBe(false);
    expect((await getPersonalSupervisingAgent(OWNER_A)).scope.ownerId).toBe(OWNER_A);
    await expect(getPersonalSupervisingAgent(OWNER_B)).resolves.toMatchObject({
      scope: { ownerId: OWNER_B },
    });
  });

  it("explains from authoritative records", async () => {
    await initA();
    const explained = await explainSupervisedRecord(OWNER_A, { eventId: "evt-1" });
    expect(explained.explanation).toMatch(/REQUIRE_APPROVAL/);
    expect(explained.explanation).toMatch(/DOCUMENT\.READ/);
    expect(explained.explanation).toMatch(/cannot approve/);
  });

  it("recommendations and escalations do not execute", async () => {
    await initA();
    const rec = await recommendFromPsa(OWNER_A, {
      reason: "Civio has a pending approval",
      severity: "MEDIUM",
      applicationId: "civio",
      eventId: "evt-1",
    });
    const esc = await escalateFromPsa(OWNER_A, {
      reason: "Repeated process failure",
      severity: "HIGH",
      applicationId: "civio",
      processId: "proc-1",
    });
    expect(rec.executed).toBe(false);
    expect(esc.executed).toBe(false);
    expect((await getPersonalSupervisingAgent(OWNER_A)).recommendations).toHaveLength(1);
    expect((await getPersonalSupervisingAgent(OWNER_A)).escalations).toHaveLength(1);
  });

  it("coordinates Fabric specialists without impersonating them", async () => {
    await initA();
    const plan = await coordinateSpecialists(OWNER_A, {
      request: "summarize the authorized Civio process",
      projectId: PROJECT_UUID,
      agentIds: ["RESEARCHER"],
    });
    expect(plan.steps.some((step) => step.agentId === "RESEARCHER")).toBe(true);
    expect(plan.steps.some((step) => step.agentId === "ORCHESTRATOR")).toBe(true);
    expect(plan.steps.every((step) => FABRIC_AGENT_IDS.includes(step.agentId))).toBe(true);
    expect(plan.steps.some((step) => step.agentId === PERSONAL_SUPERVISING_AGENT_CLASS)).toBe(
      false,
    );
  });

  it("rejects coordination outside project scope", async () => {
    await initA();
    await expect(
      coordinateSpecialists(OWNER_A, {
        request: "cross project",
        projectId: "99999999-9999-4999-8999-999999999999",
        agentIds: ["RESEARCHER"],
      }),
    ).rejects.toThrow(/scope/);
  });

  it("user requests enter existing governance", async () => {
    await initA();
    const result = await requestGovernedAction(OWNER_A, proposal(OWNER_A));
    expect(result.decision).toBeDefined();
    expect(["ALLOWED", "DENIED", "APPROVAL_REQUIRED"]).toContain(result.decision);
    const types = listUnifiedAuditEntries().map((entry) => entry.type);
    expect(types).toContain("psa.request");
  });

  it("paused and disabled agents cannot dispatch", async () => {
    await initA();
    await setPersonalSupervisingAgentStatus(OWNER_A, "PAUSED");
    await expect(
      recommendFromPsa(OWNER_A, { reason: "should not", severity: "LOW" }),
    ).rejects.toThrow(/PAUSED/);
    await expect(requestGovernedAction(OWNER_A, proposal(OWNER_A))).rejects.toThrow(/PAUSED/);
    await setPersonalSupervisingAgentStatus(OWNER_A, "DISABLED");
    await expect(
      coordinateSpecialists(OWNER_A, {
        request: "nope",
        projectId: PROJECT_UUID,
        agentIds: ["RESEARCHER"],
      }),
    ).rejects.toThrow(/DISABLED/);
  });

  it("revoked agents cannot be reactivated", async () => {
    await initA();
    await setPersonalSupervisingAgentStatus(OWNER_A, "REVOKED");
    await expect(setPersonalSupervisingAgentStatus(OWNER_A, "ACTIVE")).rejects.toThrow(
      /revoked/i,
    );
    const again = await ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha"],
      applicationIds: ["civio"],
    });
    expect(again.status).toBe("REVOKED");
    expect(again.agentId).toBe(personalSupervisingAgentId(OWNER_A));
  });

  it("filters pending approvals to authorized scope", async () => {
    await initA();
    await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: OWNER_A,
      reason: "in scope",
      context: {
        tenantId: "tenant-alpha",
        projectId: "project-alpha",
        applicationId: "civio",
        eventId: "evt-1",
      },
    });
    await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: OWNER_B,
      reason: "out of scope",
      context: {
        tenantId: "tenant-beta",
        projectId: "project-beta",
        applicationId: "hotelos",
        eventId: "evt-other",
      },
    });
    const observed = await observePersonalSupervisingAgent(OWNER_A);
    expect(observed.pendingApprovals).toHaveLength(1);
    expect(observed.pendingApprovals[0]?.reason).toBe("in scope");
    expect(observed.attention.some((item) => item.reason.includes("FAILED"))).toBe(true);
  });

  it("memory stays owner-scoped", async () => {
    await initA();
    await ensurePersonalSupervisingAgent({
      ownerId: OWNER_B,
      tenantId: "tenant-beta",
      projectIds: ["project-beta"],
      applicationIds: ["hotelos"],
    });
    const now = new Date().toISOString();
    osStore.addMemory(
      memorySchema.parse({
        id: "66666666-6666-4666-8666-666666666666",
        ownerId: OWNER_A,
        type: "DECISION",
        projectId: null,
        statement: "owner A lesson",
        reason: ["test"],
        status: "ACTIVE",
        confidence: 0.8,
        category: "DECISION_MEMORY",
        epistemicState: "OBSERVED",
        observationMode: "OBSERVED",
        source: "test",
        sourceType: "SYSTEM",
        sourceId: "m1",
        evidence: [{ id: "77777777-7777-4777-8777-777777777777", kind: "note", reference: "n1" }],
        supersededBy: null,
        validFrom: null,
        validUntil: null,
        observedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: OWNER_A,
        scope: "GLOBAL",
        priority: "MEDIUM",
      }),
    );
    osStore.addMemory(
      memorySchema.parse({
        id: "88888888-8888-4888-8888-888888888888",
        ownerId: OWNER_B,
        type: "DECISION",
        projectId: null,
        statement: "owner B secret",
        reason: ["test"],
        status: "ACTIVE",
        confidence: 0.8,
        category: "DECISION_MEMORY",
        epistemicState: "OBSERVED",
        observationMode: "OBSERVED",
        source: "test",
        sourceType: "SYSTEM",
        sourceId: "m2",
        evidence: [{ id: "99999999-9999-4999-8999-999999999999", kind: "note", reference: "n2" }],
        supersededBy: null,
        validFrom: null,
        validUntil: null,
        observedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: OWNER_B,
        scope: "GLOBAL",
        priority: "MEDIUM",
      }),
    );
    const memory = await readPsaMemory(OWNER_A, {});
    const statements = memory.items.map((item) => item.statement);
    expect(statements).toContain("owner A lesson");
    expect(statements).not.toContain("owner B secret");
  });

  it("audits important supervising-agent activity", async () => {
    await initA();
    await recommendFromPsa(OWNER_A, { reason: "attention", severity: "LOW", applicationId: "civio" });
    const types = listUnifiedAuditEntries().map((entry) => entry.type);
    expect(types).toContain("psa.created");
    expect(types).toContain("psa.recommend");
  });

  it("resolves the same owner and authorized scope after repeated requests", async () => {
    const first = await initA();
    const second = await ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha", PROJECT_UUID],
      applicationIds: ["civio"],
    });
    const third = await getPersonalSupervisingAgent(OWNER_A);
    expect(second.agentId).toBe(first.agentId);
    expect(third.createdAt).toBe(first.createdAt);
    expect(third.scope).toEqual(first.scope);
  });

  it("survives repository and API process restart simulation", async () => {
    const durable = createInProcessPersonalSupervisingAgentStore();
    configurePersonalSupervisingAgentStore(new PersonalSupervisingAgentRepository(durable));
    bindProjectOwner(PROJECT_UUID, OWNER_A, "bound_on_create");
    const created = await ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha", PROJECT_UUID],
      applicationIds: ["civio"],
    });
    await recommendFromPsa(OWNER_A, {
      reason: "persist me",
      severity: "LOW",
      applicationId: "civio",
    });
    configurePersonalSupervisingAgentStore(new PersonalSupervisingAgentRepository(durable));
    const restored = await getPersonalSupervisingAgent(OWNER_A);
    expect(restored.agentId).toBe(created.agentId);
    expect(restored.createdAt).toBe(created.createdAt);
    expect(restored.recommendations).toHaveLength(1);
    expect(restored.recommendations[0]?.executed).toBe(false);
  });

  it("survives os-store process restart", async () => {
    const prevPath = process.env.ATLAS_STORE_PATH;
    const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
    process.env.ATLAS_STORE_PATH = join(dir, "store.json");
    delete process.env.ATLAS_SKIP_STORE_PERSIST;
    osStore.unloadForTests();
    configurePersonalSupervisingAgentStore(
      new PersonalSupervisingAgentRepository(createOsStorePersonalSupervisingAgentStore()),
    );
    bindProjectOwner(PROJECT_UUID, OWNER_A, "bound_on_create");
    const created = await ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha"],
      applicationIds: ["civio"],
    });
    osStore.unloadForTests();
    configurePersonalSupervisingAgentStore(
      new PersonalSupervisingAgentRepository(createOsStorePersonalSupervisingAgentStore()),
    );
    const restored = await getPersonalSupervisingAgent(OWNER_A);
    expect(restored.agentId).toBe(created.agentId);
    expect(restored.scope.tenantId).toBe("tenant-alpha");
    if (prevPath === undefined) delete process.env.ATLAS_STORE_PATH;
    else process.env.ATLAS_STORE_PATH = prevPath;
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
    osStore.unloadForTests();
  });

  it("does not let a different owner resolve another owner's PSA", async () => {
    await initA();
    await expect(getPersonalSupervisingAgent(OWNER_B)).rejects.toThrow(/not initialized/);
  });

  it("fails closed across tenant, project, and application", async () => {
    await initA();
    await expect(
      ensurePersonalSupervisingAgent({
        ownerId: OWNER_A,
        tenantId: "tenant-beta",
        projectIds: ["project-alpha"],
        applicationIds: ["civio"],
      }),
    ).rejects.toThrow(/outside the persisted supervising agent scope/);
    await expect(
      ensurePersonalSupervisingAgent({
        ownerId: OWNER_A,
        tenantId: "tenant-alpha",
        projectIds: ["project-beta"],
        applicationIds: ["civio"],
      }),
    ).rejects.toThrow(/outside the persisted supervising agent scope/);
    await expect(
      ensurePersonalSupervisingAgent({
        ownerId: OWNER_A,
        tenantId: "tenant-alpha",
        projectIds: ["project-alpha"],
        applicationIds: ["hotelos"],
      }),
    ).rejects.toThrow(/outside the persisted supervising agent scope/);
    await expect(
      recommendFromPsa(OWNER_A, {
        reason: "wrong app",
        severity: "LOW",
        applicationId: "hotelos",
      }),
    ).rejects.toThrow(/Application is outside/);
  });

  it("does not recreate a REVOKED PSA after restart", async () => {
    const durable = createInProcessPersonalSupervisingAgentStore();
    configurePersonalSupervisingAgentStore(new PersonalSupervisingAgentRepository(durable));
    bindProjectOwner(PROJECT_UUID, OWNER_A, "bound_on_create");
    await ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha"],
      applicationIds: ["civio"],
    });
    await setPersonalSupervisingAgentStatus(OWNER_A, "REVOKED");
    configurePersonalSupervisingAgentStore(new PersonalSupervisingAgentRepository(durable));
    const restored = await ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha"],
      applicationIds: ["civio"],
    });
    expect(restored.status).toBe("REVOKED");
    await expect(setPersonalSupervisingAgentStatus(OWNER_A, "ACTIVE")).rejects.toThrow(/revoked/i);
  });

  it("keeps paused behavior and governed requests after restart", async () => {
    const durable = createInProcessPersonalSupervisingAgentStore();
    configurePersonalSupervisingAgentStore(new PersonalSupervisingAgentRepository(durable));
    bindProjectOwner(PROJECT_UUID, OWNER_A, "bound_on_create");
    await ensurePersonalSupervisingAgent({
      ownerId: OWNER_A,
      tenantId: "tenant-alpha",
      projectIds: ["project-alpha", PROJECT_UUID],
      applicationIds: ["civio"],
    });
    await setPersonalSupervisingAgentStatus(OWNER_A, "PAUSED");
    configurePersonalSupervisingAgentStore(new PersonalSupervisingAgentRepository(durable));
    await expect(
      recommendFromPsa(OWNER_A, { reason: "paused after restart", severity: "LOW" }),
    ).rejects.toThrow(/PAUSED/);
    await expect(requestGovernedAction(OWNER_A, proposal(OWNER_A))).rejects.toThrow(/PAUSED/);
    await setPersonalSupervisingAgentStatus(OWNER_A, "ACTIVE");
    const observed = await observePersonalSupervisingAgent(OWNER_A);
    expect(observed.applications.map((item) => item.applicationId)).toEqual(["civio"]);
    const result = await requestGovernedAction(OWNER_A, proposal(OWNER_A));
    expect(["ALLOWED", "DENIED", "APPROVAL_REQUIRED"]).toContain(result.decision);
  });
});
