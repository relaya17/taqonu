import { describe, expect, it } from "vitest";
import { ApplicationGovernanceRepository } from "./application-governance.js";
import {
  createApplicationGovernanceMemory,
  createInProcessApplicationGovernanceClient,
} from "./application-governance.in-process.js";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

function repo(memory = createApplicationGovernanceMemory()) {
  const client = createInProcessApplicationGovernanceClient(memory);
  return {
    repository: new ApplicationGovernanceRepository(client),
    client,
    memory,
  };
}

function outcomeInput(
  overrides: Partial<Parameters<ApplicationGovernanceRepository["recordOutcome"]>[0]> = {},
) {
  return {
    decisionId: "11111111-1111-4111-8111-111111111111",
    requestId: "req-1",
    applicationId: "civio",
    tenantId: "tenant-a",
    projectId: "project-a",
    operation: "civio.legal.query",
    operationClass: "GOVERNED_DECISION",
    decision: "ALLOW",
    agentId: null,
    approvalId: null,
    httpStatus: 200,
    response: { decision: "ALLOW", decisionId: "11111111-1111-4111-8111-111111111111" },
    expiresAt: FUTURE,
    idempotencyKey: "idem-1",
    fingerprint: "fp-1",
    auditId: "22222222-2222-4222-8222-222222222222",
    auditPayload: {
      type: "application.preflight.evaluated",
      tenantId: "tenant-a",
      projectId: "project-a",
    },
    ...overrides,
  };
}

function reportInput(
  overrides: Partial<Parameters<ApplicationGovernanceRepository["recordReport"]>[0]> = {},
) {
  return {
    decisionId: "11111111-1111-4111-8111-111111111111",
    executionId: "chatcmpl-1",
    applicationId: "civio",
    tenantId: "tenant-a",
    projectId: "project-a",
    requestId: "req-1",
    operation: "civio.legal.query",
    executionStatus: "SUCCESS" as const,
    agentId: null,
    auditId: "33333333-3333-4333-8333-333333333333",
    auditPayload: {
      type: "application.execution.reported",
      tenantId: "tenant-a",
      projectId: "project-a",
    },
    ...overrides,
  };
}

