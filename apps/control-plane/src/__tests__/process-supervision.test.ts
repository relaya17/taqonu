import { createServer, type AddressInfo } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitCivioEventToControl } from "@atlas/integrations-civio";
import {
  CIVIO_APPLICATION_ID,
  CIVIO_CONNECTOR_ID,
  type CivioEventEnvelope,
  type SupervisedProcess,
} from "@atlas/shared";
import { createRequestHandler } from "../http.js";
import { resetApplicationRegistryForTests } from "../services/application-registry.js";
import { resetCivioConnectorForTests } from "../services/civio-connector.js";
import { resetGovernanceStateForTests } from "../services/governance-state.js";

const SECRET = "civio-connector-test-secret-32b!!";
const TENANT = "tenant-alpha";
const PROJECT = "project-alpha";
const CP_TOKEN = "control-plane-operator-token";

function event(overrides: Partial<CivioEventEnvelope> = {}): CivioEventEnvelope {
  return {
    eventId: "evt-proc-1",
    eventType: "civio.process.started",
    occurredAt: "2026-09-03T12:00:00.000Z",
    applicationId: CIVIO_APPLICATION_ID,
    connectorId: CIVIO_CONNECTOR_ID,
    tenantId: TENANT,
    projectId: PROJECT,
    actor: { id: "civio-runtime", kind: "SYSTEM" },
    source: { runtime: "civio" },
    payload: {},
    schemaVersion: "1.0.0",
    correlationId: "corr-proc-1",
    idempotencyKey: "idem-proc-1",
    ...overrides,
  };
}

