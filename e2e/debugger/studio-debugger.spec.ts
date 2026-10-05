import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { ensureStage9Account } from "../stage9/accounts";
import { stage9ApiBase, stage9MutationHeaders } from "../stage9/local-api";
import { createStage9Project, linkWorkspaceRoot, studioProjectUrl } from "../stage9/projects";

/**
 * Studio Debugger product path, in a real browser:
 *
 *   User -> Studio UI -> Debug Session -> authorization -> CDP -> real Node
 *   target -> result -> Studio UI -> audit/evidence
 *
 * Runs against the real Next.js Studio and the real API app (see
 * playwright.debugger.config.ts and e2e/debugger/harness-api.ts). The target is
 * a real `node --inspect-brk` process whose own files prove whether it is
 * paused or running. Local/test only.
 */
const CONTROL = "http://127.0.0.1:4101";
const PASSWORD = "Debugger-E2E-Local-Only!";

interface Fixture {
  readonly projectId: string;
  readonly userId: string;
  readonly started: string;
  readonly ticks: string;
}

async function control(request: APIRequestContext, path: string, body: unknown) {
  const res = await request.post(`${CONTROL}${path}`, { data: body });
  expect(res.ok()).toBe(true);
}

async function audit(request: APIRequestContext, sessionId: string): Promise<Array<Record<string, unknown>>> {
  const res = await request.get(`${CONTROL}/audit?sessionId=${sessionId}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { entries: Array<Record<string, unknown>> }).entries;
}

/**
 * The target rewrites this file every 50 ms (truncate, then write), so a read can land between the
 * two and see it empty. An empty read is not a tick count: re-read instead of reporting 0.
 */
function readTicks(file: string): number {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!existsSync(file)) return 0;
    const text = readFileSync(file, "utf8");
    if (text.length > 0) return Number(text);
  }
  return Number.NaN;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function prepare(context: BrowserContext): Promise<Fixture> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const account = await ensureStage9Account(context, {
    key: "requester",
    email: `debugger-e2e-${stamp}@atlas.test`,
    password: PASSWORD,
    displayName: "Debugger E2E",
  });
  const request = context.request;
  const project = await createStage9Project(request, `Debugger E2E ${stamp}`);

  const root = await mkdtemp(join(tmpdir(), "atlas-debugger-e2e-ws-"));
  const started = join(root, "started.txt");
  const ticks = join(root, "ticks.txt");
  await writeFile(
    join(root, "script.js"),
    [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(started)}, "1");`,
      "let n = 0;",
      `setInterval(() => { n += 1; fs.writeFileSync(${JSON.stringify(ticks)}, String(n)); }, 50);`,
      "",
    ].join("\n"),
    "utf8",
  );
  await linkWorkspaceRoot(request, project.id, root);

  // The test classifies ITS project through the existing in-process P2 test seam.
  await control(request, "/classify", { projectId: project.id, tier: "DEVELOPMENT" });

  // The Debugger is an official extension: install, enable for the project, grant its permission.
  const api = stage9ApiBase();
  const headers = stage9MutationHeaders();
  for (const [method, url, data] of [
    ["post", `${api}/api/v1/studio/extensions/arletos.debugger/install`, {}],
    ["post", `${api}/api/v1/projects/${project.id}/studio/extensions/arletos.debugger/enable`, {}],
    ["post", `${api}/api/v1/studio/extensions/arletos.debugger/permissions`, { grant: ["debug.governed"] }],
  ] as const) {
    const res = await request[method](url, { data, headers });
    // 409 = already installed from an earlier run for this (fresh) user is not expected; any other failure is real.
    expect([200, 201, 409]).toContain(res.status());
  }
  return { projectId: project.id, userId: account.id, started, ticks };
}

