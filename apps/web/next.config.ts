import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
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
  /** Faster cold navigations in local lab. */
  experimental: {
    optimizePackageImports: ["@mui/material", "@mui/icons-material"],
  },
};

export default withNextIntl(nextConfig);
