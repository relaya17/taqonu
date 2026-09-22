import { test, expect } from "@playwright/test";

test.describe("ArletOS critical path (HE)", () => {
  test("home loads brand and verdict area", async ({ page }) => {
    await page.goto("/he");
    // AppShell always renders a mobile-only brand link ahead of page
    // content in the DOM (hidden at desktop widths via CSS); a free-text
    // search picks that one up before the real, visible <h1>. Target the
    // actual brand heading instead.
    await expect(
      page.getByRole("heading", { level: 1, name: /ArletOS|Atlas/i }),
    ).toBeVisible({
      timeout: 45_000,
    });
  });

  test("health page reachable", async ({ page }) => {
    await page.goto("/he/health");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
  });

  test("readiness page reachable", async ({ page }) => {
    await page.goto("/he/readiness");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
  });

  test("architecture contract page reachable", async ({ page }) => {
    await page.goto("/he/contract");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
  });
});
