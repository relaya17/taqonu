import { describe, expect, it, beforeEach } from "vitest";
import { createApiRouter } from "../routes/api.js";
import {
  appendAuditEntry,
  resetGovernanceStateForTests,
  type AuditEntry,
} from "../services/governance-state.js";
import { resetAgentRuntimeForTests } from "../services/agent-registry.js";
import { resetApplicationRegistryForTests } from "../services/application-registry.js";
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
          body: { operation: "inspect", applicationId: "def-000", actorId: "owner" },
          headers: { "x-atlas-reason": "owner inspect def-000" },
        }),
        res,
      );
      expect(res._mock.statusCode).toBe(200);
      const body = JSON.parse(res._mock.body) as { decision: string };
      expect(body.decision).toBe("ALLOW");
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
