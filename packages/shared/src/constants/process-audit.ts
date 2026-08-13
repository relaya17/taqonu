/** App-class profiles — each gets tailored internal-process journeys. */
export const PROCESS_APP_PROFILES = [
  "GENERIC",
  "HOTEL",
  "SAAS",
  "ECOMMERCE",
  "MARKETPLACE",
  "CONTENT",
  "FINTECH",
  "HEALTH",
  "EDTECH",
] as const;

export type ProcessAppProfile = (typeof PROCESS_APP_PROFILES)[number];

/** Four production gates (HotelOS-style example generalized). */
export const PROCESS_GATES = [
  "GATE_1_CORRECT_ENTRY",
  "GATE_2_AUTHORIZATION",
  "GATE_3_TENANT_ISOLATION",
  "GATE_4_REAL_E2E_ACTION",
] as const;

export type ProcessGateId = (typeof PROCESS_GATES)[number];

export const PROCESS_VERDICTS = ["GO", "CONDITIONAL_GO", "NO_GO"] as const;

export type ProcessVerdict = (typeof PROCESS_VERDICTS)[number];

export const PROCESS_ITEM_KINDS = [
  "DEFECT",
  "FUTURE_CHECK",
  "PASS",
  "BLOCKER",
  "RECOMMENDATION",
] as const;

export type ProcessItemKind = (typeof PROCESS_ITEM_KINDS)[number];

export const PROCESS_DIMENSIONS = [
  "AUTH_JOURNEY",
  "RBAC",
  "TENANT_ISOLATION",
  "BUSINESS_E2E",
  "AI_HITL",
  "UI_UX",
  "PERFORMANCE",
  "ACCESSIBILITY",
  "SECURITY",
  "DATABASE",
  "PROVIDERS",
  "WEBHOOKS",
  "AUDIT_TRAIL",
  "VISUAL_DESIGN",
] as const;

export type ProcessDimension = (typeof PROCESS_DIMENSIONS)[number];

/** Specialists the process agent councils by default. */
export const PROCESS_SPECIALIST_EXPERTS = [
  "QA",
  "SECURITY",
  "ENGINEERING",
  "UI_UX",
  "VISUAL_DESIGN",
  "ACCESSIBILITY",
  "DEVOPS",
  "PRODUCT",
  "LEGAL_MEDIA",
] as const;

/** Hosting / data providers the service can observe or plan against. */
export const PROCESS_PROVIDER_TARGETS = [
  "github",
  "local",
  "vercel",
  "netlify",
  "render",
  "supabase",
  "mongodb",
  "ci",
  "sentry",
  "stripe",
] as const;

export type ProcessProviderTarget = (typeof PROCESS_PROVIDER_TARGETS)[number];
