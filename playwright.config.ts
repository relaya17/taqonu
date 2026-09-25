import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  STAGE9_OPERATOR_EMAILS_ENV,
  STAGE9_REQUESTER_STATE,
} from "./e2e/stage9/identities";

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
function envWith(extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) out[key] = value;
  }
  return { ...out, ...extra };
}

const chromiumLaunch = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
  : {};

const stage9AuthDir = join(tmpdir(), `atlas-stage9-${Date.now()}`);

const localWebServers = [
  {
    command: "pnpm --filter @atlas/api dev",
    url: "http://127.0.0.1:4000/api/v1/health",
    reuseExistingServer: true,
    timeout: 180_000,
    env: envWith({
      ATLAS_OPERATOR_EMAILS: STAGE9_OPERATOR_EMAILS_ENV,
      // bootstrapRole runs only in createLocalUser. .atlas/users.json already
      // has stage9-decider@atlas.test as role "user" from an earlier create.
      // ATLAS_SKIP_STORE_PERSIST does not touch that auth file. A fresh auth
      // file lets this process create the decider while the operator list is set.
      ATLAS_AUTH_PATH: join(stage9AuthDir, "users.json"),
      ATLAS_SESSIONS_PATH: join(stage9AuthDir, "sessions.json"),
      // apps/api/.env points at a live local Supabase. Register then returns
      // the new local id, while /auth/me prefers the existing Supabase user
      // for the same email (the old .atlas id). Stage 9 identity is the
      // local session. CI already uses this sentinel.
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
      ATLAS_SKIP_STORE_PERSIST: "1",
    }),
  },
  {
    command: "pnpm --filter @atlas/web dev",
    // apps/web binds `-H localhost` (typically ::1 on Windows). Checking
    // 127.0.0.1 misses a live Studio and then fails with EADDRINUSE on ::1.
    url: "http://localhost:3000/he",
    reuseExistingServer: true,
    timeout: 180_000,
  },
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  // CI starts API + web in the workflow before Playwright. Locally, start
  // them here unless something is already listening (reuseExistingServer).
  webServer: process.env.CI ? undefined : localWebServers,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /[/\\]stage9[/\\]/,
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumLaunch,
      },
    },
    {
      name: "stage9-setup",
      testMatch: /[/\\]stage9[/\\]auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], ...chromiumLaunch },
    },
    {
      name: "stage9",
      testMatch: /[/\\]stage9[/\\].*\.spec\.ts/,
      dependencies: ["stage9-setup"],
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumLaunch,
        storageState: STAGE9_REQUESTER_STATE,
      },
    },
  ],
});
