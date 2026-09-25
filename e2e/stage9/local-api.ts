import { API_BASE } from "../helpers";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * Stage 9 authenticated fixtures are local/test-only.
 * They must never target Production or any non-loopback API host.
 */
export function assertLocalTestApiUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Stage 9 fixture: invalid API URL "${raw}"`);
  }
  if (parsed.protocol !== "http:") {
    throw new Error(
      `Stage 9 fixture is local/test-only and requires http:// loopback, not ${parsed.protocol}//${parsed.host}`,
    );
  }
  if (!LOOPBACK.has(hostnameOf(parsed))) {
    throw new Error(
      `Stage 9 fixture refuses non-local API host "${parsed.hostname}". Do not use Production credentials or Production API URLs.`,
    );
  }
  return parsed;
}

/**
 * Prefer the same loopback host as the Playwright web origin so session
 * cookies set by the browser (localhost vs 127.0.0.1) attach to API calls.
 */
export function stage9ApiBase(
  webOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
): string {
  const api = new URL(API_BASE);
  const web = new URL(webOrigin);
  if (LOOPBACK.has(hostnameOf(api)) && LOOPBACK.has(hostnameOf(web))) {
    api.hostname = web.hostname;
  }
  return assertLocalTestApiUrl(api.toString()).toString().replace(/\/$/, "");
}
