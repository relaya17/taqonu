import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { stage9ApiBase } from "./local-api";

interface ShellMessages {
  brand: { name: string };
  nav: { languages: string };
  a11y: { openMenu: string; themeDark: string; themeLight: string };
  studio: { title: string };
}

const here = dirname(fileURLToPath(import.meta.url));

function webMessages(locale: "he" | "en" | "ar" | "fr"): ShellMessages {
  return JSON.parse(
    readFileSync(join(here, "..", "..", "apps", "web", "messages", `${locale}.json`), "utf8"),
  ) as ShellMessages;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expectAuthenticatedStudio(
  page: import("@playwright/test").Page,
): Promise<void> {
  const me = await page.context().request.get(
    `${stage9ApiBase(page.url())}/api/v1/auth/me`,
  );
  expect(me.status()).toBe(200);
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

/** The docked sidebar must sit beside main, not over it, in either direction. */
async function expectSidebarBesideMain(
  page: import("@playwright/test").Page,
): Promise<void> {
  const sidebar = page.locator("aside:has(nav)");
  await expect(sidebar).toBeVisible({ timeout: 30_000 });
  const aside = await sidebar.boundingBox();
  const main = await page.locator("main#main-content").boundingBox();
  expect(aside && main, "sidebar and main must both render").toBeTruthy();
  const overlap =
    Math.min(aside!.x + aside!.width, main!.x + main!.width) -
    Math.max(aside!.x, main!.x);
  expect(overlap, "sidebar overlaps main content").toBeLessThanOrEqual(1);
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
    await expectSidebarBesideMain(page);
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
    await expectSidebarBesideMain(page);
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
    await expectSidebarBesideMain(page);
  });

  test("the language menu switches Studio to French, LTR", async ({ page }) => {
    const he = webMessages("he");
    const fr = webMessages("fr");
    await page.goto("/he/studio", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: he.studio.title }),
    ).toBeVisible({ timeout: 45_000 });

    const languages = page.locator("main header").getByRole("button", { name: he.nav.languages });
    const french = page.getByRole("menuitem", { name: /Français/ });
    // The heading is server-rendered, so it can be visible before hydration;
    // a click on the not-yet-hydrated trigger is dropped, so retry until it opens.
    await expect(async () => {
      if (!(await french.isVisible())) await languages.click();
      await expect(french).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await french.click();

    await expect(page).toHaveURL(/\/fr\/studio/, { timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(
      page.getByRole("heading", { level: 1, name: fr.studio.title }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      page.locator("main header").getByRole("button", { name: fr.nav.languages }),
    ).toBeVisible();
    await expectAuthenticatedStudio(page);
    await expectSidebarBesideMain(page);
  });
});

test.describe("Header keeps brand and controls on the same sides at every width", () => {
  test.setTimeout(90_000);

  const viewports = [
    { label: "mobile", width: 390, height: 844 },
    { label: "desktop", width: 1280, height: 800 },
  ] as const;
  const cases = (["he", "fr"] as const).flatMap((locale) =>
    viewports.map((viewport) => ({ locale, viewport })),
  );

  for (const { locale, viewport } of cases) {
    test(`${locale.toUpperCase()} ${viewport.label}: controls at the inline start, brand at the inline end`, async ({
      page,
    }) => {
      const m = webMessages(locale);
      const rtl = locale === "he";
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/${locale}/studio`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("dir", rtl ? "rtl" : "ltr");

      const header = page.locator("main header");
      const menu = header.getByRole("button", { name: m.a11y.openMenu });
      const lang = header.getByRole("button", { name: m.nav.languages });
      const theme = header.getByRole("button", {
        name: new RegExp(
          `^(${escapeRegExp(m.a11y.themeDark)}|${escapeRegExp(m.a11y.themeLight)})$`,
        ),
      });
      const brand = header.getByRole("link", { name: m.brand.name });
      await expect(menu).toBeVisible({ timeout: 45_000 });
      await expect(brand).toBeVisible();

      const [menuBox, langBox, themeBox, brandBox] = await Promise.all([
        menu.boundingBox(),
        lang.boundingBox(),
        theme.boundingBox(),
        brand.boundingBox(),
      ]);
      expect(menuBox && langBox && themeBox && brandBox, "header parts must render").toBeTruthy();
      const center = (b: { x: number; width: number }) => b.x + b.width / 2;

      // Inline start is the right edge in RTL and the left edge in LTR.
      const startwards = (a: number, b: number) => (rtl ? a > b : a < b);
      expect(startwards(center(menuBox!), center(langBox!)), "menu is the outermost control").toBe(true);
      expect(startwards(center(langBox!), center(themeBox!)), "language sits between menu and theme").toBe(true);
      expect(startwards(center(themeBox!), center(brandBox!)), "brand sits at the inline end").toBe(true);

      const gap = rtl
        ? langBox!.x - (themeBox!.x + themeBox!.width)
        : themeBox!.x - (langBox!.x + langBox!.width);
      expect(gap, "theme toggle and language button are adjacent").toBeLessThanOrEqual(1);
      expect(gap, "theme toggle and language button do not overlap").toBeGreaterThanOrEqual(-1);
    });
  }

  test("desktop hamburger closes and reopens the docked sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    const sidebar = page.locator("aside:has(nav)");
    const menu = page.locator("main header").getByRole("button", { name: "Open menu" });
    await expect(sidebar).toBeVisible({ timeout: 45_000 });
    // The desktop state is only known after hydration, so this also waits for it.
    await expect(menu).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });

    await menu.click();
    await expect(sidebar).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    await expect(sidebar).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expectSidebarBesideMain(page);
  });
});
