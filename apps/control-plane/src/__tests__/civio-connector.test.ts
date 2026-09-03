import { createServer, type AddressInfo } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitCivioEventToControl,
  signCivioConnectorRequest,
} from "@atlas/integrations-civio";
import {
  CIVIO_APPLICATION_ID,
  CIVIO_CONNECTOR_ID,
  CIVIO_CONNECTOR_INGRESS_PATH,
  type CivioEventEnvelope,
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
    eventId: "evt-civio-1",
    eventType: "civio.rights.answered",
    occurredAt: "2026-09-02T11:00:00.000Z",
    applicationId: CIVIO_APPLICATION_ID,
    connectorId: CIVIO_CONNECTOR_ID,
    tenantId: TENANT,
    projectId: PROJECT,
    actor: { id: "civio-runtime", kind: "SYSTEM" },
    source: { runtime: "civio", path: "packages/logic/src/housing-agent/answerEngine.ts" },
    payload: { questionId: "housing-1" },
    schemaVersion: "1.0.0",
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
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

describe("Civio → Atlas Control connector", () => {
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

  it("1. accepts a valid authenticated Civio event via the production caller", async () => {
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    expect(result.status).toBe(202);
    expect(result.body.accepted).toBe(true);
    expect(result.body.disposition).toBe("ACCEPTED");
    expect(result.body.eventId).toBe("evt-civio-1");
    expect(result.body.execution).toBe("NOT_IMPLEMENTED");
    expect(result.body.process).toBeNull();
  });

  it("2. rejects invalid authentication", async () => {
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: "wrong-secret-that-is-long-enough!!",
      event: event(),
    });
    expect(result.status).toBe(401);
    expect(result.body.accepted).toBe(false);
    expect(result.body.disposition).toBe("REJECTED");
  });

  it("3. rejects the wrong application identity", async () => {
    const raw = JSON.stringify({
      ...event(),
      applicationId: "def-000",
    });
    const signed = signCivioConnectorRequest({ secret: SECRET, rawBody: raw });
    const response = await fetch(`${control.baseUrl}${CIVIO_CONNECTOR_INGRESS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...signed.headers },
      body: raw,
    });
    const body = (await response.json()) as { disposition: string; reason: string };
    expect(response.status).toBe(403);
    expect(body.disposition).toBe("REJECTED");
    expect(body.reason).toMatch(/application identity/i);
  });

  it("4. rejects the wrong tenant and project scope", async () => {
    const otherTenant = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ eventId: "evt-tenant", idempotencyKey: "idem-tenant", tenantId: "tenant-beta" }),
    });
    expect(otherTenant.status).toBe(403);
    expect(otherTenant.body.reason).toMatch(/tenant/i);

    const otherProject = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ eventId: "evt-project", idempotencyKey: "idem-project", projectId: "project-beta" }),
    });
    expect(otherProject.status).toBe(403);
    expect(otherProject.body.reason).toMatch(/project/i);
  });

  it("5. classifies an unsupported event type without ingesting it", async () => {
    const raw = JSON.stringify({
      ...event(),
      eventType: "civio.unknown.exploded",
    });
    const signed = signCivioConnectorRequest({ secret: SECRET, rawBody: raw });
    const response = await fetch(`${control.baseUrl}${CIVIO_CONNECTOR_INGRESS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...signed.headers },
      body: raw,
    });
    const body = (await response.json()) as { disposition: string };
    expect(response.status).toBe(400);
    expect(body.disposition).toBe("UNSUPPORTED_EVENT");
  });

  it("6. handles duplicate event / idempotency safely", async () => {
    const first = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    const second = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    expect(first.status).toBe(202);
    expect(first.body.disposition).toBe("ACCEPTED");
    expect(second.status).toBe(202);
    expect(second.body.disposition).toBe("DUPLICATE");
    expect(second.body.evaluation?.decision).toBe(first.body.evaluation?.decision);
  });

  it("7–9. reaches Control processing, evaluates policy/risk, and preserves audit", async () => {
    const started = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.process.started",
        processId: "civio-proc-1",
        eventId: "evt-start-1",
        idempotencyKey: "idem-start-1",
      }),
    });
    expect(started.status).toBe(202);
    expect(started.body.process).toEqual({ processId: "civio-proc-1" });

    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        processId: "civio-proc-1",
        eventId: "evt-civio-attach",
        idempotencyKey: "idem-attach-1",
      }),
    });
    expect(result.body.accepted).toBe(true);
    expect(result.body.evaluation).toBeDefined();
    expect(result.body.evaluation?.stagesPassed).toEqual(
      expect.arrayContaining(["IDENTITY", "AUTHORIZATION", "POLICY", "RISK", "DECISION"]),
    );
    expect(result.body.evaluation?.executed).toBe(false);
    expect(result.body.audit?.inMemory).toBe(true);
    expect(result.body.process).toEqual({ processId: "civio-proc-1" });

    const audit = await fetch(`${control.baseUrl}/api/v1/audit?type=civio.connector`, {
      headers: { authorization: `Bearer ${CP_TOKEN}` },
    });
    const entries = (await audit.json()) as Array<{
      type: string;
      ownerId: string;
      projectId: string;
      actorId: string;
      policy: string;
    }>;
    expect(audit.status).toBe(200);
    expect(entries.some((entry) => entry.type === "civio.connector.event.accepted")).toBe(true);
    expect(entries[0]?.ownerId).toBe(TENANT);
    expect(entries[0]?.projectId).toBe(PROJECT);
    expect(entries[0]?.actorId).toBe("civio-runtime");
    expect(entries[0]?.policy).toBe("civio.connector.observe");
  });

  it("10. does not let Civio data cross tenant or project boundaries", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.process.started",
        processId: "proc-alpha",
        eventId: "evt-alpha",
        idempotencyKey: "idem-alpha",
      }),
    });
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventId: "evt-beta",
        idempotencyKey: "idem-beta",
        tenantId: "tenant-beta",
        processId: "proc-beta",
      }),
    });

    const processes = await fetch(`${control.baseUrl}/api/v1/processes`, {
      headers: { authorization: `Bearer ${CP_TOKEN}` },
    });
    const body = (await processes.json()) as {
      items: Array<{ processId: string; tenantId: string }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.processId).toBe("proc-alpha");
    expect(body.items[0]?.tenantId).toBe(TENANT);
    expect(body.items.some((item) => item.processId === "proc-beta")).toBe(false);
  });

  it("does not invent a process when Civio omitted processId", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    const processes = await fetch(`${control.baseUrl}/api/v1/processes`, {
      headers: { authorization: `Bearer ${CP_TOKEN}` },
    });
    const body = (await processes.json()) as { items: unknown[]; live: boolean };
    expect(body.items).toEqual([]);
    expect(body.live).toBe(false);
  });

  it("fails closed when the connector secret is not configured", async () => {
    delete process.env["ATLAS_CIVIO_CONNECTOR_SECRET"];
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ eventId: "evt-unconfigured", idempotencyKey: "idem-unconfigured" }),
    });
    expect(result.status).toBe(503);
    expect(result.body.disposition).toBe("UNCONFIGURED");
  });
});
