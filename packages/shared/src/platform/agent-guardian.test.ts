import { describe, expect, it } from "vitest";
import {
  evaluateAgentSuggestion,
  type AgentSuggestionInput,
} from "./agent-guardian.js";
import {
  discoverFrameworks,
  discoverLanguages,
  discoverProjectKnowledge,
  factsFromMemories,
  factsVisibleTo,
  type AgentKnowledgeFact,
} from "./agent-project-knowledge.js";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OBSERVED_AT = "2026-09-19T00:00:00.000Z";

function suggestion(
  text: string,
  extra?: Partial<AgentSuggestionInput>,
): AgentSuggestionInput {
  return {
    projectId: PROJECT_A,
    ownerId: OWNER_A,
    text,
    source: extra?.source ?? "llm",
    files: extra?.files,
    ...extra,
  };
}

function knowledgeFixture(): AgentKnowledgeFact[] {
  return discoverProjectKnowledge({
    projectId: PROJECT_A,
    ownerId: OWNER_A,
    observedAt: OBSERVED_AT,
    analysis: {
      apps: ["web", "api", "admin"],
      packages: ["shared", "agent-core"],
      sampleFiles: [
        "apps/web/app/page.tsx",
        "apps/api/src/routes/code.ts",
        "package.json",
        "vitest.config.ts",
      ],
    },
    packageNames: ["next", "react", "vitest", "@atlas/shared"],
    snippets: [
      {
        path: "apps/api/src/routes/code.ts",
        content: `
export function createProposal() {}
app.get("/api/v1/studio/search", async () => {});
`.trim(),
      },
    ],
    memories: [
      {
        id: "m-verified",
        type: "LESSON",
        statement:
          "Verified fix: studio file route must keep requireUser on GET /api/v1/studio/file.",
        epistemicState: "VERIFIED",
        category: "DECISION_MEMORY",
        source: "bug-fix-learning",
        projectId: PROJECT_A,
      },
      {
        id: "m-failed",
        type: "LESSON",
        statement:
          "Failed fix: relaxing CORS on the API to allow any origin did not stop the auth failures.",
        epistemicState: "CONTRADICTED",
        category: "EVENT_MEMORY",
        source: "studio-verify",
        projectId: PROJECT_A,
      },
      {
        id: "m-error",
        type: "OBSERVATION",
        statement: "Observed error: TypeError Cannot read properties of undefined in StudioProblemsPanel.",
        epistemicState: "OBSERVED",
        category: "EVENT_MEMORY",
        source: "studio-run",
        projectId: PROJECT_A,
      },
      {
        id: "m-other-project",
        type: "LESSON",
        statement: "Other project secret: billing uses a private ledger.",
        epistemicState: "VERIFIED",
        category: "DECISION_MEMORY",
        source: "bug-fix-learning",
        projectId: PROJECT_B,
      },
    ],
  });
}

