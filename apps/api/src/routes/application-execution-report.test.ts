import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  APPLICATION_EXECUTION_REPORT_PATH,
  APPLICATION_EXECUTION_REPORT_SCHEMA,
  APPLICATION_PREFLIGHT_PATH,
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-execution-report-route-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const SECRET = "civio-connector-test-secret-32b!!";
const TENANT = "tenant-a";
const PROJECT = "project-a";

const { registerApplicationPreflightRoutes } = await import(
  "./application-preflight.js"
);
const { registerApplicationExecutionReportRoutes } = await import(
  "./application-execution-report.js"
);
const { resetApplicationPreflightForTests } = await import(
  "../services/application-preflight.js"
);
const { resetApplicationExecutionReportForTests } = await import(
  "../services/application-execution-report.js"
);
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

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

describe("POST /api/v1/governance/application-execution-report", () => {
  let app: FastifyInstance;
  const originalSecret = process.env.ATLAS_CIVIO_CONNECTOR_SECRET;
  const originalTenant = process.env.ATLAS_CIVIO_TENANT_ID;
  const originalProject = process.env.ATLAS_CIVIO_PROJECT_ID;

  beforeEach(async () => {
    process.env.ATLAS_CIVIO_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_CIVIO_TENANT_ID = TENANT;
    process.env.ATLAS_CIVIO_PROJECT_ID = PROJECT;
    delete process.env.ATLAS_KILL_SWITCHES;
    resetApplicationPreflightForTests();
    resetApplicationExecutionReportForTests();
    app = await buildRouteTestApp(async (instance) => {
      await registerApplicationPreflightRoutes(instance);
      await registerApplicationExecutionReportRoutes(instance);
    });
  });

  afterEach(async () => {
    if (app) await app.close();
    resetApplicationPreflightForTests();
    resetApplicationExecutionReportForTests();
    if (originalSecret === undefined) delete process.env.ATLAS_CIVIO_CONNECTOR_SECRET;
    else process.env.ATLAS_CIVIO_CONNECTOR_SECRET = originalSecret;
    if (originalTenant === undefined) delete process.env.ATLAS_CIVIO_TENANT_ID;
    else process.env.ATLAS_CIVIO_TENANT_ID = originalTenant;
    if (originalProject === undefined) delete process.env.ATLAS_CIVIO_PROJECT_ID;
    else process.env.ATLAS_CIVIO_PROJECT_ID = originalProject;
  });

  it("accepts a HMAC-signed report after ALLOW", async () => {
    const preflight = JSON.stringify({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "civio",
      tenantId: TENANT,
      projectId: PROJECT,
      actorId: "user-1",
      actorKind: "USER",
      operation: "civio.legal.query",
      operationClass: "GOVERNED_DECISION",
      requestId: "req-route-1",
      idempotencyKey: "idem-route-1",
    });
    const allowed = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(preflight),
      payload: preflight,
    });
    expect(allowed.statusCode).toBe(200);
    const decisionId = allowed.json().decisionId as string;

    const report = JSON.stringify({
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "civio",
      tenantId: TENANT,
      projectId: PROJECT,
      decisionId,
      requestId: "req-route-1",
      operation: "civio.legal.query",
      executionId: "chatcmpl-route-1",
      executionStatus: "SUCCESS",
    });
    const result = await app.inject({
      method: "POST",
      url: APPLICATION_EXECUTION_REPORT_PATH,
      headers: sign(report),
      payload: report,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      accepted: true,
      decisionId,
      requestId: "req-route-1",
      executionId: "chatcmpl-route-1",
    });
  });

  it("rejects invalid HMAC on the report route", async () => {
    const report = JSON.stringify({
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "civio",
      tenantId: TENANT,
      projectId: PROJECT,
      decisionId: "dec-x",
      requestId: "req-x",
      operation: "civio.legal.query",
      executionId: "chatcmpl-x",
      executionStatus: "SUCCESS",
    });
    const result = await app.inject({
      method: "POST",
      url: APPLICATION_EXECUTION_REPORT_PATH,
      headers: {
        "content-type": "application/json",
        "x-atlas-connector-timestamp": String(Date.now()),
        "x-atlas-connector-nonce": "abcd",
        "x-atlas-connector-signature": "00",
      },
      payload: report,
    });
    expect(result.statusCode).toBe(401);
    expect(result.json()).toMatchObject({ accepted: false });
  });
});
