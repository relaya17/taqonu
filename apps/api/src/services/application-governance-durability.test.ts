import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPLICATION_EXECUTION_REPORT_SCHEMA,
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-gov-durable-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const SECRET = "civio-connector-test-secret-32b!!";
const TENANT = "tenant-a";
const PROJECT = "project-a";

const { evaluateApplicationPreflight, resetApplicationPreflightForTests } =
  await import("./application-preflight.js");
const { evaluateApplicationExecutionReport, resetApplicationExecutionReportForTests } =
  await import("./application-execution-report.js");
const { installApplicationGovernanceStoreForTests } = await import(
  "./application-governance-test-store.js"
);
const { listUnifiedAuditEntries, setAuditLogPathForTests } = await import("./audit-log.js");
const auditLog = await import("./audit-log.js");

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
    applicationId: "civio",
    tenantId: TENANT,
    projectId: PROJECT,
    actorId: "civio-runtime",
    actorKind: "USER",
    operation: "civio.legal.query",
    operationClass: "GOVERNED_DECISION",
    requestId: `req-${randomBytes(8).toString("hex")}`,
    idempotencyKey: `idem-${randomBytes(8).toString("hex")}`,
    ...overrides,
  });
}

function reportBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
    applicationId: "civio",
    tenantId: TENANT,
    projectId: PROJECT,
    decisionId: "missing",
    requestId: "missing",
    operation: "civio.legal.query",
    executionId: "chatcmpl-durable",
    executionStatus: "SUCCESS",
    ...overrides,
  });
}

