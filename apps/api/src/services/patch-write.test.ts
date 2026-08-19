import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineeringIssueSchema, type AuthUser } from "@atlas/shared";
import {
  persistAutoRemediationDrafts,
} from "./remediation-pipeline.js";
import { approvePatchArtifact, applyApprovedPatch } from "./patch-write.js";
import { osStore } from "../store/os-store.js";

/**
 * Proves the P0 audit-provenance fix: `applyApprovedPatch` threads the
 * authenticated actor's id into the `patch.applied` domain event's payload
 * (`payload.actorId`), instead of the event carrying no attribution at all.
 * apps/api/src/services/event-rules.ts's `onPatchApplied` reads this same
 * key to populate the unified audit entry's `actorId` — see
 * event-rules.test.ts for that half of the chain.
 */

const user: AuthUser = {
  id: "00000000-0000-4000-8000-000000000042",
  email: "actor@atlas.test",
  role: "user",
  displayName: "Actor",
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
      { ref: "docs/adr", note: "not found", epistemicState: "OBSERVED" },
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

describe("patch-write: applyApprovedPatch threads the actor id into patch.applied", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const prevStorePath = process.env.ATLAS_STORE_PATH;
  // Isolation gap fix: this previously left `ATLAS_STORE_PATH` unset, so
  // `applyApprovedPatch`'s internal osStore writes (patch persistence,
  // domain-event dispatch) hit the REAL `.atlas/store.json` at the repo
  // root — SKIP_STORE_PERSIST alone suppresses persistence but not the
  // initial `ensureLoaded()` read of real accumulated state.
  const storeDir = mkdtempSync(join(tmpdir(), "atlas-patch-write-store-"));

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

  it("publishes patch.applied with payload.actorId set to the authenticated user's id", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-patch-write-actor-"));
    const issue = lowIssue();
    const drafts = persistAutoRemediationDrafts({
      projectId: null,
      issues: [issue],
      workspaceRoot: root,
    });
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;

    const approved = approvePatchArtifact(draft.patch, {
      approvedBy: user.email,
      userId: user.id,
    });

    applyApprovedPatch({
      existing: approved,
      user,
      bodyWorkspaceRoot: root,
      skipVerify: true,
    });

    const events = osStore
      .listDomainEvents()
      .filter((e) => e.type === "patch.applied");
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1]!;
    expect(last.payload.actorId).toBe(user.id);
  });
});
