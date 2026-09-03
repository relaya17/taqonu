import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupervisedGovernanceDecision } from "./supervised-governance.js";
import { handoffGovernedDecisionToApi } from "./lifecycle-handoff.js";

const decision: SupervisedGovernanceDecision = {
  decision: "ALLOW",
  reason: "DOCUMENT.READ observe",
  evaluatedAt: "2026-09-03T12:00:00.000Z",
  tenantId: "tenant-alpha",
  projectId: "project-alpha",
  applicationId: "civio",
  processId: "proc-1",
  eventId: "evt-1",
  eventType: "civio.rights.answered",
  correlationId: "corr-1",
  requestId: "req-1",
  connectorId: "atlas-civio-connector",
  policy: {
    entityType: "DOCUMENT",
    action: "READ",
    riskTier: "AUTO_LOG",
    requiresApproval: false,
    description: "observe",
  },
  risk: { status: "EVALUATED", tier: "AUTO_LOG" },
  cycle: { blockedAt: null, stagesPassed: ["IDENTITY"], executed: false },
};

describe("Control Plane lifecycle handoff", () => {
  afterEach(() => {
    delete process.env["ATLAS_API_URL"];
    delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    vi.unstubAllGlobals();
  });

  it("skips when the Control Plane service token is unset", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    const result = await handoffGovernedDecisionToApi(decision);
    expect(result.status).toBe("NOT_ATTEMPTED");
  });

  it("skips when API URL is unset and does not execute locally", async () => {
    delete process.env["ATLAS_API_URL"];
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "token";
    const result = await handoffGovernedDecisionToApi(decision);
    expect(result.status).toBe("NOT_ATTEMPTED");
    expect(result.executed).toBeUndefined();
  });

  it("records HANDOFF_FAILED when the API rejects authentication", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:3999";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "unauthorized" } }), {
          status: 401,
        }),
      ),
    );
    const result = await handoffGovernedDecisionToApi(decision);
    expect(result.status).toBe("HANDOFF_FAILED");
    expect(result.reason).toMatch(/unauthorized/i);
  });

  it("posts the Phase 9 identity to the API without execution intent", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "token";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        execution?: unknown;
        identity: { eventId: string };
        decision: { decision: string };
      };
      const headers = init?.headers as Record<string, string>;
      expect(body.execution).toBeUndefined();
      expect(body.identity.eventId).toBe("evt-1");
      expect(body.decision.decision).toBe("ALLOW");
      expect(headers.authorization).toBe("Bearer token");
      expect(headers["x-idempotency-key"]).toBe("lifecycle:tenant-alpha:civio:evt-1");
      return new Response(
        JSON.stringify({
          status: "STOPPED",
          executed: false,
          reason: "No authoritative execution intent — ALLOW is not EXECUTED",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await handoffGovernedDecisionToApi(decision);
    expect(result.status).toBe("HANDED_OFF");
    expect(result.executed).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
