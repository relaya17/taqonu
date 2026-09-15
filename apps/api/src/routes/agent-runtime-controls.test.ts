import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AGENT_RUNTIME_CONTROL_PATH } from "@atlas/shared";
import {
  AgentRuntimeControlRepository,
  type AgentRuntimeControlRecord,
  type AgentRuntimeControlStore,
} from "@atlas/database";
import {
  clearAgentRuntimeControlStoreForTests,
  configureAgentRuntimeControlStore,
} from "../services/agent-runtime-controls.js";
import { registerAgentRuntimeControlRoutes } from "./agent-runtime-controls.js";
import { buildRouteTestApp } from "./test-helpers/build-route-test-app.js";

const CP_TOKEN = "control-plane-operator-token-32chars!!";

function createInMemoryAgentRuntimeControlStore(): AgentRuntimeControlStore {
  const rows = new Map<string, AgentRuntimeControlRecord>();
  return {
    async get(agentId) {
      return rows.get(agentId) ?? null;
    },
    async upsert(record) {
      rows.set(record.agentId, record);
      return record;
    },
    async clear(agentId) {
      rows.delete(agentId);
    },
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "CODE_ENGINEER",
    status: "PAUSED",
    setBy: "owner-1",
    reason: "route-level test",
    ...overrides,
  };
}

describe("agent runtime control routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;
    configureAgentRuntimeControlStore(
      new AgentRuntimeControlRepository(createInMemoryAgentRuntimeControlStore()),
    );
    app = await buildRouteTestApp(registerAgentRuntimeControlRoutes);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    clearAgentRuntimeControlStoreForTests();
  });

  function post(body: Record<string, unknown>, token: string = CP_TOKEN) {
    return app.inject({
      method: "POST",
      url: AGENT_RUNTIME_CONTROL_PATH,
      headers: {
        authorization: token ? `Bearer ${token}` : "",
        "content-type": "application/json",
      },
      payload: body,
    });
  }

  function del(agentId: string, token: string = CP_TOKEN) {
    return app.inject({
      method: "DELETE",
      url: `${AGENT_RUNTIME_CONTROL_PATH}/${agentId}`,
      headers: {
        authorization: token ? `Bearer ${token}` : "",
      },
    });
  }

  it("valid POST succeeds and returns the stored record", async () => {
    const res = await post(validBody());
    expect(res.statusCode).toBe(200);
    expect(res.json().record).toMatchObject({
      agentId: "CODE_ENGINEER",
      status: "PAUSED",
      setBy: "owner-1",
      reason: "route-level test",
      expiresAt: null,
    });
  });

  it("malformed POST returns 400", async () => {
    // Missing status/setBy/reason -- fails setBodySchema validation before
    // the store is ever reached.
    const res = await post({ agentId: "CODE_ENGINEER" });
    expect(res.statusCode).toBe(400);
  });

  it("POST without valid Control Plane service authentication is rejected", async () => {
    const missing = await post(validBody(), "");
    expect(missing.statusCode).toBe(401);
    const wrong = await post(validBody(), "not-the-token");
    expect(wrong.statusCode).toBe(401);
  });

  it("valid DELETE succeeds", async () => {
    await post(validBody());
    const res = await del("CODE_ENGINEER");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cleared: true });
  });

  it("DELETE without valid Control Plane service authentication is rejected", async () => {
    const res = await del("CODE_ENGINEER", "");
    expect(res.statusCode).toBe(401);
  });
});
