/**
 * Backend sandbox policy. Not UI, not agent instructions.
 * Synthetic tenants cannot perform real external operations.
 */

export const SYNTHETIC_ENVIRONMENT = "sandbox" as const;
export const SYNTHETIC_COMPANY_TYPE = "synthetic" as const;

export const SANDBOX_CONTROLS = {
  REAL_PAYMENTS: false,
  REAL_EMAIL: false,
  REAL_WHATSAPP: false,
  REAL_SMS: false,
  REAL_CUSTOMERS: false,
  EXTERNAL_WRITE: false,
} as const;

export type SandboxControlName = keyof typeof SANDBOX_CONTROLS;

export const PRODUCTION_TENANT_BLOCKLIST = [
  "atlas",
  "arletos",
  "atlas-core",
  "def-000",
  "production",
  "prod",
] as const;

export class SandboxPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SandboxPolicyError";
    this.code = code;
  }
}

export function isBlockedProductionTenantId(tenantId: string): boolean {
  const normalized = tenantId.trim().toLowerCase();
  return PRODUCTION_TENANT_BLOCKLIST.some(
    (blocked) => normalized === blocked || normalized.startsWith(`${blocked}-`),
  );
}

export function assertSyntheticTenantId(tenantId: string): void {
  if (!tenantId.startsWith("TEST-")) {
    throw new SandboxPolicyError(
      "NOT_SYNTHETIC",
      `Tenant "${tenantId}" is not a synthetic tenant (must start with TEST-)`,
    );
  }
  if (isBlockedProductionTenantId(tenantId)) {
    throw new SandboxPolicyError(
      "PRODUCTION_TENANT",
      `Tenant "${tenantId}" is a production identity and cannot be synthetic`,
    );
  }
}

export function denyRealExternal(channel: SandboxControlName): SandboxPolicyError {
  return new SandboxPolicyError(
    channel,
    `${channel} is forbidden in the synthetic sandbox (backend policy)`,
  );
}

export function sandboxControls(): typeof SANDBOX_CONTROLS {
  return { ...SANDBOX_CONTROLS };
}
