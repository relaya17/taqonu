/**
 * Personal Supervising Agent — owner-scoped supervisor.
 *
 * Distinct from FABRIC_AGENT_IDS. Coordinates specialists; does not impersonate
 * them. Does not execute tools. Authorization is explicit scope, not `psa:<id>`.
 * Identity is persisted; HTTP sessions only authenticate the owner.
 */

import { randomUUID } from "node:crypto";
import { planAgentWork } from "@atlas/agent-core";
import {
  createDatabaseClients,
  isLiveSupabase,
  PersonalSupervisingAgentRepository,
  PsaPersistenceError,
  type PersonalSupervisingAgentStore,
} from "@atlas/database";
import {
  AtlasError,
  agentMayExecute,
  isFabricSpecialistId,
  personalSupervisingAgentId,
  presentedScopeWithin,
  scopeAllows,
  PERSONAL_SUPERVISING_AGENT_CLASS,
  type AgentProposal,
  type FabricAgentId,
  type PersonalSupervisingAgentRecord,
  type PsaAttentionRecord,
  type PsaAuthorizationScope,
  type PsaLifecycleStatus,
} from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { listApprovalRequests } from "./approvals.js";
import { submitAgentProposal } from "./agent-proposal.js";
import { buildMemoryContext } from "./memory-pipeline.js";
import { getProjectOwnerId } from "./project-access.js";
import { osStore } from "../store/os-store.js";

export type {
  PersonalSupervisingAgentRecord,
  PsaAttentionRecord,
} from "@atlas/shared";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PsaObservedApplication {
  readonly applicationId: string;
  readonly name?: string;
  readonly tenantId: string | null;
  readonly projectId: string | null;
}

export interface PsaObservedProcess {
  readonly processId: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly state: string;
  readonly lastEventId: string;
  readonly currentEvent: string;
  readonly events: readonly {
    readonly eventId: string;
    readonly eventType: string;
    readonly occurredAt: string;
  }[];
  readonly governance: {
    readonly decision: string;
    readonly reason: string;
    readonly evaluatedAt: string;
  } | null;
}

export interface PsaObservedDecision {
  readonly decision: string;
  readonly reason: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly processId: string | null;
  readonly eventId: string;
  readonly policy: {
    readonly entityType: string;
    readonly action: string;
    readonly riskTier: string;
  };
  readonly risk: { readonly tier: string };
}

export interface PsaObservationSource {
  listApplications(): Promise<readonly PsaObservedApplication[]>;
  listProcesses(): Promise<readonly PsaObservedProcess[]>;
  listDecisions(): Promise<readonly PsaObservedDecision[]>;
}

let store: PersonalSupervisingAgentRepository | null = null;
let storeClearedForTests = false;
let observationSource: PsaObservationSource = controlPlaneObservationSource();

export function configurePersonalSupervisingAgentStore(
  next: PersonalSupervisingAgentRepository,
): void {
  store = next;
  storeClearedForTests = false;
}

export function clearPersonalSupervisingAgentStoreForTests(): void {
  store = null;
  storeClearedForTests = true;
  observationSource = controlPlaneObservationSource();
}

export function restoreDefaultPsaObservationSourceForTests(): void {
  observationSource = controlPlaneObservationSource();
}

export function setPsaObservationSourceForTests(source: PsaObservationSource): void {
  observationSource = source;
}

export function createOsStorePersonalSupervisingAgentStore(): PersonalSupervisingAgentStore {
  return {
    async getByOwner(ownerId: string) {
      return osStore.getPersonalSupervisingAgent(ownerId);
    },
    async upsert(record: PersonalSupervisingAgentRecord) {
      osStore.putPersonalSupervisingAgent(record);
      return record;
    },
  };
}

function notConfigured(): never {
  throw new AtlasError(
    "INTEGRATION_ERROR",
    "Personal Supervising Agent store is not configured",
    { statusCode: 503 },
  );
}

