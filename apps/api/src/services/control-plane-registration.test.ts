import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  registerSpecialistAgentsWithControl,
  registerPsaWithControl,
} from "./control-plane-registration.js";

// ── Local mock HTTP server helper ─────────────────────────────────────────

interface MockServer {
  server: http.Server;
  origin: string;
  registrations: unknown[];
}

function createMockControlPlane(statusCode = 200): Promise<MockServer> {
  const registrations: unknown[] = [];
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/agents/register") {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body) as unknown;
            registrations.push(parsed);
            const b = parsed as Record<string, unknown>;
            const idempotencyKey = b["ownerId"]
              ? `${String(b["agentId"])}::owner::${String(b["ownerId"])}`
              : String(b["agentId"]);
            const record = {
              agentId: b["agentId"],
              registrationSource: b["registrationSource"],
              ownerId: b["ownerId"] ?? null,
              registeredAt: new Date().toISOString(),
              registeredBy: b["registeredBy"],
              evidence: b["evidence"],
              status: "CONTROL_REGISTERED",
              idempotencyKey,
            };
            res.writeHead(statusCode, { "content-type": "application/json" });
            res.end(JSON.stringify(record));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "bad json" }));
          }
        });
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no listen address"));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}`, registrations });
    });
  });
}

function closeMock(mock: MockServer): Promise<void> {
  return new Promise((resolve, reject) => mock.server.close((e) => e ? reject(e) : resolve()));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("registerSpecialistAgentsWithControl()", () => {
  const mocks: MockServer[] = [];

  afterEach(async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    await Promise.all(mocks.splice(0).map(closeMock));
  });

  it("returns not-registered for all agents when Control Plane is not configured", async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    const results = await registerSpecialistAgentsWithControl();
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.registered).toBe(false);
    }
  });

  it("registers SECURITY, LEGAL_MEDIA_COMMS, CODE_ENGINEER, RESEARCHER via POST", async () => {
    const mock = await createMockControlPlane();
    mocks.push(mock);
    process.env.ATLAS_CONTROL_PLANE_URL = mock.origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "test-token";

    const results = await registerSpecialistAgentsWithControl();
    expect(results).toHaveLength(4);

    const agentIds = results.map((r) => r.agentId);
    expect(agentIds).toContain("SECURITY");
    expect(agentIds).toContain("LEGAL_MEDIA_COMMS");
    expect(agentIds).toContain("CODE_ENGINEER");
    expect(agentIds).toContain("RESEARCHER");

    for (const r of results) {
      expect(r.registered).toBe(true);
      if (r.registered) {
        expect(r.record.status).toBe("CONTROL_REGISTERED");
      }
    }
  });

  it("is safe to call multiple times (idempotent on the caller side)", async () => {
    const mock = await createMockControlPlane();
    mocks.push(mock);
    process.env.ATLAS_CONTROL_PLANE_URL = mock.origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "test-token";

    const first = await registerSpecialistAgentsWithControl();
    const second = await registerSpecialistAgentsWithControl();
    // Both calls succeed — the mock doesn't deduplicate but the function
    // itself is stateless (dedup is on Control side); both return registered:true
    expect(first.every((r) => r.registered)).toBe(true);
    expect(second.every((r) => r.registered)).toBe(true);
  });

  it("marks agents as not-registered when Control returns non-2xx", async () => {
    const mock = await createMockControlPlane(500);
    mocks.push(mock);
    process.env.ATLAS_CONTROL_PLANE_URL = mock.origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "test-token";

    const results = await registerSpecialistAgentsWithControl();
    for (const r of results) {
      expect(r.registered).toBe(false);
    }
  });

  it("handles Control Plane network failure gracefully (fail-open)", async () => {
    // Port 1 is unreachable
    process.env.ATLAS_CONTROL_PLANE_URL = "http://127.0.0.1:1";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "test-token";

    const results = await registerSpecialistAgentsWithControl();
    for (const r of results) {
      expect(r.registered).toBe(false);
      if (!r.registered) {
        expect(r.reason).toBeTruthy();
      }
    }
  });
});

describe("registerPsaWithControl()", () => {
  const mocks: MockServer[] = [];

  afterEach(async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    await Promise.all(mocks.splice(0).map(closeMock));
  });

  it("returns null when Control Plane is not configured", async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    const result = await registerPsaWithControl("owner-123");
    expect(result).toBeNull();
  });

  it("registers PSA with psa:<ownerId> identity", async () => {
    const mock = await createMockControlPlane();
    mocks.push(mock);
    process.env.ATLAS_CONTROL_PLANE_URL = mock.origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "test-token";

    const ownerId = "owner-abc-456";
    const record = await registerPsaWithControl(ownerId);
    expect(record).not.toBeNull();
    expect(record?.agentId).toBe(`psa:${ownerId}`);
    expect(record?.registrationSource).toBe("PSA_OWNER");
    expect(record?.ownerId).toBe(ownerId);
    expect(record?.status).toBe("CONTROL_REGISTERED");
  });

  it("deterministic PSA identity — same ownerId → same agentId", async () => {
    const mock = await createMockControlPlane();
    mocks.push(mock);
    process.env.ATLAS_CONTROL_PLANE_URL = mock.origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "test-token";

    const ownerId = "stable-owner-789";
    const first = await registerPsaWithControl(ownerId);
    const second = await registerPsaWithControl(ownerId);
    expect(first?.agentId).toBe(`psa:${ownerId}`);
    expect(second?.agentId).toBe(`psa:${ownerId}`);
  });

  it("owner isolation — PSA owner A != owner B (different agentIds)", async () => {
    const mock = await createMockControlPlane();
    mocks.push(mock);
    process.env.ATLAS_CONTROL_PLANE_URL = mock.origin;
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "test-token";

    const recA = await registerPsaWithControl("owner-A");
    const recB = await registerPsaWithControl("owner-B");
    expect(recA?.agentId).toBe("psa:owner-A");
    expect(recB?.agentId).toBe("psa:owner-B");
    expect(recA?.agentId).not.toBe(recB?.agentId);
    expect(recA?.ownerId).not.toBe(recB?.ownerId);
  });

  it("returns null gracefully on network failure (fail-open)", async () => {
    process.env.ATLAS_CONTROL_PLANE_URL = "http://127.0.0.1:1";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "test-token";

    const result = await registerPsaWithControl("owner-net-failure");
    expect(result).toBeNull();
  });
});
