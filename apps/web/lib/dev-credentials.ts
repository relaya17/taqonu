/** Fixed demo account shared by Atlas, Sentinel, and Admin. */
export const DEV_CREDENTIALS = {
  domain: "atlas.local",
  email: "dev@atlas.local",
  password: "AtlasDev1!",
  displayName: "Atlas Dev",
} as const;

export const isDevLoginPrefill =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED === "1";