describe("ApplicationGovernanceRepository (in-process double)", () => {
  it("consumes a nonce once and rejects reuse (proof 1)", async () => {
    const { repository } = repo();
    const first = await repository.consumeNonce({
      applicationId: "civio",
      nonce: "aabbccddeeff0011",
      expiresAt: FUTURE,
    });
    const second = await repository.consumeNonce({
      applicationId: "civio",
      nonce: "aabbccddeeff0011",
      expiresAt: FUTURE,
    });
    expect(first).toEqual({ ok: true });
    expect(second.ok).toBe(false);
  });

  it("rejects concurrent same-nonce consumption (proof 2)", async () => {
    const { repository } = repo();
    const input = {
      applicationId: "civio",
      nonce: "1122334455667788",
      expiresAt: FUTURE,
    };
    const results = await Promise.all([
      repository.consumeNonce(input),
      repository.consumeNonce(input),
    ]);
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok).length).toBe(1);
  });

  it("shares nonce state across repository instances (proof 3)", async () => {
    const memory = createApplicationGovernanceMemory();
    const a = new ApplicationGovernanceRepository(
      createInProcessApplicationGovernanceClient(memory),
    );
    const b = new ApplicationGovernanceRepository(
      createInProcessApplicationGovernanceClient(memory),
    );
    expect(
      await a.consumeNonce({
        applicationId: "civio",
        nonce: "9999888877776666",
        expiresAt: FUTURE,
      }),
    ).toEqual({ ok: true });
    expect(
      (
        await b.consumeNonce({
          applicationId: "civio",
          nonce: "9999888877776666",
          expiresAt: FUTURE,
        })
      ).ok,
    ).toBe(false);
  });

  it("returns the stored response for same idempotency key + fingerprint (proof 4)", async () => {
    const { repository } = repo();
    const first = await repository.recordOutcome(outcomeInput());
    const second = await repository.recordOutcome(
      outcomeInput({
        decisionId: "44444444-4444-4444-8444-444444444444",
        auditId: "55555555-5555-4555-8555-555555555555",
      }),
    );
    expect(first.kind).toBe("RECORDED");
    expect(second.kind).toBe("IDEMPOTENT_HIT");
    if (second.kind === "IDEMPOTENT_HIT") {
      expect(second.decisionId).toBe("11111111-1111-4111-8111-111111111111");
    }
  });

  it("conflicts on same idempotency key + different fingerprint (proof 5)", async () => {
    const { repository } = repo();
    await repository.recordOutcome(outcomeInput());
    const conflict = await repository.recordOutcome(
      outcomeInput({
        fingerprint: "fp-other",
        decisionId: "44444444-4444-4444-8444-444444444444",
        requestId: "req-2",
        auditId: "55555555-5555-4555-8555-555555555555",
      }),
    );
    expect(conflict.kind).toBe("IDEMPOTENT_CONFLICT");
  });

  it("persists at most one T1 authority for concurrent same idempotency key (proof 6)", async () => {
    const { repository, memory } = repo();
    const results = await Promise.all([
      repository.recordOutcome(outcomeInput()),
      repository.recordOutcome(
        outcomeInput({
          decisionId: "44444444-4444-4444-8444-444444444444",
          auditId: "55555555-5555-4555-8555-555555555555",
        }),
      ),
    ]);
    const recorded = results.filter((r) => r.kind === "RECORDED");
    const hits = results.filter((r) => r.kind === "IDEMPOTENT_HIT");
    expect(recorded.length).toBe(1);
    expect(hits.length).toBe(1);
    expect(memory.decisions.size).toBe(1);
    expect(
      [...memory.audits.values()].filter((a) => a.action === "application.preflight.evaluated")
        .length,
    ).toBe(1);
  });

  it("looks up a decision from a second repository instance (proof 7)", async () => {
    const memory = createApplicationGovernanceMemory();
    const a = new ApplicationGovernanceRepository(
      createInProcessApplicationGovernanceClient(memory),
    );
    const recorded = await a.recordOutcome(outcomeInput());
    expect(recorded.kind).toBe("RECORDED");
    const b = new ApplicationGovernanceRepository(
      createInProcessApplicationGovernanceClient(memory),
    );
    const found = await b.lookupDecision("11111111-1111-4111-8111-111111111111");
    expect(found?.decision).toBe("ALLOW");
    expect(found?.expired).toBe(false);
  });

  it("accepts a report from another repository instance (proof 8)", async () => {
    const memory = createApplicationGovernanceMemory();
    const a = new ApplicationGovernanceRepository(
      createInProcessApplicationGovernanceClient(memory),
    );
    await a.recordOutcome(outcomeInput());
    const b = new ApplicationGovernanceRepository(
      createInProcessApplicationGovernanceClient(memory),
    );
    const report = await b.recordReport(reportInput());
    expect(report.kind).toBe("RECORDED");
  });

  it("rejects report binding mismatches (proof 9)", async () => {
    const { repository } = repo();
    await repository.recordOutcome(outcomeInput());
    const tenant = await repository.recordReport(reportInput({ tenantId: "other" }));
    const operation = await repository.recordReport(
      reportInput({
        operation: "other.op",
        auditId: "66666666-6666-4666-8666-666666666666",
      }),
    );
    const request = await repository.recordReport(
      reportInput({
        requestId: "other-req",
        auditId: "77777777-7777-4777-8777-777777777777",
      }),
    );
    expect(tenant).toMatchObject({ kind: "REJECTED" });
    expect(operation).toMatchObject({ kind: "REJECTED" });
    expect(request).toMatchObject({ kind: "REJECTED" });
  });

  it("rejects an expired decision (proof 10)", async () => {
    const { repository } = repo();
    await repository.recordOutcome(outcomeInput({ expiresAt: PAST }));
    const report = await repository.recordReport(reportInput());
    expect(report).toMatchObject({
      kind: "REJECTED",
      reason: "Preceding preflight authorization has expired",
    });
  });

  it("rejects an unknown decision (proof 11)", async () => {
    const { repository } = repo();
    const report = await repository.recordReport(reportInput());
    expect(report.kind).toBe("REJECTED");
  });

  it("rejects a non-ALLOW decision (proof 12)", async () => {
    const { repository } = repo();
    await repository.recordOutcome(outcomeInput({ decision: "DENY", httpStatus: 409 }));
    const report = await repository.recordReport(reportInput());
    expect(report.kind).toBe("REJECTED");
    if (report.kind === "REJECTED") {
      expect(report.reason).toContain("ALLOW");
    }
  });

  it("replays an identical report idempotently (proof 13)", async () => {
    const { repository } = repo();
    await repository.recordOutcome(outcomeInput());
    const first = await repository.recordReport(reportInput());
    const second = await repository.recordReport(
      reportInput({ auditId: "88888888-8888-4888-8888-888888888888" }),
    );
    expect(first.kind).toBe("RECORDED");
    expect(second.kind).toBe("IDEMPOTENT_HIT");
  });

  it("rejects a conflicting report (proof 14)", async () => {
    const { repository } = repo();
    await repository.recordOutcome(outcomeInput());
    await repository.recordReport(reportInput());
    const conflict = await repository.recordReport(
      reportInput({
        executionStatus: "FAILURE",
        auditId: "88888888-8888-4888-8888-888888888888",
      }),
    );
    expect(conflict.kind).toBe("CONFLICT");
  });

  it("rolls T1 back so neither decision nor audit remains (proof 15)", async () => {
    const { repository, client, memory } = repo();
    client.failNext("t1_before_audit");
    await expect(repository.recordOutcome(outcomeInput())).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
    expect(memory.decisions.size).toBe(0);
    expect(memory.idempotency.size).toBe(0);
    expect(memory.audits.size).toBe(0);
  });

  it("rolls T2 back so neither report nor audit remains (proof 16)", async () => {
    const { repository, client, memory } = repo();
    await repository.recordOutcome(outcomeInput());
    const auditsAfterT1 = memory.audits.size;
    client.failNext("t2_before_audit");
    await expect(repository.recordReport(reportInput())).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
    expect(memory.reports.size).toBe(0);
    expect(memory.audits.size).toBe(auditsAfterT1);
  });

  it("does not reconstruct ALLOW from audit rows", async () => {
    const { repository, memory } = repo();
    memory.audits.set("orphan", {
      id: "orphan",
      action: "application.preflight.evaluated",
      entityType: "application_preflight",
      entityId: "99999999-9999-4999-8999-999999999999",
      payload: { decision: "ALLOW" },
    });
    expect(
      await repository.lookupDecision("99999999-9999-4999-8999-999999999999"),
    ).toBeNull();
  });
});
