import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { registerTool, resetToolRegistryForTests } from "@atlas/agent-core";
import {
  CONTROL_PLANE_SERVICE_ID,
  GOVERNED_LIFECYCLE_HANDOFF_PATH,
  type GovernedLifecycleHandoff,
} from "@atlas/shared";
import {
  computeGovernedBindingHash,
  resetGovernedIdempotencyForTests,
} from "../services/governed-execution.js";
import { resetGovernedClaimStartsForTests } from "../services/governed-claimed-execution.js";
import { resetGovernedLifecycleForTests } from "../services/governed-lifecycle.js";
import { resetApprovalsForTests } from "../services/approvals-test-store.js";
import { decideApprovalRequest, getApprovalRequest } from "../services/approvals.js";
import {
  acceptGovernedLifecycleHandoff,
} from "../services/governed-lifecycle-handoff.js";
import { resolveAgentIdentity } from "../services/agent-runtime-authz.js";
import {
  setAuditLogPathForTests,
  listUnifiedAuditEntries,
} from "../services/audit-log.js";

const getProject = vi.fn();
vi.mock("../store/os-store.js", () => ({
  osStore: {
    getProject: (id: string) => getProject(id),
  },
}));

const { registerGovernedLifecycleHandoffRoutes } = await import(
  "../routes/governed-lifecycle-handoff.js"
);
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

const CP_TOKEN = "control-plane-operator-token-32chars!!";
const TENANT = "tenant-alpha";
const PROJECT = "project-alpha";
const APP = "civio";
const OWNER = "11111111-1111-4111-8111-111111111111";
const PROJECT_UUID = "33333333-3333-4333-8333-333333333333";
const ARTIFACT = "export const answer = 42;";
const QUERY = "src/index.ts";

function identity() {
  return {
    tenantId: TENANT,
    projectId: PROJECT,
    applicationId: APP,
    processId: "proc-1",
    eventId: "evt-1",
  };
}

function decision(
  kind: "ALLOW" | "DENY" | "REQUIRE_APPROVAL",
  overrides: Record<string, unknown> = {},
) {
  return {
    ...identity(),
    decision: kind,
    reason: `${kind} by supervised governance`,
    eventType: "civio.rights.answered",
    correlationId: "corr-1",
    requestId: "req-1",
    policy: {
      entityType: kind === "DENY" ? "*" : "DOCUMENT",
      action: kind === "DENY" ? "DELETE" : "READ",
      riskTier: kind === "DENY" ? "BLOCK" : kind === "REQUIRE_APPROVAL" ? "APPROVAL" : "AUTO_LOG",
    },
    ...overrides,
  };
}

function handoff(
  kind: "ALLOW" | "DENY" | "REQUIRE_APPROVAL",
  extra: Partial<GovernedLifecycleHandoff> = {},
): GovernedLifecycleHandoff {
  return {
    schemaVersion: "atlas.governed-lifecycle-handoff/v1",
    identity: identity(),
    decision: decision(kind),
    ...extra,
  } as GovernedLifecycleHandoff;
}

