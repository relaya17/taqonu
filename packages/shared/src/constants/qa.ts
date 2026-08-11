export const QA_SCOPES = [
  "SINGLE_PROJECT",
  "SELECTED_PROJECTS",
  "ENTIRE_PORTFOLIO",
] as const;

export type QaScope = (typeof QA_SCOPES)[number];

export const QA_PROFILES = [
  "QUICK",
  "STANDARD",
  "DEEP",
  "SECURITY",
  "REGRESSION",
  "PRE_DEPLOY",
  "PRODUCTION_SAFE",
  "PORTFOLIO",
  "FULL_AUDIT",
  "CHANGED_ONLY",
] as const;

export type QaProfile = (typeof QA_PROFILES)[number];

export const QA_ENVIRONMENTS = ["LOCAL", "STAGING", "PRODUCTION_SAFE"] as const;

export type QaEnvironment = (typeof QA_ENVIRONMENTS)[number];

export const QA_DOMAINS = [
  "FUNCTIONAL",
  "API",
  "UI_UX",
  "SECURITY",
  "DATABASE",
  "INTEGRATION",
  "E2E",
  "UNIT",
  "REGRESSION",
  "PERFORMANCE",
  "AI",
  "DEPLOYMENT",
  "ARCHITECTURE",
  "PORTFOLIO",
  "ACCESSIBILITY",
  "CONTRACT",
] as const;

export type QaDomain = (typeof QA_DOMAINS)[number];

export const QA_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type QaSeverity = (typeof QA_SEVERITIES)[number];

export const QA_FINDING_STATUSES = [
  "OPEN",
  "TRIAGED",
  "FALSE_POSITIVE",
  "FIXED",
  "REGRESSED",
  "ACCEPTED_RISK",
] as const;

export type QaFindingStatus = (typeof QA_FINDING_STATUSES)[number];

export const QA_RUN_STATUSES = [
  "PLANNED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
  "CANCELLED",
  "AWAITING_APPROVAL",
] as const;

export type QaRunStatus = (typeof QA_RUN_STATUSES)[number];

/** Risk classes used by the adaptive planner. */
export const QA_RISK_CLASSES = [
  "AUTHENTICATION",
  "PAYMENTS",
  "DATABASE_MIGRATION",
  "API_CONTRACT",
  "AI_PROMPT",
  "UI_TEXT",
  "DOCUMENTATION",
  "DEPENDENCY",
  "DEPLOYMENT",
  "SECURITY_CONFIG",
] as const;

export type QaRiskClass = (typeof QA_RISK_CLASSES)[number];

export const DEFAULT_RISK_SEVERITY: Readonly<Record<QaRiskClass, QaSeverity>> = {
  AUTHENTICATION: "HIGH",
  PAYMENTS: "CRITICAL",
  DATABASE_MIGRATION: "CRITICAL",
  API_CONTRACT: "HIGH",
  AI_PROMPT: "HIGH",
  UI_TEXT: "LOW",
  DOCUMENTATION: "LOW",
  DEPENDENCY: "MEDIUM",
  DEPLOYMENT: "HIGH",
  SECURITY_CONFIG: "CRITICAL",
};

/** Domains included per profile (planner seed — executor may narrow further). */
export const PROFILE_DOMAIN_MAP: Readonly<Record<QaProfile, readonly QaDomain[]>> = {
  QUICK: ["UNIT", "API", "SECURITY"],
  STANDARD: ["UNIT", "API", "FUNCTIONAL", "SECURITY", "ARCHITECTURE"],
  DEEP: [
    "UNIT",
    "API",
    "FUNCTIONAL",
    "E2E",
    "SECURITY",
    "DATABASE",
    "UI_UX",
    "ACCESSIBILITY",
    "ARCHITECTURE",
    "PERFORMANCE",
    "AI",
  ],
  SECURITY: ["SECURITY", "AI", "DATABASE", "API"],
  REGRESSION: ["REGRESSION", "UNIT", "E2E", "CONTRACT"],
  PRE_DEPLOY: ["UNIT", "E2E", "SECURITY", "DEPLOYMENT", "CONTRACT"],
  PRODUCTION_SAFE: ["DEPLOYMENT", "API", "FUNCTIONAL"],
  PORTFOLIO: ["PORTFOLIO", "ARCHITECTURE", "SECURITY", "REGRESSION"],
  FULL_AUDIT: [
    "FUNCTIONAL",
    "API",
    "UI_UX",
    "SECURITY",
    "DATABASE",
    "INTEGRATION",
    "E2E",
    "UNIT",
    "REGRESSION",
    "PERFORMANCE",
    "AI",
    "DEPLOYMENT",
    "ARCHITECTURE",
    "PORTFOLIO",
    "ACCESSIBILITY",
    "CONTRACT",
  ],
  CHANGED_ONLY: ["UNIT", "API", "REGRESSION", "CONTRACT"],
};
