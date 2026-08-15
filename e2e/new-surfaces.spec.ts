import { test, expect } from "@playwright/test";
import { apiHealthy } from "./helpers";

/**
 * Smoke coverage for newer product surfaces (welcome / workbench / process-audit)
 * and legacy orphan redirects.
 */
test.describe("New product surfaces (EN)", () => {
  test("welcome landing shows brand and login CTA", async ({ page }) => {
    await page.goto("/en/welcome");
    await expect(page.getByText(/ArletOS|Atlas/i).first()).toBeVisible({
      timeout: 45_000,
    });
    const login = page
      .getByRole("link", { name: /start|log ?in|sign|free/i })
      .first();
    await expect(login).toBeVisible();
    await login.click();
    await expect(page).toHaveURL(/\/en\/auth\/login/, { timeout: 20_000 });
  });

  test("workbench page loads", async ({ page, request }) => {
    await page.goto("/en/workbench");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (await apiHealthy(request)) {
      await expect(
        page.getByText(/workbench|project|files|local path|folder/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("process-audit page loads", async ({ page, request }) => {
    await page.goto("/en/process-audit");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (await apiHealthy(request)) {
      await expect(
        page.getByText(/process|audit|E2E|profile|run/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
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

  test("/proof redirects to readiness", async ({ page }) => {
    await page.goto("/en/proof");
    await expect(page).toHaveURL(/\/en\/readiness/, { timeout: 30_000 });
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
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("observer loads", async ({ page }) => {
    await page.goto("/en/observer");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
