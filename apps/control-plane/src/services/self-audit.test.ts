import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectCatalogRegistrationDrift,
  detectCpApiStatusEnforcementDrift,
  detectGovernanceStateInconsistency,
  detectMissingAuditEvidence,
  detectPolicyWithoutImplementation,
  detectRuntimeConfigDrift,
  detectVerificationGaps,
  runSelfAudit,
} from "./self-audit.js";
import {
  resetAgentRuntimeForTests,
  setAgentRuntimeStatus,
  getRegisteredAgent,
} from "./agent-registry.js";
import { resetApplicationRegistryForTests } from "./application-registry.js";
import {
  addApprovalRecord,
  appendAuditEntry,
  listApprovalRecords,
  resetGovernanceStateForTests,
} from "./governance-state.js";

describe("Self-audit — detect and propose only", () => {
  const previousNodeEnv = process.env["NODE_ENV"];
  const previousApiUrl = process.env["ATLAS_API_URL"];

  beforeEach(() => {
    resetGovernanceStateForTests();
    resetApplicationRegistryForTests();
    resetAgentRuntimeForTests();
  });

  afterEach(() => {
    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = previousNodeEnv;
    if (previousApiUrl === undefined) delete process.env["ATLAS_API_URL"];
    else process.env["ATLAS_API_URL"] = previousApiUrl;
    resetAgentRuntimeForTests();
    resetGovernanceStateForTests();
  });

  it("never sets autoApply true", () => {
    const report = runSelfAudit();
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.every((finding) => finding.autoApply === false)).toBe(true);
  });

  it("does not mutate agent runtime status or approvals", () => {
    setAgentRuntimeStatus("CODE_ENGINEER", "QUARANTINED");
    const before = getRegisteredAgent("CODE_ENGINEER")?.status;
    const pendingBefore = listApprovalRecords({ status: "PENDING" }).length;
    runSelfAudit();
    expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe(before);
    expect(listApprovalRecords({ status: "PENDING" })).toHaveLength(pendingBefore);
  });

  it("detects catalog ↔ production-registration alignment", () => {
    const finding = detectCatalogRegistrationDrift();
    expect(finding.autoApply).toBe(false);
    expect(finding.id).toBe("catalog-registration-aligned");
    expect(finding.evidence).toMatch(/analyze_repo/);
  });

  it("detects catalog tools without a production implementation", () => {
    const finding = detectPolicyWithoutImplementation();
    expect(finding.autoApply).toBe(false);
    expect(finding.id).toBe("policy-without-implementation");
    expect(finding.evidence).toMatch(/propose_patch|impact|evaluate/);
  });

  it("detects CP overlay that API must not default to ACTIVE", () => {
    setAgentRuntimeStatus("CODE_ENGINEER", "QUARANTINED");
    const finding = detectCpApiStatusEnforcementDrift();
    expect(finding.autoApply).toBe(false);
    expect(finding.id).toBe("cp-api-status-mismatch");
    expect(finding.evidence).toMatch(/CODE_ENGINEER=QUARANTINED/);
  });

  it("detects missing observational audit evidence", () => {
    const finding = detectMissingAuditEvidence();
    expect(finding.autoApply).toBe(false);
    expect(finding.id).toBe("missing-audit-evidence");
    expect(finding.evidence).toMatch(/count=0/);
  });

  it("detects a verification gap between gateway success and verification observations", () => {
    appendAuditEntry({
      seq: 1,
      timestamp: new Date().toISOString(),
      type: "gateway.request_agent_run",
      actorId: "owner",
      actorKind: "USER",
      reason: "test",
      policy: "gateway.request_agent_run",
      risk: "LOW",
      approval: "NOT_REQUIRED",
      result: "SUCCESS",
      ownerId: "owner",
      projectId: null,
      hash: "h1",
      prevHash: "000",
    });
    const finding = detectVerificationGaps();
    expect(finding.autoApply).toBe(false);
    expect(finding.id).toBe("verification-gap");
  });

  it("detects expired-but-PENDING governance-state inconsistency", () => {
    addApprovalRecord({
      id: "apr-expired",
      agentId: "CODE_ENGINEER",
      entityType: "RECORD",
      action: "CREATE",
      status: "PENDING",
      decidedBy: null,
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-02T00:00:00.000Z",
      artifactHash: "a".repeat(64),
    });
    const finding = detectGovernanceStateInconsistency();
    expect(finding.autoApply).toBe(false);
    expect(finding.id).toBe("governance-state-inconsistency");
    expect(finding.evidence).toMatch(/apr-expired/);
  });

  it("detects production runtime configuration drift", () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["ATLAS_API_URL"];
    const finding = detectRuntimeConfigDrift();
    expect(finding.autoApply).toBe(false);
    expect(finding.id).toBe("runtime-config-drift");
    expect(finding.severity).toBe("CRITICAL");
  });
});
