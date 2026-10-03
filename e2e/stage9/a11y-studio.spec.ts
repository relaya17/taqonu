import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { expectNoA11yViolations } from "../axe";
import {
  createMarkerWorkspace,
  createStage9Project,
  linkWorkspaceRoot,
  studioProjectUrl,
} from "./projects";

type Rgba = { r: number; g: number; b: number; a: number };

function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: Rgba, bg: Rgba): number {
  const a = fg.a;
  const flat = {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
  const [hi, lo] = [relativeLuminance(flat), relativeLuminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
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
    // The sidebar mounts only after the session query resolves; scanning
    // before that leaves its text out of the axe run.
    await expect(
      page.getByRole("navigation", { name: /main navigation/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expectNoA11yViolations(page, testInfo);
  });

  test("main navigation lists the four destinations, no More group", async ({ page }) => {
    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    const nav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(nav).toBeVisible({ timeout: 45_000 });
    for (const name of ["Studio", "Dashboard", "Agents", "Account"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    // Projects/Systems live in Dashboard, Models/Experts in Agents: no
    // separate entries and no collapsible "More" group.
    await expect(nav.getByRole("button", { name: /more/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Systems" })).toHaveCount(0);
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

  test("keyboard focus on a sidebar link paints an outline of at least 3:1", async ({
    page,
  }) => {
    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    const nav = page.getByRole("navigation", { name: /main navigation/i });
    await expect(nav).toBeVisible({ timeout: 45_000 });

    let href: string | null = null;
    for (let i = 0; i < 25 && !href; i++) {
      await page.keyboard.press("Tab");
      href = await nav.evaluate((el) => {
        const active = document.activeElement;
        return active instanceof HTMLAnchorElement && el.contains(active)
          ? active.getAttribute("href")
          : null;
      });
    }
    expect(href, "Tab must reach a link inside the main navigation").not.toBeNull();
    const link = nav.locator(`a[href="${href}"]`);
    await expect(link).toBeFocused();
    await expect(link).toHaveClass(/Mui-focusVisible/);

    const ring = await link.evaluate((el) => {
      const parse = (value: string) => {
        const [r, g, b, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
        return { r, g, b, a };
      };
      const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
      for (let node = el.parentElement; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg.a > 0) layers.push(bg);
        if (bg.a >= 1) break;
      }
      let background = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of layers.reverse()) {
        background = {
          r: layer.r * layer.a + background.r * (1 - layer.a),
          g: layer.g * layer.a + background.g * (1 - layer.a),
          b: layer.b * layer.a + background.b * (1 - layer.a),
          a: 1,
        };
      }
      const style = getComputedStyle(el);
      return {
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
        color: parse(style.outlineColor),
        background,
      };
    });
    expect(ring.style, "focused link must draw an outline").not.toBe("none");
    expect(ring.width, "focused link outline width (px)").toBeGreaterThan(0);
    // WCAG 1.4.11: the focus indicator needs 3:1 against the adjacent surface.
    expect(
      contrastRatio(ring.color, ring.background),
      `outline ${JSON.stringify(ring.color)} on ${JSON.stringify(ring.background)}`,
    ).toBeGreaterThanOrEqual(3);

    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    const clip = {
      x: box!.x - 8,
      y: box!.y - 8,
      width: box!.width + 16,
      height: box!.height + 16,
    };
    const focused = await page.screenshot({ clip, animations: "disabled" });
    await link.evaluate((el) => (el as HTMLElement).blur());
    await expect(link).not.toHaveClass(/Mui-focusVisible/);
    const unfocused = await page.screenshot({ clip, animations: "disabled" });
    expect(focused.equals(unfocused), "focus must change the rendered pixels").toBe(false);
  });

  test("mobile drawer traps keyboard focus and Escape returns it to Open menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
    const openMenu = page.getByRole("button", { name: /open menu/i });
    await expect(openMenu).toBeVisible({ timeout: 15_000 });
    await openMenu.focus();
    await page.keyboard.press("Enter");

    const mobileDrawer = page.locator(".MuiDrawer-modal .MuiDrawer-paper");
    await expect(mobileDrawer).toBeVisible({ timeout: 15_000 });
    // The trap is the whole modal: MUI's FocusTrap sentinels sit next to the
    // paper and briefly hold focus while it wraps from first to last item.
    const drawerModal = page.locator(".MuiDrawer-modal");
    const focusInsideDrawer = () =>
      drawerModal.evaluate((el) => el.contains(document.activeElement));
    await expect.poll(focusInsideDrawer, { message: "focus moves into the drawer" }).toBe(true);

    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInsideDrawer(), `focus stays in the drawer after Tab ${i + 1}`).toBe(
        true,
      );
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(
        await focusInsideDrawer(),
        `focus stays in the drawer after Shift+Tab ${i + 1}`,
      ).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(mobileDrawer).toHaveCount(0, { timeout: 15_000 });
    await expect(openMenu).toBeFocused();
    await expect(openMenu).toHaveAttribute("aria-expanded", "false");
  });

  test("open files are tabs in a tablist with arrow-key selection and no axe violations", async ({
    page,
    request,
  }, testInfo) => {
    const stamp = Date.now();
    const project = await createStage9Project(request, `Stage9 Tabs ${stamp}`);
    const first = `first-${stamp}.txt`;
    const second = `second-${stamp}.txt`;
    const root = await createMarkerWorkspace({ fileName: first, contents: `FIRST ${stamp}` });
    await writeFile(join(root, second), `SECOND ${stamp}`, "utf8");
    await linkWorkspaceRoot(request, project.id, root);

    await page.goto(studioProjectUrl(project.id), { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: first }).click({ timeout: 20_000 });
    await expect(page.getByRole("textbox", { name: first })).toHaveValue(`FIRST ${stamp}`, {
      timeout: 20_000,
    });
    await page.getByRole("button", { name: second }).click();
    await expect(page.getByRole("textbox", { name: second })).toHaveValue(`SECOND ${stamp}`, {
      timeout: 20_000,
    });

    const strip = page.getByRole("tablist", { name: "Open files" });
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await expect(strip.getByRole("button")).toHaveCount(0);
    const firstTab = strip.getByRole("tab", { name: first });
    const secondTab = strip.getByRole("tab", { name: second });
    await expect(secondTab).toHaveAttribute("aria-selected", "true");
    await expect(secondTab).toHaveAttribute("tabindex", "0");
    await expect(firstTab).toHaveAttribute("aria-selected", "false");
    await expect(firstTab).toHaveAttribute("tabindex", "-1");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", (await secondTab.getAttribute("id"))!);
    await expect(secondTab).toHaveAttribute("aria-controls", (await panel.getAttribute("id"))!);

    await secondTab.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(firstTab).toBeFocused();
    await expect(firstTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("textbox", { name: first })).toHaveValue(`FIRST ${stamp}`, {
      timeout: 20_000,
    });
    await page.keyboard.press("End");
    await expect(secondTab).toBeFocused();
    await expect(secondTab).toHaveAttribute("aria-selected", "true");

    await expectNoA11yViolations(page, testInfo);
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
