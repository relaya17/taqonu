/** Least-privilege GitHub App permissions for Phase 3 sync + Truth checks. */
export const GITHUB_APP_PERMISSIONS = {
  metadata: "read",
  contents: "read",
  statuses: "read",
  /** Required to publish Atlas Truth Check Runs on push/PR (TRUTH-10 · 1.6). */
  checks: "write",
  issues: "read",
  pull_requests: "read",
  actions: "read",
  deployments: "read",
} as const;

export const GITHUB_DENIED_PERMISSIONS = [
  "contents:write",
  "workflows:write",
  "administration:write",
  "secrets:write",
] as const;
