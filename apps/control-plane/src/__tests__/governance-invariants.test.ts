import { describe, expect, it, beforeEach } from "vitest";
import { evaluateGatewayRequest } from "../services/atlas-gateway.js";
import { resetApplicationRegistryForTests } from "../services/application-registry.js";
import { resetGovernanceStateForTests, verifyAuditChain } from "../services/governance-state.js";
import { resetAgentRuntimeForTests } from "../services/agent-registry.js";
import { runSelfAudit } from "../services/self-audit.js";

describe("Control Plane governance invariants", () => {
  beforeEach(() => {
    resetGovernanceStateForTests();
    resetApplicationRegistryForTests();
    resetAgentRuntimeForTests();
  });

  it("unauthenticated / empty principal is DENY at IDENTITY", () => {
    const result = evaluateGatewayRequest({
      actorId: "",
      applicationId: "def-000",
      operation: "inspect",
      reason: "anonymous",
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("IDENTITY");
    expect(result.receipt?.verification.verdict).toBe("BLOCKED");
  });

  it("Control Plane audit is explicitly non-canonical", () => {
    const chain = verifyAuditChain();
    expect(chain.canonical).toBe(false);
    expect(chain.status).toBe("UNKNOWN");
  });

  it("self-audit detects and proposes only — never auto-applies", () => {
    const report = runSelfAudit();
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.every((f) => f.autoApply === false)).toBe(true);
    expect(report.findings.some((f) => f.id === "audit-canonical-is-api")).toBe(true);
    expect(report.findings.some((f) => f.id === "cp-mfa-not-bound")).toBe(true);
  });
});
