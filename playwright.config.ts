import { defineConfig, devices } from "@playwright/test";

/**
 * Minimal Playwright config.
 *
 * NOTE: this file did not exist anywhere in the repo before this run — there
 * was no playwright.config.{ts,js,mjs,cjs} at all, anywhere. Without it,
 * `playwright test` has no `use.baseURL`, so every `page.goto("/en")`-style
 * relative navigation in e2e/*.spec.ts throws immediately ("Cannot navigate
 * to invalid URL"), and CI's `PLAYWRIGHT_BASE_URL` / `PLAYWRIGHT_API_URL` env
 * vars (set in .github/workflows/e2e-critical-path.yml) were never actually
 * consumed by anything. This is added as the minimum viable config to make
 * the suite runnable at all, mirroring what e2e-critical-path.yml assumes
 * already exists.
 */
const localWebServers = [
  {
    command: "pnpm --filter @atlas/api dev",
    url: "http://127.0.0.1:4000/api/v1/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  {
    command: "pnpm --filter @atlas/web dev",
    url: "http://127.0.0.1:3000/he",
    reuseExistingServer: true,
    timeout: 180_000,
  },
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  // CI starts API + web in the workflow before Playwright. Locally, start
  // them here unless something is already listening (reuseExistingServer).
  webServer: process.env.CI ? undefined : localWebServers,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // CI (Linux image) may set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a
        // pre-baked binary. Local Windows/macOS must use Playwright's own
        // browser install — do not default to a Linux path.
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? {
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
              },
            }
          : {}),
      },
    },
  ],
});
