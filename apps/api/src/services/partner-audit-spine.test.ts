import { describe, expect, it } from "vitest";
import { buildPartnerChecklist } from "./partner-audit-spine.js";

describe("buildPartnerChecklist", () => {
  it("emits markdown + json with deep links and success checks", () => {
    const { markdown, json } = buildPartnerChecklist({
      projectName: "Acme",
      projectSlug: "acme",
      projectId: "11111111-1111-4111-8111-111111111111",
      at: "2026-08-12T10:00:00.000Z",
      verdictStatus: "CONDITIONAL",
      productionReadiness: 72,
      criticalBlockers: 1,
      highRisks: 2,
      unverifiedClaims: 3,
      healthScore: 61,
      constitutionScore: 55,
      criticalIssues: 1,
      certificateId: "22222222-2222-4222-8222-222222222222",
      healthReportId: "33333333-3333-4333-8333-333333333333",
      auditSkipped: false,
      auditSkipReason: null,
      workspaceRoot: "C:/repos/acme",
    });

    expect(markdown).toContain("Design Partner — Audit spine summary");
    expect(markdown).toContain("CONDITIONAL");
    expect(markdown).toContain("/health");
    expect(markdown).toContain("/readiness");
    expect(markdown).toContain("No email automation");
    expect(json.kind).toBe("design-partner-audit-spine");
    expect(json.verdict).toMatchObject({
      status: "CONDITIONAL",
      productionReadiness: 72,
      criticalBlockers: 1,
    });
    expect((json.successChecks as { blockerMadeExplicit: boolean }).blockerMadeExplicit).toBe(
      true,
    );
  });

  it("records health skip reason when audit skipped", () => {
    const { markdown, json } = buildPartnerChecklist({
      projectName: "Remote Only",
      projectSlug: "remote-only",
      projectId: "11111111-1111-4111-8111-111111111111",
      at: "2026-08-12T10:00:00.000Z",
      verdictStatus: "UNKNOWN",
      productionReadiness: 40,
      criticalBlockers: 0,
      highRisks: 0,
      unverifiedClaims: 5,
      healthScore: null,
      constitutionScore: null,
      criticalIssues: null,
      certificateId: null,
      healthReportId: null,
      auditSkipped: true,
      auditSkipReason: "No workspaceRoot linked",
      workspaceRoot: null,
    });

    expect(markdown).toContain("Health: skipped");
    expect(markdown).toContain("No workspaceRoot linked");
    expect(json.health).toMatchObject({
      skipped: true,
      skipReason: "No workspaceRoot linked",
    });
  });
});
