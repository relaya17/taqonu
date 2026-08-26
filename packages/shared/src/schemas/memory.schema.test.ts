import { describe, expect, it } from "vitest";
import {
  capEpistemicStateForSource,
  createMemorySchema,
  memorySchema,
} from "./memory.schema.js";

describe("createMemorySchema", () => {
  it("accepts a typed decision memory with provenance fields, capping epistemicState to what a USER source may claim", () => {
    const parsed = createMemorySchema.parse({
      type: "DECISION",
      projectId: "11111111-1111-4111-8111-111111111111",
      statement: "Zod schemas are the source of truth for API contracts.",
      reason: [
        "Prevent frontend/backend drift",
        "Centralize validation",
        "Share contracts across applications",
      ],
      confidence: 1,
      category: "DECISION_MEMORY",
      epistemicState: "CONFIRMED",
      observationMode: "CONFIRMED",
      source: "decision-log-entry",
      sourceType: "USER",
      scope: "PROJECT",
      priority: "HIGH",
    });

    expect(parsed.type).toBe("DECISION");
    // FACT-assertion poisoning gate (P0 fix): sourceType USER is
    // self-reported and cannot claim CONFIRMED directly at create time —
    // it is capped down to PROPOSED. Promotion requires approveMemory().
    expect(parsed.epistemicState).toBe("PROPOSED");
    expect(parsed.category).toBe("DECISION_MEMORY");
  });

  it("rejects invalid confidence", () => {
    expect(() =>
      createMemorySchema.parse({
        type: "PREFERENCE",
        statement: "Do not use any in TypeScript.",
        category: "DECISION_MEMORY",
        epistemicState: "FACT",
        observationMode: "OBSERVED",
        source: "conversation",
        sourceType: "USER",
        confidence: 2,
      }),
    ).toThrow();
  });

  describe("FACT-assertion poisoning gate", () => {
    it("downgrades sourceType=AGENT + epistemicState=FACT to PROPOSED", () => {
      const parsed = createMemorySchema.parse({
        type: "FACT",
        statement: "The production database is PostgreSQL 16.",
        category: "REPOSITORY_EVIDENCE",
        epistemicState: "FACT",
        observationMode: "OBSERVED",
        source: "agent-run",
        sourceType: "AGENT",
      });
      expect(parsed.epistemicState).toBe("PROPOSED");
    });

    it("downgrades sourceType=CONVERSATION + epistemicState=VERIFIED to PROPOSED", () => {
      const parsed = createMemorySchema.parse({
        type: "FACT",
        statement: "The user confirmed the API key rotation completed.",
        category: "EVENT_MEMORY",
        epistemicState: "VERIFIED",
        observationMode: "OBSERVED",
        source: "chat",
        sourceType: "CONVERSATION",
      });
      expect(parsed.epistemicState).toBe("PROPOSED");
    });

    it("downgrades sourceType=WEB_RESEARCH + epistemicState=FACT to INFERRED (structured but unverified source)", () => {
      const parsed = createMemorySchema.parse({
        type: "EXTERNAL_KNOWLEDGE",
        statement: "The library's latest major version is 4.x.",
        category: "VERIFIED_WEB_KNOWLEDGE",
        epistemicState: "FACT",
        observationMode: "OBSERVED",
        source: "web-search",
        sourceType: "WEB_RESEARCH",
      });
      expect(parsed.epistemicState).toBe("INFERRED");
    });

    it("allows sourceType=SYSTEM to claim CONFIRMED directly but still caps FACT down to CONFIRMED", () => {
      const confirmed = createMemorySchema.parse({
        type: "PROJECT_STATE",
        statement: "The pipeline finished the nightly sync.",
        category: "GENERATED_REASONING",
        epistemicState: "CONFIRMED",
        observationMode: "CONFIRMED",
        source: "system-pipeline",
        sourceType: "SYSTEM",
      });
      expect(confirmed.epistemicState).toBe("CONFIRMED");

      const fact = createMemorySchema.parse({
        type: "PROJECT_STATE",
        statement: "The pipeline finished the nightly sync.",
        category: "GENERATED_REASONING",
        epistemicState: "FACT",
        observationMode: "CONFIRMED",
        source: "system-pipeline",
        sourceType: "SYSTEM",
      });
      expect(fact.epistemicState).toBe("CONFIRMED");
    });

    it("leaves negative/error states (e.g. STALE) untouched regardless of sourceType", () => {
      const parsed = createMemorySchema.parse({
        type: "LESSON",
        statement: "This claim is no longer current.",
        category: "GENERATED_REASONING",
        epistemicState: "STALE",
        observationMode: "OBSERVED",
        source: "user-report",
        sourceType: "USER",
      });
      expect(parsed.epistemicState).toBe("STALE");
    });
  });

  describe("capEpistemicStateForSource (unit)", () => {
    it("never raises trust — only clamps down or leaves unchanged", () => {
      expect(capEpistemicStateForSource("USER", "PROPOSED")).toBe("PROPOSED");
      expect(capEpistemicStateForSource("GITHUB", "CONFIRMED")).toBe(
        "CONFIRMED",
      );
      expect(capEpistemicStateForSource("USER", "FACT")).toBe("PROPOSED");
      expect(capEpistemicStateForSource("AGENT", "FACT")).toBe("PROPOSED");
      expect(capEpistemicStateForSource("GITHUB", "FACT")).toBe("CONFIRMED");
    });
  });
});

