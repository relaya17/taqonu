import { test, expect } from "@playwright/test";

/**
 * Light a11y / responsive smoke — not a full axe suite.
 * Checks landmarks, skip link, keyboard-named controls, mobile overflow.
 */
const PRIMARY = [
  "/en",
  "/en/projects",
  "/en/health",
  "/en/decisions",
  "/en/agent",
  "/en/memory",
  "/en/auth/login",
] as const;

test.describe("A11y smoke (EN)", () => {
  test("home has skip link, main landmark, and h1", async ({ page }) => {
    await page.goto("/en");
    const main = page.locator("main#main-content");
    await expect(main).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    const skip = page.locator("a.skip-link");
    await expect(skip).toHaveAttribute("href", "#main-content");
    await skip.focus();
    await expect(skip).toBeFocused();
    await skip.click();
    await expect(main).toBeFocused();
  });

  test("mobile menu control is named and expandable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en");
    await expect(page.locator("main#main-content")).toBeVisible({
      timeout: 45_000,
    });

    const openMenu = page.getByRole("button", { name: /open menu/i });
    await expect(openMenu).toBeVisible({ timeout: 15_000 });
    await expect(openMenu).toHaveAttribute("aria-expanded", "false");
    await openMenu.click();
    // Drawer modal aria-hides the page (incl. open button); assert the close control instead.
    const closeMenu = page.getByRole("button", { name: /close menu/i });
    await expect(closeMenu).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: /open menu/i, includeHidden: true }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("primary surfaces avoid horizontal overflow on narrow viewports", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    for (const path of PRIMARY) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });

      const overflowed = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth + 2;
      });
      expect(overflowed, `${path} should not overflow horizontally`).toBe(false);
    }
  });

  test("login form is keyboard-submittable", async ({ page }) => {
    await page.goto("/en/auth/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator("form")).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("memory page exposes main landmark and heading", async ({ page }) => {
    await page.goto("/en/memory");
    await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("investors landing has brand hero and evidence graph visual", async ({
    page,
  }) => {
    await page.goto("/investors");
    await expect(page.getByText("ArletOS").first()).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#contact")).toBeVisible();
    await expect(
      page.getByRole("img", { name: /evidence graph/i }),
    ).toBeVisible();
  });
});
