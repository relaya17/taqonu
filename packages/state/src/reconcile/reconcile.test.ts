import { describe, expect, it } from "vitest";
import type { Decision, EvidenceRecord, Memory } from "@atlas/shared";
import { assertNeverPromotesToFact, weakestEpistemicState } from "./epistemic.js";
import { reconcileProjectState } from "./reconcile.js";
import type { ConnectorObservation } from "./input.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function evidence(partial: Partial<EvidenceRecord> & Pick<EvidenceRecord, "source" | "sourceType">): EvidenceRecord {
  const now = "2026-08-11T12:00:00.000Z";
  return {
    id: partial.id ?? crypto.randomUUID(),
    ownerId: "00000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    source: partial.source,
    sourceType: partial.sourceType,
    sourceId: partial.sourceId ?? null,
    uri: partial.uri ?? null,
    excerpt: partial.excerpt ?? null,
    version: partial.version ?? null,
    observedAt: partial.observedAt ?? now,
    createdAt: now,
    confidence: partial.confidence ?? 1,
    epistemicState: partial.epistemicState ?? "FACT",
    category: partial.category ?? "CODE",
    classification: partial.classification ?? "INTERNAL",
    authorityRank: partial.authorityRank ?? "REPOSITORY_CODE",
    metadata: partial.metadata ?? {},
  };
}

describe("epistemic guards", () => {
  it("never promotes to FACT without FACT sources", () => {
    expect(assertNeverPromotesToFact("FACT", ["PROPOSED", "INFERRED"])).toBe(
      "INFERRED",
    );
  });

  it("overall state uses the weakest slice", () => {
    expect(weakestEpistemicState(["FACT", "UNKNOWN", "CONFIRMED"])).toBe(
      "UNKNOWN",
    );
  });
});

