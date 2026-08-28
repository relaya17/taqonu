import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
};

export default withNextIntl(nextConfig);
