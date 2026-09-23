import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  APPLICATION_PREFLIGHT_PATH,
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-application-preflight-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const SECRET = "civio-connector-test-secret-32b!!";
const TENANT = "tenant-a";
const PROJECT = "project-a";

const { registerApplicationPreflightRoutes } = await import(
  "./application-preflight.js"
);
const { resetApplicationPreflightForTests } = await import(
  "../services/application-preflight.js"
);
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);
const { decideApprovalRequest, clearLiveApprovalStoreForTests } = await import(
  "../services/approvals.js"
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

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
    applicationId: "civio",
    tenantId: TENANT,
    projectId: PROJECT,
    actorId: "user-1",
    actorKind: "USER",
    operation: "civio.legal.query",
    operationClass: "GOVERNED_DECISION",
    requestId: `req-${randomBytes(8).toString("hex")}`,
    idempotencyKey: `idem-${randomBytes(8).toString("hex")}`,
    ...overrides,
  });
}

describe("POST /api/v1/governance/application-preflight", () => {
  let app: FastifyInstance;
  const originalKill = process.env.ATLAS_KILL_SWITCHES;
  const originalSecret = process.env.ATLAS_CIVIO_CONNECTOR_SECRET;
  const originalTenant = process.env.ATLAS_CIVIO_TENANT_ID;
  const originalProject = process.env.ATLAS_CIVIO_PROJECT_ID;

  beforeEach(async () => {
    process.env.ATLAS_CIVIO_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_CIVIO_TENANT_ID = TENANT;
    process.env.ATLAS_CIVIO_PROJECT_ID = PROJECT;
    delete process.env.ATLAS_KILL_SWITCHES;
    resetApplicationPreflightForTests();
    resetApprovalsForTests();
    app = await buildRouteTestApp(registerApplicationPreflightRoutes);
  });

  afterEach(async () => {
    if (app) await app.close();
    resetApplicationPreflightForTests();
    if (originalKill === undefined) delete process.env.ATLAS_KILL_SWITCHES;
    else process.env.ATLAS_KILL_SWITCHES = originalKill;
    if (originalSecret === undefined) delete process.env.ATLAS_CIVIO_CONNECTOR_SECRET;
    else process.env.ATLAS_CIVIO_CONNECTOR_SECRET = originalSecret;
    if (originalTenant === undefined) delete process.env.ATLAS_CIVIO_TENANT_ID;
    else process.env.ATLAS_CIVIO_TENANT_ID = originalTenant;
    if (originalProject === undefined) delete process.env.ATLAS_CIVIO_PROJECT_ID;
    else process.env.ATLAS_CIVIO_PROJECT_ID = originalProject;
  });

  it("allows a valid HMAC-bound informational/governed request", async () => {
    const rawBody = body();
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      decision: "ALLOW",
      executed: false,
      applicationId: "civio",
      agentId: null,
      tenantId: TENANT,
      unavailablePolicy: "FAIL_OPEN",
    });
  });

  it("preserves HotelOS agent.cio explicitly and does not invent one when omitted", async () => {
    process.env.ATLAS_HOTELOS_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID = PROJECT;
    const withAgent = body({
      applicationId: "hotelos",
      actorKind: "USER",
      agentId: "agent.cio",
      operation: "hotelos.gateway.agent.cio",
    });
    const allowed = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(withAgent),
      payload: withAgent,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      decision: "ALLOW",
      executed: false,
      applicationId: "hotelos",
      agentId: "agent.cio",
      operation: "hotelos.gateway.agent.cio",
    });

    const embed = body({
      applicationId: "hotelos",
      agentId: null,
      operation: "hotelos.gateway.embed",
      operationClass: "INFORMATIONAL",
    });
    const embedRes = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(embed),
      payload: embed,
    });
    expect(embedRes.statusCode).toBe(200);
    expect(embedRes.json()).toMatchObject({
      decision: "ALLOW",
      executed: false,
      applicationId: "hotelos",
      agentId: null,
      operation: "hotelos.gateway.embed",
    });
    delete process.env.ATLAS_HOTELOS_CONNECTOR_SECRET;
    delete process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID;
    delete process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID;
  });

  it("rejects a missing HMAC as INVALID", async () => {
    const rawBody = body();
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: { "content-type": "application/json" },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().decision).toBe("INVALID");
  });

  it("rejects a forged signature", async () => {
    const rawBody = body();
    const headers = sign(rawBody);
    headers["x-atlas-connector-signature"] = "a".repeat(64);
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers,
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().decision).toBe("INVALID");
  });

  it("rejects a spoofed applicationId that does not match the HMAC secret", async () => {
    process.env.ATLAS_CASEFLOW_CONNECTOR_SECRET = "caseflow-connector-test-secret-32b";
    process.env.ATLAS_CASEFLOW_CONNECTOR_TENANT_ID = "other-tenant";
    process.env.ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID = "other-project";
    const rawBody = body({ applicationId: "caseflow", tenantId: "other-tenant", projectId: "other-project" });
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().decision).toBe("INVALID");
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_SECRET;
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_TENANT_ID;
    delete process.env.ATLAS_CASEFLOW_CONNECTOR_PROJECT_ID;
  });

  it("rejects a caller-supplied tenant that does not match the binding", async () => {
    const rawBody = body({ tenantId: "tenant-b" });
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().decision).toBe("OUT_OF_SCOPE");
  });

  it("denies PSA impersonation", async () => {
    const rawBody = body({ agentId: "psa:00000000-0000-4000-8000-000000000001" });
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().decision).toBe("OUT_OF_SCOPE");
  });

  it("denies Fabric impersonation", async () => {
    const rawBody = body({ actorKind: "AGENT", agentId: "ORCHESTRATOR" });
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().decision).toBe("OUT_OF_SCOPE");
  });

  it("returns KILLED when aiWorkers is active", async () => {
    process.env.ATLAS_KILL_SWITCHES = "aiWorkers";
    const rawBody = body();
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      decision: "KILLED",
      executed: false,
      killSwitchCategory: "aiWorkers",
    });
  });

  it("CTRL-012 G12-A: agentDispatch returns KILLED on GOVERNED sibling preflight (next hop only)", async () => {
    process.env.ATLAS_KILL_SWITCHES = "agentDispatch";
    process.env.ATLAS_HOTELOS_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID = PROJECT;
    const civio = body();
    const civioRes = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(civio),
      payload: civio,
    });
    expect(civioRes.statusCode).toBe(409);
    expect(civioRes.json()).toMatchObject({
      decision: "KILLED",
      executed: false,
      killSwitchCategory: "agentDispatch",
      applicationId: "civio",
      operationClass: "GOVERNED_DECISION",
    });

    const hotelos = body({
      applicationId: "hotelos",
      agentId: "agent.cio",
      operation: "hotelos.gateway.agent.cio",
    });
    const hotelosRes = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(hotelos),
      payload: hotelos,
    });
    expect(hotelosRes.statusCode).toBe(409);
    expect(hotelosRes.json()).toMatchObject({
      decision: "KILLED",
      executed: false,
      killSwitchCategory: "agentDispatch",
      applicationId: "hotelos",
      agentId: "agent.cio",
      operationClass: "GOVERNED_DECISION",
    });
    delete process.env.ATLAS_HOTELOS_CONNECTOR_SECRET;
    delete process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID;
    delete process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID;
  });

  it.each(["payments", "webhooksInbound", "webhooksOutbound"] as const)(
    "CTRL-012 G12-B: %s kill does not kill GOVERNED application preflight",
    async (category) => {
      process.env.ATLAS_KILL_SWITCHES = category;
      const rawBody = body();
      const res = await app.inject({
        method: "POST",
        url: APPLICATION_PREFLIGHT_PATH,
        headers: sign(rawBody),
        payload: rawBody,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        decision: "ALLOW",
        executed: false,
        killSwitchCategory: null,
        applicationId: "civio",
        operationClass: "GOVERNED_DECISION",
      });
    },
  );

  it("CTRL-012 G12-D: hotelos agent.cio is not gated by Fabric pause/quarantine", async () => {
    delete process.env.ATLAS_KILL_SWITCHES;
    process.env.ATLAS_HOTELOS_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID = TENANT;
    process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID = PROJECT;
    const rawBody = body({
      applicationId: "hotelos",
      agentId: "agent.cio",
      operation: "hotelos.gateway.agent.cio",
    });
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      decision: "ALLOW",
      executed: false,
      applicationId: "hotelos",
      agentId: "agent.cio",
      killSwitchCategory: null,
    });
    delete process.env.ATLAS_HOTELOS_CONNECTOR_SECRET;
    delete process.env.ATLAS_HOTELOS_CONNECTOR_TENANT_ID;
    delete process.env.ATLAS_HOTELOS_CONNECTOR_PROJECT_ID;
  });

  it("denies destructive operations", async () => {
    const rawBody = body({ operation: "civio.record.delete" });
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().decision).toBe("DENY");
  });

  it("requires approval for HIGH_RISK and does not mark executed", async () => {
    const rawBody = body({
      operation: "civio.legal.scan-contract",
      operationClass: "HIGH_RISK",
    });
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      executed: false,
      unavailablePolicy: "FAIL_CLOSED",
    });
    expect(res.json().approvalRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("rejects SoD self-approval then allows after a different approver", async () => {
    const rawBody = body({
      operation: "civio.legal.scan-contract",
      operationClass: "HIGH_RISK",
    });
    const pending = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    const approvalId = pending.json().approvalRequestId as string;
    await expect(
      decideApprovalRequest(approvalId, {
        decidedBy: "civio:user-1",
        approve: true,
        decisionReason: "self approve",
      }),
    ).rejects.toThrow(/separation of duties/i);

    const approved = await decideApprovalRequest(approvalId, {
      decidedBy: "operator-2",
      approve: true,
      decisionReason: "operator approved",
    });
    expect(approved.status).toBe("APPROVED");

    const retry = JSON.parse(rawBody) as Record<string, unknown>;
    retry.approvalId = approvalId;
    retry.idempotencyKey = `idem-${randomBytes(8).toString("hex")}`;
    const retryBody = JSON.stringify(retry);
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(retryBody),
      payload: retryBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      decision: "ALLOW",
      executed: false,
      approvalRequestId: approvalId,
    });
  });

  it("rejects a replayed nonce", async () => {
    const rawBody = body();
    const headers = sign(rawBody);
    const first = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers,
      payload: rawBody,
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers,
      payload: rawBody,
    });
    expect(second.statusCode).toBe(401);
    expect(second.json().decision).toBe("INVALID");
  });

  it("returns the cached decision for the same idempotency key", async () => {
    const rawBody = body({
      requestId: "req-idem-1",
      idempotencyKey: "idem-stable-1",
    });
    const first = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    const second = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().decisionId).toBe(first.json().decisionId);
  });

  it("fail-closes HIGH_RISK when the approval store is unavailable", async () => {
    clearLiveApprovalStoreForTests();
    const rawBody = body({
      operation: "civio.legal.scan-contract",
      operationClass: "HIGH_RISK",
    });
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_PREFLIGHT_PATH,
      headers: sign(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      decision: "DENY",
      executed: false,
      unavailablePolicy: "FAIL_CLOSED",
    });
    resetApprovalsForTests();
  });

  it.each([
    {
      operationClass: "GOVERNED_DECISION" as const,
      operation: "civio.legal.query",
      unavailablePolicy: "FAIL_OPEN" as const,
    },
    {
      operationClass: "INFORMATIONAL" as const,
      operation: "civio.legal.lookup",
      unavailablePolicy: "FAIL_OPEN" as const,
    },
    {
      operationClass: "HIGH_RISK" as const,
      operation: "civio.legal.scan-contract",
      unavailablePolicy: "FAIL_CLOSED" as const,
    },
    {
      operationClass: "TOOL_ACTION" as const,
      operation: "civio.legal.tool",
      unavailablePolicy: "FAIL_CLOSED" as const,
    },
  ])(
    "CTRL-013: unset connector secret returns 401 INVALID with $unavailablePolicy for $operationClass",
    async ({ operationClass, operation, unavailablePolicy }) => {
      delete process.env.ATLAS_CIVIO_CONNECTOR_SECRET;
      const rawBody = body({ operation, operationClass });
      const res = await app.inject({
        method: "POST",
        url: APPLICATION_PREFLIGHT_PATH,
        headers: sign(rawBody),
        payload: rawBody,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        decision: "INVALID",
        executed: false,
        operationClass,
        unavailablePolicy,
      });
      expect(String(res.json().reason)).toMatch(/CONNECTOR_SECRET must be set/i);
    },
  );
});
