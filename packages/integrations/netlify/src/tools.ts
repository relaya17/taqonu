export const NETLIFY_TOOLS = {
  "netlify.sites.read": { risk: "READ_ONLY", requiresApproval: false },
  "netlify.deployments.read": { risk: "READ_ONLY", requiresApproval: false },
  "netlify.logs.read": { risk: "READ_ONLY", requiresApproval: false },
  "netlify.deployments.create": {
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
  },
  "netlify.deployments.cancel": {
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
  },
  "netlify.environment.read_metadata": {
    risk: "READ_ONLY",
    requiresApproval: false,
    secretsAccess: "METADATA_ONLY",
  },
  "netlify.environment.secret_values": { denied: true },
} as const;
