import { test, expect, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "../axe";

/**
 * Signed-in content of the product pages. The signed-out suites
 * (critical-path, product-surfaces, new-surfaces, a11y) prove these pages
 * send a visitor without a session to sign-in; this file checks what they
 * show to the Stage 9 requester. `<main>` renders while the session is being
 * checked too, so every page is asserted through its own heading.
 */

async function expectPageHeading(page: Page, name?: string | RegExp) {
  await expect(page.locator("main#main-content")).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByRole("heading", { level: 1, ...(name ? { name } : {}) }).first(),
  ).toBeVisible({ timeout: 45_000 });
}

test.describe("Signed-in critical path (HE)", () => {
  test.setTimeout(120_000);

  test("home loads brand and verdict area", async ({ page }) => {
    await page.goto("/he");
    await expectPageHeading(page, /ArletOS|Atlas/i);
  });

  test("health page reachable", async ({ page }) => {
    await page.goto("/he/health");
    await expect(page).toHaveURL(/\/he\/studio\?.*check=health/, { timeout: 30_000 });
    await expectPageHeading(page);
  });

  test("readiness page reachable", async ({ page }) => {
    await page.goto("/he/readiness");
    await expect(page).toHaveURL(/\/he\/studio\?.*check=readiness/, { timeout: 30_000 });
    await expectPageHeading(page);
  });

  test("architecture contract page reachable", async ({ page }) => {
    await page.goto("/he/contract");
    await expectPageHeading(page, "חוזה ארכיטקטורה");
  });
});