async function openDebugger(page: Page, projectId: string): Promise<void> {
  await page.goto(studioProjectUrl(projectId), { waitUntil: "domcontentloaded" });
  const bar = page.getByRole("toolbar", { name: "Activity bar" });
  await expect(bar).toBeVisible({ timeout: 90_000 });
  await bar.getByRole("button", { name: "Debugger", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Debug target" })).toBeVisible({ timeout: 30_000 });
}

async function startSession(page: Page): Promise<string> {
  const target = page.getByRole("combobox", { name: "Debug target" });
  await target.click();
  await page.getByRole("option", { name: "debug.node-script" }).click();
  await page.getByLabel("relativePath").fill("script.js");
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/studio/debug/sessions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start debug session" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { session: { sessionId: string; pid: number }; ticket?: string };
  return body.session.sessionId;
}

const state = (page: Page) => page.getByTestId("debug-state");
const resume = (page: Page) => page.getByTestId("debug-resume");
const pause = (page: Page) => page.getByTestId("debug-pause");
const expressionBox = (page: Page) => page.getByTestId("debug-expression");
const evaluateButton = (page: Page) => page.getByTestId("debug-evaluate");

async function evaluate(page: Page, expression: string): Promise<void> {
  await expressionBox(page).fill(expression);
  await expect(evaluateButton(page)).toBeEnabled();
  await evaluateButton(page).click();
}

async function sessionPid(request: APIRequestContext, projectId: string, sessionId: string): Promise<number> {
  const res = await request.get(`${stage9ApiBase()}/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { session: { pid: number } }).session.pid;
}

// One test, several steps: the browser context (and its signed-in session) is shared, exactly as a
// user's Studio tab is, and a fresh Playwright context per test would lose the session cookie.
test("Studio Debugger: Resume / Pause / Evaluate through the real product path", async ({ page, context }) => {
  const fixture = await prepare(context);
  const api = context.request;
  await openDebugger(page, fixture.projectId);

  await test.step("paused -> Resume -> running -> Pause -> Resume, against a real Node target", async () => {
    const sessionId = await startFreshSession(page, api, fixture.projectId);

    // Waiting at --inspect-brk: not attached, nothing has run, Resume is offered, Pause is not.
    await expect(state(page)).toHaveAttribute("data-state", "notAttached", { timeout: 20_000 });
    await expect(resume(page)).toBeEnabled();
    await expect(pause(page)).toBeDisabled();
    expect(existsSync(fixture.started)).toBe(false);

    // Resume from Studio: the real target starts executing.
    await resume(page).click();
    await expect(state(page)).toHaveAttribute("data-state", "running", { timeout: 20_000 });
    await expect.poll(() => existsSync(fixture.started), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => readTicks(fixture.ticks), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(pause(page)).toBeEnabled();
    await expect(resume(page)).toBeDisabled();

    // Pause from Studio: the real target stops making progress (fixed 1 s observation window = ~20 tick periods).
    await pause(page).click();
    await expect(state(page)).toHaveAttribute("data-state", "paused", { timeout: 20_000 });
    const atPause = readTicks(fixture.ticks);
    await page.waitForTimeout(1_000);
    expect(readTicks(fixture.ticks)).toBe(atPause);
    await expect(resume(page)).toBeEnabled();
    await expect(pause(page)).toBeDisabled();

    // Resume again: execution continues.
    await resume(page).click();
    await expect(state(page)).toHaveAttribute("data-state", "running", { timeout: 20_000 });
    await expect.poll(() => readTicks(fixture.ticks), { timeout: 10_000 }).toBeGreaterThan(atPause);

    // Evidence: the lifecycle is recorded; no endpoint, no ticket in the audit trail.
    const types = (await audit(api, sessionId)).map((e) => String(e.type));
    expect(types).toEqual(
      expect.arrayContaining(["debugger.session.opened", "debugger.inspector.connected", "debugger.inspector.command"]),
    );
    expect(JSON.stringify(await audit(api, sessionId))).not.toMatch(/ws:\/\/|127\.0\.0\.1:\d+\/[0-9a-f-]{8,}/);
  });

  await test.step("Evaluate: a real value from the target, bounded errors, and no leakage into audit or the page", async () => {
    const sessionId = await startFreshSession(page, api, fixture.projectId);
    await resume(page).click();
    await expect(state(page)).toHaveAttribute("data-state", "running", { timeout: 20_000 });
    const pid = await sessionPid(api, fixture.projectId, sessionId);

    // The value corresponds to the real target process.
    await evaluate(page, "process.pid");
    await expect(page.getByTestId("debug-evaluation-text")).toHaveText(String(pid), { timeout: 15_000 });
    await expect(page.getByTestId("debug-evaluation")).toHaveAttribute("data-kind", "value");

    // Bounded error behavior: an exception is shown as text, bounded, and the session stays usable.
    await evaluate(page, 'throw new Error("boom-from-target")');
    await expect(page.getByTestId("debug-evaluation")).toHaveAttribute("data-kind", "exception", { timeout: 15_000 });
    await expect(page.getByTestId("debug-evaluation-text")).toContainText("boom-from-target");
    await expect(state(page)).toHaveAttribute("data-state", "running");

    // Objects are shown by description only; a very long string is truncated.
    await evaluate(page, "({ secret: 'object-contents-are-not-returned' })");
    await expect(page.getByTestId("debug-evaluation")).toHaveAttribute("data-kind", "description", { timeout: 15_000 });
    await expect(page.getByTestId("debug-evaluation-text")).not.toContainText("object-contents-are-not-returned");
    await evaluate(page, '"x".repeat(9000)');
    await expect(page.getByTestId("debug-evaluation-text")).toContainText("…", { timeout: 15_000 });
    const rendered = (await page.getByTestId("debug-evaluation-text").textContent()) ?? "";
    expect(rendered.length).toBeLessThanOrEqual(2001);

    // The input limit is enforced in the UI before any request, and by the API independently.
    await expressionBox(page).fill("y".repeat(4097));
    await expect(evaluateButton(page)).toBeDisabled();
    await expect(page.getByText("The expression is longer than 4096 characters.")).toBeVisible();
    const tooLong = await api.post(`${stage9ApiBase()}/api/v1/projects/${fixture.projectId}/studio/debug/sessions/${sessionId}/action`, {
      data: { action: "evaluate", expression: "y".repeat(4097) },
      headers: stage9MutationHeaders(),
    });
    expect(tooLong.status()).toBe(400);

    // The expression is never written to audit, and neither is the result; no endpoint appears anywhere.
    await evaluate(page, "'distinctive-ui-secret-' + (40 + 2)");
    await expect(page.getByTestId("debug-evaluation-text")).toHaveText("distinctive-ui-secret-42", { timeout: 15_000 });
    const entries = await audit(api, sessionId);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("distinctive-ui-secret");
    expect(serialized).not.toContain("boom-from-target");
    expect(serialized).not.toMatch(/ws:\/\//);
    expect(entries.some((e) => e.type === "debugger.inspector.command" && e.action === "evaluate" && typeof e.expressionChars === "number")).toBe(true);

    const pageText = (await page.locator("body").innerText()) + (await page.content());
    expect(pageText).not.toMatch(/ws:\/\/127\.0\.0\.1/);
    expect(pageText).not.toContain("Debugger listening on");
  });

  await test.step("disconnecting the Inspector ends the session, cleans up the target and rejects further actions", async () => {
    const sessionId = await startFreshSession(page, api, fixture.projectId);
    await resume(page).click();
    await expect(state(page)).toHaveAttribute("data-state", "running", { timeout: 20_000 });
    const pid = await sessionPid(api, fixture.projectId, sessionId);

    // Deactivates the target's own Inspector: the controller's socket drops while the process is alive.
    await evaluate(page, 'process.getBuiltinModule("node:inspector").close()');

    await expect(state(page)).toHaveAttribute("data-state", "terminated", { timeout: 20_000 });
    await expect(resume(page)).toBeDisabled();
    await expect(pause(page)).toBeDisabled();
    await expect(evaluateButton(page)).toBeDisabled();
    await expect(page.getByTestId("debug-no-actions")).toBeVisible();
    await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);

    // The service rejects the action by itself, independent of the UI.
    const direct = await api.post(`${stage9ApiBase()}/api/v1/projects/${fixture.projectId}/studio/debug/sessions/${sessionId}/action`, {
      data: { action: "pause" },
      headers: stage9MutationHeaders(),
    });
    expect(direct.status()).toBe(403);
    const types = (await audit(api, sessionId)).map((e) => String(e.type));
    expect(types).toContain("debugger.inspector.disconnected");
  });

  await test.step("authorization loss: a stale UI cannot act, the service rejects it, and the target is cleaned up", async () => {
    const sessionId = await startFreshSession(page, api, fixture.projectId);
    await resume(page).click();
    await expect(state(page)).toHaveAttribute("data-state", "running", { timeout: 20_000 });
    const pid = await sessionPid(api, fixture.projectId, sessionId);
    const sessionUrl = `**/studio/debug/sessions/${sessionId}`;
    const snapshot = await (await api.get(`${stage9ApiBase()}/api/v1/projects/${fixture.projectId}/studio/debug/sessions/${sessionId}`)).json();

    // Keep the UI showing the old, still-actionable session so the click really reaches the backend.
    await page.route(sessionUrl, (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: snapshot }) : route.continue(),
    );
    await control(api, "/transfer-owner", { projectId: fixture.projectId, ownerId: "99999999-9999-4999-8999-999999999999" });

    await expect(pause(page)).toBeEnabled();
    await pause(page).click();
    await expect(page.getByTestId("debug-action-error")).toBeVisible({ timeout: 15_000 });

    // The backend revoked the session and killed the target; nothing further can execute.
    await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);
    const direct = await api.post(`${stage9ApiBase()}/api/v1/projects/${fixture.projectId}/studio/debug/sessions/${sessionId}/action`, {
      data: { action: "evaluate", expression: "1" },
      headers: stage9MutationHeaders(),
    });
    expect(direct.status()).toBe(403);
    const types = (await audit(api, sessionId)).map((e) => String(e.type));
    expect(types).toContain("debugger.authorization.revoked");

    // Once the UI sees the truth again it disables everything.
    await page.unroute(sessionUrl);
    await expect(state(page)).toHaveAttribute("data-state", "unavailable", { timeout: 20_000 });
    await expect(pause(page)).toBeDisabled();
    await expect(evaluateButton(page)).toBeDisabled();
  });

  await test.step("session expiry: the UI shows it, no further CDP execution is possible, the target is gone", async () => {
    // Ownership was transferred away in the previous test; restore it for a clean, authorized session.
    await control(api, "/transfer-owner", { projectId: fixture.projectId, ownerId: fixture.userId });
    const sessionId = await startFreshSession(page, api, fixture.projectId);
    await resume(page).click();
    await expect(state(page)).toHaveAttribute("data-state", "running", { timeout: 20_000 });
    const pid = await sessionPid(api, fixture.projectId, sessionId);

    // Fires the same expiry transition the idle / lifetime timers fire.
    await control(api, "/expire", { sessionId });

    await expect(state(page)).toHaveAttribute("data-state", "expired", { timeout: 20_000 });
    await expect(resume(page)).toBeDisabled();
    await expect(pause(page)).toBeDisabled();
    await expect(evaluateButton(page)).toBeDisabled();
    await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);

    const direct = await api.post(`${stage9ApiBase()}/api/v1/projects/${fixture.projectId}/studio/debug/sessions/${sessionId}/action`, {
      data: { action: "continue" },
      headers: stage9MutationHeaders(),
    });
    expect(direct.status()).toBe(403);
    const types = (await audit(api, sessionId)).map((e) => String(e.type));
    expect(types).toContain("debugger.session.expired");
  });
});

let previousSessionId: string | null = null;

/**
 * The panel keeps its session in component state, so a fresh page load forgets
 * it while the server still holds it ACTIVE. Close the previous test's session
 * through the API (the service path), then start a new one from the UI.
 */
async function startFreshSession(page: Page, request: APIRequestContext, projectId: string): Promise<string> {
  if (previousSessionId) {
    await request.post(`${stage9ApiBase()}/api/v1/projects/${projectId}/studio/debug/sessions/${previousSessionId}/close`, {
      data: {},
      headers: stage9MutationHeaders(),
    });
  }
  previousSessionId = await startSession(page);
  return previousSessionId;
}