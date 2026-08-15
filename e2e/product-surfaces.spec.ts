import { test, expect } from "@playwright/test";
import { apiHealthy } from "./helpers";

/**
 * Broader product-surface smoke beyond critical-path.
 * Pages must render even when the API is down; richer checks skip if API is unavailable.
 */
test.describe("Product surfaces (EN)", () => {
  test("home / verdict area loads brand", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByText(/ArletOS|Atlas/i).first()).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator("main")).toBeVisible();
  });

  test("readiness page shows title", async ({ page }) => {
    await page.goto("/en/readiness");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("health / system scorecard reachable", async ({ page }) => {
    await page.goto("/en/health");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("partners / import surface reachable", async ({ page, request }) => {
    await page.goto("/en/partners");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    if (await apiHealthy(request)) {
      // Import tabs are the interactive core of the partners surface.
      await expect(page.getByRole("tab").first()).toBeVisible({
        timeout: 20_000,
      });
    }
  });

  test("systems command center reachable", async ({ page }) => {
    await page.goto("/en/systems");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("projects portfolio page reachable", async ({ page, request }) => {
    await page.goto("/en/projects");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    if (await apiHealthy(request)) {
      // Registry copy or empty-state should appear once projects query settles.
      await expect(
        page.getByText(/project|portfolio|discover|empty|registered/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("current state center reachable", async ({ page, request }) => {
    await page.goto("/en/projects");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    if (await apiHealthy(request)) {
      await expect(
        page.getByText(/project|portfolio|discover|empty|registered|folder/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("ops / metrics page reachable", async ({ page, request }) => {
    await page.goto("/en/ops/metrics");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    if (await apiHealthy(request)) {
      await expect(
        page.getByText(/ops metrics|sample|prometheus|metric/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("specialist lanes / agents page reachable", async ({ page, request }) => {
    await page.goto("/en/agents");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    if (await apiHealthy(request)) {
      await expect(
        page.getByText(/specialist|orchestrator|evidence|plan|dispatch/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("model marketplace page reachable", async ({ page, request }) => {
    await page.goto("/en/models");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    if (await apiHealthy(request)) {
      await expect(
        page.getByText(/marketplace|strength|weakness|credit|arletos/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("conversation / chat evidence surface reachable", async ({
    page,
    request,
  }) => {
    await page.goto("/en/workbench");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    if (await apiHealthy(request)) {
      await expect(
        page.getByText(/workbench|agent|chat|files|project/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });
});
