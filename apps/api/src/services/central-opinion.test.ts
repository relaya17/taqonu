import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessAuditDocument } from "@atlas/shared";

// Isolation gap fix: `syncProcessAuditToMemory` internally calls
// `osStore.addMemory(...)` (see central-opinion.ts) even though this test
// file never imports osStore directly — same transitive-write gap found in
// admin-oracle-queue.test.ts. Env vars must be set BEFORE
// `central-opinion.js` (and therefore os-store.js) is ever imported.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-central-opinion-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { syncProcessAuditToMemory } = await import("./central-opinion.js");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeAudit(overrides: Partial<ProcessAuditDocument> = {}): ProcessAuditDocument {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    projectId: null,
    appProfile: "GENERIC",
    appProfileSource: "AUTO_DETECT",
    verdict: "NO_GO",
    verdictReason: "Critical checkout flow is broken.",
    gates: [],
    items: [],
    specialistsEngaged: [],
    providers: [],
    markdownReport: "# report",
    sections: {
      executiveSummary: "summary",
      defects: [],
      blockers: [],
      futureChecks: [],
      recommendations: [],
    },
    createdAt: now,
    completedAt: now,
    ...overrides,
  };
}

describe("syncProcessAuditToMemory", () => {
  it("redacts a secret leaked into verdictReason before persisting the memory statement", () => {
    // Shaped to match the github_token pattern recognized by
    // packages/agent-core/src/secrets/detector.ts: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/
    const leakedToken = "ghp_ABCDEFGHIJ0123456789abcdefghij";
    const audit = makeAudit({
      verdictReason: `CI logs dump included a credential: ${leakedToken}`,
    });

    const memory = syncProcessAuditToMemory(audit);

    expect(memory.statement).not.toContain(leakedToken);
    expect(memory.statement).toContain("[REDACTED_SECRET]");
  });

  it("redacts a secret leaked into blockers/defects before persisting the memory statement", () => {
    const leakedToken = "ghp_ZZZZYYYYXXXXWWWWVVVVUUUU1234";
    const audit = makeAudit({
      sections: {
        executiveSummary: "summary",
        defects: [`env dump found in stack trace: ${leakedToken}`],
        blockers: ["unrelated blocker text"],
        futureChecks: [],
        recommendations: [],
      },
    });

    const memory = syncProcessAuditToMemory(audit);

    expect(memory.statement).not.toContain(leakedToken);
    expect(memory.statement).toContain("[REDACTED_SECRET]");
  });

  it("still builds a normal statement when no secrets are present", () => {
    const audit = makeAudit({
      verdictReason: "All gates passed cleanly.",
      sections: {
        executiveSummary: "summary",
        defects: ["minor styling issue"],
        blockers: ["none"],
        futureChecks: [],
        recommendations: [],
      },
    });

    const memory = syncProcessAuditToMemory(audit);

    expect(memory.statement).toContain("All gates passed cleanly.");
    expect(memory.statement).toContain("minor styling issue");
    expect(memory.statement).toContain(`auditId=${audit.id}`);
    expect(memory.statement).not.toContain("[REDACTED_SECRET]");
  });
});
