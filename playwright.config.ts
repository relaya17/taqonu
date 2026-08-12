import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright suites for ArletOS (e2e/).
 *
 *   pnpm test:e2e              — all suites
 *   pnpm test:e2e:critical     — critical-path smoke (keep green)
 *   pnpm test:e2e:product      — broader product surfaces
 *   pnpm test:e2e:security     — API auth / webhook / redaction checks
 *   pnpm test:e2e:a11y         — light a11y / responsive smoke
 *
 * Requires: pnpm exec playwright install
 * Optional: PLAYWRIGHT_BASE_URL (web), PLAYWRIGHT_API_URL (API, default :4000)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