test.describe("Signed-in product surfaces (EN)", () => {
  test.setTimeout(120_000);

  test("home / verdict area loads brand", async ({ page }) => {
    await page.goto("/en");
    await expectPageHeading(page, /ArletOS|Atlas/i);
  });

  test("dashboard shows onboarding path", async ({ page }) => {
    await page.goto("/en");
    await expectPageHeading(page);
    await expect(
      page.getByText(/link a local folder|start here|workbench|E2E/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("readiness page shows title", async ({ page }) => {
    await page.goto("/en/readiness");
    await expect(page).toHaveURL(/\/en\/studio\?.*check=readiness/, { timeout: 30_000 });
    // Studio carries its own "Project Studio" <h1> next to the panel heading.
    await expectPageHeading(page, "Production Readiness");
  });

  test("health / system scorecard reachable", async ({ page }) => {
    await page.goto("/en/health");
    await expect(page).toHaveURL(/\/en\/studio\?.*check=health/, { timeout: 30_000 });
    await expectPageHeading(page, "System Health");
  });

  test("partners / import surface reachable", async ({ page }) => {
    await page.goto("/en/partners");
    await expectPageHeading(page);
    // Import tabs are the interactive core of the partners surface.
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 20_000 });
  });

  test("systems command center reachable", async ({ page }) => {
    await page.goto("/en/systems");
    await expectPageHeading(page);
  });

  test("projects portfolio page reachable", async ({ page }) => {
    await page.goto("/en/projects");
    await expectPageHeading(page);
    await expect(
      page.getByText(/project|portfolio|discover|empty|registered|folder/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("ops / metrics page reachable", async ({ page }) => {
    await page.goto("/en/ops/metrics");
    await expectPageHeading(page);
    await expect(
      page.getByText(/ops metrics|sample|prometheus|metric/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("specialist lanes / agents page reachable", async ({ page }) => {
    await page.goto("/en/agents");
    await expectPageHeading(page);
    await expect(
      page.getByText(/specialist|orchestrator|evidence|plan|dispatch/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("model marketplace page reachable", async ({ page }) => {
    await page.goto("/en/models");
    // Signed in, the collapsed companion bar holds a hidden "Marketplace"
    // link ahead of the page, so the page is asserted through its own copy.
    await expectPageHeading(page, "Model marketplace");
    await expect(
      page.getByText(/strength, weakness, and credit cost/i),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("workbench lands in the Studio chat tab", async ({ page }) => {
    await page.goto("/en/workbench");
    await expect(page).toHaveURL(/\/en\/studio\?.*tab=chat/, { timeout: 30_000 });
    await expectPageHeading(page);
    await expect(
      page.getByText(/studio|project|files|local path|folder|agent|chat/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("process-audit route lands in Studio Checks", async ({ page }) => {
    await page.goto("/en/process-audit");
    await expect(page).toHaveURL(/\/en\/studio\?.*check=processAudit/, { timeout: 30_000 });
    await expectPageHeading(page);
  });

  test("pricing shows the account plan instead of a sign-in prompt", async ({ page }) => {
    await page.goto("/en/plan");
    await expectPageHeading(page, "Readiness Audit & BYO cloud");
    await expect(page.getByText(/Current tier: (FREE|PRO)/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Sign in to see your plan, usage and cloud connection.")).toHaveCount(0);
  });
});

test.describe("Signed-in surfaces for every user-facing capability (EN)", () => {
  test.setTimeout(120_000);

  for (const [path, heading] of [
    ["/en?view=activity", /activity/i],
    ["/en?view=insights", /insights/i],
    ["/en/agents?view=knowledge", /knowledge/i],
    ["/en/agents?view=intelligence", /intelligence/i],
  ] as const) {
    test(`${path} renders its view without axe violations`, async ({ page }, testInfo) => {
      await page.goto(path);
      await expectPageHeading(page, heading);
      await expectNoA11yViolations(page, testInfo);
    });
  }

  test("legacy /activity and /knowledge land on the new views", async ({ page }) => {
    await page.goto("/en/activity");
    await expect(page).toHaveURL(/\/en\?view=activity/, { timeout: 30_000 });
    await page.goto("/en/knowledge");
    await expect(page).toHaveURL(/\/en\/agents\?view=knowledge/, { timeout: 30_000 });
  });

  test("Studio Checks include constitution and benchmarks", async ({ page }, testInfo) => {
    await page.goto("/en/studio?tab=checks&check=constitution");
    await expectPageHeading(page);
    await expect(page.getByRole("tab", { name: "Constitution" })).toBeVisible({ timeout: 20_000 });
    await expectNoA11yViolations(page, testInfo);
    await page.goto("/en/studio?tab=checks&check=benchmarks");
    await expect(page.getByRole("tab", { name: "Benchmarks & proof" })).toBeVisible({ timeout: 20_000 });
    await expectNoA11yViolations(page, testInfo);
  });
});

test.describe("Signed-in legacy orphan redirects (EN)", () => {
  test.setTimeout(120_000);

  test("/state redirects to projects", async ({ page }) => {
    await page.goto("/en/state");
    await expect(page).toHaveURL(/\/en\/projects/, { timeout: 30_000 });
    await expectPageHeading(page);
  });

  test("/chat redirects to workbench, which lands in Studio chat", async ({ page }) => {
    const response = await page.goto("/en/chat");
    expect(response, "document response for /en/chat").not.toBeNull();
    expect(new URL(response!.url()).pathname).toBe("/en/workbench");
    await expect(page).toHaveURL(/\/en\/studio\?.*tab=chat/, { timeout: 30_000 });
  });

  test("/agent redirects to agents", async ({ page }) => {
    await page.goto("/en/agent");
    await expect(page).toHaveURL(/\/en\/agents/, { timeout: 30_000 });
    await expectPageHeading(page);
  });

  test("/proof redirects to Studio Checks readiness", async ({ page }) => {
    await page.goto("/en/proof");
    await expect(page).toHaveURL(/\/en\/studio\?.*check=readiness/, { timeout: 30_000 });
    await expectPageHeading(page);
  });
});

test.describe("Signed-in counsel + security surfaces (EN)", () => {
  test.setTimeout(120_000);

  test("legal-media counsel briefing loads", async ({ page }) => {
    await page.goto("/en/legal-media");
    await expectPageHeading(page);
    await expect(page.getByText(/not legal advice/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("sentinel security check loads", async ({ page }) => {
    await page.goto("/en/sentinel");
    await expect(page).toHaveURL(/\/en\/studio\?.*check=sentinel/, { timeout: 30_000 });
    await expectPageHeading(page);
  });

  test("observer loads", async ({ page }) => {
    await page.goto("/en/observer");
    await expect(page).toHaveURL(/\/en\/studio\?.*check=observer/, { timeout: 30_000 });
    await expectPageHeading(page);
  });
});

test.describe("Signed-in a11y (EN)", () => {
  test("memory page exposes main landmark and heading", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto("/en/memory");
    await expect(page).toHaveURL(/\/en\?.*desk=memory/, { timeout: 30_000 });
    await expectPageHeading(page);
    await expectNoA11yViolations(page, testInfo);
  });

  test("primary surfaces avoid horizontal overflow on narrow viewports", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of [
      "/en",
      "/en/projects",
      "/en/systems",
      "/en/health",
      "/en/decisions",
      "/en/agents",
      "/en/memory",
    ]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expectPageHeading(page);
      const overflowed = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth + 2;
      });
      expect(overflowed, `${path} should not overflow horizontally`).toBe(false);
      await expectNoA11yViolations(page, testInfo);
    }
  });
});
