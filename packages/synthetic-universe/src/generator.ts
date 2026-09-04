import { assertSyntheticTenantId } from "./policy.js";
import { syntheticEntityId } from "./ids.js";
import type { SyntheticEntity, SyntheticEntityKind } from "./types.js";

const KIND_LABEL: Readonly<Record<SyntheticEntityKind, string>> = {
  COMPANY: "COMPANY",
  EMPLOYEE: "EMPLOYEE",
  AGENT: "AGENT",
  CUSTOMER: "CUSTOMER",
  PROPERTY: "PROPERTY",
  LEAD: "LEAD",
  DEAL: "DEAL",
  CONTRACT: "CONTRACT",
  RESERVATION: "RESERVATION",
  MAINTENANCE: "MAINTENANCE",
  INVOICE: "INVOICE",
  PAYMENT: "PAYMENT",
  TASK: "TASK",
  EVENT: "EVENT",
};

export class SyntheticDataGenerator {
  private readonly seq = new Map<string, number>();

  nextId(tenantId: string, kind: SyntheticEntityKind): string {
    assertSyntheticTenantId(tenantId);
    const key = `${tenantId}:${kind}`;
    const n = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, n);
    return syntheticEntityId(KIND_LABEL[kind], n);
  }

  entity(input: {
    readonly tenantId: string;
    readonly kind: SyntheticEntityKind;
    readonly status?: string;
    readonly assignedAgentId?: string | null;
    readonly relatedIds?: Readonly<Record<string, string>>;
    readonly fields?: Readonly<Record<string, string | number | boolean | null>>;
    readonly id?: string;
  }): SyntheticEntity {
    assertSyntheticTenantId(input.tenantId);
    return {
      id: input.id ?? this.nextId(input.tenantId, input.kind),
      kind: input.kind,
      tenantId: input.tenantId,
      status: input.status ?? "created",
      assignedAgentId: input.assignedAgentId ?? null,
      relatedIds: { ...(input.relatedIds ?? {}) },
      fields: { ...(input.fields ?? {}) },
    };
  }
}
