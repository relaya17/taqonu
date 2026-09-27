import { test } from "@playwright/test";
import { expectSignInRedirect } from "./signed-out";

/**
 * Signed-out product surfaces. Every page below requires a session, so the
 * shell sends the visitor to sign-in without mounting the page. The same
 * pages' signed-in content is checked in e2e/stage9/product-surfaces.spec.ts.
 */
test.describe("Product surfaces (EN)", () => {
  for (const path of [
    "/en",
    "/en/readiness",
    "/en/health",
    "/en/systems",
    "/en/projects",
    "/en/ops/metrics",
    "/en/agents",
    "/en/models",
    "/en/workbench",
  ]) {
    test(`${path} sends a signed-out visitor to sign-in`, async ({ page }) => {
      await expectSignInRedirect(page, path);
    });
  }

  test("partners keeps the audit door as the post-sign-in destination", async ({
    page,
  }) => {
    await expectSignInRedirect(page, "/en/partners", "/partners");
  });

  test("experts keeps the audit door as the post-sign-in destination", async ({
    page,
  }) => {
    await expectSignInRedirect(page, "/en/experts", "/experts");
  });
});