async function startControl(): Promise<{
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}> {
  const server = createServer(createRequestHandler());
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function listProcesses(baseUrl: string): Promise<readonly SupervisedProcess[]> {
  const response = await fetch(`${baseUrl}/api/v1/processes`, {
    headers: { authorization: `Bearer ${CP_TOKEN}` },
  });
  const body = (await response.json()) as { items: SupervisedProcess[] };
  return body.items;
}

describe("Application → Process supervision", () => {
  let control: { readonly baseUrl: string; readonly close: () => Promise<void> };

  beforeEach(async () => {
    process.env["ATLAS_CIVIO_CONNECTOR_SECRET"] = SECRET;
    process.env["ATLAS_CIVIO_TENANT_ID"] = TENANT;
    process.env["ATLAS_CIVIO_PROJECT_ID"] = PROJECT;
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = CP_TOKEN;
    resetCivioConnectorForTests();
    resetApplicationRegistryForTests();
    resetGovernanceStateForTests();
    control = await startControl();
  });

  afterEach(async () => {
    await control.close();
    delete process.env["ATLAS_CIVIO_CONNECTOR_SECRET"];
    delete process.env["ATLAS_CIVIO_TENANT_ID"];
    delete process.env["ATLAS_CIVIO_PROJECT_ID"];
    delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    resetCivioConnectorForTests();
    resetApplicationRegistryForTests();
    resetGovernanceStateForTests();
  });

  it("1. registers a process from an authenticated civio.process.started event", async () => {
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ processId: "proc-live-1" }),
    });
    expect(result.status).toBe(202);
    expect(result.body.accepted).toBe(true);
    expect(result.body.process).toEqual({ processId: "proc-live-1" });
    const items = await listProcesses(control.baseUrl);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      processId: "proc-live-1",
      applicationId: CIVIO_APPLICATION_ID,
      tenantId: TENANT,
      projectId: PROJECT,
      state: "CREATED",
      connectorId: CIVIO_CONNECTOR_ID,
      workerId: "civio-runtime",
    });
  });

  it("2. attaches a later event to the same process", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ processId: "proc-live-1" }),
    });
    const attached = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.rights.answered",
        processId: "proc-live-1",
        eventId: "evt-attach",
        idempotencyKey: "idem-attach",
        correlationId: "corr-attach",
        payload: { requestId: "http-req-attach", questionId: "housing-1" },
      }),
    });
    expect(attached.status).toBe(202);
    expect(attached.body.process).toEqual({ processId: "proc-live-1" });
    const items = await listProcesses(control.baseUrl);
    expect(items[0]?.state).toBe("RUNNING");
    expect(items[0]?.lastEventId).toBe("evt-attach");
    expect(items[0]?.requestId).toBe("http-req-attach");
    expect(items[0]?.correlationId).toBe("corr-attach");
  });

  it("3. rejects an unknown processId on a non-registration event", async () => {
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.rights.answered",
        processId: "never-registered",
        eventId: "evt-unknown",
        idempotencyKey: "idem-unknown",
      }),
    });
    expect(result.status).toBe(404);
    expect(result.body.accepted).toBe(false);
    expect(result.body.reason).toMatch(/Unknown process/);
    expect(await listProcesses(control.baseUrl)).toEqual([]);
  });

  it("4. does not let a Civio event mutate another application's process", async () => {
    const { upsertRegisteredApplication } = await import(
      "../services/application-registry.js"
    );
    const { registerSupervisedProcess } = await import("../services/process-registry.js");
    upsertRegisteredApplication({
      applicationId: "app-other",
      name: "Other",
      tenantId: TENANT,
      projectId: PROJECT,
    });
    const registered = registerSupervisedProcess({
      processId: "shared-id",
      applicationId: "app-other",
      tenantId: TENANT,
      projectId: PROJECT,
      processType: "other.process",
      connectorId: null,
      occurredAt: "2026-09-03T11:00:00.000Z",
      eventId: "evt-other-reg",
      eventType: "process.registered",
      correlationId: "corr-other",
      requestId: "req-other",
      agentId: "other-agent",
      workerId: null,
      governance: null,
    });
    expect(registered.ok).toBe(true);

    const spoof = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.rights.answered",
        processId: "shared-id",
        eventId: "evt-spoof",
        idempotencyKey: "idem-spoof",
      }),
    });
    expect(spoof.status).toBe(404);
    const items = await listProcesses(control.baseUrl);
    const other = items.find((item) => item.applicationId === "app-other");
    expect(other?.state).toBe("CREATED");
    expect(other?.lastEventId).toBe("evt-other-reg");
    expect(other?.agentId).toBe("other-agent");
    expect(items.some((item) => item.applicationId === CIVIO_APPLICATION_ID)).toBe(
      false,
    );
  });

  it("5. rejects a cross-tenant process claim at the connector", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ processId: "proc-live-1" }),
    });
    const otherTenant = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        processId: "proc-live-1",
        eventId: "evt-other-tenant",
        idempotencyKey: "idem-other-tenant",
        tenantId: "tenant-beta",
      }),
    });
    expect(otherTenant.status).toBe(403);
    const items = await listProcesses(control.baseUrl);
    expect(items).toHaveLength(1);
    expect(items[0]?.tenantId).toBe(TENANT);
    expect(items[0]?.state).toBe("CREATED");
  });

  it("6. moves CREATED → RUNNING → COMPLETED and refuses regression", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ processId: "proc-life" }),
    });
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.process.updated",
        processId: "proc-life",
        eventId: "evt-run",
        idempotencyKey: "idem-run",
      }),
    });
    const completed = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.process.completed",
        processId: "proc-life",
        eventId: "evt-done",
        idempotencyKey: "idem-done",
      }),
    });
    expect(completed.status).toBe(202);
    expect((await listProcesses(control.baseUrl))[0]?.state).toBe("COMPLETED");
    const regress = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.process.updated",
        processId: "proc-life",
        eventId: "evt-regress",
        idempotencyKey: "idem-regress",
      }),
    });
    expect(regress.status).toBe(409);
    expect((await listProcesses(control.baseUrl))[0]?.state).toBe("COMPLETED");
  });

  it("7. duplicate process registration events remain idempotent", async () => {
    const first = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ processId: "proc-dup" }),
    });
    const second = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ processId: "proc-dup" }),
    });
    expect(first.body.disposition).toBe("ACCEPTED");
    expect(second.body.disposition).toBe("DUPLICATE");
    expect(await listProcesses(control.baseUrl)).toHaveLength(1);
  });

  it("8. preserves correlation and request IDs on the process", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        processId: "proc-corr",
        correlationId: "corr-root",
        payload: { requestId: "req-root" },
      }),
    });
    const items = await listProcesses(control.baseUrl);
    expect(items[0]?.correlationId).toBe("corr-root");
    expect(items[0]?.requestId).toBe("req-root");
  });

  it("9. preserves application, connector, worker, and governance provenance", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ processId: "proc-prov" }),
    });
    const items = await listProcesses(control.baseUrl);
    expect(items[0]?.applicationId).toBe("civio");
    expect(items[0]?.connectorId).toBe("atlas-civio-connector");
    expect(items[0]?.workerId).toBe("civio-runtime");
    expect(items[0]?.governance?.decision).toBeTruthy();
    expect(items[0]?.events[0]?.eventId).toBe("evt-proc-1");
  });
});
