import { createServer, type AddressInfo } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitCivioEventToControl } from "@atlas/integrations-civio";
import {
  CIVIO_APPLICATION_ID,
  CIVIO_CONNECTOR_ID,
  type CivioEventEnvelope,
} from "@atlas/shared";
import { createRequestHandler } from "../http.js";
import { resetApplicationRegistryForTests } from "../services/application-registry.js";
import { resetCivioConnectorForTests } from "../services/civio-connector.js";
import { resetGovernanceStateForTests } from "../services/governance-state.js";
import type { SupervisedGovernanceDecision } from "../services/supervised-governance.js";

const SECRET = "civio-connector-test-secret-32b!!";
const TENANT = "tenant-alpha";
const PROJECT = "project-alpha";
const CP_TOKEN = "control-plane-operator-token";

function event(overrides: Partial<CivioEventEnvelope> = {}): CivioEventEnvelope {
  return {
    eventId: "evt-gov-1",
    eventType: "civio.process.started",
    occurredAt: "2026-09-03T13:00:00.000Z",
    applicationId: CIVIO_APPLICATION_ID,
    connectorId: CIVIO_CONNECTOR_ID,
    tenantId: TENANT,
    projectId: PROJECT,
    actor: { id: "civio-runtime", kind: "SYSTEM" },
    source: { runtime: "civio" },
    payload: {},
    schemaVersion: "1.0.0",
    correlationId: "corr-gov-1",
    idempotencyKey: "idem-gov-1",
    processId: "proc-gov-1",
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

async function listDecisions(
  baseUrl: string,
  query = "",
): Promise<readonly SupervisedGovernanceDecision[]> {
  const response = await fetch(`${baseUrl}/api/v1/governance/decisions${query}`, {
    headers: { authorization: `Bearer ${CP_TOKEN}` },
  });
  const body = (await response.json()) as { items: SupervisedGovernanceDecision[] };
  return body.items;
}

describe("Event → Governance → Decision", () => {
  let control: { readonly baseUrl: string; readonly close: () => Promise<void> };

  beforeEach(async () => {
    process.env["ATLAS_CIVIO_CONNECTOR_SECRET"] = SECRET;
    process.env["ATLAS_CIVIO_TENANT_ID"] = TENANT;
    process.env["ATLAS_CIVIO_PROJECT_ID"] = PROJECT;
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = CP_TOKEN;
    delete process.env["ATLAS_API_URL"];
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

  it("1–2. evaluates a valid authenticated event with process context", async () => {
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    expect(result.status).toBe(202);
    expect(result.body.evaluation?.decision).toBe("ALLOW");
    expect(result.body.evaluation?.executed).toBe(false);
    expect(result.body.evaluation?.applicationId).toBe("civio");
    expect(result.body.evaluation?.processId).toBe("proc-gov-1");
    expect(result.body.evaluation?.eventId).toBe("evt-gov-1");
    expect(result.body.execution).toBe("NOT_IMPLEMENTED");
  });

  it("3–5. selects DOCUMENT.READ / AUTO_LOG and ALLOW for observe events", async () => {
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    expect(result.body.evaluation?.policy).toEqual({
      entityType: "DOCUMENT",
      action: "READ",
      riskTier: "AUTO_LOG",
    });
    expect(result.body.evaluation?.risk?.tier).toBe("AUTO_LOG");
    expect(result.body.evaluation?.decision).toBe("ALLOW");
  });

  it("7. produces REQUIRE_APPROVAL for civio.legal.ai.completed without executing", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({
        eventType: "civio.legal.ai.completed",
        eventId: "evt-ai-done",
        idempotencyKey: "idem-ai-done",
        processId: "proc-gov-1",
      }),
    });
    expect(result.status).toBe(202);
    expect(result.body.evaluation?.decision).toBe("REQUIRE_APPROVAL");
    expect(result.body.evaluation?.executed).toBe(false);
    expect(result.body.evaluation?.policy).toEqual({
      entityType: "CODE",
      action: "EXECUTE",
      riskTier: "APPROVAL",
    });
    expect(result.body.execution).toBe("NOT_IMPLEMENTED");
  });

  it("8. stores the decision against the canonical application/process/event", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    const items = await listDecisions(
      control.baseUrl,
      "?applicationId=civio&eventId=evt-gov-1",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      applicationId: "civio",
      tenantId: TENANT,
      projectId: PROJECT,
      processId: "proc-gov-1",
      eventId: "evt-gov-1",
      decision: "ALLOW",
      correlationId: "corr-gov-1",
    });
  });

  it("9. cannot associate a Civio decision with another application", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    const foreign = await listDecisions(
      control.baseUrl,
      "?applicationId=def-000&eventId=evt-gov-1",
    );
    expect(foreign).toEqual([]);
    const own = await listDecisions(control.baseUrl, "?applicationId=civio&eventId=evt-gov-1");
    expect(own[0]?.applicationId).toBe("civio");
  });

  it("10. rejects a cross-tenant event before a decision is stored", async () => {
    const result = await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event({ tenantId: "tenant-beta", eventId: "evt-other-tenant", idempotencyKey: "idem-other-tenant" }),
    });
    expect(result.status).toBe(403);
    const items = await listDecisions(control.baseUrl, "?eventId=evt-other-tenant");
    expect(items).toEqual([]);
  });

  it("11. duplicate delivery retains the original decision", async () => {
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
    expect(first.body.evaluation?.decision).toBe("ALLOW");
    expect(second.body.disposition).toBe("DUPLICATE");
    expect(second.body.evaluation?.decision).toBe(first.body.evaluation?.decision);
    expect(second.body.evaluation?.reason).toBe(first.body.evaluation?.reason);
    expect(await listDecisions(control.baseUrl, "?eventId=evt-gov-1")).toHaveLength(1);
  });

  it("12–13. preserves the explanation and writes governance audit evidence", async () => {
    await emitCivioEventToControl({
      controlBaseUrl: control.baseUrl,
      secret: SECRET,
      event: event(),
    });
    const items = await listDecisions(control.baseUrl, "?eventId=evt-gov-1");
    expect(items[0]?.reason.length).toBeGreaterThan(0);
    const audit = await fetch(`${control.baseUrl}/api/v1/audit?type=governance.decision`, {
      headers: { authorization: `Bearer ${CP_TOKEN}` },
    });
    const entries = (await audit.json()) as Array<{ type: string; reason: string; policy: string }>;
    expect(entries.some((entry) => entry.type === "governance.decision")).toBe(true);
    expect(entries[0]?.reason).toContain("application=civio");
    expect(entries[0]?.reason).toContain("process=proc-gov-1");
    expect(entries[0]?.policy).toBe("DOCUMENT.READ");
  });
});
