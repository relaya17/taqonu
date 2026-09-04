import { assertSyntheticTenantId } from "./policy.js";
import type { SyntheticEvent } from "./types.js";

const EPOCH = Date.parse("2026-09-04T00:00:00.000Z");

export class SyntheticEventStream {
  private readonly events: SyntheticEvent[] = [];
  private seq = 0;

  emit(input: {
    readonly name: string;
    readonly tenantId: string;
    readonly runId: string;
    readonly entityId?: string | null;
    readonly payload?: Readonly<Record<string, unknown>>;
  }): SyntheticEvent {
    assertSyntheticTenantId(input.tenantId);
    this.seq += 1;
    const event: SyntheticEvent = {
      seq: this.seq,
      name: input.name,
      at: new Date(EPOCH + this.seq * 1000).toISOString(),
      tenantId: input.tenantId,
      runId: input.runId,
      entityId: input.entityId ?? null,
      payload: { ...(input.payload ?? {}) },
    };
    this.events.push(event);
    return event;
  }

  list(tenantId?: string): readonly SyntheticEvent[] {
    if (!tenantId) return this.events;
    assertSyntheticTenantId(tenantId);
    return this.events.filter((event) => event.tenantId === tenantId);
  }

  names(tenantId: string): readonly string[] {
    return this.list(tenantId).map((event) => event.name);
  }

  has(tenantId: string, name: string): boolean {
    return this.list(tenantId).some((event) => event.name === name);
  }
}
