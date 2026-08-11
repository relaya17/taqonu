import { test, expect } from "@playwright/test";

test.describe("ArletOS critical path (HE)", () => {
  test("home loads brand and verdict area", async ({ page }) => {
    await page.goto("/he");
    await expect(page.getByText(/ArletOS|Atlas/i).first()).toBeVisible({
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
