import { isAtlasDemoLoginEnabled } from "@atlas/shared";

/**
 * Local-development identity hints. Never include a password: this module
 * is imported by client login pages and would ship in the Web bundle.
 */
export const DEV_CREDENTIALS = {
  domain: "atlas.local",
  email: "dev@atlas.local",
  displayName: "Atlas Dev",
} as const;

export const isDevLoginPrefill = isAtlasDemoLoginEnabled({
  nodeEnv: process.env.NODE_ENV,
  flag: process.env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED,
});
