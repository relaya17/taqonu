import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-observation-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const SECRET = "hotelos-connector-test-secret-32b!!";
const TENANT = "tenant-a";
const PROJECT = "project-a";

const { evaluateApplicationPreflight, resetApplicationPreflightForTests } =
  await import("./application-preflight.js");
const { evaluateApplicationExecutionReport } = await import(
  "./application-execution-report.js"
);
const { listUnifiedAuditEntries, setAuditLogPathForTests } = await import(
  "./audit-log.js"
);

function sign(rawBody: string): Record<string, string> {
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", SECRET)
    .update(applicationConnectorSigningString(timestamp, nonce, rawBody), "utf8")
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-atlas-connector-timestamp": timestamp,
    "x-atlas-connector-nonce": nonce,
    "x-atlas-connector-signature": signature,
  };
}

function preflightBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
    applicationId: "hotelos",
    tenantId: TENANT,
    projectId: PROJECT,
    actorId: "hotel-user-1",
    actorKind: "USER",
    agentId: "agent.cio",
    operation: "hotelos.gateway.agent.cio",
    operationClass: "GOVERNED_DECISION",
    requestId: `req-${randomBytes(4).toString("hex")}`,
    idempotencyKey: `idem-${randomBytes(4).toString("hex")}`,
    ...overrides,
  });
}

async function evaluate(body: string) {
  return evaluateApplicationPreflight({ rawBody: body, headers: sign(body) });
}

function latestPreflight() {
  return listUnifiedAuditEntries()
    .filter((entry) => entry.type === "application.preflight.evaluated")
    .at(-1);
}

describe("CTRL-018 preflight Agent observation", () => {
  const originalSecret = process.env.ATLAS_HOTELOS_CONNECTOR_SECRET;
  const originalTenant = process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID;
  const originalProject = process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID;
  const originalExpected = process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS;

  beforeEach(() => {
    process.env.ATLAS_HOTELOS_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID = PROJECT;
    delete process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS;
    delete process.env.ATLAS_KILL_SWITCHES;
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    setAuditLogPathForTests(
      join(tmpDir, `audit-${randomBytes(8).toString("hex")}.ndjson`),
    );
    resetApplicationPreflightForTests();
  });

  afterEach(() => {
    resetApplicationPreflightForTests();
    setAuditLogPathForTests(null);
    if (originalSecret === undefined) delete process.env.ATLAS_HOTELOS_CONNECTOR_SECRET;
    else process.env.ATLAS_HOTELOS_CONNECTOR_SECRET = originalSecret;
    if (originalTenant === undefined) delete process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID;
    else process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID = originalTenant;
    if (originalProject === undefined) delete process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID;
    else process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID = originalProject;
    if (originalExpected === undefined) delete process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS;
    else process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS = originalExpected;
  });

  it("Case 1 — null agentId is UNKNOWN and ALLOW is unchanged", async () => {
    process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS = "agent.cio";
    const result = await evaluate(preflightBody({ agentId: null }));
    expect(result.body).toMatchObject({ decision: "ALLOW", agentId: null });
    expect(latestPreflight()?.input["agentObservation"]).toBe("UNKNOWN");
  });

  it("Case 2 — no Expected declaration and observed ID is UNKNOWN", async () => {
    const result = await evaluate(preflightBody({ agentId: "agent.cio" }));
    expect(result.body).toMatchObject({ decision: "ALLOW", agentId: "agent.cio" });
    expect(latestPreflight()?.input["expectedAgentIds"]).toBeNull();
    expect(latestPreflight()?.input["agentObservation"]).toBe("UNKNOWN");
  });

  it("Case 3 — Expected [agent.cio] and observed agent.cio is EXPECTED", async () => {
    process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS = "agent.cio";
    const result = await evaluate(preflightBody({ agentId: "agent.cio" }));
    expect(result.body).toMatchObject({ decision: "ALLOW", agentId: "agent.cio" });
    expect(latestPreflight()?.input["agentObservation"]).toBe("EXPECTED");
    expect(latestPreflight()?.output["agentObservation"]).toBe("EXPECTED");
  });

  it("Case 4 — Expected [agent.cio] and observed agent.other is UNEXPECTED without changing ALLOW", async () => {
    process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS = "agent.cio";
    const result = await evaluate(preflightBody({ agentId: "agent.other" }));
    expect(result.body).toMatchObject({
      decision: "ALLOW",
      agentId: "agent.other",
    });
    expect(latestPreflight()?.input["agentObservation"]).toBe("UNEXPECTED");
    expect(latestPreflight()?.output["decision"]).toBe("ALLOW");
  });

  it("Case 5 — multiple Expected IDs: one member is EXPECTED", async () => {
    process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS = "agent.cio,agent.kashrut";
    const result = await evaluate(preflightBody({ agentId: "agent.kashrut" }));
    expect(result.body).toMatchObject({ decision: "ALLOW" });
    expect(latestPreflight()?.input["agentObservation"]).toBe("EXPECTED");
    expect(latestPreflight()?.input["expectedAgentIds"]).toEqual([
      "agent.cio",
      "agent.kashrut",
    ]);
  });

  it("Case 6 — explicit empty Expected set is UNKNOWN not UNEXPECTED", async () => {
    process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS = "";
    const result = await evaluate(preflightBody({ agentId: "agent.cio" }));
    expect(result.body).toMatchObject({ decision: "ALLOW" });
    expect(latestPreflight()?.input["expectedAgentIds"]).toEqual([]);
    expect(latestPreflight()?.input["agentObservation"]).toBe("UNKNOWN");
  });

  it("Case 7 — reserved Fabric identity stays impersonation, not UNEXPECTED", async () => {
    process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS = "agent.cio";
    const result = await evaluate(
      preflightBody({ actorKind: "AGENT", agentId: "ORCHESTRATOR" }),
    );
    expect(result.body).toMatchObject({ decision: "OUT_OF_SCOPE" });
    expect(latestPreflight()?.input["agentObservation"]).toBeNull();
    expect(latestPreflight()?.input["agentObservation"]).not.toBe("UNEXPECTED");
  });

  it("Case 8 — CTRL-017 report agentId mismatch remains 409, not an Expected classification", async () => {
    process.env.ATLAS_HOTELOS_EXPECTED_AGENT_IDS = "agent.cio";
    const requestId = "req-ctrl018-mismatch";
    const allowed = await evaluate(
      preflightBody({
        agentId: "agent.cio",
        requestId,
        idempotencyKey: `idem-${requestId}`,
      }),
    );
    expect(allowed.body).toMatchObject({ decision: "ALLOW" });
    const raw = JSON.stringify({
      schemaVersion: "atlas.application-execution-report.v1",
      applicationId: "hotelos",
      tenantId: TENANT,
      projectId: PROJECT,
      decisionId: (allowed.body as { decisionId: string }).decisionId,
      requestId,
      operation: "hotelos.gateway.agent.cio",
      executionId: "chatcmpl-ctrl018-mismatch",
      executionStatus: "SUCCESS",
      agentId: "agent.other",
    });
    const reported = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(raw),
    });
    expect(reported.status).toBe(409);
    expect(reported.body).toMatchObject({ accepted: false });
    const unexpectedReports = listUnifiedAuditEntries().filter(
      (entry) =>
        entry.type === "application.execution.reported" &&
        entry.input["agentObservation"] === "UNEXPECTED",
    );
    expect(unexpectedReports).toHaveLength(0);
  });
});
