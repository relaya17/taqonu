import { AtlasError, type KnowledgeSearchResult } from "@atlas/shared";
import {
  isCompleteKnowledgeScope,
  missingKnowledgeScopeReason,
  type KnowledgePin,
  type KnowledgeRetrievalScope,
} from "@atlas/knowledge";
import { executeGovernedAction } from "./governed-execution.js";
import {
  resolveAgentIdentity,
  type AuthenticatedAgentIdentity,
} from "./agent-runtime-authz.js";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { findRepoRoot } from "./repo-root.js";
import { searchKnowledgeClosedLoop, type HybridRagEnv } from "./hybrid-rag.js";
import { knowledgeSearchArtifact, registerKnowledgeSearchTool } from "./knowledge-search-tool.js";

export type GovernedKnowledgeRetrieval =
  | { readonly ok: true; readonly result: KnowledgeSearchResult }
  | { readonly ok: false; readonly reason: string; readonly stage: string };

function parseToolOutput(output: string, query: string): KnowledgeSearchResult {
  try {
    const parsed = JSON.parse(output) as KnowledgeSearchResult;
    if (parsed && Array.isArray(parsed.hits) && typeof parsed.query === "string") {
      return parsed;
    }
  } catch {
    // fall through
  }
  return {
    query,
    hits: [],
    filteredOut: 0,
    plainLanguage: "INSUFFICIENT_EVIDENCE — knowledge_search returned no parseable evidence package.",
    retrievalBackend: "local",
  };
}

function auditRetrieval(input: {
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly agentId: string;
  readonly query: string;
  readonly result: KnowledgeSearchResult;
  readonly reason: string;
  readonly ok: boolean;
}): void {
  const ownerIsUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.ownerId,
    );
  const projectIsUuid =
    input.projectId != null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.projectId,
    );
  appendUnifiedAuditEntry({
    type: "knowledge.retrieved",
    toolName: "knowledge_search",
    entityType: "DOCUMENT",
    action: "READ",
    actorId: input.agentId,
    actorKind: "AGENT",
    ...(ownerIsUuid ? { ownerId: input.ownerId } : {}),
    ...(projectIsUuid ? { projectId: input.projectId } : {}),
    agentId: input.agentId,
    reason: input.reason,
    intent: "knowledge_fabric_retrieval",
    policy: "knowledge_search",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    decision: input.ok ? "ALLOW" : "DENY",
    input: { query: input.query },
    output: {
      hitCount: input.result.hits.length,
      filteredOut: input.result.filteredOut,
      backend: input.result.retrievalBackend ?? "local",
      sourceIds: input.result.hits
        .map((hit) => hit.sourceId)
        .filter((id): id is string => typeof id === "string"),
    },
    result: input.ok && input.result.hits.length > 0 ? "SUCCESS" : "PARTIAL",
  });
}

/**
 * Governed Knowledge Fabric retrieval via `executeGovernedAction`.
 * Direct HTTP search uses this path. Conversation/kernel may call
 * `searchEligibleKnowledge` when they cannot mint a fabric identity.
 */
