import { describe, expect, it } from "vitest";
import {
  agentDispatchRequestSchema,
  agentPlanRequestSchema,
  agentRunResultSchema,
  fabricAgentIdSchema,
  judgeEvaluateRequestSchema,
  knowledgeSearchRequestSchema,
} from "./agent-fabric.schema.js";

describe("fabricAgentIdSchema", () => {
  it("accepts every documented fabric agent id", () => {
    for (const id of [
      "ORCHESTRATOR",
      "SECURITY",
      "LEGAL_MEDIA_COMMS",
      "JUDGE",
    ]) {
      expect(() => fabricAgentIdSchema.parse(id)).not.toThrow();
    }
  });

  it("rejects an id not in the fabric agent catalog", () => {
    expect(() => fabricAgentIdSchema.parse("GPT_MASTER")).toThrow();
  });
});

describe("agentPlanRequestSchema / agentDispatchRequestSchema", () => {
  it("accept requests up to 8000 chars with no internal-field cap mismatch (unlike kernel.schema's objective bug)", () => {
    for (const schema of [agentPlanRequestSchema, agentDispatchRequestSchema]) {
      expect(() => schema.parse({ request: "x".repeat(8000) })).not.toThrow();
    }
  });

  it("agentIds must be non-empty and capped at 8, and only contain real agent ids", () => {
    expect(() =>
      agentPlanRequestSchema.parse({ request: "hi", agentIds: [] }),
    ).toThrow();
    expect(() =>
      agentPlanRequestSchema.parse({ request: "hi", agentIds: ["NOT_REAL"] }),
    ).toThrow();
    expect(() =>
      agentPlanRequestSchema.parse({ request: "hi", agentIds: ["SECURITY"] }),
    ).not.toThrow();
  });

  it("agentDispatchRequestSchema defaults runJudge to true", () => {
    expect(agentDispatchRequestSchema.parse({ request: "hi" }).runJudge).toBe(true);
  });
});

describe("agentRunResultSchema", () => {
  const base = {
    agentId: "ARCHITECT" as const,
    status: "COMPLETED" as const,
    summary: "done",
    claims: [],
    evidenceRefs: [],
    epistemicState: "INFERRED" as const,
    costUsd: 0.01,
    durationMs: 5,
  };

  it("accepts a well-formed run result and defaults claims/evidenceRefs to []", () => {
    // Destructured only to OMIT these two keys from `withoutDefaults` — the
    // bindings themselves are intentionally unused, hence the `_` prefix
    // required by this repo's no-unused-vars convention (/^_/u).
    const { claims: _claims, evidenceRefs: _evidenceRefs, ...withoutDefaults } = base;
    const parsed = agentRunResultSchema.parse(withoutDefaults);
    expect(parsed.claims).toEqual([]);
    expect(parsed.evidenceRefs).toEqual([]);
  });

  it("rejects a status outside COMPLETED/SKIPPED/FAILED/NEEDS_EVIDENCE", () => {
    expect(() => agentRunResultSchema.parse({ ...base, status: "RUNNING" })).toThrow();
  });

  it("requires durationMs to be an integer", () => {
    expect(() => agentRunResultSchema.parse({ ...base, durationMs: 1.5 })).toThrow();
  });
});

describe("judgeEvaluateRequestSchema", () => {
  it("requires at least one run", () => {
    expect(() => judgeEvaluateRequestSchema.parse({ runs: [] })).toThrow();
  });

  it("request field is optional", () => {
    const runs = [
      {
        agentId: "ARCHITECT" as const,
        status: "COMPLETED" as const,
        summary: "done",
        epistemicState: "INFERRED" as const,
        costUsd: 0,
        durationMs: 1,
      },
    ];
    expect(() => judgeEvaluateRequestSchema.parse({ runs })).not.toThrow();
  });
});

describe("knowledgeSearchRequestSchema", () => {
  it("defaults maxResults=20, minAuthority=0.4, allowStale=false", () => {
    const parsed = knowledgeSearchRequestSchema.parse({ query: "auth" });
    expect(parsed.maxResults).toBe(20);
    expect(parsed.minAuthority).toBe(0.4);
    expect(parsed.allowStale).toBe(false);
  });

  it("rejects an empty query and a query over 2000 chars", () => {
    expect(() => knowledgeSearchRequestSchema.parse({ query: "" })).toThrow();
    expect(() =>
      knowledgeSearchRequestSchema.parse({ query: "x".repeat(2001) }),
    ).toThrow();
  });

  it("rejects maxResults over 50", () => {
    expect(() =>
      knowledgeSearchRequestSchema.parse({ query: "auth", maxResults: 51 }),
    ).toThrow();
  });
});
