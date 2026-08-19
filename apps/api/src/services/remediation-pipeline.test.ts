import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineeringIssueSchema, type AuthUser } from "@atlas/shared";
import {
  autoApplyLowRemediations,
  persistAutoRemediationDrafts,
  productionAutoApplyBlocked,
  shouldAutoApplyLow,
  verifyAppliedRemediation,
} from "./remediation-pipeline.js";
import { osStore } from "../store/os-store.js";

const user: AuthUser = {
  id: "00000000-0000-4000-8000-000000000099",
  email: "ops@atlas.test",
  role: "user",
  displayName: "Ops",
  locale: "en",
  provider: "local",
  createdAt: new Date().toISOString(),
};

function lowIssue() {
  return engineeringIssueSchema.parse({
    id: crypto.randomUUID(),
    category: "DOCUMENTATION",
    severity: "LOW",
    title: "Constitution · Architecture decisions recorded",
    affectedComponents: [],
    rootCause: "Missing ADR folder",
    evidence: [
      {
        ref: "docs/adr",
        note: "not found",
        epistemicState: "OBSERVED",
      },
    ],
    confidence: 0.75,
    recommendedFix: "Record key ADRs",
    proposedPatchHint: null,
    testsSuggested: ["Constitution check docs.adr"],
    regressionResult: "NOT_RUN",
    approvalStatus: "OPEN",
    remediationPolicy: "AUTO_FIX",
    architectureViolation: false,
    constitutionDomain: "DOCUMENTATION",
    omission: false,
  });
}

describe("remediation-pipeline", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const prevStorePath = process.env.ATLAS_STORE_PATH;
  // Isolation gap fix: this previously left `ATLAS_STORE_PATH` unset, so
  // `persistAutoRemediationDrafts`/`autoApplyLowRemediations`'s osStore
  // writes hit the REAL `.atlas/store.json` at the repo root —
  // SKIP_STORE_PERSIST alone suppresses persistence but not the initial
  // `ensureLoaded()` read of real accumulated patch/state data.
  const storeDir = mkdtempSync(join(tmpdir(), "atlas-remediation-pipeline-store-"));

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
    if (prevStorePath === undefined) delete process.env.ATLAS_STORE_PATH;
    else process.env.ATLAS_STORE_PATH = prevStorePath;
  });

  it("shouldAutoApplyLow requires WRITE user + flag", () => {
    expect(
      shouldAutoApplyLow({ envFlag: true, requestFlag: false, user: null }),
    ).toBe(false);
    expect(
      shouldAutoApplyLow({ envFlag: false, requestFlag: false, user }),
    ).toBe(false);
    expect(
      shouldAutoApplyLow({ envFlag: true, requestFlag: false, user }),
    ).toBe(true);
    expect(
      shouldAutoApplyLow({ envFlag: false, requestFlag: true, user }),
    ).toBe(true);
  });

  it("persists drafts then auto-applies+verifies LOW under workspaceRoot", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-remediation-pipe-"));
    const issue = lowIssue();
    const drafts = persistAutoRemediationDrafts({
      projectId: null,
      issues: [issue],
      workspaceRoot: root,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.autoApplyEligible).toBe(true);
    expect(osStore.getPatch(drafts[0]!.patch.id)?.status).toBe(
      "AWAITING_APPROVAL",
    );

    const outcomes = autoApplyLowRemediations({
      drafts,
      user,
      bodyWorkspaceRoot: root,
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("applied");
    expect(outcomes[0]!.verified).toBe(true);

    const rel = drafts[0]!.patch.filesChanged[0]!.path;
    const full = join(root, rel);
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full, "utf8")).toContain(issue.id);

    const stored = osStore.getPatch(drafts[0]!.patch.id);
    expect(stored?.status).toBe("VERIFIED");
    expect(stored?.verifiedAt).toBeTruthy();
  });

  it("skips MEDIUM drafts on auto-apply", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-remediation-med-"));
    const medium = engineeringIssueSchema.parse({
      ...lowIssue(),
      id: crypto.randomUUID(),
      severity: "MEDIUM",
      title: "Medium finding",
    });
    const drafts = persistAutoRemediationDrafts({
      projectId: null,
      issues: [medium],
      workspaceRoot: root,
    });
    expect(drafts[0]!.autoApplyEligible).toBe(false);
    const outcomes = autoApplyLowRemediations({
      drafts,
      user,
      bodyWorkspaceRoot: root,
    });
    expect(outcomes[0]!.status).toBe("skipped");
  });

  it("verifyAppliedRemediation records evidence event path", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-remediation-verify-"));
    const drafts = persistAutoRemediationDrafts({
      projectId: null,
      issues: [lowIssue()],
      workspaceRoot: root,
    });
    const outcomes = autoApplyLowRemediations({
      drafts,
      user,
      bodyWorkspaceRoot: root,
    });
    expect(outcomes[0]!.status).toBe("applied");
    const patch = osStore.getPatch(drafts[0]!.patch.id)!;
    // Re-verify already VERIFIED patch
    const again = verifyAppliedRemediation({
      patch: { ...patch, status: "APPLIED", verifiedAt: null },
      workspaceRoot: root,
      userId: user.id,
    });
    expect(again.verify.ok).toBe(true);
    expect(again.patch.status).toBe("VERIFIED");
  });

  it("blocks production auto-apply unless explicitly allowed", () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(
        productionAutoApplyBlocked({ projectId: null, allowProd: false }).blocked,
      ).toBe(true);
      expect(
        productionAutoApplyBlocked({ projectId: null, allowProd: true }).blocked,
      ).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
