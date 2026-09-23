import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPLICATION_EXECUTION_REPORT_SCHEMA,
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-execution-report-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const CIVIO_SECRET = "civio-connector-test-secret-32b!!";
const HOTELOS_SECRET = "hotelos-connector-test-secret-32b!!";
const CASEFLOW_SECRET = "caseflow-connector-test-secret-32b!!";
const TENANT = "tenant-a";
const PROJECT = "project-a";

const { evaluateApplicationPreflight, resetApplicationPreflightForTests } =
  await import("./application-preflight.js");
const {
  evaluateApplicationExecutionReport,
  listAcceptedExecutionReportsForTests,
  resetApplicationExecutionReportForTests,
} = await import("./application-execution-report.js");
const { listUnifiedAuditEntries, setAuditLogPathForTests } = await import(
  "./audit-log.js"
);

function sign(secret: string, rawBody: string): Record<string, string> {
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", secret)
    .update(applicationConnectorSigningString(timestamp, nonce, rawBody), "utf8")
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-atlas-connector-timestamp": timestamp,
    "x-atlas-connector-nonce": nonce,
    "x-atlas-connector-signature": signature,
  };
}

function preflightBody(
  applicationId: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
    applicationId,
    tenantId: TENANT,
    projectId: PROJECT,
    actorId: `${applicationId}-runtime`,
    actorKind: "USER",
    operation: `${applicationId}.openai.chat`,
    operationClass: "GOVERNED_DECISION",
    requestId: `req-${randomBytes(8).toString("hex")}`,
    idempotencyKey: `idem-${randomBytes(8).toString("hex")}`,
    ...overrides,
  });
}

function reportBody(
  applicationId: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
    applicationId,
    tenantId: TENANT,
    projectId: PROJECT,
    decisionId: "missing",
    requestId: "missing",
    operation: `${applicationId}.openai.chat`,
    executionId: "chatcmpl-abc123",
    executionStatus: "SUCCESS",
    ...overrides,
  });
}

async function allowCivio(overrides: Record<string, unknown> = {}) {
  const rawBody = preflightBody("civio", {
    operation: "civio.legal.query",
    ...overrides,
  });
  const result = await evaluateApplicationPreflight({
    rawBody,
    headers: sign(CIVIO_SECRET, rawBody),
  });
  expect(result.status).toBe(200);
  const body = result.body as { decision: string; decisionId: string; requestId: string };
  expect(body.decision).toBe("ALLOW");
  return { rawBody, body };
}

