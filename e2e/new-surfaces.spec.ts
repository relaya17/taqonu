import { test, expect } from "@playwright/test";
import { apiHealthy } from "./helpers";

/**
 * Smoke coverage for newer product surfaces (welcome / workbench / process-audit)
 * and legacy orphan redirects.
 */
test.describe("New product surfaces (EN)", () => {
  test("welcome landing shows brand and login CTA", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/en/welcome");
    await expect(page.getByText(/ArletOS|Atlas/i).first()).toBeVisible({
      timeout: 45_000,
    });
    const login = page.getByRole("link", { name: /^Log in$/i });
    await expect(login).toBeVisible();
    await login.click();
    await expect(page).toHaveURL(/\/en\/auth\/login/, { timeout: 20_000 });
  });

  test("workbench page loads", async ({ page, request }) => {
    await page.goto("/en/workbench");
    // /en/workbench redirects to /en/studio?tab=chat. Wait for redirect.
    await expect(page).toHaveURL(/\/en\/studio\?.*tab=chat/, {
      timeout: 30_000,
    });
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    if (await apiHealthy(request)) {
      await expect(
        page.getByText(/studio|project|files|local path|folder/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("process-audit route remains and lands in Studio Checks", async ({ page }) => {
    await page.goto("/en/process-audit");
    await expect(page).toHaveURL(/\/en\/studio\?.*check=processAudit/, {
      timeout: 30_000,
    });
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
  });

  test("dashboard shows onboarding path", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByText(/link a local folder|start here|workbench|E2E/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Legacy orphan redirects (EN)", () => {
  test("/state redirects to projects", async ({ page }) => {
    await page.goto("/en/state");
    await expect(page).toHaveURL(/\/en\/projects/, { timeout: 30_000 });
  });

  test("/chat redirects to workbench", async ({ page }) => {
    await page.goto("/en/chat");
    await expect(page).toHaveURL(/\/en\/workbench/, { timeout: 30_000 });
  });

  test("/agent redirects to agents", async ({ page }) => {
    await page.goto("/en/agent");
    await expect(page).toHaveURL(/\/en\/agents/, { timeout: 30_000 });
  });

  test("/proof redirects to Studio Checks readiness", async ({ page }) => {
    await page.goto("/en/proof");
    await expect(page).toHaveURL(/\/en\/studio\?.*check=readiness/, {
      timeout: 30_000,
    });
  });
});

test.describe("Counsel + security surfaces (EN)", () => {
  test("legal-media counsel briefing loads", async ({ page }) => {
    await page.goto("/en/legal-media");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/not legal advice/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("sentinel security check loads", async ({ page }) => {
    await page.goto("/en/sentinel");
    // /en/sentinel redirects to /en/studio?tab=checks&check=sentinel. Wait for redirect.
    await expect(page).toHaveURL(/\/en\/studio\?.*check=sentinel/, {
      timeout: 30_000,
    });
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("observer loads", async ({ page }) => {
    await page.goto("/en/observer");
    // /en/observer redirects to /en/studio?tab=checks&check=observer. Wait for redirect.
    await expect(page).toHaveURL(/\/en\/studio\?.*check=observer/, {
      timeout: 30_000,
    });
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
  });
});
