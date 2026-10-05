import { defineConfig, devices } from "@playwright/test";

/**
 * Studio editor regression gate: real browser -> real Next.js Studio -> real API
 * app (the existing test-only harness, used here only as a local API + auth
 * stack). The same behaviours run against the textarea and Monaco backends.
 *
 * Both servers bind loopback on their own ports so this never collides with the
 * default :3000/:4000 development stack. Local/test only. Never Production.
 */
const API_PORT = 4100;
const WEB_PORT = 3100;
// `localhost` on both: the Next.js dev server binds it (its own internal proxying targets it),
// and the same host keeps the session cookies same-site, as in the Stage 9 stack.
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

// The shared Stage 9 fixtures read these when the test worker imports them.
process.env.PLAYWRIGHT_API_URL = API_URL;
process.env.PLAYWRIGHT_BASE_URL = WEB_URL;

const env = (extra: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) out[key] = value;
  return { ...out, ...extra };
};

const chromiumLaunch = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
  : {};

export default defineConfig({
  testDir: "./e2e/editor",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 240_000,
  webServer: [
    {
      command: "pnpm exec tsx e2e/debugger/harness-api.ts",
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: env({ DEBUGGER_E2E_API_PORT: String(API_PORT), DEBUGGER_E2E_WEB_ORIGIN: WEB_URL }),
    },
    {
      // EDITOR_GATE_PROD=1 serves a prior production build (`next build` with the same
      // NEXT_PUBLIC_* values) instead of the dev server, to prove the bundled output.
      command: `pnpm --filter @atlas/web exec next ${process.env.EDITOR_GATE_PROD === "1" ? "start" : "dev"} -p ${WEB_PORT} -H localhost`,
      url: `${WEB_URL}/en`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: env({ NEXT_PUBLIC_API_URL: API_URL, NEXT_PUBLIC_STUDIO_EDITOR_TEST_SEAM: "1" }),
    },
  ],
  use: { baseURL: WEB_URL, trace: "retain-on-failure" },
  projects: [{ name: "editor-gate", use: { ...devices["Desktop Chrome"], ...chromiumLaunch } }],
});
