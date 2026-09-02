import { describe, expect, it } from "vitest";
import {
  CIVIO_APPLICATION_ID,
  civioEventEnvelopeSchema,
  civioProcessStateFromEvent,
  civioProcessTypeFromEvent,
} from "./civio-connector.js";

describe("Civio connector contract", () => {
  it("never uses def-000 as the Civio application identity", () => {
    expect(CIVIO_APPLICATION_ID).toBe("civio");
    expect(CIVIO_APPLICATION_ID).not.toBe("def-000");
  });

  it("accepts a complete Civio event envelope", () => {
    const parsed = civioEventEnvelopeSchema.parse({
      eventId: "evt-1",
      eventType: "civio.rights.answered",
      occurredAt: "2026-09-02T11:00:00.000Z",
      applicationId: "civio",
      connectorId: "atlas-civio-connector",
      tenantId: "tenant-a",
      projectId: "project-a",
      actor: { id: "civio-runtime", kind: "SYSTEM" },
      source: { runtime: "civio" },
      payload: { questionId: "housing-1" },
      schemaVersion: "1.0.0",
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
    });
    expect(parsed.applicationId).toBe("civio");
    expect(parsed.processId).toBeUndefined();
  });

  it("rejects a generic flattened event type", () => {
    const result = civioEventEnvelopeSchema.safeParse({
      eventId: "evt-1",
      eventType: "Civio event",
      occurredAt: "2026-09-02T11:00:00.000Z",
      applicationId: "civio",
      connectorId: "atlas-civio-connector",
      tenantId: "tenant-a",
      projectId: "project-a",
      actor: { id: "civio-runtime", kind: "SYSTEM" },
      source: { runtime: "civio" },
      payload: {},
      schemaVersion: "1.0.0",
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
    });
    expect(result.success).toBe(false);
  });

  it("maps process type without inventing a process id", () => {
    expect(
      civioProcessTypeFromEvent("civio.rights.answered", {}),
    ).toBe("civio.rights");
    expect(civioProcessStateFromEvent("civio.process.started")).toBe("STARTED");
  });
});
