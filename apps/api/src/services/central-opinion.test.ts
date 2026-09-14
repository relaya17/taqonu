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

const { syncProcessAuditToMemory, buildCentralOpinion, rememberProcessAuditId } =
  await import("./central-opinion.js");
const { osStore } = await import("../store/os-store.js");

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

describe("buildCentralOpinion", () => {
  function persistAudit(doc: ProcessAuditDocument) {
    osStore.setMeta(`qa.processAudit.${doc.id}`, JSON.stringify(doc));
    rememberProcessAuditId(doc.id);
  }

  function makeProject() {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    osStore.upsertProject({
      id,
      slug: `proj-${id.slice(0, 8)}`,
      name: "Central Opinion Test Project",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  it("reflects only the most recent audit, not a worst-ever verdict across history", () => {
    const projectId = makeProject();

    // Older run: NO_GO with a blocker that has since been fixed.
    const older = makeAudit({
      projectId,
      verdict: "NO_GO",
      verdictReason: "Old run — since fixed.",
      items: [
        {
          id: crypto.randomUUID(),
          kind: "BLOCKER",
          gateId: null,
          dimension: "RBAC",
          severity: "CRITICAL",
          title: "Old blocker that was fixed",
          detail: "n/a",
          expected: null,
          actual: null,
          specialist: null,
          epistemicState: "INFERRED",
          evidenceNotes: [],
          recommendedNext: null,
        },
      ],
    });
    persistAudit(older);

    // Newer run: clean GO, no findings.
    const newer = makeAudit({
      projectId,
      verdict: "GO",
      verdictReason: "Re-audit after the fix — clean.",
      items: [],
    });
    persistAudit(newer);

    const opinion = buildCentralOpinion(projectId);

    // The fix: verdict follows the latest run (GO), not the worst one ever
    // seen (NO_GO from the older run) — no permanent ratchet.
    expect(opinion.verdict).toBe("GO");
    // The old, already-fixed blocker must not resurface as a current finding.
    expect(
      opinion.findings.some((f) => f.title === "Old blocker that was fixed"),
    ).toBe(false);
    // Full history stays available for anyone who wants the trend.
    expect(opinion.processAuditIds).toEqual(
      expect.arrayContaining([older.id, newer.id]),
    );
  });
});
