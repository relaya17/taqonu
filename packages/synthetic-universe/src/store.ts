import { SandboxPolicyError, assertSyntheticTenantId } from "./policy.js";
import type { SyntheticEntity, SyntheticEntityKind } from "./types.js";

export class SyntheticStore {
  private readonly byTenant = new Map<string, Map<string, SyntheticEntity>>();
  private timeoutNextWrite = false;

  isolate(tenantId: string): void {
    assertSyntheticTenantId(tenantId);
    if (!this.byTenant.has(tenantId)) {
      this.byTenant.set(tenantId, new Map());
    }
  }

  injectDatabaseTimeout(): void {
    this.timeoutNextWrite = true;
  }

  put(entity: SyntheticEntity): SyntheticEntity {
    assertSyntheticTenantId(entity.tenantId);
    if (this.timeoutNextWrite) {
      this.timeoutNextWrite = false;
      throw new SandboxPolicyError(
        "DATABASE_TIMEOUT",
        "Injected database timeout (TEST-002)",
      );
    }
    this.isolate(entity.tenantId);
    const bucket = this.byTenant.get(entity.tenantId);
    if (!bucket) {
      throw new SandboxPolicyError("UNKNOWN_TENANT", "Store isolation missing");
    }
    bucket.set(entity.id, entity);
    return entity;
  }

  get(tenantId: string, id: string): SyntheticEntity | undefined {
    assertSyntheticTenantId(tenantId);
    return this.byTenant.get(tenantId)?.get(id);
  }

  list(tenantId: string, kind?: SyntheticEntityKind): readonly SyntheticEntity[] {
    assertSyntheticTenantId(tenantId);
    const all = [...(this.byTenant.get(tenantId)?.values() ?? [])];
    return kind ? all.filter((row) => row.kind === kind) : all;
  }

  findByKind(
    tenantId: string,
    kind: SyntheticEntityKind,
  ): SyntheticEntity | undefined {
    return this.list(tenantId, kind)[0];
  }

  snapshot(tenantId: string): Readonly<Record<string, SyntheticEntity>> {
    assertSyntheticTenantId(tenantId);
    const out: Record<string, SyntheticEntity> = {};
    for (const row of this.list(tenantId)) {
      out[row.id] = row;
    }
    return out;
  }
}
