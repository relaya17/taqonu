import type { APIRequestContext } from "@playwright/test";

/** API base for Playwright request checks (not the web baseURL). */
export const API_BASE =
  process.env.PLAYWRIGHT_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:4000";

/** True when API /health responds OK — used to skip API-dependent assertions. */
export async function apiHealthy(
  request: APIRequestContext,
  timeoutMs = 5_000,
): Promise<boolean> {
  try {
    const res = await request.get(`${API_BASE}/api/v1/health`, {
      timeout: timeoutMs,
    });
    return res.ok();
  } catch {
    return false;
  }
}
