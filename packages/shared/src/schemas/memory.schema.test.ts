import { describe, expect, it } from "vitest";
import { createMemorySchema } from "./memory.schema.js";

describe("createMemorySchema", () => {
  it("accepts a typed decision memory with provenance fields", () => {
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
    expect(parsed.epistemicState).toBe("CONFIRMED");
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
});
