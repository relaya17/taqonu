import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

/**
 * Manual a11y / responsive smoke checks, PLUS a real automated WCAG 2.2 AA
 * scan (axe-core) on every page this suite already visits.
 * Checks landmarks, skip link, keyboard-named controls, mobile overflow.
 */

/**
 * Run an axe-core scan for WCAG 2.0/2.1 A+AA and WCAG 2.2 AA, and assert
 * there are no violations. Attaches the full JSON report to the test result
 * (pass or fail) so violations are inspectable from the HTML report.
 */
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

const PRIMARY = [
  "/en",
  "/en/projects",
  "/en/systems",
  "/en/health",
  "/en/decisions",
  "/en/agents",
  "/en/memory",
  "/en/auth/login",
] as const;

test.describe("A11y smoke (EN)", () => {
  test("home has skip link, main landmark, and h1", async ({
    page,
  }, testInfo) => {
    await page.goto("/en");
    const main = page.locator("main#main-content");
    await expect(main).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    await expectNoA11yViolations(page, testInfo);

    const skip = page.locator("a.skip-link");
    await expect(skip).toHaveAttribute("href", "#main-content");
    await skip.focus();
    await expect(skip).toBeFocused();
    await skip.click();
    await expect(main).toBeFocused();
  });

  test("narrow viewport shows hamburger that opens sidebar", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en");
    await expect(page.locator("main#main-content")).toBeVisible({
      timeout: 45_000,
    });

    await expectNoA11yViolations(page, testInfo);

    const openMenu = page.getByRole("button", { name: /open menu/i });
    await expect(openMenu).toBeVisible({ timeout: 15_000 });
    await expect(openMenu).toHaveAttribute("aria-expanded", "false");

    await openMenu.click();
    // MUI temporary Drawer modals aria-hide the rest of the page (incl. hamburger).
    const mobileDrawer = page.locator(".MuiDrawer-modal .MuiDrawer-paper");
    await expect(mobileDrawer).toBeVisible({ timeout: 15_000 });
    await expect(
      mobileDrawer.getByRole("navigation", { name: /main navigation/i }),
    ).toBeVisible();
    const closeMenu = page.getByRole("button", { name: /close menu/i });
    await expect(closeMenu).toBeVisible();
    await closeMenu.click();

    await expect(openMenu).toBeVisible({ timeout: 15_000 });
    await expect(openMenu).toHaveAttribute("aria-expanded", "false");
  });

  test("primary surfaces avoid horizontal overflow on narrow viewports", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 375, height: 812 });

    for (const path of PRIMARY) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
      // Do not wait for networkidle — dashboard/systems keep polling and CI
      // closes the page when the 60s test timeout wins.

      const overflowed = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth + 2;
      });
      expect(overflowed, `${path} should not overflow horizontally`).toBe(false);

      await expectNoA11yViolations(page, testInfo);
    }
  });

  test("login form is keyboard-submittable", async ({ page }, testInfo) => {
    await page.goto("/en/auth/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 45_000,
    });
    const form = page.locator("form");
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/email/i)).toBeVisible();
    await expect(form.getByLabel(/password/i)).toBeVisible();
    await expect(
      form.getByRole("button", { name: /sign in/i }),
    ).toBeVisible();

    await expectNoA11yViolations(page, testInfo);
  });

  test("memory page exposes main landmark and heading", async ({
    page,
  }, testInfo) => {
    await page.goto("/en/memory");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    await expectNoA11yViolations(page, testInfo);
  });

  test("investors landing has brand hero and evidence graph visual", async ({
    page,
  }, testInfo) => {
    await page.goto("/investors");
    await expect(page.getByText("ArletOS").first()).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#contact")).toBeVisible();
    await expect(
      page.getByRole("img", { name: /evidence graph/i }),
    ).toBeVisible();

    await expectNoA11yViolations(page, testInfo);
  });
});
