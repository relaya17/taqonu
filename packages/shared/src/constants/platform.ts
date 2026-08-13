/**
 * Platform identity — single source of truth for version sync across
 * web, API, README, and storage-policy responses.
 * Bump in lockstep with root / apps package.json when releasing.
 */
export const PLATFORM_NAME = "ArletOS" as const;
export const PLATFORM_CODENAME = "Atlas" as const;
export const PLATFORM_VERSION = "0.1.0" as const;
export const STORAGE_POLICY_VERSION = "2.0.0" as const;

/** Product rule: customer cloud holds data; Atlas meters product usage. */
export const STORAGE_MODELS = ["BYO_CUSTOMER_CLOUD"] as const;
export type StorageModel = (typeof STORAGE_MODELS)[number];

export const CUSTOMER_CLOUD_PROVIDERS = [
  "cloudflare",
  "aws",
  "azure",
  "gcp",
  "other",
] as const;
export type CustomerCloudProvider = (typeof CUSTOMER_CLOUD_PROVIDERS)[number];

/** Preferred free-tier cloud for customer BYO (they hold the account). */
export const PREFERRED_CUSTOMER_CLOUD: CustomerCloudProvider = "cloudflare";