describe("reconcileProjectState", () => {
  it("marks all slices UNKNOWN when GitHub has not synced", () => {
    const result = reconcileProjectState({
      projectId: PROJECT_ID,
      observations: [],
      evidence: [],
      claims: [],
      memories: [],
      decisions: [],
    });

    expect(result.snapshot.overallEpistemicState).toBe("UNKNOWN");
    const git = result.snapshot.slices.find((slice) => slice.key === "GIT");
    expect(git?.epistemicState).toBe("UNKNOWN");
    expect(git?.stale).toBe(true);
  });

  it("builds FACT git/code slices from GitHub observation + evidence", () => {
    const observation: ConnectorObservation = {
      connector: "github",
      projectId: PROJECT_ID,
      observedAt: "2026-08-11T12:00:00.000Z",
      repository: {
        fullName: "arlet/brokeros",
        defaultBranch: "main",
        private: true,
        htmlUrl: "https://github.com/arlet/brokeros",
        lastSyncedAt: "2026-08-11T12:00:00.000Z",
      },
      headSha: "abcdef1234567890",
      openPrCount: 1,
      openIssueCount: 2,
      dependencyManifests: ["package.json", "pnpm-lock.yaml"],
      hasCiConfig: true,
      architectureDocPaths: ["docs/architecture/overview.md"],
      testSignals: {
        hasTestDirectory: true,
        recentCiStatus: "success",
      },
      securitySignals: {
        hasDependabot: true,
        hasCodeowners: false,
      },
    };

    const result = reconcileProjectState({
      projectId: PROJECT_ID,
      observations: [observation],
      evidence: [
        evidence({
          source: "github:arlet/brokeros",
          sourceType: "GITHUB",
          version: "abcdef1",
        }),
      ],
      claims: [],
      memories: [],
      decisions: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          projectId: PROJECT_ID,
          decision: "Use Zod as API contract source of truth",
          reason: ["Prevent drift"],
          alternatives: ["Duplicate interfaces"],
          tradeOffs: [],
          evidence: [],
          status: "ACTIVE",
          confidence: 1,
          epistemicState: "CONFIRMED",
          supersededBy: null,
          adrPath: "docs/adr/ADR-001-zod-api-contracts.md",
          decidedAt: "2026-08-11T10:00:00.000Z",
          createdAt: "2026-08-11T10:00:00.000Z",
          updatedAt: "2026-08-11T10:00:00.000Z",
        } satisfies Decision,
      ],
      openTasks: ["Wire GitHub App"],
    });

    expect(result.snapshot.slices).toHaveLength(12);
    expect(result.snapshot.slices.find((s) => s.key === "GIT")?.epistemicState).toBe(
      "FACT",
    );
    expect(result.snapshot.slices.find((s) => s.key === "CODE")?.epistemicState).toBe(
      "FACT",
    );
    expect(
      result.snapshot.slices.find((s) => s.key === "DEPENDENCIES")?.summary,
    ).toContain("package.json");
    expect(
      result.snapshot.slices.find((s) => s.key === "DECISIONS")?.summary,
    ).toContain("Zod");
    expect(
      result.snapshot.slices.find((s) => s.key === "DEPLOYMENT")?.epistemicState,
    ).toBe("UNKNOWN");
    expect(
      result.snapshot.slices.find((s) => s.key === "DATABASE")?.epistemicState,
    ).toBe("UNKNOWN");
    expect(result.domainEvent.type).toBe("state.reconciled");
  });

  it("marks DATABASE as FACT when supabase/mongo feeds exist", () => {
    const result = reconcileProjectState({
      projectId: PROJECT_ID,
      observations: [
        {
          connector: "supabase",
          projectId: PROJECT_ID,
          observedAt: "2026-08-11T12:00:00.000Z",
          database: {
            provider: "supabase",
            summary: "Supabase/public @ example: 3 tables",
            objectCount: 3,
            objectNames: ["users", "orders", "items"],
            rlsEnabled: true,
            host: "example",
          },
        },
      ],
      evidence: [],
      claims: [],
      memories: [],
      decisions: [],
    });

    expect(
      result.snapshot.slices.find((s) => s.key === "DATABASE")?.epistemicState,
    ).toBe("FACT");
  });

  it("marks DEPLOYMENT as OBSERVED when vercel feed is READY", () => {
    const result = reconcileProjectState({
      projectId: PROJECT_ID,
      observations: [
        {
          connector: "vercel",
          projectId: PROJECT_ID,
          observedAt: "2026-08-12T12:00:00.000Z",
          deployment: {
            provider: "vercel",
            summary: "Vercel/api: production · READY",
            environment: "production",
            status: "READY",
            url: "https://api.example.vercel.app",
            commitSha: "abc1234",
          },
        },
      ],
      evidence: [],
      claims: [],
      memories: [],
      decisions: [],
    });

    expect(
      result.snapshot.slices.find((s) => s.key === "DEPLOYMENT")?.epistemicState,
    ).toBe("OBSERVED");
  });

  it("retains CONFLICTED overall when claims conflict", () => {
    const claimA = {
      id: "33333333-3333-4333-8333-333333333333",
      ownerId: "00000000-0000-4000-8000-000000000001",
      projectId: PROJECT_ID,
      statement: "Use MongoDB",
      epistemicState: "CONFLICTED" as const,
      confidence: 0.7,
      evidenceIds: [] as string[],
      derivedFrom: [] as string[],
      source: null,
      authorityRank: "DEVELOPER_STATEMENT" as const,
      verification: {
        inCode: false,
        hasTest: false,
        liveVerified: false,
      },
      observedAt: null,
      verifiedAt: null,
      expiresAt: null,
      asOf: "2026-07-01T00:00:00.000Z",
      version: null,
      conflictingClaimIds: ["44444444-4444-4444-8444-444444444444"],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    const result = reconcileProjectState({
      projectId: PROJECT_ID,
      observations: [],
      evidence: [],
      claims: [claimA],
      memories: [] as Memory[],
      decisions: [],
    });

    expect(result.snapshot.overallEpistemicState).toBe("CONFLICTED");
    expect(result.snapshot.conflicts.length).toBeGreaterThan(0);
  });
});