export async function retrieveGovernedKnowledge(input: {
  readonly env: HybridRagEnv;
  readonly sessionOwnerId: string;
  readonly scope: KnowledgeRetrievalScope;
  readonly query: string;
  readonly requestId: string;
  readonly routeLabel: string;
  readonly maxResults?: number;
  readonly minAuthority?: number;
  readonly allowStale?: boolean;
  readonly pin?: KnowledgePin;
}): Promise<GovernedKnowledgeRetrieval> {
  registerKnowledgeSearchTool(input.env);
  if (!isCompleteKnowledgeScope(input.scope)) {
    const reason = missingKnowledgeScopeReason(input.scope);
    const result = await searchKnowledgeClosedLoop(input.env, {
      query: input.query,
      scope: input.scope,
    });
    auditRetrieval({
      ownerId: input.sessionOwnerId,
      projectId: input.scope.projectId,
      agentId: input.scope.requestingAgentId,
      query: input.query,
      result,
      reason,
      ok: false,
    });
    return { ok: false, reason, stage: "AUTHORIZATION" };
  }

  if (input.scope.ownerId !== input.sessionOwnerId) {
    const reason = "INSUFFICIENT_EVIDENCE — owner scope must match the authenticated session";
    return { ok: false, reason, stage: "AUTHORIZATION" };
  }

  let identity: AuthenticatedAgentIdentity;
  try {
    identity = resolveAgentIdentity({
      fabricAgentId: input.scope.requestingAgentId,
      sessionOwnerId: input.sessionOwnerId,
      projectId: input.scope.projectId,
      trustLevel: "FULL",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, stage: "AUTHORIZATION" };
  }

  const outcome = await executeGovernedAction({
    identity,
    toolName: "knowledge_search",
    toolArgs: {
      query: input.query,
      ownerId: input.scope.ownerId,
      tenantId: input.scope.tenantId,
      projectId: input.scope.projectId,
      applicationId: input.scope.applicationId,
      requestingAgentId: input.scope.requestingAgentId,
      ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
      ...(input.minAuthority !== undefined ? { minAuthority: input.minAuthority } : {}),
      ...(input.allowStale !== undefined ? { allowStale: input.allowStale } : {}),
      ...(input.pin?.sourceId ? { pinnedSourceId: input.pin.sourceId } : {}),
      ...(input.pin?.sourceVersion
        ? { pinnedSourceVersion: input.pin.sourceVersion }
        : {}),
    },
    artifact: knowledgeSearchArtifact(input.query),
    entityType: "DOCUMENT",
    action: "READ",
    sourceContext: { origin: "user_message", trustLevel: "trusted" },
    projectRoot: findRepoRoot(),
    routeLabel: input.routeLabel,
    requestId: input.requestId,
    applicationId: input.scope.applicationId,
  });

  if (outcome.status !== "EXECUTED") {
    const reason = "reason" in outcome ? outcome.reason : "knowledge_search was not executed";
    auditRetrieval({
      ownerId: input.sessionOwnerId,
      projectId: input.scope.projectId,
      agentId: identity.agentId,
      query: input.query,
      result: {
        query: input.query,
        hits: [],
        filteredOut: 0,
        plainLanguage: reason,
      },
      reason,
      ok: false,
    });
    return { ok: false, reason, stage: outcome.stage };
  }

  const result = parseToolOutput(outcome.output, input.query);
  auditRetrieval({
    ownerId: input.sessionOwnerId,
    projectId: input.scope.projectId,
    agentId: identity.agentId,
    query: input.query,
    result,
    reason: result.plainLanguage,
    ok: true,
  });
  return { ok: true, result };
}

/** Eligibility-backed search for paths that already hold a trusted session scope. */
export async function searchEligibleKnowledge(input: {
  readonly env: HybridRagEnv;
  readonly query: string;
  readonly scope: KnowledgeRetrievalScope | null;
  readonly maxResults?: number;
  readonly minAuthority?: number;
  readonly allowStale?: boolean;
  readonly pin?: KnowledgePin;
  readonly requestingAgentIds?: readonly string[];
}): Promise<KnowledgeSearchResult> {
  const result = await searchKnowledgeClosedLoop(input.env, {
    query: input.query,
    scope: input.scope,
    ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
    ...(input.minAuthority !== undefined ? { minAuthority: input.minAuthority } : {}),
    ...(input.allowStale !== undefined ? { allowStale: input.allowStale } : {}),
    ...(input.pin ? { pin: input.pin } : {}),
    ...(input.requestingAgentIds
      ? { requestingAgentIds: input.requestingAgentIds }
      : {}),
  });
  auditRetrieval({
    ownerId: input.scope?.ownerId ?? "unknown",
    projectId: input.scope?.projectId ?? null,
    agentId: input.scope?.requestingAgentId ?? "UNKNOWN",
    query: input.query,
    result,
    reason: result.plainLanguage,
    ok: isCompleteKnowledgeScope(input.scope) && result.hits.length > 0,
  });
  return result;
}

export function requireKnowledgeSearchScope(
  retrieval: GovernedKnowledgeRetrieval,
): KnowledgeSearchResult {
  if (retrieval.ok) return retrieval.result;
  throw new AtlasError("FORBIDDEN", retrieval.reason, { statusCode: 403 });
}
