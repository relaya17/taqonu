export const RENDER_TOOLS = {
  "render.services.read": { risk: "READ_ONLY", requiresApproval: false },
  "render.deployments.read": { risk: "READ_ONLY", requiresApproval: false },
  "render.logs.read": { risk: "READ_ONLY", requiresApproval: false },
  "render.environment.read_metadata": {
    risk: "READ_ONLY",
    requiresApproval: false,
    secretsAccess: "METADATA_ONLY",
  },
  "render.deployments.trigger": {
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
  },
  "render.deployments.cancel": {
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
  },
  "render.environment.secret_values": { denied: true },
} as const;
