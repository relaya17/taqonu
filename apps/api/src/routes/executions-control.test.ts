import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { EXECUTION_CONTROL_PATH, agentRunSchema } from "@atlas/shared";
import { buildRouteTestApp } from "./test-helpers/build-route-test-app.js";
import { visibilityForAgentRunStatus } from "./executions-control.js";

const CP_TOKEN = "execution-control-cp-token-32chars!!";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-execution-control-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { osStore } = await import("../store/os-store.js");
const { registerExecutionControlRoutes } = await import("./executions-control.js");

let app: FastifyInstance;

beforeAll(async () => {
  process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;
  app = await buildRouteTestApp(registerExecutionControlRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
});

afterEach(() => {
  osStore.unloadForTests();
});

describe("visibilityForAgentRunStatus", () => {
  it("maps canonical run statuses onto operator-facing visibility", () => {
    expect(visibilityForAgentRunStatus("QUEUED")).toBe("active");
    expect(visibilityForAgentRunStatus("RUNNING")).toBe("active");
    expect(visibilityForAgentRunStatus("SUCCEEDED")).toBe("completed");
    expect(visibilityForAgentRunStatus("FAILED")).toBe("failed");
    expect(visibilityForAgentRunStatus("AWAITING_APPROVAL")).toBe("blocked");
    expect(visibilityForAgentRunStatus("CANCELLED")).toBe("paused");
  });
});

describe("GET canonical executions (CP SERVICE)", () => {
  it("401s without a Control Plane service token", async () => {
    const res = await app.inject({ method: "GET", url: EXECUTION_CONTROL_PATH });
    expect(res.statusCode).toBe(401);
  });

  it("returns mapped live runs for a valid Control Plane service token", async () => {
    const now = new Date().toISOString();
    osStore.addAgentRun(
      agentRunSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        projectId: null,
        mode: "READ",
        status: "RUNNING",
        userRequest: "inspect the current project",
        answer: null,
        epistemicState: null,
        startedAt: now,
        completedAt: null,
        createdBy: "owner-1",
      }),
    );
    osStore.addAgentRun(
      agentRunSchema.parse({
        id: "22222222-2222-4222-8222-222222222222",
        projectId: null,
        mode: "PLAN",
        status: "AWAITING_APPROVAL",
        userRequest: "apply a protected patch",
        answer: null,
        epistemicState: null,
        startedAt: now,
        completedAt: null,
        createdBy: "owner-1",
      }),
    );
    const res = await app.inject({
      method: "GET",
      url: EXECUTION_CONTROL_PATH,
      headers: { authorization: `Bearer ${CP_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string; visibility: string; status: string }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.items.find((item) => item.status === "RUNNING")?.visibility).toBe(
      "active",
    );
    expect(
      body.items.find((item) => item.status === "AWAITING_APPROVAL")?.visibility,
    ).toBe("blocked");
  });
});
