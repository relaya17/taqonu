import { test, expect } from "@playwright/test";
import { apiHealthy } from "./helpers";

/**
 * Broader product-surface smoke beyond critical-path.
 * Pages must render even when the API is down; richer checks skip if API is unavailable.
 */
test.describe("Product surfaces (EN)", () => {
  test("home / verdict area loads brand", async ({ page }) => {
    await page.goto("/en");
    // AppShell always renders a mobile-only brand link ahead of page
    // content in the DOM (hidden at desktop widths via CSS); a free-text
    // search picks that one up before the real, visible <h1>. Target the
    // actual brand heading instead.
    await expect(
      page.getByRole("heading", { level: 1, name: /ArletOS|Atlas/i }),
    ).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator("main")).toBeVisible();
  });

  test("readiness page shows title", async ({ page }) => {
    await page.goto("/en/readiness");
    // /en/readiness redirects into the Studio shell (StudioSurfaceRedirect).
    // Wait for the client-side redirect to complete before checking content.
    await expect(page).toHaveURL(/\/en\/studio\?.*check=readiness/, {
      timeout: 30_000,
    });
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    // Studio carries its own persistent "Project Studio" <h1> alongside this
    // panel's own heading — two legitimate h1s on one page. Target the
    // panel's own heading by name instead of assuming a single global h1.
    await expect(
      page.getByRole("heading", { level: 1, name: "Production Readiness" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("health / system scorecard reachable", async ({ page }) => {
    await page.goto("/en/health");
    // /en/health redirects into the Studio shell (StudioSurfaceRedirect).
    // Wait for the client-side redirect to complete before checking content.
    await expect(page).toHaveURL(/\/en\/studio\?.*check=health/, {
      timeout: 30_000,
    });
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    // Studio carries its own persistent "Project Studio" <h1> alongside this
    // panel's own heading — two legitimate h1s on one page. Target the
    // panel's own heading by name instead of assuming a single global h1.
    await expect(
      page.getByRole("heading", { level: 1, name: "System Health" }),
    ).toBeVisible({ timeout: 10_000 });
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
      // "arletos" is dropped from this pattern: AppShell's always-present
      // mobile-only brand link ("ArletOS") sits ahead of this page's real
      // content in the DOM and is hidden at desktop widths, so a free-text
      // match including that token grabs the hidden link instead of the
      // page's own visible marketplace copy. The remaining terms are unique
      // to this page's actual content.
      await expect(
        page.getByText(/marketplace|strength|weakness|credit/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("conversation / chat evidence surface reachable", async ({
    page,
    request,
  }) => {
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
        page.getByText(/studio|agent|chat|files|project/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });
});
