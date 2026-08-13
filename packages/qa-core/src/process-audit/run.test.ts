import { describe, expect, it } from "vitest";
import { detectAppProfile } from "./profiles.js";
import { buildProcessMatrix } from "./matrix.js";
import { runProcessInternalAudit } from "./run.js";

describe("process-audit profiles", () => {
  it("detects hotel from request", () => {
    const d = detectAppProfile({ userRequest: "בדוק תהליכים במלון HotelOS" });
    expect(d.profile).toBe("HOTEL");
    expect(d.source).toBe("AUTO_DETECT");
  });

  it("defaults to GENERIC", () => {
    const d = detectAppProfile({ userRequest: "hello world" });
    expect(d.profile).toBe("GENERIC");
  });
});

describe("process-audit matrix", () => {
  it("includes tenant isolation for HOTEL", () => {
    const rows = buildProcessMatrix("HOTEL");
    expect(rows.some((r) => r.dimension === "TENANT_ISOLATION")).toBe(true);
    expect(rows.some((r) => r.dimension === "UI_UX")).toBe(true);
    expect(rows.some((r) => r.dimension === "AI_HITL")).toBe(true);
  });

  it("skips tenant isolation for GENERIC", () => {
    const rows = buildProcessMatrix("GENERIC");
    expect(rows.some((r) => r.dimension === "TENANT_ISOLATION")).toBe(false);
  });
});

describe("runProcessInternalAudit", () => {
  it("emits markdown document with verdict", () => {
    const doc = runProcessInternalAudit({
      request: {
        userRequest: "Deep process audit for hotel chain",
        environment: "LOCAL",
        includeProviders: true,
        includeUiUx: true,
        includePerformance: true,
      },
      projectId: null,
      projectName: "Demo Hotel",
    });
    expect(doc.appProfile).toBe("HOTEL");
    expect(["GO", "CONDITIONAL_GO", "NO_GO"]).toContain(doc.verdict);
    expect(doc.markdownReport).toContain("Internal Process Audit");
    expect(doc.specialistsEngaged.length).toBeGreaterThan(3);
    expect(doc.gates).toHaveLength(4);
    expect(doc.sections.futureChecks.length).toBeGreaterThan(0);
  });

  it("NO_GO when isolation required and no workspace", () => {
    const doc = runProcessInternalAudit({
      request: {
        appProfile: "SAAS",
        environment: "STAGING",
        includeProviders: true,
        includeUiUx: true,
        includePerformance: true,
      },
      projectId: null,
    });
    expect(doc.verdict).toBe("NO_GO");
    expect(doc.sections.blockers.length).toBeGreaterThan(0);
  });
});
