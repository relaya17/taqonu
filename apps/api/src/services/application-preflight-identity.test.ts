import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-preflight-identity-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const SECRET = "hotelos-connector-test-secret-32b!!";
const TENANT = "tenant-a";
const PROJECT = "project-a";

const { evaluateApplicationPreflight, resetApplicationPreflightForTests } =
  await import("./application-preflight.js");
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

describe("application preflight agent identity audit", () => {
  const originalSecret = process.env.ATLAS_HOTELOS_CONNECTOR_SECRET;
  const originalTenant = process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID;
  const originalProject = process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID;

  beforeEach(() => {
    process.env.ATLAS_HOTELOS_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID = PROJECT;
    delete process.env.ATLAS_KILL_SWITCHES;
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    setAuditLogPathForTests(join(tmpDir, `audit-${randomBytes(8).toString("hex")}.ndjson`));
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
  });

  it("writes applicationId + agentId + actorId + operation + decision + executed without parsing the operation", async () => {
    const rawBody = JSON.stringify({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "hotelos",
      tenantId: TENANT,
      projectId: PROJECT,
      actorId: "hotel-user-1",
      actorKind: "USER",
      agentId: "agent.cio",
      operation: "hotelos.gateway.agent.cio",
      operationClass: "GOVERNED_DECISION",
      requestId: "req-cio-audit",
      idempotencyKey: "idem-cio-audit",
    });
    const result = await evaluateApplicationPreflight({
      rawBody,
      headers: sign(rawBody),
    });
    expect(result.status).toBe(200);
    if (!("decision" in result.body)) throw new Error("expected preflight response");
    expect(result.body).toMatchObject({
      decision: "ALLOW",
      executed: false,
      applicationId: "hotelos",
      agentId: "agent.cio",
    });

    const entries = listUnifiedAuditEntries().filter(
      (entry) => entry.type === "application.preflight.evaluated",
    );
    expect(entries.length).toBeGreaterThan(0);
    const latest = entries[entries.length - 1];
    expect(latest?.agentId).toBe("agent.cio");
    expect(latest?.actorId).toBe("hotelos:hotel-user-1");
    expect(latest?.input).toMatchObject({
      applicationId: "hotelos",
      agentId: "agent.cio",
      actorId: "hotel-user-1",
      operation: "hotelos.gateway.agent.cio",
    });
    expect(latest?.output).toMatchObject({
      decision: "ALLOW",
      executed: false,
    });
    expect(String(latest?.input["operation"])).toBe("hotelos.gateway.agent.cio");
  });

  it("records agentId=null for a legacy hop and does not manufacture one", async () => {
    const rawBody = JSON.stringify({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "hotelos",
      tenantId: TENANT,
      projectId: PROJECT,
      actorId: "hotelos-runtime",
      actorKind: "USER",
      agentId: null,
      operation: "hotelos.gateway.embed",
      operationClass: "INFORMATIONAL",
      requestId: "req-embed-audit",
      idempotencyKey: "idem-embed-audit",
    });
    const result = await evaluateApplicationPreflight({
      rawBody,
      headers: sign(rawBody),
    });
    expect(result.status).toBe(200);
    if (!("decision" in result.body)) throw new Error("expected preflight response");
    expect(result.body.agentId).toBeNull();

    const latest = listUnifiedAuditEntries()
      .filter((entry) => entry.type === "application.preflight.evaluated")
      .at(-1);
    expect(latest?.agentId).toBeNull();
    expect(latest?.input).toMatchObject({
      applicationId: "hotelos",
      agentId: null,
      actorId: "hotelos-runtime",
      operation: "hotelos.gateway.embed",
    });
    expect(latest?.output).toMatchObject({
      decision: "ALLOW",
      executed: false,
    });
  });

  it("records CaseFlow agentId=null when the runtime hop has no Agent identity", async () => {
    process.env.ATLAS_CASEFLOW_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_CASEFLOW_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID = PROJECT;
    const rawBody = JSON.stringify({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "caseflow",
      tenantId: TENANT,
      projectId: PROJECT,
      actorId: "caseflow-runtime",
      actorKind: "USER",
      agentId: null,
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      requestId: "req-cf-audit",
      idempotencyKey: "idem-cf-audit",
    });
    const result = await evaluateApplicationPreflight({
      rawBody,
      headers: sign(rawBody),
    });
    expect(result.status).toBe(200);
    if (!("decision" in result.body)) throw new Error("expected preflight response");
    expect(result.body.applicationId).toBe("caseflow");
    expect(result.body.agentId).toBeNull();

    const latest = listUnifiedAuditEntries()
      .filter((entry) => entry.type === "application.preflight.evaluated")
      .at(-1);
    expect(latest?.agentId).toBeNull();
    expect(latest?.input).toMatchObject({
      applicationId: "caseflow",
      agentId: null,
      actorId: "caseflow-runtime",
      operation: "caseflow.openai.chat",
    });
    expect(latest?.output).toMatchObject({
      decision: "ALLOW",
      executed: false,
    });
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_SECRET;
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_TENANT_ID;
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID;
  });

  it("CTRL-016: audit records declaredCompletionPath without claiming execution or sufficiency", async () => {
    process.env.ATLAS_CASEFLOW_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_CASEFLOW_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID = PROJECT;
    const rawBody = JSON.stringify({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "caseflow",
      tenantId: TENANT,
      projectId: PROJECT,
      actorId: "caseflow-runtime",
      actorKind: "USER",
      agentId: null,
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      declaredCompletionPath: "LOCAL_COMPLETION_PATH",
      requestId: "req-cf-path-audit",
      idempotencyKey: "idem-cf-path-audit",
    });
    const result = await evaluateApplicationPreflight({
      rawBody,
      headers: sign(rawBody),
    });
    expect(result.status).toBe(200);
    if (!("decision" in result.body)) throw new Error("expected preflight response");
    expect(result.body).toMatchObject({
      decision: "ALLOW",
      executed: false,
      declaredCompletionPath: "LOCAL_COMPLETION_PATH",
    });
    expect(result.body).not.toHaveProperty("knowledgeSufficient");
    expect(result.body).not.toHaveProperty("UNNECESSARY");
    expect(result.body).not.toHaveProperty("executionId");

    const latest = listUnifiedAuditEntries()
      .filter((entry) => entry.type === "application.preflight.evaluated")
      .at(-1);
    expect(latest?.result).toBe("SUCCESS");
    expect(latest?.verificationVerdict).toBe("NOT_APPLICABLE");
    expect(latest?.input).toMatchObject({
      applicationId: "caseflow",
      operation: "caseflow.openai.chat",
      declaredCompletionPath: "LOCAL_COMPLETION_PATH",
    });
    expect(latest?.output).toMatchObject({
      decision: "ALLOW",
      executed: false,
      declaredCompletionPath: "LOCAL_COMPLETION_PATH",
    });
    expect(latest?.input).not.toHaveProperty("knowledgeSufficient");
    expect(latest?.input).not.toHaveProperty("UNNECESSARY");
    expect(latest?.input).not.toHaveProperty("executionId");
    expect(latest?.output).not.toHaveProperty("outcomeStatus");
    expect(latest?.output).not.toHaveProperty("resultStatus");
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_SECRET;
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_TENANT_ID;
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID;
  });
});
