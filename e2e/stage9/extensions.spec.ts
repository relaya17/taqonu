import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { expectNoA11yViolations } from "../axe";
import {
  createMarkerWorkspace,
  createStage9Project,
  linkWorkspaceRoot,
  studioProjectUrl,
} from "./projects";

/**
 * ADR-026 — native Studio extensions: catalog in the side bar, details in the
 * editor area, permissions granted one by one, and the dynamic activity bar.
 */
test.describe("Studio extensions (ADR-026)", () => {
  test.setTimeout(150_000);

  test("Git is built in: grant its permission, open its panel from the activity bar", async ({
    page,
    request,
  }, testInfo) => {
    const stamp = Date.now();
    const project = await createStage9Project(request, `Stage9 Ext ${stamp}`);
    const root = await createMarkerWorkspace({ fileName: `ext-${stamp}.txt`, contents: "x" });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await linkWorkspaceRoot(request, project.id, root);

    await page.goto(studioProjectUrl(project.id), { waitUntil: "domcontentloaded" });
    const bar = page.getByRole("toolbar", { name: "Activity bar" });
    await expect(bar).toBeVisible({ timeout: 45_000 });

    // Built-in Git contributes its icon; the Extensions icon is always there.
    const gitIcon = bar.getByRole("button", { name: "Git", exact: true });
    await expect(gitIcon).toBeVisible({ timeout: 20_000 });
    await bar.getByRole("button", { name: "Extensions", exact: true }).click();

    const catalog = page.getByRole("region", { name: "Extensions" });
    await expect(catalog.getByRole("button", { name: "Cloud & deploy" })).toBeVisible();
    await catalog.getByRole("button", { name: "Git" }).click();

    const detail = page.getByRole("region", { name: "Extension: Git" });
    await expect(detail.getByText("Built-in extension: ships with ArletOS.")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Uninstall" })).toHaveCount(0);
    await expectNoA11yViolations(page, testInfo);

    // Installing (built-in: shipped) grants nothing — the panel asks first.
    await gitIcon.click();
    await expect(page.getByText("Git is waiting for permissions")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Grant permissions" }).first().click();
    await expect(page.getByText("Git is waiting for permissions")).toHaveCount(0, { timeout: 20_000 });
  });

  test("an official extension installs, enables, and can be uninstalled", async ({ page, request }) => {
    const stamp = Date.now();
    const project = await createStage9Project(request, `Stage9 Ext2 ${stamp}`);
    await page.goto(studioProjectUrl(project.id), { waitUntil: "domcontentloaded" });
    const bar = page.getByRole("toolbar", { name: "Activity bar" });
    await expect(bar).toBeVisible({ timeout: 45_000 });
    await bar.getByRole("button", { name: "Extensions", exact: true }).click();
    await page.getByRole("region", { name: "Extensions" }).getByRole("button", { name: "Engineering runs" }).click();

    const detail = page.getByRole("region", { name: "Extension: Engineering runs" });
    await detail.getByRole("button", { name: "Install" }).click();
    await detail.getByRole("button", { name: "Enable in project" }).click();
    await expect(bar.getByRole("button", { name: "Engineering runs", exact: true })).toBeVisible({ timeout: 20_000 });

    page.once("dialog", (dialog) => void dialog.accept());
    await detail.getByRole("button", { name: "Uninstall" }).click();
    await expect(bar.getByRole("button", { name: "Engineering runs", exact: true })).toHaveCount(0, { timeout: 20_000 });
  });
});
