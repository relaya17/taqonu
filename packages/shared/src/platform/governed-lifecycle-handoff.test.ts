import { describe, expect, it } from "vitest";
import {
  governedLifecycleHandoffSchema,
  identitiesMatch,
} from "./governed-lifecycle-handoff.js";

const identity = {
  tenantId: "tenant-alpha",
  projectId: "project-alpha",
  applicationId: "civio",
  processId: "proc-1",
  eventId: "evt-1",
};

describe("governed lifecycle handoff contract", () => {
  it("accepts a decision-only handoff", () => {
    const parsed = governedLifecycleHandoffSchema.parse({
      schemaVersion: "atlas.governed-lifecycle-handoff/v1",
      identity,
      decision: {
        ...identity,
        decision: "ALLOW",
        reason: "DOCUMENT.READ observe",
        eventType: "civio.rights.answered",
        correlationId: "corr-1",
        requestId: "req-1",
        policy: { entityType: "DOCUMENT", action: "READ", riskTier: "AUTO_LOG" },
      },
    });
    expect(parsed.execution).toBeUndefined();
  });

  it("detects identity mismatches", () => {
    expect(identitiesMatch(identity, { ...identity, tenantId: "other" })).toMatch(
      /tenant/,
    );
    expect(identitiesMatch(identity, identity)).toBeNull();
  });
});
