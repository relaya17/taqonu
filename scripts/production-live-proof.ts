#!/usr/bin/env tsx
/**
 * Live private-plane proof. Observation + real HTTP against running processes.
 * Does not invent sibling execute. Does not claim an external pentest.
 *
 * Usage:
 *   pnpm production:live-proof
 *
 * Optional env:
 *   ATLAS_CONTROL_PLANE_TOKEN  shared Admin/CP/API service token
 *   ATLAS_CIVIO_CONNECTOR_SECRET / ATLAS_CIVIO_TENANT_ID / ATLAS_CIVIO_PROJECT_ID
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { signCivioConnectorRequest } from "../packages/integrations/civio/src/hmac.ts";
import {
  CIVIO_APPLICATION_ID,
  CIVIO_CONNECTOR_ID,
  CIVIO_CONNECTOR_INGRESS_PATH,
  CONNECTED_APPLICATION_RUNTIME,
} from "../packages/shared/src/index.ts";

function loadLiveSessionEnv(): void {
  const sessionPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".atlas", "live-session.env");
  if (!existsSync(sessionPath)) return;
  for (const line of readFileSync(sessionPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}

loadLiveSessionEnv();

type CheckStatus = "PASS" | "FAIL" | "SKIP" | "BLOCKED";

interface Check {
  readonly id: string;
  readonly status: CheckStatus;
  readonly expected: string;
  readonly actual: string;
  readonly evidence: string;
}

const API = (process.env["ATLAS_API_URL"] ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const CP = (process.env["ATLAS_CONTROL_PLANE_URL"] ?? "http://127.0.0.1:3100").replace(
  /\/$/,
  "",
);
const ADMIN = (process.env["ATLAS_ADMIN_URL"] ?? "http://127.0.0.1:3200").replace(/\/$/, "");
const WEB = (process.env["ATLAS_WEB_URL"] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const TOKEN = process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim() ?? "";
const CIVIO_SECRET = process.env["ATLAS_CIVIO_CONNECTOR_SECRET"]?.trim() ?? "";
const CIVIO_TENANT = process.env["ATLAS_CIVIO_TENANT_ID"]?.trim() ?? "tenant-alpha";
const CIVIO_PROJECT = process.env["ATLAS_CIVIO_PROJECT_ID"]?.trim() ?? "project-alpha";

const checks: Check[] = [];

function record(check: Check): void {
  checks.push(check);
}

async function http(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8_000,
): Promise<{
  readonly ok: boolean;
  readonly status: number | null;
  readonly body: unknown;
  readonly error: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 400);
    }
    return { ok: response.ok, status: response.status, body, error: null };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "fetch-failed";
    return { ok: false, status: null, body: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return TOKEN
    ? { authorization: `Bearer ${TOKEN}`, ...extra }
    : extra;
}

function listening(result: { status: number | null; error: string | null }): boolean {
  return result.status !== null && result.error === null;
}

const apiLiveness = await http(`${API}/health`);
const apiHealth = await http(`${API}/api/v1/health`);
const cpStatus = await http(`${CP}/api/v1/status`);
const adminRoot = await http(ADMIN + "/");
const webRoot = await http(WEB + "/");

record({
  id: "infra.api.liveness",
  status: apiLiveness.status === 200 ? "PASS" : "BLOCKED",
  expected: "GET /health → 200",
  actual: apiLiveness.error ?? `HTTP ${apiLiveness.status}`,
  evidence: JSON.stringify(apiLiveness.body).slice(0, 300),
});
record({
  id: "infra.api.health",
  status: apiHealth.status === 200 || apiHealth.status === 503 ? "PASS" : "BLOCKED",
  expected: "GET /api/v1/health reachable (200 or 503 CRITICAL)",
  actual: apiHealth.error ?? `HTTP ${apiHealth.status}`,
  evidence: JSON.stringify(apiHealth.body).slice(0, 500),
});
record({
  id: "infra.control-plane.status",
  status: cpStatus.status === 200 ? "PASS" : "BLOCKED",
  expected: "GET /api/v1/status → 200 (public liveness)",
  actual: cpStatus.error ?? `HTTP ${cpStatus.status}`,
  evidence: JSON.stringify(cpStatus.body).slice(0, 300),
});
record({
  id: "infra.admin.listening",
  status: adminRoot.status !== null ? "PASS" : "BLOCKED",
  expected: "Admin :3200 accepts HTTP",
  actual: adminRoot.error ?? `HTTP ${adminRoot.status}`,
  evidence: typeof adminRoot.body === "string" ? adminRoot.body.slice(0, 120) : JSON.stringify(adminRoot.body).slice(0, 200),
});
record({
  id: "infra.web.listening",
  status: webRoot.status !== null ? "PASS" : "BLOCKED",
  expected: "Studio :3000 accepts HTTP (optional; needs apps/web env)",
  actual: webRoot.error ?? `HTTP ${webRoot.status}`,
  evidence: "web .env.local was absent at last inspection; BLOCKED is an environment gap",
});
record({
  id: "infra.localhost-is-not-production",
  status: "SKIP",
  expected: "Ubuntu + Tailscale production private plane per docs/deployment/private-plane.md",
  actual: "this script probes loopback (LOCAL PRIVATE PLANE)",
  evidence: "Loopback success is not production VM / Tailscale / systemd proof.",
});

const apiUp = listening(apiLiveness);
const cpUp = listening(cpStatus);
const adminUp = adminRoot.status !== null;

if (adminUp) {
  record({
    id: "security.admin.promo-root",
    status: adminRoot.status === 200 ? "PASS" : "FAIL",
    expected: "GET / without a token → 200 promo HTML (not a privileged JSON surface)",
    actual: `HTTP ${adminRoot.status}`,
    evidence: typeof adminRoot.body === "string" ? adminRoot.body.slice(0, 160) : JSON.stringify(adminRoot.body).slice(0, 200),
  });
}

if (!TOKEN) {
  record({
    id: "auth.token.configured",
    status: "BLOCKED",
    expected: "ATLAS_CONTROL_PLANE_TOKEN set for live Admin/CP/API SERVICE proofs",
    actual: "unset",
    evidence: "Unauthenticated negative paths can still run. Positive SERVICE paths are skipped.",
  });
} else {
  record({
    id: "auth.token.configured",
    status: "PASS",
    expected: "ATLAS_CONTROL_PLANE_TOKEN present (value not logged)",
    actual: `length=${TOKEN.length}`,
    evidence: "token withheld from report",
  });
}

if (adminUp) {
  const unauth = await http(`${ADMIN}/api/v1/platform/hierarchy`);
  if (TOKEN) {
    record({
      id: "security.admin.unauthenticated",
      status: unauth.status === 401 ? "PASS" : "FAIL",
      expected: "Admin /api/v1/platform/hierarchy without bearer → 401 when token is configured",
      actual: `HTTP ${unauth.status}`,
      evidence: JSON.stringify(unauth.body).slice(0, 200),
    });
    const authed = await http(`${ADMIN}/api/v1/platform/hierarchy`, {
      headers: authHeaders(),
    });
    record({
      id: "auth.admin.bearer",
      status: authed.status === 200 ? "PASS" : "FAIL",
      expected: "Admin hierarchy with bearer → 200",
      actual: `HTTP ${authed.status}`,
      evidence: JSON.stringify(authed.body).slice(0, 300),
    });
  } else {
    record({
      id: "security.admin.unauthenticated",
      status: "SKIP",
      expected: "401 when token configured",
      actual: `HTTP ${unauth.status} (dev loopback may allow unauthenticated)`,
      evidence: "Cannot claim production Admin lock without ATLAS_CONTROL_PLANE_TOKEN",
    });
  }
}

if (cpUp) {
  const unauthHealth = await http(`${CP}/api/v1/health`);
  if (TOKEN) {
    record({
      id: "security.cp.unauthenticated.health",
      status: unauthHealth.status === 401 ? "PASS" : "FAIL",
      expected: "CP /api/v1/health without bearer → 401 when token is configured",
      actual: `HTTP ${unauthHealth.status}`,
      evidence: JSON.stringify(unauthHealth.body).slice(0, 200),
    });
    const health = await http(`${CP}/api/v1/health`, { headers: authHeaders() });
    record({
      id: "auth.cp.health",
      status: health.status === 200 ? "PASS" : "FAIL",
      expected: "CP /api/v1/health with bearer → 200",
      actual: `HTTP ${health.status}`,
      evidence: JSON.stringify(health.body).slice(0, 400),
    });
    const selfAudit = await http(`${CP}/api/v1/self-audit`, { headers: authHeaders() });
    const auditBody = selfAudit.body as {
      systemId?: unknown;
      findings?: ReadonlyArray<{ autoApply?: unknown; id?: unknown }>;
    } | null;
    const findings = Array.isArray(auditBody?.findings) ? auditBody.findings : [];
    const autoApplyClosed =
      findings.length > 0 && findings.every((finding) => finding.autoApply === false);
    record({
      id: "governance.def-000.self-audit",
      status:
        selfAudit.status === 200 &&
        auditBody?.systemId === "DEF-000" &&
        autoApplyClosed
          ? "PASS"
          : "FAIL",
      expected: "GET /api/v1/self-audit → systemId DEF-000 and every finding autoApply:false",
      actual: `HTTP ${selfAudit.status} systemId=${String(auditBody?.systemId)} findings=${findings.length} autoApplyClosed=${String(autoApplyClosed)}`,
      evidence: JSON.stringify({
        systemId: auditBody?.systemId,
        findingIds: findings.map((finding) => finding.id ?? null),
      }).slice(0, 500),
    });
    const inspect = await http(`${CP}/api/v1/gateway/ops`, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/json",
        "x-atlas-reason": "production live proof inspect def-000",
      }),
      body: JSON.stringify({
        operation: "inspect",
        applicationId: "def-000",
      }),
    });
    const inspectBody = inspect.body as {
      decision?: string;
      executed?: boolean;
      receipt?: { executionKind?: string };
    } | null;
    record({
      id: "e2e.cp.inspect.allow",
      status:
        inspect.status === 200 && inspectBody?.decision === "ALLOW"
          ? "PASS"
          : "FAIL",
      expected: "CP inspect def-000 → ALLOW observation (not tool execute)",
      actual: `HTTP ${inspect.status} decision=${inspectBody?.decision} executed=${String(inspectBody?.executed)} kind=${inspectBody?.receipt?.executionKind}`,
      evidence: JSON.stringify(inspect.body).slice(0, 600),
    });
    const writeNoReauth = await http(`${CP}/api/v1/gateway/ops`, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/json",
        "x-atlas-reason": "production live proof request_agent_run no reauth",
      }),
      body: JSON.stringify({
        operation: "request_agent_run",
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
      }),
    });
    record({
      id: "security.cp.write.no-reauth",
      status: writeNoReauth.status === 403 ? "PASS" : "FAIL",
      expected: "request_agent_run without reauth → 403 DENY",
      actual: `HTTP ${writeNoReauth.status}`,
      evidence: JSON.stringify(writeNoReauth.body).slice(0, 400),
    });
    const reauth = await http(`${CP}/api/v1/auth/reauth`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
    });
    const ticket =
      reauth.body && typeof reauth.body === "object" && "ticket" in reauth.body
        ? String((reauth.body as { ticket?: unknown }).ticket ?? "")
        : "";
    const writeForgedApproval = await http(`${CP}/api/v1/gateway/ops`, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/json",
        "x-atlas-reason": "production live proof forged independent approval",
        "x-atlas-reauth": ticket,
      }),
      body: JSON.stringify({
        operation: "request_agent_run",
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        approved: true,
        independentApprovalVerified: true,
      }),
    });
    const forgedBody = writeForgedApproval.body as {
      decision?: string;
      executed?: boolean;
    } | null;
    record({
      id: "security.cp.write.forged-independent-approval",
      status:
        writeForgedApproval.status === 202 &&
        forgedBody?.decision === "REQUIRE_APPROVAL" &&
        forgedBody.executed !== true
          ? "PASS"
          : "FAIL",
      expected: "body independentApprovalVerified ignored → REQUIRE_APPROVAL, not executed",
      actual: `HTTP ${writeForgedApproval.status} decision=${forgedBody?.decision} executed=${String(forgedBody?.executed)}`,
      evidence: JSON.stringify(writeForgedApproval.body).slice(0, 500),
    });
    const siblingWrite = await http(`${CP}/api/v1/gateway/ops`, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/json",
        "x-atlas-reason": "production live proof hotelos write must not fulfill",
        "x-atlas-reauth": ticket,
      }),
      body: JSON.stringify({
        operation: "request_agent_run",
        applicationId: "hotelos",
        agentId: "CODE_ENGINEER",
        approved: true,
        verificationPlanPresent: true,
      }),
    });
    const siblingBody = siblingWrite.body as {
      decision?: string;
      executed?: boolean;
      receipt?: { verification?: { detail?: string } };
    } | null;
    record({
      id: "security.cp.sibling.no-http-fulfill",
      status:
        siblingWrite.status === 403 &&
        siblingBody?.executed !== true &&
        siblingBody?.decision === "DENY"
          ? "PASS"
          : "FAIL",
      expected:
        "hotelos request_agent_run → 403 DENY at IDENTITY (not in CP registry); executed !== true",
      actual: `HTTP ${siblingWrite.status} decision=${siblingBody?.decision} executed=${String(siblingBody?.executed)}`,
      evidence: JSON.stringify(siblingWrite.body).slice(0, 500),
    });
  } else {
    record({
      id: "security.cp.unauthenticated.health",
      status: "SKIP",
      expected: "401 when token configured",
      actual: `HTTP ${unauthHealth.status}`,
      evidence: "dev loopback may allow unauthenticated CP",
    });
  }
}

if (apiUp) {
  const fulfillUnauth = await http(`${API}/api/v1/gateway/fulfill`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
    }),
  });
  record({
    id: "security.api.fulfill.unauthenticated",
    status: fulfillUnauth.status === 401 ? "PASS" : "FAIL",
    expected: "POST /api/v1/gateway/fulfill without credentials → 401",
    actual: `HTTP ${fulfillUnauth.status}`,
    evidence: JSON.stringify(fulfillUnauth.body).slice(0, 300),
  });
  const fulfillWrong = await http(`${API}/api/v1/gateway/fulfill`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer definitely-not-the-control-plane-token",
    },
    body: JSON.stringify({
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
    }),
  });
  record({
    id: "security.api.fulfill.wrong-token",
    status: fulfillWrong.status === 401 ? "PASS" : "FAIL",
    expected: "wrong SERVICE bearer → 401",
    actual: `HTTP ${fulfillWrong.status}`,
    evidence: JSON.stringify(fulfillWrong.body).slice(0, 300),
  });

  if (TOKEN) {
    const siblingFulfill = await http(`${API}/api/v1/gateway/fulfill`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        applicationId: "civio",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      }),
    });
    record({
      id: "security.api.fulfill.non-def-000",
      status: siblingFulfill.status === 403 ? "PASS" : "FAIL",
      expected: "CP SERVICE fulfill of civio → 403 (Atlas-self only)",
      actual: `HTTP ${siblingFulfill.status}`,
      evidence: JSON.stringify(siblingFulfill.body).slice(0, 400),
    });
    const requestId = randomUUID();
    const fulfill = await http(`${API}/api/v1/gateway/fulfill`, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/json",
        "x-request-id": requestId,
      }),
      body: JSON.stringify({
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      }),
    });
    const fulfillBody = fulfill.body as {
      executed?: boolean;
      verified?: boolean;
      toolName?: string;
      outcome?: { status?: string; stage?: string };
      verificationVerdict?: string;
      applicationId?: string;
      observation?: { artifactHash?: string };
    } | null;
    const artifactHash = fulfillBody?.observation?.artifactHash;
    const artifactHashOk =
      typeof artifactHash === "string" && /^[a-f0-9]{64}$/i.test(artifactHash);
    const executed =
      fulfill.status === 200 &&
      fulfillBody?.executed === true &&
      fulfillBody.toolName === "analyze_repo" &&
      fulfillBody.applicationId === "def-000";
    record({
      id: "e2e.def-000.fulfill.execute",
      status: executed ? "PASS" : "FAIL",
      expected:
        "CP bearer → fulfill → executeGovernedAction → executeTool(analyze_repo) executed:true",
      actual: `HTTP ${fulfill.status} executed=${String(fulfillBody?.executed)} tool=${fulfillBody?.toolName} outcome=${fulfillBody?.outcome?.status}`,
      evidence: JSON.stringify({ requestId, body: fulfill.body }).slice(0, 800),
    });
    record({
      id: "e2e.def-000.artifact-hash",
      status: executed && artifactHashOk ? "PASS" : executed ? "FAIL" : "SKIP",
      expected: "EXECUTED fulfill returns observation.artifactHash (64 hex)",
      actual: `hashLength=${typeof artifactHash === "string" ? artifactHash.length : 0}`,
      evidence: "Request correlation is x-request-id; hash is the execution artifact, not world-state VERIFIED",
    });
    record({
      id: "e2e.def-000.executed-not-verified",
      status:
        executed && fulfillBody?.verified === false
          ? "PASS"
          : executed
            ? "FAIL"
            : "SKIP",
      expected: "executed:true does not imply verified:true (world-state NOT VERIFIED without observations)",
      actual: `verified=${String(fulfillBody?.verified)} verdict=${fulfillBody?.verificationVerdict}`,
      evidence: "Missing verification observations → NOT VERIFIED, fail-closed on claiming verified",
    });
  } else {
    record({
      id: "e2e.def-000.fulfill.execute",
      status: "BLOCKED",
      expected: "live fulfill with SERVICE bearer",
      actual: "ATLAS_CONTROL_PLANE_TOKEN unset",
      evidence: "API is up; positive execute hop needs the shared token on both processes",
    });
  }
}

if (cpUp && CIVIO_SECRET.length >= 32) {
  const event = {
    eventId: `evt-live-${randomUUID()}`,
    eventType: "civio.rights.answered",
    occurredAt: new Date().toISOString(),
    applicationId: CIVIO_APPLICATION_ID,
    connectorId: CIVIO_CONNECTOR_ID,
    tenantId: CIVIO_TENANT,
    projectId: CIVIO_PROJECT,
    actor: { id: "civio-runtime", kind: "SYSTEM" },
    source: { runtime: "civio", path: "live-proof" },
    payload: { questionId: "live-proof" },
    schemaVersion: "1.0.0",
    correlationId: `corr-${randomUUID()}`,
    idempotencyKey: `idem-${randomUUID()}`,
  };
  const raw = JSON.stringify(event);
  const signed = signCivioConnectorRequest({ secret: CIVIO_SECRET, rawBody: raw });
  const ingest = await http(`${CP}${CIVIO_CONNECTOR_INGRESS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signed.headers },
    body: raw,
  });
  const ingestBody = ingest.body as {
    accepted?: boolean;
    execution?: string;
    evaluation?: { executed?: boolean };
    lifecycle?: { executed?: boolean; status?: string };
  } | null;
  const civioNoToolExecute =
    ingest.status === 202 &&
    ingestBody?.accepted === true &&
    ingestBody.evaluation?.executed !== true &&
    ingestBody.lifecycle?.executed !== true &&
    (ingestBody.execution === "NOT_IMPLEMENTED" ||
      ingestBody.execution === "HANDED_OFF" ||
      ingestBody.execution === "HANDOFF_FAILED");
  record({
    id: "connected.civio.hmac.evaluate",
    status: civioNoToolExecute ? "PASS" : "FAIL",
    expected:
      "HMAC ingest 202; evaluation.executed false; lifecycle.executed false; execution is evaluate/handoff of decision, not a Civio tool",
    actual: `HTTP ${ingest.status} execution=${ingestBody?.execution} accepted=${String(ingestBody?.accepted)} evalExecuted=${String(ingestBody?.evaluation?.executed)} lifecycleExecuted=${String(ingestBody?.lifecycle?.executed)}`,
    evidence: JSON.stringify(ingest.body).slice(0, 800),
  });
  const bad = await http(`${CP}${CIVIO_CONNECTOR_INGRESS_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...signCivioConnectorRequest({
        secret: "wrong-secret-that-is-long-enough!!",
        rawBody: raw,
      }).headers,
    },
    body: raw,
  });
  record({
    id: "security.civio.bad-hmac",
    status: bad.status === 401 ? "PASS" : "FAIL",
    expected: "invalid HMAC → 401",
    actual: `HTTP ${bad.status}`,
    evidence: JSON.stringify(bad.body).slice(0, 300),
  });
} else {
  record({
    id: "connected.civio.hmac.evaluate",
    status: cpUp ? "BLOCKED" : "BLOCKED",
    expected: "Civio HMAC evaluate-only live ingest",
    actual: !cpUp ? "control plane not listening" : "ATLAS_CIVIO_CONNECTOR_SECRET missing or <32 chars",
    evidence: "Civio runtime is not in this monorepo. Evaluate-only is the existing contract.",
  });
}

for (const row of CONNECTED_APPLICATION_RUNTIME) {
  const executable = row.execute === "GATEWAY_FULFILL";
  record({
    id: `connected.inventory.${row.applicationId}`,
    status: "PASS",
    expected: executable
      ? "def-000 has GATEWAY_FULFILL"
      : `${row.applicationId} has no execute contract`,
    actual: `${row.connection}/${row.execute}/${row.ingest} gap=${JSON.stringify(row.executeGap)}`,
    evidence: row.evidence,
  });
}

record({
  id: "security.external-pentest",
  status: "SKIP",
  expected: "external penetration test",
  actual: "not performed",
  evidence: "Internally verified only. Externally tested: none. Externally pending: owner engagement.",
});

const summary = {
  probedAt: new Date().toISOString(),
  origins: { api: API, controlPlane: CP, admin: ADMIN, web: WEB },
  counts: {
    pass: checks.filter((c) => c.status === "PASS").length,
    fail: checks.filter((c) => c.status === "FAIL").length,
    blocked: checks.filter((c) => c.status === "BLOCKED").length,
    skip: checks.filter((c) => c.status === "SKIP").length,
  },
  checks,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.counts.fail > 0 ? 1 : 0);