describe("application governance durability (service + shared store)", () => {
  const originals = {
    secret: process.env.ATLAS_CIVIO_CONNECTOR_SECRET,
    tenant: process.env.ATLAS_CIVIO_TENANT_ID,
    project: process.env.ATLAS_CIVIO_PROJECT_ID,
    vercel: process.env.VERCEL,
    nodeEnv: process.env.NODE_ENV,
  };

  beforeEach(() => {
    process.env.ATLAS_CIVIO_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_CIVIO_TENANT_ID = TENANT;
    process.env.ATLAS_CIVIO_PROJECT_ID = PROJECT;
    delete process.env.ATLAS_KILL_SWITCHES;
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    setAuditLogPathForTests(join(tmpDir, `audit-${randomBytes(8).toString("hex")}.ndjson`));
    resetApplicationPreflightForTests();
    resetApplicationExecutionReportForTests();
    installApplicationGovernanceStoreForTests();
  });

  afterEach(() => {
    resetApplicationPreflightForTests();
    resetApplicationExecutionReportForTests();
    setAuditLogPathForTests(null);
    if (originals.secret === undefined) delete process.env.ATLAS_CIVIO_CONNECTOR_SECRET;
    else process.env.ATLAS_CIVIO_CONNECTOR_SECRET = originals.secret;
    if (originals.tenant === undefined) delete process.env.ATLAS_CIVIO_TENANT_ID;
    else process.env.ATLAS_CIVIO_TENANT_ID = originals.tenant;
    if (originals.project === undefined) delete process.env.ATLAS_CIVIO_PROJECT_ID;
    else process.env.ATLAS_CIVIO_PROJECT_ID = originals.project;
    if (originals.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originals.vercel;
    process.env.NODE_ENV = originals.nodeEnv;
  });

  async function allow(overrides: Record<string, unknown> = {}) {
    const rawBody = preflightBody(overrides);
    const result = await evaluateApplicationPreflight({
      rawBody,
      headers: sign(rawBody),
    });
    expect(result.status).toBe(200);
    return result.body as {
      decision: string;
      decisionId: string;
      requestId: string;
      tenantId: string;
      projectId: string;
    };
  }

  it("replays a nonce from a second installed store instance (proof 3)", async () => {
    const memory = installApplicationGovernanceStoreForTests().memory;
    const rawBody = preflightBody();
    const headers = sign(rawBody);
    expect((await evaluateApplicationPreflight({ rawBody, headers })).status).toBe(200);
    installApplicationGovernanceStoreForTests(memory);
    const replay = await evaluateApplicationPreflight({ rawBody, headers });
    expect(replay.status).toBe(401);
  });

  it("keeps an ALLOW after swapping to a new repository on the same memory (proof 7/8)", async () => {
    const { memory } = installApplicationGovernanceStoreForTests();
    const body = await allow();
    installApplicationGovernanceStoreForTests(memory);
    const rawReport = reportBody({
      decisionId: body.decisionId,
      requestId: body.requestId,
    });
    const reported = await evaluateApplicationExecutionReport({
      rawBody: rawReport,
      headers: sign(rawReport),
    });
    expect(reported.status).toBe(200);
    expect(reported.body).toMatchObject({ accepted: true });
  });

  it("returns the stored ALLOW for same idempotency key + fingerprint", async () => {
    const rawBody = preflightBody({
      requestId: "req-same",
      idempotencyKey: "idem-same",
    });
    const first = await evaluateApplicationPreflight({
      rawBody,
      headers: sign(rawBody),
    });
    const second = await evaluateApplicationPreflight({
      rawBody,
      headers: sign(rawBody),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body as { decisionId: string }).decisionId).toBe(
      (first.body as { decisionId: string }).decisionId,
    );
  });

  it("conflicts when the same idempotency key carries a different fingerprint", async () => {
    const firstBody = preflightBody({
      requestId: "req-a",
      idempotencyKey: "idem-conflict",
    });
    expect(
      (await evaluateApplicationPreflight({ rawBody: firstBody, headers: sign(firstBody) }))
        .status,
    ).toBe(200);
    const secondBody = preflightBody({
      requestId: "req-b",
      idempotencyKey: "idem-conflict",
      operation: "civio.other.query",
    });
    const second = await evaluateApplicationPreflight({
      rawBody: secondBody,
      headers: sign(secondBody),
    });
    expect(second.status).toBe(409);
  });

  it("rejects an unknown decision on the durable path (proof 11)", async () => {
    const rawReport = reportBody({
      decisionId: "00000000-0000-4000-8000-000000000099",
      requestId: "req-missing",
    });
    const reported = await evaluateApplicationExecutionReport({
      rawBody: rawReport,
      headers: sign(rawReport),
    });
    expect(reported.status).toBe(409);
    expect(reported.body).toMatchObject({ accepted: false });
  });

  it("writes tenantId and projectId on the two application audit events (R05)", async () => {
    const body = await allow();
    const rawReport = reportBody({
      decisionId: body.decisionId,
      requestId: body.requestId,
    });
    await evaluateApplicationExecutionReport({
      rawBody: rawReport,
      headers: sign(rawReport),
    });
    const entries = listUnifiedAuditEntries();
    const preflight = entries.filter((e) => e.type === "application.preflight.evaluated");
    const reported = entries.filter((e) => e.type === "application.execution.reported");
    expect(preflight.at(-1)?.tenantId).toBe(TENANT);
    expect(preflight.at(-1)?.projectId).toBe(PROJECT);
    expect(reported.at(-1)?.tenantId).toBe(TENANT);
    expect(reported.at(-1)?.projectId).toBe(PROJECT);
  });

  it("does not call Node appendCanonicalAuditEntry on the live application path (proof 18)", async () => {
    const spy = vi.spyOn(auditLog, "appendCanonicalAuditEntry");
    const body = await allow();
    const rawReport = reportBody({
      decisionId: body.decisionId,
      requestId: body.requestId,
    });
    await evaluateApplicationExecutionReport({
      rawBody: rawReport,
      headers: sign(rawReport),
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("fail-closes with 503 when Vercel production has no durable store (proof 17)", async () => {
    resetApplicationPreflightForTests();
    process.env.VERCEL = "1";
    process.env.NODE_ENV = "production";
    const rawBody = preflightBody();
    const result = await evaluateApplicationPreflight({
      rawBody,
      headers: sign(rawBody),
    });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      error: "Fail closed: application governance store is unavailable",
    });
  });
});
