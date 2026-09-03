/**
 * Canonical Application → Process → Event supervision model.
 *
 * Identity is namespaced by tenant + project + application + process.
 * Caller-supplied relationships are not trusted until Atlas binds them.
 */

export const SUPERVISED_PROCESS_STATES = [
  "CREATED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type SupervisedProcessState = (typeof SUPERVISED_PROCESS_STATES)[number];

export const SUPERVISED_PROCESS_TERMINAL_STATES: ReadonlySet<SupervisedProcessState> =
  new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface SupervisedProcessGovernance {
  readonly decision: string;
  readonly reason: string;
  readonly evaluatedAt: string;
}

export interface SupervisedProcessEventRef {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly requestId: string;
}

export interface SupervisedProcess {
  readonly processId: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly processType: string;
  readonly state: SupervisedProcessState;
  readonly agentId: string | null;
  readonly workerId: string | null;
  readonly connectorId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly currentEvent: string;
  readonly lastEventId: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly governance: SupervisedProcessGovernance | null;
  readonly events: readonly SupervisedProcessEventRef[];
}

export function mapCivioEventToSupervisedState(
  eventType: string,
): SupervisedProcessState {
  if (eventType === "civio.process.started") return "CREATED";
  if (eventType === "civio.process.completed") return "COMPLETED";
  if (eventType === "civio.legal.ai.failed") return "FAILED";
  return "RUNNING";
}

export function canTransitionSupervisedProcess(
  from: SupervisedProcessState,
  to: SupervisedProcessState,
): boolean {
  if (from === to) return true;
  if (SUPERVISED_PROCESS_TERMINAL_STATES.has(from)) return false;
  if (from === "CREATED") return to !== "CREATED";
  if (from === "RUNNING") return to !== "CREATED";
  return false;
}
