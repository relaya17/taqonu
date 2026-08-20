import { describe, expect, it } from "vitest";
import type { Claim, EvidenceRecord } from "@atlas/shared";
import {
  computeArtifactHash,
  computeEvidenceHash,
  requireVerifiedClaim,
  revalidateClaim,
  verifyClaimEvidence,
} from "./claim-integrity.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CLAIM_ID = "22222222-2222-4222-8222-222222222222";
const EV_ID = "33333333-3333-4333-8333-333333333333";

const ARTIFACT = "const secureMode = true;";
const ARTIFACT_HASH = computeArtifactHash(ARTIFACT);

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: EV_ID,
    ownerId: OWNER,
    projectId: null,
    source: "security-runtime",
    sourceType: "TEST_RUN",
    sourceId: "run-1",
    uri: null,
    excerpt: '{"secureMode":true}',
    // `version` is the schema's existing "which version of the source" slot —
    // this is where the artifact binding lives.
    version: ARTIFACT_HASH,
    observedAt: "2026-08-20T20:00:00.000Z",
    createdAt: "2026-08-20T20:00:00.000Z",
    confidence: 0.9,
    epistemicState: "OBSERVED",
    category: "CODE",
    classification: "INTERNAL",
    authorityRank: "AUTOMATED_VERIFIED_TEST",
    metadata: {},
    ...overrides,
  } as EvidenceRecord;
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: CLAIM_ID,
    ownerId: OWNER,
    projectId: null,
    statement: "Secure mode is enabled.",
    epistemicState: "PROPOSED",
    confidence: 0.8,
    evidenceIds: [EV_ID],
    derivedFrom: [],
    source: null,
    authorityRank: "DEVELOPER_STATEMENT",
    verification: { inCode: false, hasTest: false, liveVerified: false },
    observedAt: null,
    verifiedAt: null,
    expiresAt: null,
    ...overrides,
  } as Claim;
}

describe("P0.4 — Evidence → Claim integrity", () => {
  it("VERIFIES a claim whose required evidence matches the artifact", () => {
    const result = verifyClaimEvidence(claim(), [evidence()], ARTIFACT_HASH);
    expect(result.state).toBe("VERIFIED");
    expect(result.evidenceHashes).toHaveLength(1);
  });

  it("is UNVERIFIED when the required evidence is absent entirely", () => {
    const result = verifyClaimEvidence(claim(), [], ARTIFACT_HASH);
    expect(result.state).toBe("UNVERIFIED");
  });

  it("is UNVERIFIED when the evidence describes a DIFFERENT artifact version", () => {
    // Same evidence id, same subject — but recorded against other code.
    const other = evidence({ version: computeArtifactHash("const secureMode = false;") });
    const result = verifyClaimEvidence(claim(), [other], ARTIFACT_HASH);
    expect(result.state).toBe("UNVERIFIED");
  });

  it("is UNVERIFIED when only SOME required evidence matches", () => {
    const second = "44444444-4444-4444-8444-444444444444";
    const result = verifyClaimEvidence(
      claim({ evidenceIds: [EV_ID, second] }),
      [evidence()],
      ARTIFACT_HASH,
    );
    expect(result.state).toBe("UNVERIFIED");
    expect(result.reason).toContain(second);
  });

  it("is UNVERIFIED when the claim requires no evidence at all", () => {
    // A claim that demands nothing is not thereby proven.
    const result = verifyClaimEvidence(claim({ evidenceIds: [] }), [evidence()], ARTIFACT_HASH);
    expect(result.state).toBe("UNVERIFIED");
  });
});

describe("P0.4 — revalidation against the current world", () => {
  it("marks a claim STALE once the artifact changes", () => {
    const result = revalidateClaim(claim(), {
      currentArtifact: "const secureMode = false;",
      currentEvidence: [evidence()],
      boundArtifactHash: ARTIFACT_HASH,
    });
    expect(result.state).toBe("STALE");
    expect(result.reason).toContain("no longer describes the current state");
  });

  it("stays VERIFIED while the artifact is unchanged", () => {
    const result = revalidateClaim(claim(), {
      currentArtifact: ARTIFACT,
      currentEvidence: [evidence()],
      boundArtifactHash: ARTIFACT_HASH,
    });
    expect(result.state).toBe("VERIFIED");
  });

  it("reports STALE — not UNVERIFIED — when the artifact changed AND evidence is missing", () => {
    // Staleness is decided first: reporting "missing evidence" would send a
    // reader hunting for a record that was never the problem.
    const result = revalidateClaim(claim(), {
      currentArtifact: "const secureMode = false;",
      currentEvidence: [],
      boundArtifactHash: ARTIFACT_HASH,
    });
    expect(result.state).toBe("STALE");
  });

  it("honours claim-level expiry even when the artifact is unchanged", () => {
    const result = revalidateClaim(claim({ expiresAt: "2026-08-19T00:00:00.000Z" }), {
      currentArtifact: ARTIFACT,
      currentEvidence: [evidence()],
      boundArtifactHash: ARTIFACT_HASH,
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    expect(result.state).toBe("STALE");
    expect(result.reason).toContain("expired");
  });

  it("returns INSUFFICIENT_EVIDENCE — never VERIFIED — for a claim that was never artifact-bound", () => {
    const result = revalidateClaim(claim(), {
      currentArtifact: ARTIFACT,
      currentEvidence: [evidence()],
    });
    expect(result.state).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("P0.4 — execution gate and hash determinism", () => {
  it("THROWS when an execution requires a claim that has gone stale", () => {
    expect(() =>
      requireVerifiedClaim(claim(), {
        currentArtifact: "const secureMode = false;",
        currentEvidence: [evidence()],
        boundArtifactHash: ARTIFACT_HASH,
      }),
    ).toThrow(/CLAIM INTEGRITY FAILURE/);
  });

  it("passes through when the claim is still verified", () => {
    expect(() =>
      requireVerifiedClaim(claim(), {
        currentArtifact: ARTIFACT,
        currentEvidence: [evidence()],
        boundArtifactHash: ARTIFACT_HASH,
      }),
    ).not.toThrow();
  });

  it("produces deterministic evidence hashes", () => {
    expect(computeEvidenceHash(evidence())).toBe(computeEvidenceHash(evidence()));
  });

  it("hashes evidence by identity, not by object key order", () => {
    // Building the same evidence with keys in a different order must not
    // change its hash — key order is an implementation detail.
    const a = evidence();
    const b = { ...evidence(), metadata: {}, id: EV_ID } as EvidenceRecord;
    expect(computeEvidenceHash(a)).toBe(computeEvidenceHash(b));
  });

  it("changes the evidence hash when the observation itself changes", () => {
    expect(computeEvidenceHash(evidence())).not.toBe(
      computeEvidenceHash(evidence({ excerpt: '{"secureMode":false}' })),
    );
  });
});
