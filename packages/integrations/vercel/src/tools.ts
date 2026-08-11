export const VERCEL_TOOLS = {
  "vercel.projects.read": { risk: "READ_ONLY", requiresApproval: false },
  "vercel.deployments.read": { risk: "READ_ONLY", requiresApproval: false },
  "vercel.logs.read": { risk: "READ_ONLY", requiresApproval: false },
  "vercel.domains.read": { risk: "READ_ONLY", requiresApproval: false },
  "vercel.env.read_metadata": {
    risk: "READ_ONLY",
    requiresApproval: false,
    secretsAccess: "METADATA_ONLY",
  },
  "vercel.deployments.create": {
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
  },
  "vercel.deployments.cancel": {
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
  },
  "vercel.environment.secret_values": {
    risk: "DESTRUCTIVE",
    requiresApproval: true,
    denied: true,
  },
} as const;