function bindDurableStore(): PersonalSupervisingAgentRepository {
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL ?? "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
  if (
    env.SUPABASE_URL &&
    env.SUPABASE_ANON_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    isLiveSupabase({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    })
  ) {
    const { service } = createDatabaseClients({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    return PersonalSupervisingAgentRepository.fromSupabase(service);
  }
  return new PersonalSupervisingAgentRepository(createOsStorePersonalSupervisingAgentStore());
}

function requireStore(): PersonalSupervisingAgentRepository {
  if (store !== null) return store;
  if (storeClearedForTests) notConfigured();
  store = bindDurableStore();
  return store;
}

function rethrowStoreError(error: unknown): never {
  if (error instanceof AtlasError) throw error;
  if (error instanceof PsaPersistenceError) {
    throw new AtlasError(
      error.kind === "CONFLICT" ? "FORBIDDEN" : "INTEGRATION_ERROR",
      error.message,
      { statusCode: error.kind === "CONFLICT" ? 403 : 503 },
    );
  }
  throw new AtlasError(
    "INTEGRATION_ERROR",
    error instanceof Error ? error.message : "Personal Supervising Agent store failed",
    { statusCode: 503, cause: error },
  );
}

async function persist(
  record: PersonalSupervisingAgentRecord,
): Promise<PersonalSupervisingAgentRecord> {
  try {
    return await requireStore().save(record);
  } catch (error) {
    rethrowStoreError(error);
  }
}

function audit(input: {
  readonly type: string;
  readonly ownerId: string;
  readonly reason: string;
  readonly extra?: Record<string, unknown>;
}): void {
  appendUnifiedAuditEntry({
    type: input.type,
    actorId: personalSupervisingAgentId(input.ownerId),
    actorKind: "AGENT",
    ownerId: input.ownerId,
    reason: input.reason,
    input: {
      agentClass: PERSONAL_SUPERVISING_AGENT_CLASS,
      ownerId: input.ownerId,
      ...(input.extra ?? {}),
    },
    output: {},
    policy: "psa.supervise",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
  });
}

function requireOwnerMatch(record: PersonalSupervisingAgentRecord, ownerId: string): void {
  if (record.scope.ownerId !== ownerId) {
    throw new AtlasError("FORBIDDEN", "Personal Supervising Agent is not in this owner's scope", {
      statusCode: 403,
    });
  }
}

function assertCanAct(record: PersonalSupervisingAgentRecord): void {
  if (!agentMayExecute(record.status)) {
    throw new AtlasError(
      "FORBIDDEN",
      `Personal Supervising Agent is ${record.status} and cannot dispatch or perform governed actions`,
      { statusCode: 403 },
    );
  }
}

function assertProjectInScope(scope: PsaAuthorizationScope, projectId: string | null): void {
  if (projectId === null || projectId.length === 0) return;
  if (!scope.projectIds.includes(projectId)) {
    throw new AtlasError("FORBIDDEN", "Project is outside the supervising agent scope", {
      statusCode: 403,
    });
  }
  if (UUID_RE.test(projectId)) {
    const owner = getProjectOwnerId(projectId);
    if (owner !== scope.ownerId) {
      throw new AtlasError("FORBIDDEN", "Project is not owned by this user", {
        statusCode: 403,
      });
    }
  }
}

async function touch(
  record: PersonalSupervisingAgentRecord,
): Promise<PersonalSupervisingAgentRecord> {
  return persist({ ...record, lastActivityAt: new Date().toISOString() });
}

export async function ensurePersonalSupervisingAgent(input: {
  readonly ownerId: string;
  readonly tenantId: string;
  readonly projectIds: readonly string[];
  readonly applicationIds: readonly string[];
}): Promise<PersonalSupervisingAgentRecord> {
  let existing: PersonalSupervisingAgentRecord | null;
  try {
    existing = await requireStore().getByOwner(input.ownerId);
  } catch (error) {
    rethrowStoreError(error);
  }
  if (existing) {
    requireOwnerMatch(existing, input.ownerId);
    if (existing.status === "REVOKED") {
      return existing;
    }
    if (!presentedScopeWithin(existing.scope, input)) {
      throw new AtlasError(
        "FORBIDDEN",
        "Presented tenant, project, or application is outside the persisted supervising agent scope",
        { statusCode: 403 },
      );
    }
    return touch(existing);
  }

  for (const projectId of input.projectIds) {
    if (UUID_RE.test(projectId)) {
      const owner = getProjectOwnerId(projectId);
      if (owner !== input.ownerId) {
        throw new AtlasError("FORBIDDEN", "Project is not owned by this user", {
          statusCode: 403,
        });
      }
    }
  }

  const scope: PsaAuthorizationScope = {
    ownerId: input.ownerId,
    tenantId: input.tenantId,
    projectIds: [...input.projectIds],
    applicationIds: [...input.applicationIds],
  };
  const now = new Date().toISOString();
  const record = await persist({
    agentClass: PERSONAL_SUPERVISING_AGENT_CLASS,
    agentId: personalSupervisingAgentId(input.ownerId),
    scope,
    status: "ACTIVE",
    createdAt: now,
    lastActivityAt: now,
    recommendations: [],
    escalations: [],
  });
  audit({
    type: "psa.created",
    ownerId: input.ownerId,
    reason: "Personal Supervising Agent initialized",
    extra: { tenantId: scope.tenantId, applicationIds: scope.applicationIds },
  });
  return record;
}

export async function getPersonalSupervisingAgent(
  ownerId: string,
): Promise<PersonalSupervisingAgentRecord> {
  let existing: PersonalSupervisingAgentRecord | null;
  try {
    existing = await requireStore().getByOwner(ownerId);
  } catch (error) {
    rethrowStoreError(error);
  }
  if (!existing) {
    throw new AtlasError("NOT_FOUND", "Personal Supervising Agent is not initialized", {
      statusCode: 404,
    });
  }
  requireOwnerMatch(existing, ownerId);
  return existing;
}

export async function setPersonalSupervisingAgentStatus(
  ownerId: string,
  status: PsaLifecycleStatus,
): Promise<PersonalSupervisingAgentRecord> {
  const existing = await getPersonalSupervisingAgent(ownerId);
  if (existing.status === "REVOKED" && status !== "REVOKED") {
    throw new AtlasError(
      "FORBIDDEN",
      "A revoked Personal Supervising Agent cannot be recreated or reactivated",
      { statusCode: 403 },
    );
  }
  const next = await persist({
    ...existing,
    status,
    lastActivityAt: new Date().toISOString(),
  });
  audit({
    type: "psa.lifecycle",
    ownerId,
    reason: `Personal Supervising Agent status set to ${status}`,
    extra: { status },
  });
  return next;
}

function attentionFromObservation(
  processes: readonly PsaObservedProcess[],
  decisions: readonly PsaObservedDecision[],
  pendingApprovalCount: number,
): readonly PsaAttentionRecord[] {
  const now = new Date().toISOString();
  const items: PsaAttentionRecord[] = [];
  for (const process of processes) {
    if (process.state === "FAILED") {
      items.push({
        id: randomUUID(),
        kind: "recommendation",
        reason: `Process ${process.processId} is FAILED`,
        severity: "HIGH",
        applicationId: process.applicationId,
        processId: process.processId,
        eventId: process.lastEventId,
        decision: process.governance?.decision ?? null,
        risk: null,
        evidenceRefs: [`process:${process.processId}`],
        executed: false,
        createdAt: now,
      });
    }
  }
  for (const decision of decisions) {
    if (decision.decision === "REQUIRE_APPROVAL") {
      items.push({
        id: randomUUID(),
        kind: "recommendation",
        reason: `Approval required: ${decision.reason}`,
        severity: "MEDIUM",
        applicationId: decision.applicationId,
        processId: decision.processId,
        eventId: decision.eventId,
        decision: decision.decision,
        risk: decision.risk.tier,
        evidenceRefs: [`event:${decision.eventId}`],
        executed: false,
        createdAt: now,
      });
    }
  }
  if (pendingApprovalCount > 0) {
    items.push({
      id: randomUUID(),
      kind: "recommendation",
      reason: `${pendingApprovalCount} pending approval(s) require attention`,
      severity: "MEDIUM",
      applicationId: null,
      processId: null,
      eventId: null,
      decision: null,
      risk: null,
      evidenceRefs: [],
      executed: false,
      createdAt: now,
    });
  }
  return items;
}

export async function observePersonalSupervisingAgent(ownerId: string): Promise<{
  readonly agent: PersonalSupervisingAgentRecord;
  readonly applications: readonly PsaObservedApplication[];
  readonly processes: readonly PsaObservedProcess[];
  readonly events: readonly {
    readonly eventId: string;
    readonly eventType: string;
    readonly processId: string;
    readonly occurredAt: string;
  }[];
  readonly decisions: readonly PsaObservedDecision[];
  readonly pendingApprovals: readonly {
    readonly id: string;
    readonly entityType: string;
    readonly action: string;
    readonly reason: string;
    readonly status: string;
  }[];
  readonly attention: readonly PsaAttentionRecord[];
}> {
  const agent = await touch(await getPersonalSupervisingAgent(ownerId));
  const [applications, processes, decisions, approvals] = await Promise.all([
    observationSource.listApplications(),
    observationSource.listProcesses(),
    observationSource.listDecisions(),
    listApprovalRequests("PENDING").catch(() => []),
  ]);
  const scopedApps = applications.filter((item) => scopeAllows(agent.scope, item));
  const scopedProcesses = processes.filter((item) => scopeAllows(agent.scope, item));
  const scopedDecisions = decisions.filter((item) => scopeAllows(agent.scope, item));
  const scopedApprovals = approvals.filter((item) =>
    scopeAllows(agent.scope, {
      tenantId: typeof item.context["tenantId"] === "string" ? item.context["tenantId"] : null,
      projectId: typeof item.context["projectId"] === "string" ? item.context["projectId"] : null,
      applicationId:
        typeof item.context["applicationId"] === "string" ? item.context["applicationId"] : null,
    }),
  );
  const events = scopedProcesses.flatMap((process) =>
    process.events.map((event) => ({
      eventId: event.eventId,
      eventType: event.eventType,
      processId: process.processId,
      occurredAt: event.occurredAt,
    })),
  );
  const attention = attentionFromObservation(
    scopedProcesses,
    scopedDecisions,
    scopedApprovals.length,
  );
  return {
    agent,
    applications: scopedApps,
    processes: scopedProcesses,
    events,
    decisions: scopedDecisions,
    pendingApprovals: scopedApprovals.map((item) => ({
      id: item.id,
      entityType: item.entityType,
      action: item.action,
      reason: item.reason,
      status: item.status,
    })),
    attention,
  };
}

export async function explainSupervisedRecord(
  ownerId: string,
  input: { readonly eventId?: string; readonly processId?: string },
): Promise<{ readonly explanation: string }> {
  const observation = await observePersonalSupervisingAgent(ownerId);
  const decision = input.eventId
    ? observation.decisions.find((item) => item.eventId === input.eventId)
    : undefined;
  const process = input.processId
    ? observation.processes.find((item) => item.processId === input.processId)
    : undefined;
  if (!decision && !process) {
    throw new AtlasError("NOT_FOUND", "No authorized record matches that identity", {
      statusCode: 404,
    });
  }
  const parts: string[] = [];
  if (decision) {
    parts.push(
      `Decision ${decision.decision} on ${decision.applicationId} event ${decision.eventId}.`,
      `Policy ${decision.policy.entityType}.${decision.policy.action} (risk ${decision.risk.tier}).`,
      `Reason: ${decision.reason}.`,
    );
    const approval = observation.pendingApprovals.find(
      (item) => item.reason.includes(decision.eventId) || item.reason === decision.reason,
    );
    if (decision.decision === "REQUIRE_APPROVAL") {
      parts.push(
        approval
          ? `Approval is pending (${approval.entityType}.${approval.action}). The supervising agent cannot approve it.`
          : "Approval is required. The supervising agent cannot approve it.",
      );
    }
    if (decision.decision === "DENY") {
      parts.push("Execution was not permitted.");
    }
    if (decision.decision === "ALLOW") {
      parts.push("Eligibility is ALLOW. Execution still requires an authoritative intent and governed execution.");
    }
  }
  if (process) {
    parts.push(
      `Process ${process.processId} in ${process.applicationId} is ${process.state}.`,
      `Last event: ${process.currentEvent} (${process.lastEventId}).`,
    );
    if (process.governance) {
      parts.push(
        `Bound governance: ${process.governance.decision} — ${process.governance.reason}.`,
      );
    }
  }
  return { explanation: parts.join(" ") };
}

async function recordAttention(
  ownerId: string,
  kind: "recommendation" | "escalation",
  input: {
    readonly reason: string;
    readonly severity: PsaAttentionRecord["severity"];
    readonly applicationId?: string | null;
    readonly processId?: string | null;
    readonly eventId?: string | null;
    readonly decision?: string | null;
    readonly risk?: string | null;
  },
): Promise<PsaAttentionRecord> {
  const agent = await getPersonalSupervisingAgent(ownerId);
  assertCanAct(agent);
  if (input.applicationId && !agent.scope.applicationIds.includes(input.applicationId)) {
    throw new AtlasError("FORBIDDEN", "Application is outside the supervising agent scope", {
      statusCode: 403,
    });
  }
  const entry: PsaAttentionRecord = {
    id: randomUUID(),
    kind,
    reason: input.reason,
    severity: input.severity,
    applicationId: input.applicationId ?? null,
    processId: input.processId ?? null,
    eventId: input.eventId ?? null,
    decision: input.decision ?? null,
    risk: input.risk ?? null,
    evidenceRefs: [
      ...(input.eventId ? [`event:${input.eventId}`] : []),
      ...(input.processId ? [`process:${input.processId}`] : []),
    ],
    executed: false,
    createdAt: new Date().toISOString(),
  };
  await persist({
    ...agent,
    lastActivityAt: entry.createdAt,
    recommendations:
      kind === "recommendation" ? [...agent.recommendations, entry] : agent.recommendations,
    escalations: kind === "escalation" ? [...agent.escalations, entry] : agent.escalations,
  });
  audit({
    type: kind === "recommendation" ? "psa.recommend" : "psa.escalate",
    ownerId,
    reason: input.reason,
    extra: { severity: input.severity, executed: false },
  });
  return entry;
}

export async function recommendFromPsa(
  ownerId: string,
  input: Parameters<typeof recordAttention>[2],
): Promise<PsaAttentionRecord> {
  return recordAttention(ownerId, "recommendation", input);
}

export async function escalateFromPsa(
  ownerId: string,
  input: Parameters<typeof recordAttention>[2],
): Promise<PsaAttentionRecord> {
  return recordAttention(ownerId, "escalation", input);
}

export async function coordinateSpecialists(
  ownerId: string,
  input: {
    readonly request: string;
    readonly projectId: string | null;
    readonly agentIds?: readonly FabricAgentId[];
  },
): Promise<ReturnType<typeof planAgentWork>> {
  const agent = await getPersonalSupervisingAgent(ownerId);
  assertCanAct(agent);
  assertProjectInScope(agent.scope, input.projectId);
  if (input.agentIds) {
    for (const id of input.agentIds) {
      if (!isFabricSpecialistId(id)) {
        throw new AtlasError(
          "FORBIDDEN",
          "Specialist coordination requires an existing Fabric agent identity",
          { statusCode: 403 },
        );
      }
    }
  }
  const plan = planAgentWork({
    request: input.request,
    projectId: input.projectId,
    ...(input.agentIds ? { agentIds: [...input.agentIds] } : {}),
  });
  await touch(agent);
  audit({
    type: "psa.coordinate",
    ownerId,
    reason: "Coordinated Fabric specialists without expanding permissions",
    extra: {
      planId: plan.id,
      specialists: plan.steps.map((step) => step.agentId),
    },
  });
  return plan;
}

export async function requestGovernedAction(
  ownerId: string,
  proposal: AgentProposal,
): Promise<Awaited<ReturnType<typeof submitAgentProposal>>> {
  const agent = await getPersonalSupervisingAgent(ownerId);
  assertCanAct(agent);
  if (!isFabricSpecialistId(proposal.agentId)) {
    throw new AtlasError(
      "FORBIDDEN",
      "Governed actions must use an existing Fabric specialist identity",
      { statusCode: 403 },
    );
  }
  assertProjectInScope(agent.scope, proposal.projectId);
  const result = await submitAgentProposal(proposal, {
    actorKind: "AGENT",
    onBehalfOfUserId: ownerId,
    sourceContext: { origin: "user_message", trustLevel: "trusted" },
    routeLabel: "psa.request",
    agentRuntimeStatus: agent.status,
    delegationHopCount: 1,
  });
  await touch(agent);
  audit({
    type: "psa.request",
    ownerId,
    reason: "User request entered existing governance via specialist proposal",
    extra: {
      specialistId: proposal.agentId,
      decision: result.decision,
    },
  });
  return result;
}

export async function readPsaMemory(
  ownerId: string,
  input: { readonly projectId?: string | null; readonly query?: string },
): Promise<ReturnType<typeof buildMemoryContext>> {
  const agent = await getPersonalSupervisingAgent(ownerId);
  if (input.projectId) {
    assertProjectInScope(agent.scope, input.projectId);
  }
  return buildMemoryContext({
    ownerId,
    projectId: input.projectId ?? null,
    requestingAgentId: agent.agentId,
    budget: 12,
    ...(input.query ? { query: input.query } : {}),
  });
}

function controlPlaneObservationSource(): PsaObservationSource {
  return {
    async listApplications() {
      const body = await fetchControlJson<{ items?: PsaObservedApplication[] }>(
        "/api/v1/applications",
      );
      return body?.items ?? [];
    },
    async listProcesses() {
      const body = await fetchControlJson<{ items?: PsaObservedProcess[] }>(
        "/api/v1/processes",
      );
      return body?.items ?? [];
    },
    async listDecisions() {
      const body = await fetchControlJson<{ items?: PsaObservedDecision[] }>(
        "/api/v1/governance/decisions",
      );
      return body?.items ?? [];
    },
  };
}

async function fetchControlJson<T>(path: string): Promise<T | null> {
  const base = process.env.ATLAS_CONTROL_PLANE_URL?.trim();
  const token = process.env.ATLAS_CONTROL_PLANE_TOKEN?.trim();
  if (!base || !token) return null;
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
