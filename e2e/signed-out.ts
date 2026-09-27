import { expect, type Page, type Response } from "@playwright/test";

/**
 * Collects every Atlas API response rejected with 401 while `run` executes.
 * A signed-out visit must not mount private pages, so this list stays empty.
 */
export async function rejectedApiCalls(
  page: Page,
  run: () => Promise<void>,
): Promise<string[]> {
  const rejected: string[] = [];
  const onResponse = (response: Response) => {
    if (response.status() === 401 && response.url().includes("/api/v1/")) {
      rejected.push(`${response.request().method()} ${response.url()}`);
    }
  };
  page.on("response", onResponse);
  try {
    await run();
  } finally {
    page.off("response", onResponse);
  }
  return rejected;
}

/**
 * Opens a private locale page without a session and proves the shell sends
 * the visitor to sign-in (keeping `next` only for the audit doors) without
 * firing a single request the API rejects.
 */
export async function expectSignInRedirect(
  page: Page,
  path: string,
  next?: "/partners" | "/experts",
): Promise<void> {
  const locale = path.split("/")[1];
  const loginUrl = new RegExp(
    `/${locale}/auth/login${next ? `\\?next=${next}` : ""}$`,
  );
  const rejected = await rejectedApiCalls(page, async () => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(loginUrl, { timeout: 45_000 });
    await expect(page.locator('input[type="password"]')).toBeVisible({
      timeout: 45_000,
    });
  });
  expect(rejected, `${path} fired API calls the API rejected with 401`).toEqual([]);
}
