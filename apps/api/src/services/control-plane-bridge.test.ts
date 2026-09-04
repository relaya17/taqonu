import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupControlPlaneAgentRuntimeStatus } from "./control-plane-bridge.js";

describe("lookupControlPlaneAgentRuntimeStatus", () => {
  afterEach(() => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    vi.unstubAllGlobals();
  });

  it("is not configured when the Control Plane URL is unset", async () => {
    delete process.env.ATLAS_CONTROL_PLANE_URL;
    const result = await lookupControlPlaneAgentRuntimeStatus("CODE_ENGINEER");
    expect(result).toEqual({ configured: false });
  });

  it("fail-closes as UNKNOWN when the URL is set but the hop fails", async () => {
    process.env.ATLAS_CONTROL_PLANE_URL = "http://127.0.0.1:3100";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    const result = await lookupControlPlaneAgentRuntimeStatus("CODE_ENGINEER");
    expect(result).toEqual({ configured: true, status: "UNKNOWN" });
  });

  it("treats a missing oversight overlay as ACTIVE", async () => {
    process.env.ATLAS_CONTROL_PLANE_URL = "http://127.0.0.1:3100";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })),
    );
    const result = await lookupControlPlaneAgentRuntimeStatus("RESEARCHER");
    expect(result).toEqual({ configured: true, status: "ACTIVE" });
  });

  it("returns the Control Plane overlay status when present", async () => {
    process.env.ATLAS_CONTROL_PLANE_URL = "http://127.0.0.1:3100";
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ agentId: "CODE_ENGINEER", status: "QUARANTINED" }), {
          status: 200,
        }),
      ),
    );
    const result = await lookupControlPlaneAgentRuntimeStatus("CODE_ENGINEER");
    expect(result).toEqual({ configured: true, status: "QUARANTINED" });
  });
});
