import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiRouter } from "../routes/api.js";
import {
  appendAuditEntry,
  listAuditEntries,
  resetGovernanceStateForTests,
  type AuditEntry,
} from "../services/governance-state.js";
import {
  getRegisteredAgent,
  resetAgentRuntimeForTests,
} from "../services/agent-registry.js";
import { setAtlasSelfControlApprovalVerifier } from "../services/atlas-self-agent-control.js";
import { issueReauthTicket } from "../control-plane-auth.js";
import { resetApplicationRegistryForTests } from "../services/application-registry.js";
import { resetCivioConnectorForTests } from "../services/civio-connector.js";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── Mock helpers ─────────────────────────────────────────────────────────

interface MockResponseData {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function createMockReq(
  method: string,
  url: string,
  options?: { readonly body?: unknown; readonly headers?: Record<string, string> },
): IncomingMessage {
  const payload =
    options?.body !== undefined ? JSON.stringify(options.body) : "";
  let sent = false;
  const readable = new Readable({
    read() {
      if (!sent && payload) {
        sent = true;
        this.push(payload);
      }
      this.push(null);
    },
  }) as IncomingMessage;
  readable.method = method;
  readable.url = url;
  readable.headers = {
    host: "localhost:3100",
    "content-type": "application/json",
    ...options?.headers,
  };
  return readable;
}

function createMockRes(): ServerResponse & { _mock: MockResponseData } {
  const data: MockResponseData = { statusCode: 200, headers: {}, body: "" };
  const mock = {
    _mock: data,
    writeHead(status: number, headers?: Record<string, string>) {
      data.statusCode = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          data.headers[k] = v;
        }
      }
      return mock;
    },
    setHeader(name: string, value: string) {
      data.headers[name] = value;
      return mock;
    },
    end(body?: string) {
      if (body) data.body = body;
      return mock;
    },
    headersSent: false,
  } as unknown as ServerResponse & { _mock: MockResponseData };
  return mock;
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    seq: 1,
    timestamp: new Date().toISOString(),
    type: "test",
    actorId: "TEST_AGENT",
    actorKind: "AGENT",
    reason: "test",
    policy: "RECORD.CREATE",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
    ownerId: "user-1",
    projectId: "project-1",
    hash: "abc",
    prevHash: "000",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Control Plane — API Routes", () => {
  const router = createApiRouter();

  beforeEach(() => {
    resetGovernanceStateForTests();
    resetApplicationRegistryForTests();
    resetAgentRuntimeForTests();
    resetCivioConnectorForTests();
    setAtlasSelfControlApprovalVerifier(null);
  });

  // ── Status ─────────────────────────────────────────────────────────

  describe("GET /api/v1/status", () => {
    it("returns service info", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/status"), res);
      const body = JSON.parse(res._mock.body) as Record<string, unknown>;
      expect(body["service"]).toBe("atlas-control-plane");
      expect(body["status"]).toBe("ok");
      expect(body["version"]).toBe("0.1.0");
      expect(typeof body["timestamp"]).toBe("string");
    });
  });

  describe("GET /api/v1/operational-foundation", () => {
    it("exposes Control operational contracts without inventing live sibling connections", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/operational-foundation"),
        res,
      );
      const body = JSON.parse(res._mock.body) as {
        kind: string;
        parentSurface: string;
        notStudio: boolean;
        liveSiblingConnectors: boolean;
        lifecycle: string[];
        registeredApplicationIds: string[];
        civioConnector: { applicationId: string; atlasIngress: string };
        domains: Array<{ domain: string; live: boolean; status: string }>;
      };
      expect(body.kind).toBe("ATLAS_CONTROL_OPERATIONAL_FOUNDATION");
      expect(body.parentSurface).toBe("ADMIN");
      expect(body.notStudio).toBe(true);
      expect(body.liveSiblingConnectors).toBe(false);
      expect(body.civioConnector.applicationId).toBe("civio");
      expect(body.civioConnector.atlasIngress).toBe("IMPLEMENTED");
      expect(body.lifecycle[0]).toBe("APPLICATION");
      expect(body.lifecycle).toContain("AUDIT");
      expect(body.registeredApplicationIds).toEqual(["def-000"]);
      expect(body.domains.find((d) => d.domain === "processes")?.status).toBe(
        "PARTIAL",
      );
      expect(body.domains.every((d) => d.live === false)).toBe(true);
    });
  });

  describe("GET /api/v1/processes", () => {
    it("returns an empty process contract and does not invent records", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/processes"), res);
      const body = JSON.parse(res._mock.body) as {
        items: unknown[];
        live: boolean;
        note: string;
      };
      expect(body.items).toEqual([]);
      expect(body.live).toBe(false);
      expect(body.note).toContain("process-audit");
    });
  });

  describe("GET /api/v1/supervision", () => {
    it("returns a platform supervision snapshot for Admin, not an agent dump", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/supervision"), res);
      const body = JSON.parse(res._mock.body) as {
        surface: string;
        parentSurface: string;
        role: string;
        metrics: Record<string, number>;
        notes: string[];
      };
      expect(body.surface).toBe("CONTROL");
      expect(body.parentSurface).toBe("ADMIN");
      expect(body.role).toBe("operational_supervision");
      expect(body.metrics["registeredApplications"]).toBe(1);
      expect(body.metrics["oversightAgents"]).toBe(9);
      expect(body.metrics["fabricProjectionAgents"]).toBe(16);
      expect(body.notes.some((note) => note.includes("Not Atlas Admin"))).toBe(
        true,
      );
    });
  });

  // ── Agents ─────────────────────────────────────────────────────────

  describe("GET /api/v1/agents", () => {
    it("returns array of agents", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/agents"), res);
      const body = JSON.parse(res._mock.body) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(9);
    });
  });

  describe("GET /api/v1/agents/:id", () => {
    it("returns specific agent", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/agents/CODE_ENGINEER"),
        res,
      );
      const body = JSON.parse(res._mock.body) as Record<string, unknown>;
      expect(body["agentId"]).toBe("CODE_ENGINEER");
    });

    it("returns 404 for unknown agent", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/agents/NONEXISTENT"),
        res,
      );
      expect(res._mock.statusCode).toBe(404);
    });
  });

  describe("GET /api/v1/agents/stats", () => {
    it("returns registry statistics", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/agents/stats"),
        res,
      );
      const body = JSON.parse(res._mock.body) as Record<string, unknown>;
      expect(typeof body["totalAgents"]).toBe("number");
      expect(typeof body["activeAgents"]).toBe("number");
    });
  });

  describe("GET /api/v1/agents/fabric-projection", () => {
    it("projects FABRIC_AGENT_CATALOG without becoming an execution registry", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/agents/fabric-projection"),
        res,
      );
      const body = JSON.parse(res._mock.body) as {
        kind: string;
        executionAuthority: string;
        notAnExecutionRegistry: boolean;
        defaultCatalogStatus: string;
        items: Array<{ catalogStatus: string; executionEnabledByThisProjection: boolean }>;
      };
      expect(body.kind).toBe("FABRIC_PROJECTION");
      expect(body.executionAuthority).toBe("FABRIC_AGENT_CATALOG");
      expect(body.notAnExecutionRegistry).toBe(true);
      expect(body.defaultCatalogStatus).toBe("LAB");
      expect(body.items).toHaveLength(16);
      expect(body.items.every((item) => item.catalogStatus === "LAB")).toBe(true);
      expect(body.items.every((item) => item.executionEnabledByThisProjection === false)).toBe(true);
    });

    it("does not change GET /api/v1/agents length", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/agents"), res);
      const body = JSON.parse(res._mock.body) as unknown[];
      expect(body.length).toBe(9);
    });
  });

  describe("GET /api/v1/portfolio-governance", () => {
    it("returns observational inventory and does not expand application registry", async () => {
      const portRes = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/portfolio-governance"), portRes);
      const port = JSON.parse(portRes._mock.body) as {
        writeAuthority: string;
        executionRegistry: string;
        notAnAgentRegistry: boolean;
        observational: boolean;
        snapshot: { applications: unknown[]; sourceAgents: unknown[] };
        summary: { ingestEnabled: boolean; knowledgeIngested: boolean };
      };
      expect(port.writeAuthority).toBe("ATLAS_API");
      expect(port.executionRegistry).toBe("FABRIC_AGENT_CATALOG");
      expect(port.notAnAgentRegistry).toBe(true);
      expect(port.observational).toBe(true);
      expect(port.snapshot.applications.length).toBe(7);
      expect(port.snapshot.applications.some((application) => application.slug === "civio")).toBe(true);
      expect(port.snapshot.sourceAgents.length).toBeGreaterThan(0);
      expect(port.summary.ingestEnabled).toBe(false);
      expect(port.summary.knowledgeIngested).toBe(true); // Phase 11.15: 4 Owner-approved records ingested

      const appsRes = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/applications"), appsRes);
      const apps = JSON.parse(appsRes._mock.body) as { items: unknown[] };
      expect(apps.items).toHaveLength(1);
    });
  });

  // ── Audit ──────────────────────────────────────────────────────────

  describe("GET /api/v1/audit", () => {
    it("returns empty array when no entries", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/audit"), res);
      const body = JSON.parse(res._mock.body) as unknown[];
      expect(body).toEqual([]);
    });

    it("returns entries after appending", async () => {
      appendAuditEntry(makeEntry({ seq: 1 }));
      appendAuditEntry(makeEntry({ seq: 2 }));
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/audit"), res);
      const body = JSON.parse(res._mock.body) as unknown[];
      expect(body).toHaveLength(2);
    });

    it("supports query parameter filters", async () => {
      appendAuditEntry(makeEntry({ actorId: "AGENT_A", risk: "HIGH" }));
      appendAuditEntry(makeEntry({ actorId: "AGENT_B", risk: "LOW" }));
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/audit?actorId=AGENT_A"),
        res,
      );
      const body = JSON.parse(res._mock.body) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]?.["actorId"]).toBe("AGENT_A");
    });
  });

  describe("GET /api/v1/audit/count", () => {
    it("returns zero count initially", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/audit/count"),
        res,
      );
      const body = JSON.parse(res._mock.body) as Record<string, unknown>;
      expect(body["count"]).toBe(0);
    });

    it("returns correct count after appending", async () => {
      appendAuditEntry(makeEntry());
      appendAuditEntry(makeEntry());
      appendAuditEntry(makeEntry());
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/audit/count"),
        res,
      );
      const body = JSON.parse(res._mock.body) as Record<string, unknown>;
      expect(body["count"]).toBe(3);
    });
  });

  // ── Policies ──────────────────────────────────────────────────────

  describe("GET /api/v1/policies", () => {
    it("returns array of policies", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/policies"), res);
      const body = JSON.parse(res._mock.body) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe("GET /api/v1/policies/:entityType/:action", () => {
    it("returns specific policy", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/policies/DOCUMENT/READ"),
        res,
      );
      const body = JSON.parse(res._mock.body) as Record<string, unknown>;
      expect(body["entityType"]).toBe("DOCUMENT");
      expect(body["action"]).toBe("READ");
      expect(body["riskTier"]).toBe("AUTO_LOG");
    });

    it("returns 404 for unknown policy", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/policies/UNKNOWN/UNKNOWN"),
        res,
      );
      expect(res._mock.statusCode).toBe(404);
    });
  });

  // ── Approvals ─────────────────────────────────────────────────────

  describe("GET /api/v1/approvals", () => {
    it("returns empty array initially", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("GET", "/api/v1/approvals"),
        res,
      );
      const body = JSON.parse(res._mock.body) as unknown[];
      expect(body).toEqual([]);
    });
  });

  // ── Health ─────────────────────────────────────────────────────────

  describe("GET /api/v1/health", () => {
    it("returns health metrics", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/health"), res);
      const body = JSON.parse(res._mock.body) as Record<string, unknown>;
      expect(typeof body["uptimeMs"]).toBe("number");
      expect(typeof body["totalExecutions"]).toBe("number");
      expect(typeof body["successfulExecutions"]).toBe("number");
      expect(typeof body["failedExecutions"]).toBe("number");
    });
  });

  describe("GET /api/v1/applications", () => {
    it("includes DEF-000 as a generic managed application", async () => {
      const res = createMockRes();
      await router.handle(createMockReq("GET", "/api/v1/applications"), res);
      const body = JSON.parse(res._mock.body) as { items: Array<{ applicationId: string }> };
      expect(body.items.some((item) => item.applicationId === "def-000")).toBe(true);
    });
  });

  describe("POST /api/v1/gateway/ops", () => {
    it("requires X-Atlas-Reason", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/gateway/ops", {
          body: { operation: "inspect", applicationId: "def-000" },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(400);
    });

    it("inspects through the gateway when a reason is supplied", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/gateway/ops", {
          body: { operation: "inspect", applicationId: "def-000" },
          headers: { "x-atlas-reason": "owner inspect def-000" },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(200);
      const body = JSON.parse(res._mock.body) as {
        decision: string;
        principalId: string;
      };
      expect(body.decision).toBe("ALLOW");
      expect(body.principalId).toBe("cp:service");
    });

    it("ignores body.actorId so a caller cannot impersonate atlas-owner", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/gateway/ops", {
          body: {
            operation: "inspect",
            applicationId: "def-000",
            actorId: "atlas-owner",
          },
          headers: { "x-atlas-reason": "forged owner inspect" },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(200);
      const body = JSON.parse(res._mock.body) as { principalId: string };
      expect(body.principalId).toBe("cp:service");
      expect(body.principalId).not.toBe("atlas-owner");
    });

    it("refuses a write op without re-authentication", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/gateway/ops", {
          body: {
            operation: "request_agent_run",
            applicationId: "def-000",
            agentId: "CODE_ENGINEER",
            actorId: "owner",
          },
          headers: { "x-atlas-reason": "run agent without reauth" },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(403);
    });

    it("does not treat body approved:true as Atlas-self write authorization", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/gateway/ops", {
          body: {
            operation: "request_agent_run",
            applicationId: "def-000",
            agentId: "CODE_ENGINEER",
            approved: true,
            verificationPlanPresent: true,
          },
          headers: {
            "x-atlas-reason": "self authorize atlas",
            "x-atlas-reauth": "forged",
          },
        }),
        res,
      );
      // Missing/invalid reauth still DENY; even with a ticket, approved:true
      // cannot become independent approval (see atlas-gateway tests).
      expect(res._mock.statusCode).toBe(403);
      const body = JSON.parse(res._mock.body) as { executed?: boolean };
      expect(body.executed).not.toBe(true);
    });
  });

  describe("POST /api/v1/agents/:id/control", () => {
    it("does not mutate Atlas-self agent overlay without independent approval", async () => {
      const ticket = issueReauthTicket();
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/agents/CODE_ENGINEER/control", {
          body: { action: "pause", approved: true },
          headers: {
            "x-atlas-reason": "pause fabric agent now",
            "x-atlas-reauth": ticket.ticket,
          },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(202);
      const body = JSON.parse(res._mock.body) as {
        decision: string;
        executed: boolean;
        applicationId: string;
      };
      expect(body.decision).toBe("REQUIRE_APPROVAL");
      expect(body.executed).toBe(false);
      expect(body.applicationId).toBe("def-000");
      expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe("ACTIVE");
    });

    it("denies control without re-authentication", async () => {
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/agents/CODE_ENGINEER/control", {
          body: { action: "pause" },
          headers: { "x-atlas-reason": "pause fabric agent now" },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(401);
      expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe("ACTIVE");
    });

    it("applies overlay after an independently verified approval", async () => {
      setAtlasSelfControlApprovalVerifier(
        (input) =>
          input.approvalId === "22222222-2222-4222-8222-222222222222" &&
          input.agentId === "CODE_ENGINEER" &&
          input.action === "pause",
      );
      const ticket = issueReauthTicket();
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/agents/CODE_ENGINEER/control", {
          body: {
            action: "pause",
            approvalId: "22222222-2222-4222-8222-222222222222",
          },
          headers: {
            "x-atlas-reason": "pause after independent approval",
            "x-atlas-reauth": ticket.ticket,
          },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(200);
      const body = JSON.parse(res._mock.body) as {
        executed: boolean;
        verified: boolean;
        applicationId: string;
      };
      expect(body.executed).toBe(true);
      expect(body.verified).toBe(false);
      expect(body.applicationId).toBe("def-000");
      expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe("PAUSED");
    });

    afterEach(() => {
      delete process.env["ATLAS_API_URL"];
      delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
      vi.unstubAllGlobals();
    });

    it("production verifier fail-closes when the API is down; overlay unchanged", async () => {
      process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
      process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("API unavailable");
        }),
      );
      const ticket = issueReauthTicket();
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/agents/CODE_ENGINEER/control", {
          body: {
            action: "pause",
            approvalId: "11111111-1111-4111-8111-111111111111",
          },
          headers: {
            "x-atlas-reason": "pause after network failure",
            "x-atlas-reauth": ticket.ticket,
          },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(202);
      expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe("ACTIVE");
    });

    it("production verifier applies overlay only after API verified:true and records approvalId", async () => {
      process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
      process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
      const approvalId = "33333333-3333-4333-8333-333333333333";
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toContain("/api/v1/approvals/verify-atlas-self");
        const body = JSON.parse(String(init?.body)) as {
          approvalId: string;
          agentId: string;
          action: string;
        };
        expect(body.approvalId).toBe(approvalId);
        expect(body.agentId).toBe("CODE_ENGINEER");
        expect(body.action).toBe("pause");
        const headers = init?.headers as Record<string, string>;
        expect(headers.authorization).toBe("Bearer cp-token");
        return new Response(
          JSON.stringify({
            verified: true,
            reason: "independent Atlas-self approval verified",
            approvalId,
          }),
          { status: 200 },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const ticket = issueReauthTicket();
      const res = createMockRes();
      await router.handle(
        createMockReq("POST", "/api/v1/agents/CODE_ENGINEER/control", {
          body: { action: "pause", approvalId },
          headers: {
            "x-atlas-reason": "pause after live API verify",
            "x-atlas-reauth": ticket.ticket,
          },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(200);
      expect(fetchMock).toHaveBeenCalled();
      const body = JSON.parse(res._mock.body) as {
        executed: boolean;
        verified: boolean;
        approvalId: string;
      };
      expect(body.executed).toBe(true);
      expect(body.verified).toBe(false);
      expect(body.approvalId).toBe(approvalId);
      expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe("PAUSED");
      expect(
        listAuditEntries().some(
          (entry) =>
            entry.type === "atlas-self.agent.control" &&
            entry.reason.includes(approvalId),
        ),
      ).toBe(true);
    });
  });

  // ── 404 for unknown routes ────────────────────────────────────────

  describe("unknown routes", () => {
    it("returns false (unhandled) for unknown path", async () => {
      const res = createMockRes();
      const handled = await router.handle(
        createMockReq("GET", "/api/v1/nonexistent"),
        res,
      );
      expect(handled).toBe(false);
    });
  });
});
