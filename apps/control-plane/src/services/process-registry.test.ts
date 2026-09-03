import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canTransitionSupervisedProcess,
  mapCivioEventToSupervisedState,
} from "@atlas/shared";
import {
  resetApplicationRegistryForTests,
  upsertRegisteredApplication,
} from "./application-registry.js";
import {
  getSupervisedProcess,
  observeConnectorProcessEvent,
  registerSupervisedProcess,
  resetProcessRegistryForTests,
} from "./process-registry.js";

const TENANT = "tenant-alpha";
const PROJECT = "project-alpha";
const APP = "app-other";

function baseRegister(
  overrides: Partial<Parameters<typeof registerSupervisedProcess>[0]> = {},
) {
  return registerSupervisedProcess({
    processId: "proc-1",
    applicationId: APP,
    tenantId: TENANT,
    projectId: PROJECT,
    processType: "order",
    connectorId: "test-connector",
    occurredAt: "2026-09-03T10:00:00.000Z",
    eventId: "evt-register",
    eventType: "process.registered",
    correlationId: "corr-register",
    requestId: "req-register",
    agentId: null,
    workerId: "worker-1",
    governance: {
      decision: "ALLOW",
      reason: "registered",
      evaluatedAt: "2026-09-03T10:00:00.000Z",
    },
    ...overrides,
  });
}