describe("POST /api/v1/governance/lifecycle/handoff", () => {
  let app: FastifyInstance;
  let dir: string;
  let projectRoot: string;
  let runs: number;

  beforeEach(async () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;
    getProject.mockReset();
    getProject.mockImplementation((id: string) =>
      id === PROJECT_UUID ? { id } : undefined,
    );
    dir = mkdtempSync(join(tmpdir(), `atlas-handoff-${Math.random().toString(16).slice(2)}`));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();
    resetGovernedLifecycleForTests();
    resetGovernedIdempotencyForTests();
    resetGovernedClaimStartsForTests();
    projectRoot = join(dir, "repo");
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "index.ts"), ARTIFACT, "utf8");
    runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        return "observation: answer = 42";
      },
    });
    app = await buildRouteTestApp(registerGovernedLifecycleHandoffRoutes);
  });

  afterEach(async () => {
    await app.close();
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    resetGovernedLifecycleForTests();
    resetToolRegistryForTests();
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    rmSync(dir, { recursive: true, force: true });
  });

  async function post(body: unknown, token = CP_TOKEN) {
    return app.inject({
      method: "POST",
      url: GOVERNED_LIFECYCLE_HANDOFF_PATH,
      headers: {
        authorization: token ? `Bearer ${token}` : "",
        "content-type": "application/json",
      },
      payload: body,
    });
  }

  it("rejects unauthorized CP handoff", async () => {
    const missing = await post(handoff("ALLOW"), "");
    expect(missing.statusCode).toBe(401);
    const wrong = await post(handoff("ALLOW"), "not-the-token");
    expect(wrong.statusCode).toBe(401);
  });

  it("rejects wrong tenant", async () => {
    const body = handoff("ALLOW", {
      identity: { ...identity(), tenantId: "other-tenant" },
    });
    const res = await post(body);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/tenant/);
  });

  it("rejects wrong project", async () => {
    const res = await post(
      handoff("ALLOW", { identity: { ...identity(), projectId: "other-project" } }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/project/);
  });

  it("rejects wrong application", async () => {
    const res = await post(
      handoff("ALLOW", { identity: { ...identity(), applicationId: "other-app" } }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/application/);
  });

  it("rejects wrong process", async () => {
    const res = await post(
      handoff("ALLOW", { identity: { ...identity(), processId: "other-proc" } }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/process/);
  });

  it("rejects wrong event", async () => {
    const res = await post(
      handoff("ALLOW", { identity: { ...identity(), eventId: "other-event" } }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/event/);
  });

  it("DENY never executes", async () => {
    const res = await post(handoff("DENY"));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executed).toBe(false);
    expect(body.status).toBe("STOPPED");
    expect(runs).toBe(0);
    const types = listUnifiedAuditEntries().map((e) => e.type);
    expect(types).toContain("lifecycle.decision.denied");
    expect(listUnifiedAuditEntries().some((e) => e.actorId === CONTROL_PLANE_SERVICE_ID)).toBe(
      true,
    );
    expect(listUnifiedAuditEntries().some((e) => e.actorKind === "SYSTEM")).toBe(true);
  });

  it("REQUIRE_APPROVAL uses existing approval bound to decision identity", async () => {
    const res = await post(handoff("REQUIRE_APPROVAL"));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("APPROVAL_REQUIRED");
    expect(body.executed).toBe(false);
    expect(body.approvalRequestId).toBeTruthy();
    const stored = await getApprovalRequest(body.approvalRequestId);
    expect(stored?.entityType).toBe("DOCUMENT");
    expect(stored?.action).toBe("READ");
    expect(stored?.context["tenantId"]).toBe(TENANT);
    expect(stored?.context["applicationId"]).toBe(APP);
    expect(stored?.context["eventId"]).toBe("evt-1");
    expect(stored?.context["processId"]).toBe("proc-1");
    expect(stored?.artifactHash).toBeNull();
    expect(runs).toBe(0);
  });

  it("approval cannot unlock another operation", async () => {
    const minted = await post(handoff("REQUIRE_APPROVAL"));
    const id = minted.json().approvalRequestId as string;
    await decideApprovalRequest(id, {
      decidedBy: OWNER,
      approve: true,
      decisionReason: "ok",
    });
    const other = handoff("REQUIRE_APPROVAL", {
      decision: decision("REQUIRE_APPROVAL", {
        policy: { entityType: "CODE", action: "EXECUTE", riskTier: "APPROVAL" },
      }),
      approvalRequestId: id,
    });
    const res = await post(other);
    expect(res.json().executed).toBe(false);
    expect(res.json().reason).toMatch(/different operation/);
    expect(runs).toBe(0);
  });

  it("ALLOW without execution intent does not invent execution", async () => {
    const res = await post(handoff("ALLOW"));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executed).toBe(false);
    expect(body.status).toBe("STOPPED");
    expect(body.reason).toMatch(/execution intent/);
    expect(runs).toBe(0);
  });

  it("ALLOW with valid authoritative execution intent reaches runGovernedLifecycle", async () => {
    const intent = {
      toolName: "knowledge_search",
      toolArgs: { query: QUERY },
      artifact: ARTIFACT,
      artifactHash: computeGovernedBindingHash({ kind: "query", value: QUERY }, ARTIFACT),
      target: { kind: "query" as const, value: QUERY },
    };
    const agentIdentity = resolveAgentIdentity({
      fabricAgentId: "RESEARCHER",
      sessionOwnerId: OWNER,
      projectId: PROJECT_UUID,
    });
    const result = await acceptGovernedLifecycleHandoff({
      handoff: { ...handoff("ALLOW"), execution: intent },
      projectRoot,
      agentIdentity,
    });
    expect(result.executed).toBe(true);
    expect(result.status).toBe("EXECUTED");
    expect(runs).toBe(1);
  });

  it("HTTP ALLOW with execution intent does not invent a tenant agent", async () => {
    const res = await post({
      ...handoff("ALLOW"),
      execution: {
        toolName: "knowledge_search",
        toolArgs: { query: QUERY },
        artifact: ARTIFACT,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().executed).toBe(false);
    expect(res.json().status).toBe("STOPPED");
    expect(runs).toBe(0);
  });

  it("target mismatch is rejected", async () => {
    const res = await post({
      ...handoff("ALLOW"),
      execution: {
        toolName: "knowledge_search",
        toolArgs: { query: QUERY },
        artifact: ARTIFACT,
        target: { kind: "query", value: "other.ts" },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/target/);
    expect(runs).toBe(0);
  });

  it("artifact / binding-hash mismatch is rejected", async () => {
    const hash = computeGovernedBindingHash({ kind: "query", value: QUERY }, ARTIFACT);
    const artifactMismatch = await post({
      ...handoff("ALLOW"),
      execution: {
        toolName: "knowledge_search",
        toolArgs: { query: QUERY },
        artifact: "different-artifact",
        artifactHash: hash,
      },
    });
    expect(artifactMismatch.statusCode).toBe(403);
    expect(artifactMismatch.json().error.message).toMatch(/hash/);
    const hashMismatch = await post({
      ...handoff("ALLOW"),
      execution: {
        toolName: "knowledge_search",
        toolArgs: { query: QUERY },
        artifact: ARTIFACT,
        artifactHash: "a".repeat(64),
      },
    });
    expect(hashMismatch.statusCode).toBe(403);
    expect(hashMismatch.json().error.message).toMatch(/hash/);
    expect(runs).toBe(0);
  });

  it("duplicate handoff is idempotent", async () => {
    const first = await post(handoff("REQUIRE_APPROVAL"));
    const second = await post(handoff("REQUIRE_APPROVAL"));
    expect(first.json().approvalRequestId).toBe(second.json().approvalRequestId);
    expect(first.json().status).toBe("APPROVAL_REQUIRED");
    expect(second.json().status).toBe("APPROVAL_REQUIRED");
  });
});
