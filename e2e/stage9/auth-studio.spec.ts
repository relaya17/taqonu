import { test, expect } from "@playwright/test";
import { loginViaUi } from "./accounts";
import {
  STAGE9_DECIDER_STATE,
  STAGE9_REQUESTER,
  STAGE9_REQUESTER_EMAIL,
} from "./identities";
import { stage9ApiBase } from "./local-api";
import { createStage9Project } from "./projects";

test.describe("Stage 9.3 auth + Studio entry + project context", () => {
  test.setTimeout(120_000);

  test("login through the real form reaches authenticated Studio", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginViaUi(page, STAGE9_REQUESTER);
      await expect(page).toHaveURL(/\/en\/studio/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Project Studio" }),
      ).toBeVisible({ timeout: 45_000 });
      const me = await page.request.get(`${stage9ApiBase(page.url())}/api/v1/auth/me`);
      expect(me.status()).toBe(200);
      const body = (await me.json()) as { user: { email: string } };
      expect(body.user.email.toLowerCase()).toBe(STAGE9_REQUESTER_EMAIL);
    } finally {
      await context.close();
    }
  });

  test("storageState session stays authenticated on Studio", async ({
    page,
    request,
  }) => {
    const api = stage9ApiBase();
    const session = await request.get(`${api}/api/v1/auth/session`);
    expect(session.ok()).toBeTruthy();
    const sessionBody = (await session.json()) as {
      authenticated: boolean;
      user: { email: string };
    };
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.user.email.toLowerCase()).toBe(STAGE9_REQUESTER_EMAIL);

    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
  });

  test("logout clears the session and returns to login", async ({ page }) => {
    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });

    const openMenu = page.getByRole("button", { name: /open menu/i });
    if (await openMenu.isVisible()) {
      await openMenu.click();
    }
    const signOut = page.getByRole("button", { name: /^sign out$/i });
    await expect(signOut).toBeVisible({ timeout: 20_000 });
    await signOut.click();
    await page.waitForURL(/\/en\/auth\/login/, {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1, name: /sign in/i })).toBeVisible();

    const me = await page.request.get(`${stage9ApiBase(page.url())}/api/v1/auth/me`);
    expect(me.status()).toBe(401);
  });

  test("project picker lists a created project and selection updates context", async ({
    page,
    request,
  }) => {
    const project = await createStage9Project(request, `Stage9 Alpha ${Date.now()}`);
    const listed = await request.get(`${stage9ApiBase()}/api/v1/projects`);
    expect(listed.ok()).toBeTruthy();
    const catalog = (await listed.json()) as { items?: Array<{ id: string; name: string }> };
    expect(catalog.items?.some((item) => item.id === project.id)).toBe(true);

    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Select a project above to open Studio.")).toBeVisible({
      timeout: 20_000,
    });

    const picker = page.getByRole("combobox", { name: /project/i });
    await expect(picker).toBeVisible();
    await picker.click();
    const option = page
      .locator('[role="option"], [role="menuitem"]')
      .filter({ hasText: project.name });
    await expect(option.first()).toBeVisible({ timeout: 20_000 });
    await option.first().click();
    await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
    await expect(picker).toContainText(project.name);
  });

  test("decider session cannot be used as the requester cookie jar", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: STAGE9_DECIDER_STATE });
    try {
      const api = stage9ApiBase();
      const me = await context.request.get(`${api}/api/v1/auth/me`);
      expect(me.status()).toBe(200);
      const body = (await me.json()) as { user: { email: string } };
      expect(body.user.email.toLowerCase()).not.toBe(STAGE9_REQUESTER_EMAIL);
    } finally {
      await context.close();
    }
  });
});
