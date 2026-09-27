import { test, expect } from "@playwright/test";
import { expectSignInRedirect, rejectedApiCalls } from "./signed-out";

/**
 * Signed-out critical path. Product pages require a session, so a visitor
 * without one lands on sign-in; what those pages show signed in is covered by
 * e2e/stage9/product-surfaces.spec.ts.
 */
test.describe("ArletOS critical path (HE)", () => {
  test("home sends a signed-out visitor to sign-in", async ({ page }) => {
    await expectSignInRedirect(page, "/he");
  });

  test("health page sends a signed-out visitor to sign-in", async ({ page }) => {
    await expectSignInRedirect(page, "/he/health");
  });

  test("readiness page sends a signed-out visitor to sign-in", async ({ page }) => {
    await expectSignInRedirect(page, "/he/readiness");
  });

  test("architecture contract page sends a signed-out visitor to sign-in", async ({
    page,
  }) => {
    await expectSignInRedirect(page, "/he/contract");
  });

  test("welcome door stays public and shows the brand", async ({ page }) => {
    const rejected = await rejectedApiCalls(page, async () => {
      await page.goto("/he/welcome");
      await expect(page.getByText(/ArletOS|Atlas/i).first()).toBeVisible({
        timeout: 45_000,
      });
    });
    await expect(page).toHaveURL(/\/he\/welcome$/);
    expect(rejected).toEqual([]);
  });

  test("pricing stays public and asks for sign-in instead of loading the account", async ({
    page,
  }) => {
    const rejected = await rejectedApiCalls(page, async () => {
      await page.goto("/he/plan");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 45_000,
      });
      await expect(page.getByRole("link", { name: "כניסה", exact: true })).toBeVisible({
        timeout: 20_000,
      });
    });
    await expect(page).toHaveURL(/\/he\/plan$/);
    expect(rejected).toEqual([]);
  });
});
