import { API_BASE } from "../helpers";
import type { BrowserContext } from "@playwright/test";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Fail-closed: Stage 9 may only rewrite cookies bound to loopback hosts. */
export function assertLoopbackCookieHost(domain: string): void {
  const host = domain.replace(/^\./, "").toLowerCase();
  if (host && !LOOPBACK.has(host)) {
    throw new Error(
      `Stage 9 fixture refuses to rewrite cookies for host "${domain}"`,
    );
  }
}

/**
 * CI `NODE_ENV=production` requires Origin on cookie-authenticated writes.
 * Playwright APIRequestContext does not send Origin by default.
 */
export function stage9MutationHeaders(
  webOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
): Record<string, string> {
  const origin = new URL(webOrigin).origin;
  return {
    "content-type": "application/json",
    origin,
    referer: `${origin}/en/studio`,
  };
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

/**
 * CI sets NODE_ENV=production so the API issues SameSite=None; Secure cookies.
 * Chromium will not send Secure cookies on http://127.0.0.1. Production cookie
 * issuance is unchanged. This rewrite is loopback/test-only and fail-closed
 * for any non-loopback cookie host.
 */
export async function softenLoopbackSessionCookies(
  context: BrowserContext,
): Promise<void> {
  const api = stage9ApiBase();
  const state = await context.storageState();
  if (state.cookies.length === 0) {
    throw new Error("Stage 9 fixture: register/login did not set any cookies");
  }
  const rewritten = state.cookies.map((cookie) => {
    assertLoopbackCookieHost(cookie.domain);
    const next: {
      name: string;
      value: string;
      url: string;
      httpOnly: boolean;
      sameSite: "Lax";
      expires?: number;
    } = {
      name: cookie.name,
      value: cookie.value,
      url: api,
      httpOnly: cookie.httpOnly,
      sameSite: "Lax",
    };
    if (cookie.expires > 0) {
      next.expires = cookie.expires;
    }
    return next;
  });
  await context.clearCookies();
  await context.addCookies(rewritten);
}
