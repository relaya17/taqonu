import { defineConfig, devices } from "@playwright/test";

/**
 * Minimal Playwright config.
 *
 * Without it, `playwright test` has no `use.baseURL`, so every
 * `page.goto("/en")`-style relative navigation in e2e/*.spec.ts throws
 * immediately ("Cannot navigate to invalid URL"), and CI's
 * `PLAYWRIGHT_BASE_URL` / `PLAYWRIGHT_API_URL` env vars (set in
 * .github/workflows/e2e-critical-path.yml) are never actually consumed by
 * anything.
 */

/**
 * Optional override for the Chromium binary.
 *
 * DEFAULT (unset) is the correct setting for CI and for any normal
 * checkout: Playwright then resolves the browser it installed itself — in
 * CI that's the one `.github/workflows/e2e-critical-path.yml` installs via
 * `pnpm exec playwright install --with-deps chromium`.
 *
 * This is deliberately opt-in rather than a hardcoded fallback. A previous
 * revision of this file hardcoded a sandbox-specific path
 * (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) as the default, to
 * work around a browser-revision mismatch inside one particular development
 * container. That path does not exist on a GitHub Actions runner, so every
 * E2E test failed at launch — in ~3ms, before any page was ever loaded —
 * with "Failed to launch chromium because executable doesn't exist". The
 * workflow was installing the right browser and the config was then
 * pointing away from it.
 *
 * Environment-specific paths must never be the default in a committed
 * config: set this env var in the environment that needs it instead.
 */
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
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
        // Spread only when explicitly overridden — see the doc comment on
        // `chromiumExecutablePath` above. When unset, Playwright resolves
        // its own installed browser, which is what CI needs.
        ...(chromiumExecutablePath
          ? { launchOptions: { executablePath: chromiumExecutablePath } }
          : {}),
      },
    },
  ],
});
