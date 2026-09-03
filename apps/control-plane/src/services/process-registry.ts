/**
 * Application-scoped process registry for Atlas Control.
 *
 * Not a second event bus. Connector ingest remains the write path.
 * Processes are keyed by tenant + project + application + process so
 * Application A cannot mutate Application B.
 */

import {
  canTransitionSupervisedProcess,
  type SupervisedProcess,
  type SupervisedProcessEventRef,
  type SupervisedProcessGovernance,
  type SupervisedProcessState,
} from "@atlas/shared";
import { getRegisteredApplication } from "./application-registry.js";

const MAX_EVENT_REFS = 16;

export interface RegisterSupervisedProcessInput {
  readonly processId: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly processType: string;
  readonly connectorId: string | null;
  readonly occurredAt: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly agentId: string | null;
  readonly workerId: string | null;
  readonly governance: SupervisedProcessGovernance | null;
}

export interface ObserveConnectorProcessEventInput {
  readonly processId: string | undefined;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly processType: string;
  readonly connectorId: string | null;
  readonly occurredAt: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly agentId: string | null;
  readonly workerId: string | null;
  readonly proposedState: SupervisedProcessState;
  readonly registration: boolean;
  readonly governance: SupervisedProcessGovernance | null;
}

export type ObserveConnectorProcessEventResult =
  | { readonly ok: true; readonly process: SupervisedProcess | null }
  | {
      readonly ok: false;
      readonly status: 403 | 404 | 409;
      readonly reason: string;
    };

const processes = new Map<string, SupervisedProcess>();

export function supervisedProcessKey(
  tenantId: string,
  projectId: string,
  applicationId: string,
  processId: string,
): string {
  return `${tenantId}\0${projectId}\0${applicationId}\0${processId}`;
}

function appendEvent(
  existing: readonly SupervisedProcessEventRef[],
  next: SupervisedProcessEventRef,
): readonly SupervisedProcessEventRef[] {
  if (existing.some((item) => item.eventId === next.eventId)) return existing;
  const merged = [...existing, next];
  return merged.length <= MAX_EVENT_REFS
    ? merged
    : merged.slice(merged.length - MAX_EVENT_REFS);
}

function actorFields(input: {
  readonly agentId: string | null;
  readonly workerId: string | null;
}): { readonly agentId: string | null; readonly workerId: string | null } {
  return { agentId: input.agentId, workerId: input.workerId };
}

export function listSupervisedProcesses(filter?: {
  readonly applicationId?: string;
  readonly tenantId?: string;
  readonly projectId?: string;
}): readonly SupervisedProcess[] {
  const items = [...processes.values()];
  if (!filter) return items;
  return items.filter((process) => {
    if (filter.applicationId && process.applicationId !== filter.applicationId) {
      return false;
    }
    if (filter.tenantId && process.tenantId !== filter.tenantId) return false;
    if (filter.projectId && process.projectId !== filter.projectId) return false;
    return true;
  });
}

export function getSupervisedProcess(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly processId: string;
}): SupervisedProcess | undefined {
  return processes.get(
    supervisedProcessKey(
      input.tenantId,
      input.projectId,
      input.applicationId,
      input.processId,
    ),
  );
}

