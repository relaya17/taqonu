import { describe, expect, it } from "vitest";
import {
  assertCategoriesPreserved,
  createClaimSchema,
  createEvidenceRecordSchema,
  groupEvidenceByCategory,
  inferEvidenceCategory,
  parseEvidenceRecord,
} from "./evidence.schema.js";
import { isWriteGateOpen } from "./evaluation.schema.js";
import { EVIDENCE_CATEGORIES } from "../constants/state.js";

describe("evidence + claim contracts", () => {
  it("requires epistemic labeling on claims", () => {
    const claim = createClaimSchema.parse({
      statement: "Zod is the API contract source of truth",
      epistemicState: "CONFIRMED",
      evidenceIds: ["11111111-1111-4111-8111-111111111111"],
      confidence: 0.95,
    });
    expect(claim.epistemicState).toBe("CONFIRMED");
  });

  it("records FACT evidence from GitHub with GIT category", () => {
    const evidence = createEvidenceRecordSchema.parse({
      source: "github:brokeros@main:README.md",
      sourceType: "REPOSITORY_FILE",
      epistemicState: "FACT",
      excerpt: "# BrokerOS",
      version: "abc1234",
      category: "CODE",
    });
    expect(evidence.epistemicState).toBe("FACT");
    expect(evidence.category).toBe("CODE");
  });

  it("rejects unknown evidence categories on write", () => {
    expect(() =>
      createEvidenceRecordSchema.parse({
        source: "x",
        sourceType: "GITHUB",
        epistemicState: "FACT",
        category: "BLOB",
      }),
    ).toThrow();
  });
});

describe("evidence category separation", () => {
  const NOW = "2026-08-12T12:00:00.000Z";
  const OWNER = "00000000-0000-4000-8000-000000000001";
  const PROJECT = "11111111-1111-4111-8111-111111111111";

  it("infers distinct categories from provenance (not one blob)", () => {
    expect(
      inferEvidenceCategory({ sourceType: "GITHUB", source: "github:x" }),
    ).toBe("GIT");
    expect(
      inferEvidenceCategory({
        sourceType: "REPOSITORY_FILE",
        metadata: { kind: "architecture_doc" },
      }),
    ).toBe("ARCHITECTURE");
    expect(
      inferEvidenceCategory({
        sourceType: "REPOSITORY_FILE",
        metadata: { kind: "dependency_manifest" },
      }),
    ).toBe("DEPENDENCIES");
    expect(
      inferEvidenceCategory({
        sourceType: "CONNECTOR",
        source: "supabase:prod",
        metadata: { tableCount: 3 },
      }),
    ).toBe("DATABASE");
    expect(
      inferEvidenceCategory({ sourceType: "PRODUCTION", source: "vercel:app" }),
    ).toBe("DEPLOYMENT");
  });

  it("preserves CODE/GIT/SECURITY separately in groupEvidenceByCategory", () => {
    const records = [
      parseEvidenceRecord({
        id: "33333333-3333-4333-8333-333333333331",
        ownerId: OWNER,
        projectId: PROJECT,
        source: "repo:src/index.ts",
        sourceType: "REPOSITORY_FILE",
        sourceId: "src/index.ts",
        uri: null,
        excerpt: "export {}",
        version: null,
        observedAt: NOW,
        createdAt: NOW,
        confidence: 1,
        epistemicState: "FACT",
        category: "CODE",
        metadata: {},
      }),
      parseEvidenceRecord({
        id: "33333333-3333-4333-8333-333333333332",
        ownerId: OWNER,
        projectId: PROJECT,
        source: "github:owner/repo",
        sourceType: "GITHUB",
        sourceId: "owner/repo",
        uri: "https://github.com/owner/repo",
        excerpt: "HEAD",
        version: "abc",
        observedAt: NOW,
        createdAt: NOW,
        confidence: 1,
        epistemicState: "FACT",
        category: "GIT",
        metadata: {},
      }),
      parseEvidenceRecord({
        id: "33333333-3333-4333-8333-333333333333",
        ownerId: OWNER,
        projectId: PROJECT,
        source: "security:advisory",
        sourceType: "SYSTEM",
        sourceId: "cve-1",
        uri: null,
        excerpt: "advisory",
        version: null,
        observedAt: NOW,
        createdAt: NOW,
        confidence: 0.8,
        epistemicState: "OBSERVED",
        category: "SECURITY",
        metadata: { kind: "security" },
      }),
    ];

    const grouped = groupEvidenceByCategory(records);
    expect(grouped).toHaveLength(EVIDENCE_CATEGORIES.length);
    expect(grouped.find((b) => b.category === "CODE")?.items).toHaveLength(1);
    expect(grouped.find((b) => b.category === "GIT")?.items).toHaveLength(1);
    expect(grouped.find((b) => b.category === "SECURITY")?.items).toHaveLength(
      1,
    );
    expect(grouped.find((b) => b.category === "DEPLOYMENT")?.items).toHaveLength(
      0,
    );
    expect(() => assertCategoriesPreserved(records, grouped)).not.toThrow();
  });

  it("refuses silent merge into a single category bucket", () => {
    const records = [
      parseEvidenceRecord({
        id: "33333333-3333-4333-8333-333333333331",
        ownerId: OWNER,
        projectId: PROJECT,
        source: "a",
        sourceType: "GITHUB",
        sourceId: null,
        uri: null,
        excerpt: null,
        version: null,
        observedAt: NOW,
        createdAt: NOW,
        confidence: 1,
        epistemicState: "FACT",
        category: "GIT",
        metadata: {},
      }),
      parseEvidenceRecord({
        id: "33333333-3333-4333-8333-333333333332",
        ownerId: OWNER,
        projectId: PROJECT,
        source: "b",
        sourceType: "REPOSITORY_FILE",
        sourceId: null,
        uri: null,
        excerpt: null,
        version: null,
        observedAt: NOW,
        createdAt: NOW,
        confidence: 1,
        epistemicState: "FACT",
        category: "CODE",
        metadata: {},
      }),
    ];

    const collapsed = EVIDENCE_CATEGORIES.map((category) => ({
      category,
      items: category === "CODE" ? records : [],
    }));

    expect(() => assertCategoriesPreserved(records, collapsed)).toThrow(
      /Silent category merge|silently merged/i,
    );
  });
});

describe("write gate", () => {
  it("stays closed until all required eval dimensions pass", () => {
    expect(
      isWriteGateOpen(
        [
          { dimension: "ACCURACY", score: 0.9, passed: true, notes: null },
          { dimension: "SECURITY", score: 0.5, passed: false, notes: "fail" },
        ],
        ["ACCURACY", "SECURITY"],
      ),
    ).toBe(false);
  });
});
