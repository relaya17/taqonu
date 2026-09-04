import {
  SANDBOX_CONTROLS,
  SYNTHETIC_COMPANY_TYPE,
  SYNTHETIC_ENVIRONMENT,
  SandboxPolicyError,
  assertSyntheticTenantId,
} from "./policy.js";
import type { SyntheticDomain, SyntheticTenantRecord } from "./types.js";

const DOMAIN_BY_PREFIX: Readonly<Record<string, SyntheticDomain>> = {
  "TEST-REALTY": "REALTY",
  "TEST-HOTEL": "HOTEL",
  "TEST-PROPERTY": "PROPERTY",
  "TEST-CRM": "CRM",
};

export class SyntheticTenantManager {
  private readonly tenants = new Map<string, SyntheticTenantRecord>();

  create(tenantId: string): SyntheticTenantRecord {
    assertSyntheticTenantId(tenantId);
    const domain = resolveDomain(tenantId);
    if (this.tenants.has(tenantId)) {
      throw new SandboxPolicyError(
        "DUPLICATE_TENANT",
        `Synthetic tenant "${tenantId}" already exists`,
      );
    }
    const record: SyntheticTenantRecord = {
      tenantId,
      environment: SYNTHETIC_ENVIRONMENT,
      companyType: SYNTHETIC_COMPANY_TYPE,
      realBusiness: false,
      domain,
      externalCommunications: false,
      realPayments: false,
      externalWrites: false,
      controls: { ...SANDBOX_CONTROLS },
    };
    this.tenants.set(tenantId, record);
    return record;
  }

  get(tenantId: string): SyntheticTenantRecord {
    assertSyntheticTenantId(tenantId);
    const existing = this.tenants.get(tenantId);
    if (!existing) {
      throw new SandboxPolicyError(
        "UNKNOWN_TENANT",
        `Synthetic tenant "${tenantId}" is not registered`,
      );
    }
    return existing;
  }

  list(): readonly SyntheticTenantRecord[] {
    return [...this.tenants.values()];
  }

  isSynthetic(tenantId: string): boolean {
    return this.tenants.has(tenantId);
  }
}

export function resolveDomain(tenantId: string): SyntheticDomain {
  for (const [prefix, domain] of Object.entries(DOMAIN_BY_PREFIX)) {
    if (tenantId === prefix || tenantId.startsWith(`${prefix}-`)) {
      return domain;
    }
  }
  throw new SandboxPolicyError(
    "UNKNOWN_DOMAIN",
    `Tenant "${tenantId}" is not one of TEST-REALTY / TEST-HOTEL / TEST-PROPERTY / TEST-CRM`,
  );
}
