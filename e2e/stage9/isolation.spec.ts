import { test, expect } from "@playwright/test";
import {
  createMarkerWorkspace,
  createStage9Project,
  linkWorkspaceRoot,
  selectStudioProject,
  studioProjectUrl,
} from "./projects";

test.describe("Stage 9.4 switch, isolation, persistence, deep links", () => {
  test.setTimeout(120_000);

  test("switch A → B isolates workspace and survives refresh + deep link", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const projectA = await createStage9Project(request, `Stage9 Iso A ${stamp}`);
    const projectB = await createStage9Project(request, `Stage9 Iso B ${stamp}`);
    const fileA = `alpha-${stamp}.txt`;
    const fileB = `beta-${stamp}.txt`;
    const rootA = await createMarkerWorkspace({
      fileName: fileA,
      contents: `PROJECT_A_ONLY ${stamp}`,
    });
    const rootB = await createMarkerWorkspace({
      fileName: fileB,
      contents: `PROJECT_B_ONLY ${stamp}`,
    });
    await linkWorkspaceRoot(request, projectA.id, rootA);
    await linkWorkspaceRoot(request, projectB.id, rootB);

    await page.goto(studioProjectUrl(projectA.id), { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("combobox", { name: /project/i })).toContainText(
      projectA.name,
    );
    await expect(page.getByRole("button", { name: fileA })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: fileB })).toHaveCount(0);
    await page.getByRole("button", { name: fileA }).click();
    await expect(page.getByRole("textbox", { name: fileA })).toHaveValue(
      `PROJECT_A_ONLY ${stamp}`,
      { timeout: 20_000 },
    );

    await selectStudioProject(page, projectB.name);
    await expect(page).toHaveURL(new RegExp(`project=${projectB.id}`));
    await expect(page.getByRole("button", { name: fileB })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: fileA })).toHaveCount(0);
    await page.getByRole("button", { name: fileB }).click();
    await expect(page.getByRole("textbox", { name: fileB })).toHaveValue(
      `PROJECT_B_ONLY ${stamp}`,
      { timeout: 20_000 },
    );
    await expect(page.getByRole("textbox", { name: fileA })).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`project=${projectB.id}`));
    await expect(page.getByRole("combobox", { name: /project/i })).toContainText(
      projectB.name,
    );
    await expect(page.getByRole("button", { name: fileB })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: fileA })).toHaveCount(0);

    await page.goto(studioProjectUrl(projectA.id), { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`project=${projectA.id}`));
    await expect(page.getByRole("combobox", { name: /project/i })).toContainText(
      projectA.name,
    );
    await expect(page.getByRole("button", { name: fileA })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: fileB })).toHaveCount(0);
    await page.getByRole("button", { name: fileA }).click();
    await expect(page.getByRole("textbox", { name: fileA })).toHaveValue(
      `PROJECT_A_ONLY ${stamp}`,
      { timeout: 20_000 },
    );
    await expect(page.getByRole("textbox", { name: fileB })).toHaveCount(0);
  });
});
