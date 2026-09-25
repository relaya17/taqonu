import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { STAGE9_DECIDER_EMAIL, STAGE9_DECIDER_STATE, STAGE9_IDENTITY_RECORD, STAGE9_REQUESTER_EMAIL } from "./identities";
import { assertLocalTestApiUrl, stage9ApiBase } from "./local-api";
import type { Stage9IdentityFile } from "./identities";

test.describe("Stage 9.2 authenticated fixtures", () => {
  test.setTimeout(120_000);
  test("refuses Production and non-loopback API hosts", () => {
    expect(() =>
      assertLocalTestApiUrl("https://taqonu-api.vercel.app"),
    ).toThrow(/local\/test-only|non-local/);
    expect(() => assertLocalTestApiUrl("http://example.com:4000")).toThrow(
      /non-local/,
    );
    expect(assertLocalTestApiUrl("http://127.0.0.1:4000").hostname).toBe(
      "127.0.0.1",
    );
    expect(assertLocalTestApiUrl("http://localhost:4000").hostname).toBe(
      "localhost",
    );
  });

  test("requester storageState is a real authenticated session", async ({
    page,
    request,
  }) => {
    const api = stage9ApiBase();
    const me = await request.get(`${api}/api/v1/auth/me`);
    expect(me.status()).toBe(200);
    const body = (await me.json()) as {
      authenticated: boolean;
      user: { id: string; email: string };
    };
    expect(body.authenticated).toBe(true);
    expect(body.user.email.toLowerCase()).toBe(STAGE9_REQUESTER_EMAIL);

    await page.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/en\/studio/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 45_000 });
  });

  test("decider storageState is a distinct authenticated identity", async ({
    browser,
  }) => {
    const api = stage9ApiBase();
    const record = JSON.parse(
      await readFile(STAGE9_IDENTITY_RECORD, "utf8"),
    ) as Stage9IdentityFile;
    expect(record.requester.id).not.toBe(record.decider.id);
    expect(record.requester.email.toLowerCase()).toBe(STAGE9_REQUESTER_EMAIL);
    expect(record.decider.email.toLowerCase()).toBe(STAGE9_DECIDER_EMAIL);

    const context = await browser.newContext({
      storageState: STAGE9_DECIDER_STATE,
    });
    try {
      const me = await context.request.get(`${api}/api/v1/auth/me`);
      expect(me.status()).toBe(200);
      const body = (await me.json()) as {
        authenticated: boolean;
        user: { id: string; email: string };
      };
      expect(body.authenticated).toBe(true);
      expect(body.user.email.toLowerCase()).toBe(STAGE9_DECIDER_EMAIL);
      expect(body.user.id).toBe(record.decider.id);
      expect(body.user.id).not.toBe(record.requester.id);
    } finally {
      await context.close();
    }
  });
});
