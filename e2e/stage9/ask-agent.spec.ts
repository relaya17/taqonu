import { test, expect } from "@playwright/test";
import {
  createMarkerWorkspace,
  createStage9Project,
  linkWorkspaceRoot,
  studioProjectUrl,
} from "./projects";

test.describe("Stage 9.5 Ask Agent + patch proposal", () => {
  test.setTimeout(120_000);

  test("authenticated Ask Agent creates a visible patch proposal", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const fileName = "hello.ts";
    const project = await createStage9Project(request, `Stage9 Ask ${stamp}`);
    const root = await createMarkerWorkspace({
      fileName,
      contents: "export const greeting = 'hello';\n",
    });
    await linkWorkspaceRoot(request, project.id, root);

    await page.goto(studioProjectUrl(project.id), { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: fileName })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: fileName }).click();

    const instruction = page.getByRole("textbox", { name: /what should change/i });
    await expect(instruction).toBeVisible({ timeout: 20_000 });
    await instruction.fill("hello.ts: change the greeting export comment");

    const ask = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/studio/ask-agent") && res.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: /^ask agent$/i }).click();
    const response = await ask;
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      patch?: { id?: string; status?: string; title?: string };
    };
    expect(body.patch?.id).toBeTruthy();
    expect(body.patch?.status).toMatch(/PROPOSED|EVALUATED|AWAITING_APPROVAL|DRAFT/);

    await expect(
      page.getByText("Propose → review → approve → apply → verify"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(body.patch!.status!, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    if (body.patch?.title) {
      await expect(page.getByText(body.patch.title).first()).toBeVisible();
    }
  });
});
