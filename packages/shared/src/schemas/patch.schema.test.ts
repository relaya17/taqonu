import { describe, expect, it } from "vitest";
import { patchArtifactSchema, patchFileChangeSchema } from "./patch.schema.js";

const baseFileChange = {
  path: "src/index.ts",
  action: "modify" as const,
  summary: "small fix",
};

const basePatch = {
  id: "00000000-0000-4000-8000-000000000000",
  projectId: null,
  title: "Fix bug",
  reason: "There was a bug",
  mode: "fix" as const,
  status: "AWAITING_APPROVAL" as const,
  risk: "LOW" as const,
  baseCommit: null,
  targetBranch: null,
  filesChanged: [baseFileChange],
  evidenceIds: [],
  claimIds: [],
  expectedImpact: "fixes the bug",
  tests: [],
  evaluationSummary: null,
  approvals: [],
  appliedAt: null,
  verifiedAt: null,
  rollbackRef: null,
  rollbackSnapshot: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "agent",
};

describe("patchArtifactSchema", () => {
  it("accepts a well-formed patch and defaults epistemicState/confidence/authorityHint", () => {
    // Destructured only to OMIT these three keys from `withoutDefaults` —
    // the bindings themselves are intentionally unused, hence the `_`
    // prefix required by this repo's no-unused-vars convention (/^_/u).
    const {
      epistemicState: _epistemicState,
      confidence: _confidence,
      authorityHint: _authorityHint,
      ...withoutDefaults
    } = basePatch as Record<string, unknown>;
    const parsed = patchArtifactSchema.parse(withoutDefaults);
    expect(parsed.epistemicState).toBe("PROPOSED");
    expect(parsed.confidence).toBe(0.5);
    expect(parsed.authorityHint).toBe("LLM_INFERENCE");
  });

  it("requires filesChanged to be non-empty — a zero-file patch cannot be constructed via this schema", () => {
    expect(() => patchArtifactSchema.parse({ ...basePatch, filesChanged: [] })).toThrow();
  });

  it("caps filesChanged at 50 entries", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      ...baseFileChange,
      path: `src/f${i}.ts`,
    }));
    expect(() =>
      patchArtifactSchema.parse({ ...basePatch, filesChanged: many }),
    ).toThrow();
  });

  it("rejects a status outside the documented patch lifecycle", () => {
    expect(() =>
      patchArtifactSchema.parse({ ...basePatch, status: "MERGED" }),
    ).toThrow();
  });

  it("rejects an empty title or reason", () => {
    expect(() => patchArtifactSchema.parse({ ...basePatch, title: "" })).toThrow();
    expect(() => patchArtifactSchema.parse({ ...basePatch, reason: "" })).toThrow();
  });
});

describe("patchFileChangeSchema", () => {
  it("accepts add/modify/delete actions and rejects anything else", () => {
    for (const action of ["add", "modify", "delete"] as const) {
      expect(() =>
        patchFileChangeSchema.parse({ ...baseFileChange, action }),
      ).not.toThrow();
    }
    expect(() =>
      patchFileChangeSchema.parse({ ...baseFileChange, action: "rename" }),
    ).toThrow();
  });

  it("caps unifiedDiff at 200,000 chars and afterContent at 500,000 chars", () => {
    expect(() =>
      patchFileChangeSchema.parse({
        ...baseFileChange,
        unifiedDiff: "x".repeat(200_001),
      }),
    ).toThrow();
    expect(() =>
      patchFileChangeSchema.parse({
        ...baseFileChange,
        afterContent: "x".repeat(500_001),
      }),
    ).toThrow();
  });
});