describe("application execution report correlation", () => {
  const originals = {
    civioSecret: process.env.ATLAS_CIVIO_CONNECTOR_SECRET,
    civioTenant: process.env.ATLAS_CIVIO_TENANT_ID,
    civioProject: process.env.ATLAS_CIVIO_PROJECT_ID,
    hotelosSecret: process.env.ATLAS_HOTELOS_CONNECTOR_SECRET,
    hotelosTenant: process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID,
    hotelosProject: process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID,
    caseflowSecret: process.env.ATLAS_CASEFLOW_CONNECTOR_SECRET,
    caseflowTenant: process.env.ATLAS_CASEFLOW_CONNECTOR_TENANT_ID,
    caseflowProject: process.env.ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID,
  };

  beforeEach(() => {
    process.env.ATLAS_CIVIO_CONNECTOR_SECRET = CIVIO_SECRET;
    process.env.ATLAS_CIVIO_TENANT_ID = TENANT;
    process.env.ATLAS_CIVIO_PROJECT_ID = PROJECT;
    process.env.ATLAS_HOTELOS_CONNECTOR_SECRET = HOTELOS_SECRET;
    process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID = PROJECT;
    process.env.ATLAS_CASEFLOW_CONNECTOR_SECRET = CASEFLOW_SECRET;
    process.env.ATLAS_CASEFLOW_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID = PROJECT;
    delete process.env.ATLAS_KILL_SWITCHES;
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    setAuditLogPathForTests(
      join(tmpDir, `audit-${randomBytes(8).toString("hex")}.ndjson`),
    );
    resetApplicationPreflightForTests();
    resetApplicationExecutionReportForTests();
  });

  afterEach(() => {
    resetApplicationPreflightForTests();
    resetApplicationExecutionReportForTests();
    setAuditLogPathForTests(null);
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("ATLAS_CIVIO_CONNECTOR_SECRET", originals.civioSecret);
    restore("ATLAS_CIVIO_TENANT_ID", originals.civioTenant);
    restore("ATLAS_CIVIO_PROJECT_ID", originals.civioProject);
    restore("ATLAS_HOTELOS_CONNECTOR_SECRET", originals.hotelosSecret);
    restore("ATLAS_HOTELOS_CONNECTOR_TENANT_ID", originals.hotelosTenant);
    restore("ATLAS_HOTELOS_CONNECTOR_PROJECT_ID", originals.hotelosProject);
    restore("ATLAS_CASEFLOW_CONNECTOR_SECRET", originals.caseflowSecret);
    restore("ATLAS_CASEFLOW_CONNECTOR_TENANT_ID", originals.caseflowTenant);
    restore("ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID", originals.caseflowProject);
  });

  it("Test 1 — valid correlation is accepted", async () => {
    const { body } = await allowCivio();
    const raw = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      executionId: "chatcmpl-valid-1",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      accepted: true,
      decisionId: body.decisionId,
      requestId: body.requestId,
      executionId: "chatcmpl-valid-1",
      executionStatus: "SUCCESS",
      applicationId: "civio",
    });
  });

  it("Test 2 — wrong decisionId is rejected", async () => {
    const { body } = await allowCivio();
    const raw = reportBody("civio", {
      decisionId: "dec-does-not-exist",
      requestId: body.requestId,
      operation: "civio.legal.query",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ accepted: false, executionStatus: null });
  });

  it("Test 3 — wrong requestId is rejected", async () => {
    const { body } = await allowCivio();
    const raw = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: "req-not-the-authorization",
      operation: "civio.legal.query",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ accepted: false });
  });

  it("Test 4 — wrong application binding is rejected", async () => {
    const { body } = await allowCivio();
    const raw = reportBody("hotelos", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(HOTELOS_SECRET, raw),
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ accepted: false });
  });

  it("Test 5 — wrong tenant/project is rejected", async () => {
    const { body } = await allowCivio();
    const raw = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      tenantId: "tenant-other",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ accepted: false });
  });

  it("Test 6 — report against DENY is rejected", async () => {
    const firstRaw = preflightBody("civio", {
      operation: "civio.legal.query",
      idempotencyKey: "idem-deny-reuse",
      requestId: "req-deny-1",
    });
    const first = await evaluateApplicationPreflight({
      rawBody: firstRaw,
      headers: sign(CIVIO_SECRET, firstRaw),
    });
    expect((first.body as { decision: string }).decision).toBe("ALLOW");
    const denyRaw = preflightBody("civio", {
      operation: "civio.legal.query",
      idempotencyKey: "idem-deny-reuse",
      requestId: "req-deny-2",
    });
    const denied = await evaluateApplicationPreflight({
      rawBody: denyRaw,
      headers: sign(CIVIO_SECRET, denyRaw),
    });
    const deniedBody = denied.body as {
      decision: string;
      decisionId: string;
      requestId: string;
    };
    expect(deniedBody.decision).toBe("DENY");
    const raw = reportBody("civio", {
      decisionId: deniedBody.decisionId,
      requestId: deniedBody.requestId,
      operation: "civio.legal.query",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ accepted: false });
  });

  it("Test 7 — ALLOW without report is not execution success", async () => {
    const { body } = await allowCivio();
    expect(listAcceptedExecutionReportsForTests()).toEqual([]);
    const audit = listUnifiedAuditEntries().filter(
      (entry) => entry.type === "application.execution.reported",
    );
    expect(audit).toEqual([]);
    const preflightAudit = listUnifiedAuditEntries().filter(
      (entry) => entry.type === "application.preflight.evaluated",
    );
    expect(preflightAudit.at(-1)?.decision).toBe("ALLOW");
    expect(preflightAudit.at(-1)?.output).toMatchObject({ executed: false });
    expect(body.decisionId).toBeTruthy();
  });

  it("Test 8 — conflicting duplicate report is rejected", async () => {
    const { body } = await allowCivio();
    const success = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      executionId: "chatcmpl-dup-1",
      executionStatus: "SUCCESS",
    });
    const first = await evaluateApplicationExecutionReport({
      rawBody: success,
      headers: sign(CIVIO_SECRET, success),
    });
    expect(first.status).toBe(200);
    const failure = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      executionId: "chatcmpl-dup-1",
      executionStatus: "FAILURE",
    });
    const second = await evaluateApplicationExecutionReport({
      rawBody: failure,
      headers: sign(CIVIO_SECRET, failure),
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ accepted: false });
    expect(listAcceptedExecutionReportsForTests()).toHaveLength(1);
    expect(listAcceptedExecutionReportsForTests()[0]?.executionStatus).toBe(
      "SUCCESS",
    );
  });

  it("Test 9 — authenticated replay of the same truthful report is accepted without a second fact", async () => {
    const { body } = await allowCivio();
    const raw = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      executionId: "chatcmpl-replay-1",
    });
    const first = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    const replay = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      accepted: true,
      reason: "Replay of an already accepted execution report",
      executionId: "chatcmpl-replay-1",
    });
    expect(listAcceptedExecutionReportsForTests()).toHaveLength(1);
    const reported = listUnifiedAuditEntries().filter(
      (entry) => entry.type === "application.execution.reported",
    );
    expect(reported).toHaveLength(1);
  });

  it("Test 10 — missing executionId is rejected", async () => {
    const { body } = await allowCivio();
    const raw = JSON.stringify({
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "civio",
      tenantId: TENANT,
      projectId: PROJECT,
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      executionStatus: "SUCCESS",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Execution report request is invalid" });
  });

  it("Test 11 — missing status is rejected", async () => {
    const { body } = await allowCivio();
    const raw = JSON.stringify({
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "civio",
      tenantId: TENANT,
      projectId: PROJECT,
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      executionId: "chatcmpl-no-status",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(400);
  });

  it("Test 12 — invalid HMAC is rejected", async () => {
    const { body } = await allowCivio();
    const raw = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign("definitely-not-the-civio-secret-32b!!", raw),
    });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ accepted: false, executionStatus: null });
    expect(listAcceptedExecutionReportsForTests()).toEqual([]);
  });

  it("Test 13 — valid supplied Agent ID is preserved", async () => {
    const { body } = await allowCivio({ agentId: "agent.cio" });
    const raw = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      agentId: "agent.cio",
      executionId: "chatcmpl-agent-1",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ accepted: true, agentId: "agent.cio" });
    const reported = listUnifiedAuditEntries().filter(
      (entry) => entry.type === "application.execution.reported",
    );
    expect(reported[0]?.agentId).toBe("agent.cio");
  });

  it("Test 14 — absent agent identity remains null", async () => {
    const { body } = await allowCivio();
    const raw = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      agentId: null,
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ accepted: true, agentId: null });
  });

  it("Test 15 — mismatched Agent ID is rejected when preflight identity exists", async () => {
    const { body } = await allowCivio({ agentId: "agent.cio" });
    const raw = reportBody("civio", {
      decisionId: body.decisionId,
      requestId: body.requestId,
      operation: "civio.legal.query",
      agentId: "agent.other",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ accepted: false });
  });

  it("end-to-end CaseFlow hop correlates D ↔ R ↔ E and writes audit", async () => {
    const requestId = "req-caseflow-openai-1";
    const executionId = "chatcmpl-CaseFlowProve1";
    const rawPreflight = preflightBody("caseflow", {
      actorId: "caseflow-runtime",
      operation: "caseflow.openai.chat",
      requestId,
      idempotencyKey: `caseflow.preflight:caseflow.openai.chat:${requestId}`,
    });
    const allowed = await evaluateApplicationPreflight({
      rawBody: rawPreflight,
      headers: sign(CASEFLOW_SECRET, rawPreflight),
    });
    const allowedBody = allowed.body as {
      decision: string;
      decisionId: string;
      requestId: string;
      executed: boolean;
    };
    expect(allowed.status).toBe(200);
    expect(allowedBody.decision).toBe("ALLOW");
    expect(allowedBody.executed).toBe(false);
    expect(allowedBody.requestId).toBe(requestId);

    const rawReport = reportBody("caseflow", {
      decisionId: allowedBody.decisionId,
      requestId,
      operation: "caseflow.openai.chat",
      executionId,
      executionStatus: "SUCCESS",
    });
    const reported = await evaluateApplicationExecutionReport({
      rawBody: rawReport,
      headers: sign(CASEFLOW_SECRET, rawReport),
    });
    expect(reported.status).toBe(200);
    expect(reported.body).toMatchObject({
      accepted: true,
      decisionId: allowedBody.decisionId,
      requestId,
      executionId,
      executionStatus: "SUCCESS",
      applicationId: "caseflow",
    });

    const stored = listAcceptedExecutionReportsForTests();
    expect(stored).toEqual([
      expect.objectContaining({
        decisionId: allowedBody.decisionId,
        requestId,
        executionId,
        applicationId: "caseflow",
        tenantId: TENANT,
        projectId: PROJECT,
        operation: "caseflow.openai.chat",
        executionStatus: "SUCCESS",
      }),
    ]);

    const audit = listUnifiedAuditEntries().filter(
      (entry) => entry.type === "application.execution.reported",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.type).toBe("application.execution.reported");
    expect(audit[0]?.agentId).toBeNull();
    expect(audit[0]?.input).toMatchObject({
      decisionId: allowedBody.decisionId,
      requestId,
      executionId,
      executionStatus: "SUCCESS",
      applicationId: "caseflow",
      operation: "caseflow.openai.chat",
    });
  });

  it("negative: D1 cannot be attributed to E2 from another authorization", async () => {
    const first = await allowCivio();
    const second = await allowCivio();
    const raw = reportBody("civio", {
      decisionId: first.body.decisionId,
      requestId: first.body.requestId,
      operation: "civio.legal.query",
      executionId: "chatcmpl-belongs-to-other",
    });
    const ok = await evaluateApplicationExecutionReport({
      rawBody: raw,
      headers: sign(CIVIO_SECRET, raw),
    });
    expect(ok.status).toBe(200);
    const stolen = reportBody("civio", {
      decisionId: first.body.decisionId,
      requestId: second.body.requestId,
      operation: "civio.legal.query",
      executionId: "chatcmpl-belongs-to-other",
    });
    const rejected = await evaluateApplicationExecutionReport({
      rawBody: stolen,
      headers: sign(CIVIO_SECRET, stolen),
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ accepted: false });
  });

  it("negative: application A cannot report for application B", async () => {
    const requestId = "req-caseflow-only";
    const rawPreflight = preflightBody("caseflow", {
      operation: "caseflow.openai.chat",
      requestId,
    });
    const allowed = await evaluateApplicationPreflight({
      rawBody: rawPreflight,
      headers: sign(CASEFLOW_SECRET, rawPreflight),
    });
    const allowedBody = allowed.body as { decisionId: string };
    const stolen = reportBody("civio", {
      decisionId: allowedBody.decisionId,
      requestId,
      operation: "caseflow.openai.chat",
    });
    const result = await evaluateApplicationExecutionReport({
      rawBody: stolen,
      headers: sign(CIVIO_SECRET, stolen),
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ accepted: false });
  });
});
