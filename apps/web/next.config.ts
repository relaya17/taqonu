// Vercel deployment configured: Root Directory = apps/web
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Same-origin API proxy. With NEXT_PUBLIC_API_PROXY=1 the browser calls
 * `/api/v1/*` on this host (see lib/api.ts resolveApiUrl) and Next forwards it
 * to the API, so the session cookie is first-party and survives browsers that
 * block third-party cookies. Target: API_PROXY_TARGET, else NEXT_PUBLIC_API_URL.
 */
function apiProxyTarget(): string | null {
  if (process.env.NEXT_PUBLIC_API_PROXY !== "1") return null;
  const raw = process.env.API_PROXY_TARGET ?? process.env.NEXT_PUBLIC_API_URL;
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_API_PROXY=1 requires API_PROXY_TARGET or NEXT_PUBLIC_API_URL (absolute API origin)",
    );
  }
  const url = new URL(raw);
  return url.origin;
}

const nextConfig: NextConfig = {
  // Windows cannot create standalone symlinks without Developer Mode (EPERM).
  ...(process.platform === "win32" ? {} : { output: "standalone" as const }),
  // Stop Next from treating C:\Users\User as the workspace (home-dir pnpm-lock.yaml).
  outputFileTracingRoot: monorepoRoot,
  // Keep Emotion/MUI on one module instance under Turbopack (avoids css-* vs mui-* hydration mismatches).
  transpilePackages: [
    "@atlas/shared",
    "@mui/material",
    "@mui/icons-material",
    "@mui/material-nextjs",
    "@emotion/react",
    "@emotion/styled",
    "@emotion/cache",
  ],
  reactStrictMode: true,
  // Playwright and some clients hit 127.0.0.1 while next binds 0.0.0.0.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  /** Faster cold navigations in local lab. */
  experimental: {
    optimizePackageImports: ["@mui/material", "@mui/icons-material"],
  },
  async rewrites() {
    const target = apiProxyTarget();
    if (!target) return [];
    return {
      beforeFiles: [{ source: "/api/v1/:path*", destination: `${target}/api/v1/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
  /**
   * Legacy orphan aliases → canonical product surfaces.
   * Server-side 307 so the redirect happens before rendering (avoids prerender 200).
   */
  async redirects() {
    return [
      { source: "/:locale(he|en|ar|fr)/state", destination: "/:locale/projects", permanent: false },
      { source: "/:locale(he|en|ar|fr)/chat", destination: "/:locale/workbench", permanent: false },
      { source: "/:locale(he|en|ar|fr)/agent", destination: "/:locale/agents", permanent: false },
      { source: "/:locale(he|en|ar|fr)/proof", destination: "/:locale/readiness", permanent: false },
    ];
  },
};

export default withNextIntl(nextConfig);
