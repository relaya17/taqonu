import { expect, test, type APIRequestContext } from "@playwright/test";
import { stage9ApiBase, stage9MutationHeaders } from "../stage9/local-api";
import { createStage9Project } from "../stage9/projects";

/**
 * ArletOS <-> Control, against a REAL Control Plane process (no mock).
 *
 * The subject is ArletOS: does it connect to Control, register its agents
 * there, honour Control's registration decision when dispatching, and fail
 * closed when Control is unavailable. Control's own internals are not under
 * test. Run with `STAGE9_CONTROL=1 pnpm exec playwright test --project=control`
 * (the config starts the Control Plane through e2e/control/control-supervisor.mjs).
 */
const CONTROL = "http://127.0.0.1:3100";
const ADMIN = "http://127.0.0.1:3199";
const SPECIALISTS = ["SECURITY", "LEGAL_MEDIA_COMMS", "CODE_ENGINEER", "RESEARCHER"] as const;

const enabled = process.env.STAGE9_CONTROL === "1";
const token = process.env.STAGE9_CONTROL_TOKEN ?? "";

interface Registration {
  readonly agentId: string;
  readonly status: string;
  readonly registrationSource: string;
  readonly registeredBy: string;
  readonly ownerId: string | null;
}

interface DispatchRun {
  readonly agentId: string;
  readonly status: string;
  readonly summary: string;
}

const bearer = () => ({ authorization: `Bearer ${token}` });

/**
 * Control's registration record for one agent, or null when it answers 404 (not registered).
 * The agent id is put in the path as is: Control's router does not percent-decode path
 * parameters, so `psa%3A<id>` is answered 404 while `psa:<id>` finds the record. That is
 * a Control-side behaviour; the ids ArletOS looks up itself (the four specialists) contain
 * nothing that needs encoding.
 */
async function registration(
  request: APIRequestContext,
  agentId: string,
  ownerId?: string,
): Promise<Registration | null> {
  const query = ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : "";
  const res = await request.get(`${CONTROL}/api/v1/agents/${agentId}/registration${query}`, {
    headers: bearer(),
  });
  if (res.status() === 404) return null;
  expect(res.status()).toBe(200);
  return (await res.json()) as Registration;
}

async function dispatch(request: APIRequestContext, agentId: string): Promise<DispatchRun> {
  const res = await request.post(`${stage9ApiBase()}/api/v1/agents/dispatch`, {
    data: { request: "Control integration check", agentIds: [agentId] },
    headers: stage9MutationHeaders(),
    timeout: 90_000,
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { runs: DispatchRun[] };
  const run = body.runs.find((r) => r.agentId === agentId);
  expect(run, `no run returned for ${agentId}`).toBeTruthy();
  return run!;
}

async function supervisor(request: APIRequestContext, action: "start" | "stop" | "reset"): Promise<void> {
  const res = await request.post(`${ADMIN}/${action}`, { timeout: 90_000 });
  expect(res.ok()).toBe(true);
}

test.describe.configure({ mode: "serial" });

test.describe("ArletOS <-> Control (real Control Plane)", () => {
  test.setTimeout(180_000);

  test.beforeEach(() => {
    test.skip(
      !enabled || token === "",
      "BLOCKED (environment): needs STAGE9_CONTROL=1 so the config starts a real Control Plane. Not a product failure.",
    );
  });

  test("ArletOS connects to Control: the token is enforced and the API registered its specialists at start-up", async ({
    request,
  }) => {
    const unauthenticated = await request.post(`${CONTROL}/api/v1/agents/register`, {
      data: {
        agentId: "NOT_ALLOWED",
        registrationSource: "DYNAMIC_API",
        evidence: "unauthenticated attempt",
        registeredBy: "e2e",
      },
    });
    expect([401, 403]).toContain(unauthenticated.status());

    for (const agentId of SPECIALISTS) {
      await expect
        .poll(async () => (await registration(request, agentId))?.status ?? "NOT_REGISTERED", {
          message: `${agentId} is not registered in Control`,
          timeout: 30_000,
        })
        .toBe("CONTROL_REGISTERED");
      const record = await registration(request, agentId);
      expect(record!.registrationSource).toBe("STATIC_CATALOG");
      expect(record!.registeredBy).toBe("atlas-api-bootstrap");
    }
  });

  test("ArletOS honours a registered decision: a registered specialist passes the registration gate", async ({
    request,
  }) => {
    const run = await dispatch(request, "SECURITY");
    expect(run.summary).not.toMatch(/^CONTROL_/);
  });

  test("the Personal Agent is registered in Control for its owner only", async ({ request }) => {
    const project = await createStage9Project(request, `Control PSA ${Date.now()}`);
    const session = await request.get(`${stage9ApiBase()}/api/v1/auth/session`);
    const userId = ((await session.json()) as { user: { id: string } | null }).user?.id;
    expect(userId).toBeTruthy();

    const ensure = await request.post(`${stage9ApiBase()}/api/v1/supervising-agent`, {
      data: { tenantId: "user-plane", projectIds: [project.id], applicationIds: ["def-000"] },
      headers: stage9MutationHeaders(),
    });
    expect(ensure.ok()).toBe(true);

    await expect
      .poll(async () => (await registration(request, `psa:${userId}`, userId!))?.status ?? "NOT_REGISTERED", {
        message: "the PSA was not registered in Control",
        timeout: 20_000,
      })
      .toBe("CONTROL_REGISTERED");
    const own = await registration(request, `psa:${userId}`, userId!);
    expect(own?.ownerId).toBe(userId);
    expect(await registration(request, `psa:${userId}`, "someone-else")).toBeNull();
  });

  test("ArletOS fails closed when Control is unavailable, and recovers without a restart when it returns", async ({
    request,
  }) => {
    await supervisor(request, "stop");
    const blocked = await dispatch(request, "SECURITY");
    expect(blocked.status).toBe("SKIPPED");
    expect(blocked.summary).toMatch(/CONTROL_UNREACHABLE/);

    const health = await request.get(`${stage9ApiBase()}/api/v1/health`);
    expect(health.ok()).toBe(true);

    await supervisor(request, "start");
    const recovered = await dispatch(request, "SECURITY");
    expect(recovered.summary).not.toMatch(/^CONTROL_/);
  });

  test("registrations survive a Control restart (persistent registry)", async ({ request }) => {
    const before = await Promise.all(SPECIALISTS.map((id) => registration(request, id)));
    expect(before.every((r) => r?.status === "CONTROL_REGISTERED")).toBe(true);
    await supervisor(request, "stop");
    await supervisor(request, "start");
    for (const agentId of SPECIALISTS) {
      expect((await registration(request, agentId))?.status).toBe("CONTROL_REGISTERED");
    }
  });

  test("ArletOS denies a specialist that Control does not have registered", async ({ request }) => {
    await supervisor(request, "reset");
    expect(await registration(request, "SECURITY")).toBeNull();
    const denied = await dispatch(request, "SECURITY");
    expect(denied.status).toBe("SKIPPED");
    expect(denied.summary).toMatch(/CONTROL_NOT_REGISTERED/);
  });
});
