import { test, expect } from "@playwright/test";
import { stage9ApiBase } from "./local-api";

async function expectAuthenticatedStudio(
  page: import("@playwright/test").Page,
): Promise<void> {
  const me = await page.context().request.get(
    `${stage9ApiBase(page.url())}/api/v1/auth/me`,
  );
  expect(me.status()).toBe(200);
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

test.describe("Stage 9.8 authenticated Studio locales", () => {
  test.setTimeout(90_000);

  test("EN Studio is LTR with the English heading", async ({ page }) => {
    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/en\/studio/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
    await expectAuthenticatedStudio(page);
  });

  test("HE Studio is RTL", async ({ page }) => {
    await page.goto("/he/studio", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/he\/studio/);
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { level: 1, name: "סטודיו פרויקט" }),
    ).toBeVisible({ timeout: 45_000 });
    await expectAuthenticatedStudio(page);
  });

  test("AR Studio is RTL", async ({ page }) => {
    await page.goto("/ar/studio", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/ar\/studio/);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { level: 1, name: "Studio المشروع" }),
    ).toBeVisible({ timeout: 45_000 });
    await expectAuthenticatedStudio(page);
  });
});
