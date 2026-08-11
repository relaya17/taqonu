export const INTEGRATION_PROVIDERS = [
  "github",
  "local",
  "google",
  "vercel",
  "netlify",
  "render",
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const GOOGLE_SERVICES = [
  "drive",
  "docs",
  "sheets",
  "gmail",
  "calendar",
] as const;

export type GoogleService = (typeof GOOGLE_SERVICES)[number];