describe("Control process registry", () => {
  beforeEach(() => {
    resetProcessRegistryForTests();
    resetApplicationRegistryForTests();
    upsertRegisteredApplication({
      applicationId: APP,
      name: "Other App",
      tenantId: TENANT,
      projectId: PROJECT,
    });
  });

  afterEach(() => {
    resetProcessRegistryForTests();
    resetApplicationRegistryForTests();
  });

  it("registers an application-scoped process as CREATED", () => {
    const result = baseRegister();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected register ok");
    expect(result.process.state).toBe("CREATED");
    expect(result.process.applicationId).toBe(APP);
    expect(result.process.requestId).toBe("req-register");
    expect(result.process.correlationId).toBe("corr-register");
    expect(result.process.workerId).toBe("worker-1");
  });

  it("attaches a later event to the registered process and records governance", () => {
    expect(baseRegister().ok).toBe(true);
    const attached = observeConnectorProcessEvent({
      processId: "proc-1",
      applicationId: APP,
      tenantId: TENANT,
      projectId: PROJECT,
      processType: "order",
      connectorId: "test-connector",
      occurredAt: "2026-09-03T10:01:00.000Z",
      eventId: "evt-run",
      eventType: "step.completed",
      correlationId: "corr-run",
      requestId: "req-run",
      agentId: "agent-9",
      workerId: null,
      proposedState: "RUNNING",
      registration: false,
      governance: {
        decision: "ALLOW",
        reason: "observe",
        evaluatedAt: "2026-09-03T10:01:00.000Z",
      },
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok || !attached.process) throw new Error("expected attach");
    expect(attached.process.state).toBe("RUNNING");
    expect(attached.process.lastEventId).toBe("evt-run");
    expect(attached.process.requestId).toBe("req-run");
    expect(attached.process.agentId).toBe("agent-9");
    expect(attached.process.governance?.decision).toBe("ALLOW");
    expect(attached.process.events.map((item) => item.eventId)).toEqual([
      "evt-register",
      "evt-run",
    ]);
  });

  it("rejects an unknown process on attach", () => {
    const result = observeConnectorProcessEvent({
      processId: "missing",
      applicationId: APP,
      tenantId: TENANT,
      projectId: PROJECT,
      processType: "order",
      connectorId: "test-connector",
      occurredAt: "2026-09-03T10:00:00.000Z",
      eventId: "evt-missing",
      eventType: "step.completed",
      correlationId: "corr-missing",
      requestId: "req-missing",
      agentId: null,
      workerId: null,
      proposedState: "RUNNING",
      registration: false,
      governance: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected reject");
    expect(result.status).toBe(404);
  });

  it("does not let application B mutate application A's process", () => {
    expect(baseRegister().ok).toBe(true);
    upsertRegisteredApplication({
      applicationId: "civio",
      name: "Civio",
      tenantId: TENANT,
      projectId: PROJECT,
    });
    const spoofed = observeConnectorProcessEvent({
      processId: "proc-1",
      applicationId: "civio",
      tenantId: TENANT,
      projectId: PROJECT,
      processType: "civio.process",
      connectorId: "atlas-civio-connector",
      occurredAt: "2026-09-03T10:02:00.000Z",
      eventId: "evt-spoof",
      eventType: "civio.rights.answered",
      correlationId: "corr-spoof",
      requestId: "req-spoof",
      agentId: null,
      workerId: "civio-runtime",
      proposedState: mapCivioEventToSupervisedState("civio.rights.answered"),
      registration: false,
      governance: null,
    });
    expect(spoofed.ok).toBe(false);
    if (spoofed.ok) throw new Error("expected reject");
    expect(spoofed.status).toBe(404);
    const original = getSupervisedProcess({
      tenantId: TENANT,
      projectId: PROJECT,
      applicationId: APP,
      processId: "proc-1",
    });
    expect(original?.state).toBe("CREATED");
    expect(original?.lastEventId).toBe("evt-register");
  });

  it("rejects a tenant mismatch against the registered application", () => {
    const result = baseRegister({ tenantId: "tenant-beta" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected reject");
    expect(result.status).toBe(409);
  });

  it("applies lifecycle updates deterministically and rejects regression", () => {
    expect(baseRegister().ok).toBe(true);
    const running = observeConnectorProcessEvent({
      processId: "proc-1",
      applicationId: APP,
      tenantId: TENANT,
      projectId: PROJECT,
      processType: "order",
      connectorId: "test-connector",
      occurredAt: "2026-09-03T10:01:00.000Z",
      eventId: "evt-run",
      eventType: "step.completed",
      correlationId: "corr-run",
      requestId: "req-run",
      agentId: null,
      workerId: null,
      proposedState: "RUNNING",
      registration: false,
      governance: null,
    });
    expect(running.ok).toBe(true);
    const completed = observeConnectorProcessEvent({
      processId: "proc-1",
      applicationId: APP,
      tenantId: TENANT,
      projectId: PROJECT,
      processType: "order",
      connectorId: "test-connector",
      occurredAt: "2026-09-03T10:02:00.000Z",
      eventId: "evt-done",
      eventType: "process.completed",
      correlationId: "corr-done",
      requestId: "req-done",
      agentId: null,
      workerId: null,
      proposedState: "COMPLETED",
      registration: false,
      governance: null,
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok || !completed.process) throw new Error("expected complete");
    expect(completed.process.state).toBe("COMPLETED");
    expect(canTransitionSupervisedProcess("COMPLETED", "RUNNING")).toBe(false);
    const regress = observeConnectorProcessEvent({
      processId: "proc-1",
      applicationId: APP,
      tenantId: TENANT,
      projectId: PROJECT,
      processType: "order",
      connectorId: "test-connector",
      occurredAt: "2026-09-03T10:03:00.000Z",
      eventId: "evt-regress",
      eventType: "step.completed",
      correlationId: "corr-regress",
      requestId: "req-regress",
      agentId: null,
      workerId: null,
      proposedState: "RUNNING",
      registration: false,
      governance: null,
    });
    expect(regress.ok).toBe(false);
    if (regress.ok) throw new Error("expected reject");
    expect(regress.status).toBe(409);
    expect(
      getSupervisedProcess({
        tenantId: TENANT,
        projectId: PROJECT,
        applicationId: APP,
        processId: "proc-1",
      })?.state,
    ).toBe("COMPLETED");
  });

  it("is a no-op when processId is omitted", () => {
    const result = observeConnectorProcessEvent({
      processId: undefined,
      applicationId: APP,
      tenantId: TENANT,
      projectId: PROJECT,
      processType: "order",
      connectorId: "test-connector",
      occurredAt: "2026-09-03T10:00:00.000Z",
      eventId: "evt-app",
      eventType: "health",
      correlationId: "corr-app",
      requestId: "req-app",
      agentId: null,
      workerId: null,
      proposedState: "RUNNING",
      registration: false,
      governance: null,
    });
    expect(result).toEqual({ ok: true, process: null });
  });
});
