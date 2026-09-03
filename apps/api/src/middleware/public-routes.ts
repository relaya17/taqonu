/**
 * ADR-021 — explicit PUBLIC allow-list. Everything else requires a session.
 * robots.txt is not a substitute for this list.
 */

const PUBLIC_EXACT = new Set([
  "GET /",
  "GET /health",
  "GET /favicon.ico",
  "GET /api/v1/health",
  "GET /api/v1/auth/providers",
  "GET /api/v1/auth/session",
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/register",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/mfa/verify",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/oauth/sync",
  "POST /api/v1/auth/password/forgot",
  "POST /api/v1/auth/password/reset",
  "POST /api/v1/github/webhooks",
  "POST /api/v1/billing/stripe/webhook",
  "POST /api/v1/contact",
  "GET /api/v1/legal-media/sources",
  "GET /api/v1/knowledge",
  "GET /api/v1/knowledge/verified-sources",
  "GET /api/v1/billing/credit-packs",
  "GET /api/v1/onboarding/storage-policy",
  // Cron may present CRON_SECRET instead of a user session (handler still authenticates).
  "GET /api/v1/knowledge/refresh",
  "POST /api/v1/knowledge/refresh",
  // Control Plane SERVICE bearer — handler authenticates as cp:service.
  "POST /api/v1/governance/lifecycle/handoff",
  "POST /api/v1/approvals/verify-atlas-self",
  "POST /api/v1/approvals/atlas-self/control-request",
]);

const PUBLIC_PREFIXES: ReadonlyArray<{ method: string; prefix: string }> = [
  { method: "GET", prefix: "/api/v1/github/install" },
  { method: "GET", prefix: "/api/v1/knowledge/verified-sources/download" },
];

export function normalizeRequestPath(url: string): string {
  const cut = url.indexOf("?");
  const path = cut >= 0 ? url.slice(0, cut) : url;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

export function isPublicAtlasRoute(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "OPTIONS" || verb === "HEAD") return true;
  const path = normalizeRequestPath(url);
  if (PUBLIC_EXACT.has(`${verb} ${path}`)) return true;
  return PUBLIC_PREFIXES.some(
    (entry) => verb === entry.method && path.startsWith(entry.prefix),
  );
}
