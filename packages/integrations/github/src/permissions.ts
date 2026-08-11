/** Least-privilege GitHub App permissions for Phase 3 sync. */
export const GITHUB_APP_PERMISSIONS = {
  metadata: "read",
  contents: "read",
  statuses: "read",
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
