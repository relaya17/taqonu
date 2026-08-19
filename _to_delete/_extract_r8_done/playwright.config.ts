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
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The container ships a pre-baked Chromium (browsers.json revision
        // 1194, under PLAYWRIGHT_BROWSERS_PATH) that predates the
        // @playwright/test version resolved into this repo's lockfile
        // (1.62.1, which expects a newer "chromium_headless_shell"
        // revision that isn't present). Point directly at the pre-baked
        // full Chromium binary to sidestep the revision mismatch instead
        // of downloading a new browser (which this container's task
        // instructions say not to do).
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
            "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        },
      },
    },
  ],
});
