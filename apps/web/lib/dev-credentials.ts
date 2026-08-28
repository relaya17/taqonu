/**
 * Fixed local development account — never used in production builds.
 * Domain / email / password stay the same across Atlas, Sentinel, and Admin.
 */
export const DEV_CREDENTIALS = {
  domain: "atlas.local",
  email: "dev@atlas.local",
  password: "AtlasDev1!",
  displayName: "Atlas Dev",
} as const;

export const isDevLoginPrefill = process.env.NODE_ENV !== "production";