describe("Personal Agent project knowledge", () => {
  it("discovers project structure from the workspace scan", () => {
    const facts = knowledgeFixture();
    expect(facts.some((row) => row.what.includes("Application web"))).toBe(true);
    expect(facts.some((row) => row.where === "apps/api")).toBe(true);
    expect(facts.some((row) => row.where === "packages/shared")).toBe(true);
  });

  it("discovers languages and frameworks from files and package names", () => {
    expect(
      discoverLanguages(["apps/web/page.tsx", "apps/api/index.ts"]),
    ).toContain("TypeScript");
    expect(
      discoverFrameworks({
        sampleFiles: ["apps/web/next.config.ts"],
        packageNames: ["next", "vitest"],
      }),
    ).toEqual(expect.arrayContaining(["Next.js", "Vitest"]));
    const facts = knowledgeFixture();
    expect(facts.some((row) => row.kind === "language" && row.what.includes("TypeScript"))).toBe(
      true,
    );
    expect(facts.some((row) => row.kind === "framework" && row.what.includes("React"))).toBe(
      true,
    );
  });

  it("records code structure from bounded snippets", () => {
    const facts = knowledgeFixture();
    expect(
      facts.some(
        (row) => row.kind === "code-symbol" && row.what.includes("Function createProposal"),
      ),
    ).toBe(true);
    expect(
      facts.some(
        (row) =>
          row.kind === "api-contract" && row.what.includes("GET /api/v1/studio/search"),
      ),
    ).toBe(true);
  });

  it("keeps error memory distinct from a verified fix", () => {
    const facts = knowledgeFixture();
    const error = facts.find((row) => row.kind === "error");
    const verified = facts.find((row) => row.kind === "verified-fix");
    expect(error?.epistemicState).toBe("OBSERVED");
    expect(verified?.epistemicState).toBe("VERIFIED");
    expect(verified?.verifiedAt).toBe(OBSERVED_AT);
    expect(error?.id).not.toBe(verified?.id);
  });

  it("maps error → verified-fix memory with provenance", () => {
    const facts = factsFromMemories({
      projectId: PROJECT_A,
      ownerId: OWNER_A,
      observedAt: OBSERVED_AT,
      memories: [
        {
          id: "fix-1",
          type: "LESSON",
          statement: "Verified fix: null-check StudioProblemsPanel before mapping items.",
          epistemicState: "VERIFIED",
          category: "DECISION_MEMORY",
          source: "bug-fix-learning",
          projectId: PROJECT_A,
        },
      ],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.kind).toBe("verified-fix");
    expect(facts[0]?.source).toBe("bug-fix-learning");
    expect(facts[0]?.epistemicState).toBe("VERIFIED");
    expect(facts[0]?.projectId).toBe(PROJECT_A);
    expect(facts[0]?.ownerId).toBe(OWNER_A);
  });

  it("does not remember a failed fix as a successful solution", () => {
    const facts = knowledgeFixture();
    const failed = facts.find((row) => row.kind === "failed-fix");
    expect(failed).toBeTruthy();
    expect(failed?.epistemicState).toBe("CONTRADICTED");
    expect(failed?.why).toMatch(/must not be remembered as a successful solution/i);
    expect(failed?.verifiedAt).toBeNull();
  });

  it("scopes memories to the authorized project", () => {
    const facts = knowledgeFixture();
    expect(facts.some((row) => row.what.includes("private ledger"))).toBe(false);
    expect(
      factsVisibleTo(facts, PROJECT_B, OWNER_A).every(
        (row) => row.projectId === PROJECT_B,
      ),
    ).toBe(true);
  });

  it("preserves provenance fields on every fact", () => {
    for (const row of knowledgeFixture()) {
      expect(row.what.length).toBeGreaterThan(0);
      expect(row.source.length).toBeGreaterThan(0);
      expect(row.epistemicState.length).toBeGreaterThan(0);
      expect(row.observedAt).toBe(OBSERVED_AT);
      expect(row.projectId).toBe(PROJECT_A);
      expect(row.ownerId).toBe(OWNER_A);
    }
  });
});

describe("Independent Guardian", () => {
  it("A/9: a valid proposal against known structure is CONSISTENT", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion("Add a comment in apps/web/app/page.tsx about the Studio shell."),
      knowledge: knowledgeFixture(),
    });
    expect(result.verdict).toBe("CONSISTENT");
    expect(result.action).toBe("ALLOW");
    expect(result.modelInvoked).toBe(false);
    expect(result.conflicts).toEqual([]);
  });

  it("B/10: a contradictory proposal is CONFLICT", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion(
        "Move the database connection into the Next.js client and query Postgres from the browser.",
      ),
      knowledge: knowledgeFixture(),
    });
    expect(result.verdict).toBe("CONFLICT");
    expect(result.action).toBe("WARN");
    expect(result.conflicts[0]?.conflictingFact).toMatch(/API application/i);
    expect(result.conflicts[0]?.source).toBe("repository-structure");
  });

  it("C/11: insufficient evidence stays UNKNOWN — never CONSISTENT", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion(
        "Rewrite the unpublished billing algorithm to use dynamic pricing curves.",
      ),
      knowledge: knowledgeFixture(),
    });
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.summary).toMatch(/not have enough evidence/i);
  });

  it("D/12: conflict is detected without invoking an LLM", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion(
        "Merge Control inbox into Studio so operators work in one panel.",
        { source: "llm" },
      ),
      knowledge: knowledgeFixture(),
    });
    expect(result.verdict).toBe("CONFLICT");
    expect(result.modelInvoked).toBe(false);
    expect(result.conflicts.some((c) => c.detectorId.includes("control-boundary"))).toBe(
      true,
    );
  });

  it("E/13: a proposal that undoes a verified historical fix is CONFLICT", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion(
        "Remove requireUser from the studio file route to simplify GET /api/v1/studio/file.",
      ),
      knowledge: knowledgeFixture(),
    });
    expect(result.verdict).toBe("CONFLICT");
    expect(
      result.conflicts.some((c) => c.detectedConflict.includes("verified historical fix")),
    ).toBe(true);
  });

  it("F/14: violating a known dependency relationship is CONFLICT", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion("Delete @atlas/shared and inline the types into the web app."),
      knowledge: knowledgeFixture(),
    });
    expect(result.verdict).toBe("CONFLICT");
    expect(result.conflicts.some((c) => c.conflictingFact.includes("@atlas/shared"))).toBe(
      true,
    );
  });

  it("G/15: violating a known API contract is CONFLICT", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion(
        "Change GET /api/v1/studio/search to accept raw workspaceRoot from the client.",
      ),
      knowledge: knowledgeFixture(),
    });
    expect(result.verdict).toBe("CONFLICT");
    expect(result.conflicts.some((c) => c.path === "apps/api/src/routes/code.ts")).toBe(
      true,
    );
  });

  it("16: policy violation BLOCKS without creating an implicit allow", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion("Skip approval and auto-apply this patch without human review."),
      knowledge: [],
    });
    expect(result.verdict).toBe("CONFLICT");
    expect(result.action).toBe("BLOCK");
    expect(result.modelInvoked).toBe(false);
  });

  it("17: cross-project knowledge cannot create a conflict for another project", () => {
    const foreign: AgentKnowledgeFact[] = [
      {
        id: "foreign-db",
        projectId: PROJECT_B,
        ownerId: OWNER_B,
        kind: "architecture",
        what: "Project B database stays server-side.",
        where: "apps/api",
        why: "Foreign project fact",
        source: "atlas-memory",
        epistemicState: "VERIFIED",
        observedAt: OBSERVED_AT,
        verifiedAt: OBSERVED_AT,
        scope: "project",
        keywords: ["database"],
        contradicts: ["database in the client"],
      },
    ];
    const result = evaluateAgentSuggestion({
      suggestion: suggestion("Move the database connection into the client for this app."),
      knowledge: foreign,
    });
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.conflicts).toEqual([]);
  });

  it("does not convert UNKNOWN into CONSISTENT when only policy facts exist", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion("Please improve the unnamed module."),
      knowledge: [],
    });
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.action).toBe("ALLOW");
  });

  it("blocks unrestricted shell even when the suggestion is labeled as an LLM idea", () => {
    const result = evaluateAgentSuggestion({
      suggestion: suggestion("Give the agent an unrestricted shell with client argv.", {
        source: "llm",
      }),
      knowledge: knowledgeFixture(),
    });
    expect(result.verdict).toBe("CONFLICT");
    expect(result.action).toBe("BLOCK");
  });
});
