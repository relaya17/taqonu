import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

async function expectNoA11yViolations(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  await testInfo.attach("axe-scan-results", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  expect(
    results.violations,
    `axe-core found ${results.violations.length} WCAG 2.2 AA violation(s) on ${page.url()}:\n` +
      results.violations
        .map(
          (v) =>
            `- [${v.id}] ${v.help} (impact: ${v.impact}) — ${v.nodes.length} node(s)\n  ${v.helpUrl}`,
        )
        .join("\n"),
  ).toEqual([]);
}

test.describe("Stage 9.9 authenticated a11y + /en/projects", () => {
  test.setTimeout(120_000);

  test("authenticated Studio has skip link, main landmark, and no axe violations", async ({
    page,
  }, testInfo) => {
    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    const main = page.locator("main#main-content");
    await expect(main).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
    const skip = page.locator("a.skip-link");
    await expect(skip).toHaveAttribute("href", "#main-content");
    await expectNoA11yViolations(page, testInfo);
  });

  test("authenticated hamburger opens the product sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
    const openMenu = page.getByRole("button", { name: /open menu/i });
    await expect(openMenu).toBeVisible({ timeout: 15_000 });
    await expect(openMenu).toHaveAttribute("aria-expanded", "false");
    await openMenu.click();
    const mobileDrawer = page.locator(".MuiDrawer-modal .MuiDrawer-paper");
    await expect(mobileDrawer).toBeVisible({ timeout: 15_000 });
    await expect(
      mobileDrawer.getByRole("navigation", { name: /main navigation/i }),
    ).toBeVisible();
  });

  test("authenticated /en/projects document navigation is not ERR_ABORTED", async ({
    page,
  }) => {
    const abortedDocuments: string[] = [];
    page.on("requestfailed", (req) => {
      const failure = req.failure()?.errorText ?? "";
      if (req.resourceType() === "document" && /ERR_ABORTED/i.test(failure)) {
        abortedDocuments.push(`${req.method()} ${req.url()} ${failure}`);
      }
    });
    const response = await page.goto("/en/projects", {
      waitUntil: "domcontentloaded",
    });
    expect(response, "document navigation must return a response").toBeTruthy();
    expect(
      response!.status(),
      ` /en/projects document status ${response!.status()}`,
    ).toBeLessThan(400);
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
      timeout: 20_000,
    });
    expect(
      abortedDocuments,
      `document ERR_ABORTED on /en/projects: ${abortedDocuments.join("; ")}. Historical aborts came from waitUntil=networkidle / in-flight SPA compile, not from deleting this assertion.`,
    ).toEqual([]);
  });
});
