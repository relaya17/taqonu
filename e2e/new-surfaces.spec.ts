import { test, expect } from "@playwright/test";
import { expectSignInRedirect } from "./signed-out";

/**
 * Smoke coverage for newer product surfaces (welcome / workbench / process-audit)
 * and legacy orphan redirects. Only the welcome door is public; the rest
 * require a session and are checked signed in by
 * e2e/stage9/product-surfaces.spec.ts.
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

  for (const path of [
    "/en/workbench",
    "/en/process-audit",
    "/en/state",
    "/en/chat",
    "/en/agent",
    "/en/proof",
    "/en/legal-media",
    "/en/sentinel",
    "/en/observer",
  ]) {
    test(`${path} sends a signed-out visitor to sign-in`, async ({ page }) => {
      await expectSignInRedirect(page, path);
    });
  }
});