describe("memorySchema", () => {
  it("requires ownerId (P0 tenant-isolation fix)", () => {
    const now = new Date().toISOString();
    expect(() =>
      memorySchema.parse({
        id: crypto.randomUUID(),
        // ownerId intentionally omitted
        type: "LESSON",
        projectId: null,
        statement: "test",
        reason: [],
        status: "ACTIVE",
        confidence: 0.5,
        category: "GENERATED_REASONING",
        epistemicState: "INFERRED",
        observationMode: "INFERRED",
        source: "test",
        sourceType: "SYSTEM",
        sourceId: null,
        evidence: [],
        supersededBy: null,
        validFrom: null,
        validUntil: null,
        observedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: "test",
        scope: "GLOBAL",
        priority: "MEDIUM",
      }),
    ).toThrow();
  });

  it("accepts a valid ownerId", () => {
    const now = new Date().toISOString();
    const parsed = memorySchema.parse({
      id: crypto.randomUUID(),
      ownerId: "11111111-1111-4111-8111-111111111111",
      type: "LESSON",
      projectId: null,
      statement: "test",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "INFERRED",
      observationMode: "INFERRED",
      source: "test",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "test",
      scope: "GLOBAL",
      priority: "MEDIUM",
    });
    expect(parsed.ownerId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("accepts agentId and allowedAgents (P1 per-agent scoping fix)", () => {
    const now = new Date().toISOString();
    const parsed = memorySchema.parse({
      id: crypto.randomUUID(),
      ownerId: "11111111-1111-4111-8111-111111111111",
      type: "LESSON",
      projectId: null,
      statement: "test",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "INFERRED",
      observationMode: "INFERRED",
      source: "test",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "test",
      scope: "GLOBAL",
      priority: "MEDIUM",
      agentId: "ORCHESTRATOR",
      allowedAgents: ["JUDGE", "ORCHESTRATOR"],
    });
    expect(parsed.agentId).toBe("ORCHESTRATOR");
    expect(parsed.allowedAgents).toEqual(["JUDGE", "ORCHESTRATOR"]);
  });

  it("defaults agentId/allowedAgents to undefined when omitted (strictly additive)", () => {
    const now = new Date().toISOString();
    const parsed = memorySchema.parse({
      id: crypto.randomUUID(),
      ownerId: "11111111-1111-4111-8111-111111111111",
      type: "LESSON",
      projectId: null,
      statement: "test",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "INFERRED",
      observationMode: "INFERRED",
      source: "test",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "test",
      scope: "GLOBAL",
      priority: "MEDIUM",
    });
    expect(parsed.agentId).toBeUndefined();
    expect(parsed.allowedAgents).toBeUndefined();
  });

  it("parses without verifiedBy/verifiedAt (backward-compat: existing stored data and other fixtures never set these)", () => {
    const now = new Date().toISOString();
    const parsed = memorySchema.parse({
      id: crypto.randomUUID(),
      ownerId: "11111111-1111-4111-8111-111111111111",
      type: "LESSON",
      projectId: null,
      statement: "test",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "INFERRED",
      observationMode: "INFERRED",
      source: "test",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "test",
      scope: "GLOBAL",
      priority: "MEDIUM",
      // verifiedBy/verifiedAt intentionally omitted
    });
    expect(parsed.verifiedBy).toBeUndefined();
    expect(parsed.verifiedAt).toBeUndefined();
  });

  it("accepts verifiedBy/verifiedAt when set (provenance trail, Gap 2)", () => {
    const now = new Date().toISOString();
    const parsed = memorySchema.parse({
      id: crypto.randomUUID(),
      ownerId: "11111111-1111-4111-8111-111111111111",
      type: "LESSON",
      projectId: null,
      statement: "test",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "CONFIRMED",
      observationMode: "CONFIRMED",
      source: "test",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "test",
      scope: "GLOBAL",
      priority: "MEDIUM",
      verifiedBy: "11111111-1111-4111-8111-111111111111",
      verifiedAt: now,
    });
    expect(parsed.verifiedBy).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.verifiedAt).toBe(now);
  });
});