export function registerSupervisedProcess(
  input: RegisterSupervisedProcessInput,
):
  | { readonly ok: true; readonly process: SupervisedProcess }
  | { readonly ok: false; readonly status: 404 | 409; readonly reason: string } {
  const application = getRegisteredApplication(input.applicationId);
  if (!application) {
    return {
      ok: false,
      status: 404,
      reason: `Application "${input.applicationId}" is not registered`,
    };
  }
  if (
    application.tenantId !== null &&
    application.tenantId !== input.tenantId
  ) {
    return {
      ok: false,
      status: 409,
      reason: "Process tenant does not match the registered application",
    };
  }
  if (
    application.projectId !== null &&
    application.projectId !== input.projectId
  ) {
    return {
      ok: false,
      status: 409,
      reason: "Process project does not match the registered application",
    };
  }

  const key = supervisedProcessKey(
    input.tenantId,
    input.projectId,
    input.applicationId,
    input.processId,
  );
  const existing = processes.get(key);
  if (existing) {
    if (
      existing.applicationId !== input.applicationId ||
      existing.tenantId !== input.tenantId ||
      existing.projectId !== input.projectId
    ) {
      return {
        ok: false,
        status: 409,
        reason: "Process identity does not match the existing record",
      };
    }
    return { ok: true, process: existing };
  }

  const eventRef: SupervisedProcessEventRef = {
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    requestId: input.requestId,
  };
  const created: SupervisedProcess = {
    processId: input.processId,
    applicationId: input.applicationId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    processType: input.processType,
    state: "CREATED",
    ...actorFields(input),
    connectorId: input.connectorId,
    startedAt: input.occurredAt,
    updatedAt: input.occurredAt,
    currentEvent: input.eventType,
    lastEventId: input.eventId,
    correlationId: input.correlationId,
    requestId: input.requestId,
    governance: input.governance,
    events: [eventRef],
  };
  processes.set(key, created);
  return { ok: true, process: created };
}

export function observeConnectorProcessEvent(
  input: ObserveConnectorProcessEventInput,
): ObserveConnectorProcessEventResult {
  if (!input.processId) {
    return { ok: true, process: null };
  }

  const existing = getSupervisedProcess({
    tenantId: input.tenantId,
    projectId: input.projectId,
    applicationId: input.applicationId,
    processId: input.processId,
  });

  if (!existing) {
    if (!input.registration) {
      return {
        ok: false,
        status: 404,
        reason: `Unknown process "${input.processId}" for application "${input.applicationId}"`,
      };
    }
    return registerSupervisedProcess({
      processId: input.processId,
      applicationId: input.applicationId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      processType: input.processType,
      connectorId: input.connectorId,
      occurredAt: input.occurredAt,
      eventId: input.eventId,
      eventType: input.eventType,
      correlationId: input.correlationId,
      requestId: input.requestId,
      agentId: input.agentId,
      workerId: input.workerId,
      governance: input.governance,
    });
  }

  if (existing.applicationId !== input.applicationId) {
    return {
      ok: false,
      status: 403,
      reason: "Process does not belong to the authenticated application",
    };
  }
  if (
    existing.tenantId !== input.tenantId ||
    existing.projectId !== input.projectId
  ) {
    return {
      ok: false,
      status: 403,
      reason: "Process tenant/project does not match the authenticated connector",
    };
  }

  if (!canTransitionSupervisedProcess(existing.state, input.proposedState)) {
    return {
      ok: false,
      status: 409,
      reason: `Process "${existing.processId}" cannot transition from ${existing.state} to ${input.proposedState}`,
    };
  }

  const eventRef: SupervisedProcessEventRef = {
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    requestId: input.requestId,
  };
  const next: SupervisedProcess = {
    ...existing,
    processType:
      input.processType !== "civio.unspecified"
        ? input.processType
        : existing.processType,
    state: input.proposedState,
    ...actorFields({
      agentId: input.agentId ?? existing.agentId,
      workerId: input.workerId ?? existing.workerId,
    }),
    connectorId: input.connectorId ?? existing.connectorId,
    updatedAt: input.occurredAt,
    currentEvent: input.eventType,
    lastEventId: input.eventId,
    correlationId: input.correlationId,
    requestId: input.requestId,
    governance: input.governance ?? existing.governance,
    events: appendEvent(existing.events, eventRef),
  };
  processes.set(
    supervisedProcessKey(
      existing.tenantId,
      existing.projectId,
      existing.applicationId,
      existing.processId,
    ),
    next,
  );
  return { ok: true, process: next };
}

export function bindProcessGovernance(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly processId: string;
  readonly governance: SupervisedProcess["governance"];
}): SupervisedProcess | undefined {
  const key = supervisedProcessKey(
    input.tenantId,
    input.projectId,
    input.applicationId,
    input.processId,
  );
  const existing = processes.get(key);
  if (!existing) return undefined;
  const next: SupervisedProcess = {
    ...existing,
    governance: input.governance,
  };
  processes.set(key, next);
  return next;
}

export function resetProcessRegistryForTests(): void {
  processes.clear();
}
