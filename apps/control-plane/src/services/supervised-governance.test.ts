import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetGovernanceStateForTests, listAuditEntries } from "./governance-state.js";
import {
  evaluateSupervisedEvent,
  getSupervisedGovernanceDecision,
  listSupervisedGovernanceDecisions,
  mapSupervisedEventToPolicyCell,
  resetSupervisedGovernanceForTests,
} from "./supervised-governance.js";

const BASE = {
  tenantId: "tenant-alpha",
  projectId: "project-alpha",
  applicationId: "civio",
  processId: "proc-1",
  correlationId: "corr-1",
  requestId: "req-1",
  connectorId: "atlas-civio-connector",
  actorId: "civio-runtime",
  actorKind: "SYSTEM" as const,
};

describe("mapSupervisedEventToPolicyCell", () => {
  it("selects DOCUMENT.READ for Civio observe events", () => {
    expect(mapSupervisedEventToPolicyCell("civio.process.started")).toEqual({
      entityType: "DOCUMENT",
      action: "READ",
    });
    expect(mapSupervisedEventToPolicyCell("civio.rights.answered")).toEqual({
      entityType: "DOCUMENT",
      action: "READ",
    });
  });

  it("selects CODE.EXECUTE for Civio legal-AI completion", () => {
    expect(mapSupervisedEventToPolicyCell("civio.legal.ai.completed")).toEqual({
      entityType: "CODE",
      action: "EXECUTE",
    });
  });

  it("selects *.DELETE for delete-shaped event types", () => {
    expect(mapSupervisedEventToPolicyCell("record.deleted")).toEqual({
      entityType: "*",
      action: "DELETE",
    });
  });
});

describe("evaluateSupervisedEvent", () => {
  beforeEach(() => {
    resetSupervisedGovernanceForTests();
    resetGovernanceStateForTests();
  });

  afterEach(() => {
    resetSupervisedGovernanceForTests();
    resetGovernanceStateForTests();
  });

  it("produces ALLOW for DOCUMENT.READ observe events", () => {
    const decision = evaluateSupervisedEvent({
      ...BASE,
      eventId: "evt-allow",
      eventType: "civio.process.started",
    });
    expect(decision.decision).toBe("ALLOW");
    expect(decision.cycle.executed).toBe(false);
    expect(decision.policy).toMatchObject({
      entityType: "DOCUMENT",
      action: "READ",
      riskTier: "AUTO_LOG",
    });
    expect(decision.risk.tier).toBe("AUTO_LOG");
    expect(decision.reason).toMatch(/Read-only observe/i);
    expect(decision.processId).toBe("proc-1");
    expect(decision.applicationId).toBe("civio");
  });

  it("produces REQUIRE_APPROVAL for CODE.EXECUTE", () => {
    const decision = evaluateSupervisedEvent({
      ...BASE,
      eventId: "evt-approval",
      eventType: "civio.legal.ai.completed",
    });
    expect(decision.decision).toBe("REQUIRE_APPROVAL");
    expect(decision.cycle.executed).toBe(false);
    expect(decision.policy.riskTier).toBe("APPROVAL");
    expect(decision.reason).toMatch(/approval/i);
  });

  it("produces DENY for DELETE policy cells", () => {
    const decision = evaluateSupervisedEvent({
      ...BASE,
      eventId: "evt-deny",
      eventType: "record.deleted",
    });
    expect(decision.decision).toBe("DENY");
    expect(decision.cycle.executed).toBe(false);
    expect(decision.policy).toMatchObject({ entityType: "*", action: "DELETE" });
    expect(decision.risk.tier).toBe("BLOCK");
  });

  it("returns the original decision for a duplicate eventId", () => {
    const first = evaluateSupervisedEvent({
      ...BASE,
      eventId: "evt-dup",
      eventType: "civio.process.started",
    });
    const second = evaluateSupervisedEvent({
      ...BASE,
      eventId: "evt-dup",
      eventType: "civio.process.started",
    });
    expect(second.decision).toBe(first.decision);
    expect(second.reason).toBe(first.reason);
    expect(second.evaluatedAt).toBe(first.evaluatedAt);
    expect(
      listAuditEntries({ type: "governance.decision" }).filter(
        (entry) => entry.reason.includes("event=evt-dup"),
      ),
    ).toHaveLength(1);
  });

  it("does not let application B inherit application A's decision", () => {
    evaluateSupervisedEvent({
      ...BASE,
      applicationId: "app-a",
      eventId: "evt-shared",
      eventType: "civio.process.started",
    });
    const other = evaluateSupervisedEvent({
      ...BASE,
      applicationId: "app-b",
      eventId: "evt-shared",
      eventType: "record.deleted",
    });
    expect(other.applicationId).toBe("app-b");
    expect(other.decision).toBe("DENY");
    const original = getSupervisedGovernanceDecision({
      tenantId: BASE.tenantId,
      projectId: BASE.projectId,
      applicationId: "app-a",
      eventId: "evt-shared",
    });
    expect(original?.decision).toBe("ALLOW");
    expect(original?.applicationId).toBe("app-a");
  });

  it("does not let tenant B inherit tenant A's decision", () => {
    evaluateSupervisedEvent({
      ...BASE,
      eventId: "evt-tenant",
      eventType: "civio.process.started",
    });
    const other = evaluateSupervisedEvent({
      ...BASE,
      tenantId: "tenant-beta",
      eventId: "evt-tenant",
      eventType: "record.deleted",
    });
    expect(other.tenantId).toBe("tenant-beta");
    expect(other.decision).toBe("DENY");
    expect(
      getSupervisedGovernanceDecision({
        tenantId: "tenant-alpha",
        projectId: BASE.projectId,
        applicationId: BASE.applicationId,
        eventId: "evt-tenant",
      })?.decision,
    ).toBe("ALLOW");
  });

  it("writes an auditable Application → Process → Event → Policy → Risk → Decision record", () => {
    evaluateSupervisedEvent({
      ...BASE,
      eventId: "evt-audit",
      eventType: "civio.rights.answered",
    });
    const entries = listAuditEntries({ type: "governance.decision" });
    expect(entries[0]?.reason).toContain("application=civio");
    expect(entries[0]?.reason).toContain("process=proc-1");
    expect(entries[0]?.reason).toContain("event=evt-audit");
    expect(entries[0]?.reason).toContain("policy=DOCUMENT.READ");
    expect(entries[0]?.reason).toContain("risk=AUTO_LOG");
    expect(entries[0]?.reason).toContain("decision=ALLOW");
    expect(entries[0]?.ownerId).toBe("tenant-alpha");
    expect(entries[0]?.projectId).toBe("project-alpha");
    expect(listSupervisedGovernanceDecisions({ eventId: "evt-audit" })).toHaveLength(1);
  });
});
