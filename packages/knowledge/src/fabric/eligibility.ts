import type { KnowledgeSearchResult } from "@atlas/shared";
import { knowledgeSearchResultSchema } from "@atlas/shared";
import { authorityWeight, tierForSourceType } from "../ranking/authority.js";
import { computeFreshnessScore } from "../ranking/freshness.js";
import {
  classifiedSourceAuthority,
  resolveCanonicalKnowledgeSource,
  type CanonicalKnowledgeSource,
} from "./source-registry.js";

/** Structural document shape used by eligibility — avoids a search.ts import cycle. */
export interface KnowledgeEligibleDocument {
  readonly id: string;
  readonly title: string;
  readonly sourceClass: string;
  readonly url: string | null;
  readonly excerpt: string;
  readonly sourceUpdatedAt: string | null;
  readonly projectScoped: boolean;
  readonly contentHash: string;
  readonly sourceId?: string | null;
  readonly sourceVersion?: string | null;
  readonly ownerId?: string | null;
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
  readonly applicationId?: string | null;
  readonly allowedAgentIds?: string[] | null;
}

/** Required retrieval scope. Missing any field fails closed — never inferred. */
export interface KnowledgeRetrievalScope {
  readonly ownerId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly requestingAgentId: string;
  /** Additional agents on a kernel/dispatch package. All must be allowed. */
  readonly requestingAgentIds?: readonly string[];
}

export interface KnowledgePin {
  readonly sourceId?: string;
  readonly sourceVersion?: string;
}

export type KnowledgeFreshnessLabel = "CURRENT" | "STALE" | "UNKNOWN";

export interface KnowledgeEligibilityDecision {
  readonly eligible: boolean;
  readonly reason: string;
  readonly source: CanonicalKnowledgeSource;
  readonly authority: number | null;
  readonly freshness: KnowledgeFreshnessLabel;
  readonly freshnessScore: number | null;
  readonly sourceVersion: string;
}

const STALE_AFTER_DAYS = 365;

export function isCompleteKnowledgeScope(
  value: KnowledgeRetrievalScope | null | undefined,
): boolean {
  if (!value) return false;
  return (
    value.ownerId.trim().length > 0 &&
    value.tenantId.trim().length > 0 &&
    value.projectId.trim().length > 0 &&
    value.applicationId.trim().length > 0 &&
    value.requestingAgentId.trim().length > 0
  );
}

export function missingKnowledgeScopeReason(
  value: KnowledgeRetrievalScope | null | undefined,
): string {
  if (!value) {
    return "INSUFFICIENT_EVIDENCE — retrieval scope is required (owner, tenant, project, application, requesting agent)";
  }
  const missing: string[] = [];
  if (!value.ownerId.trim()) missing.push("owner");
  if (!value.tenantId.trim()) missing.push("tenant");
  if (!value.projectId.trim()) missing.push("project");
  if (!value.applicationId.trim()) missing.push("application");
  if (!value.requestingAgentId.trim()) missing.push("requesting agent");
  return `INSUFFICIENT_EVIDENCE — missing required retrieval scope: ${missing.join(", ")}`;
}

export function classifyKnowledgeFreshness(
  updatedAt: string | null,
  now = Date.now(),
): KnowledgeFreshnessLabel {
  if (!updatedAt) return "UNKNOWN";
  const ageDays = (now - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(ageDays)) return "UNKNOWN";
  if (ageDays > STALE_AFTER_DAYS) return "STALE";
  return "CURRENT";
}

function requestingAgents(scope: KnowledgeRetrievalScope): readonly string[] {
  if (scope.requestingAgentIds && scope.requestingAgentIds.length > 0) {
    return scope.requestingAgentIds;
  }
  return [scope.requestingAgentId];
}

function scopeFieldMatches(
  documented: string | null | undefined,
  requested: string,
): boolean {
  if (documented == null || documented.trim().length === 0) return false;
  return documented === requested;
}

/**
 * Single eligibility function for every Knowledge Fabric retrieval path.
 * Fail closed: missing scope, unknown authority, unauthorized source,
 * project/agent mismatch, stale (unless allowStale), pin mismatch.
 */
export function evaluateKnowledgeEligibility(input: {
  readonly doc: KnowledgeEligibleDocument;
  readonly scope: KnowledgeRetrievalScope;
  readonly minAuthority: number;
  readonly allowStale: boolean;
  readonly pin?: KnowledgePin;
  readonly now?: Date;
}): KnowledgeEligibilityDecision {
  const source = resolveCanonicalKnowledgeSource({
    url: input.doc.url,
    sourceClass: input.doc.sourceClass,
    ...(input.doc.title ? { title: input.doc.title } : {}),
  });
  const sourceVersion = input.doc.sourceVersion ?? input.doc.contentHash;
  const freshness = classifyKnowledgeFreshness(
    input.doc.sourceUpdatedAt,
    input.now?.getTime(),
  );
  const authority = source.authority ?? classifiedSourceAuthority(input.doc.sourceClass);

  const fail = (reason: string): KnowledgeEligibilityDecision => ({
    eligible: false,
    reason,
    source,
    authority,
    freshness,
    freshnessScore: null,
    sourceVersion,
  });

  if (!source.allowed || authority == null || source.sourceType == null) {
    return fail("unknown or unclassified source is ineligible");
  }

  if (authority < input.minAuthority) {
    return fail("authority below minimum");
  }

  if (!input.allowStale && freshness === "STALE") {
    return fail("stale knowledge excluded");
  }

  const pin = input.pin;
  if (pin?.sourceId && pin.sourceId !== source.sourceId) {
    return fail("source pin mismatch");
  }
  if (pin?.sourceVersion && pin.sourceVersion !== sourceVersion) {
    return fail("source version pin mismatch");
  }

  if (input.doc.projectScoped) {
    if (!scopeFieldMatches(input.doc.projectId, input.scope.projectId)) {
      return fail("project-scoped document is not in the requesting project");
    }
    if (input.doc.ownerId != null && input.doc.ownerId.trim().length > 0) {
      if (input.doc.ownerId !== input.scope.ownerId) {
        return fail("owner scope mismatch");
      }
    } else {
      return fail("project-scoped document is missing owner binding");
    }
    if (input.doc.tenantId != null && input.doc.tenantId.trim().length > 0) {
      if (input.doc.tenantId !== input.scope.tenantId) {
        return fail("tenant scope mismatch");
      }
    } else {
      return fail("project-scoped document is missing tenant binding");
    }
    if (input.doc.applicationId != null && input.doc.applicationId.trim().length > 0) {
      if (input.doc.applicationId !== input.scope.applicationId) {
        return fail("application scope mismatch");
      }
    } else {
      return fail("project-scoped document is missing application binding");
    }
  }

  const allowed = input.doc.allowedAgentIds;
  if (allowed && allowed.length > 0) {
    const requesting = requestingAgents(input.scope);
    const permitted =
      requesting.length > 0 && requesting.every((agentId) => allowed.includes(agentId));
    if (!permitted) {
      return fail("requesting agent is not in allowedAgentIds");
    }
  }

  const retrievedAt = input.now ?? new Date();
  const publishedAt = input.doc.sourceUpdatedAt
    ? new Date(input.doc.sourceUpdatedAt)
    : null;
  const freshnessScore = computeFreshnessScore({
    authority: tierForSourceType(source.sourceType),
    retrievedAt,
    publishedAt,
    updatedAt: publishedAt,
    verified: source.allowed,
    relevance: Math.min(1, Math.max(0, authorityWeight(tierForSourceType(source.sourceType)))),
    now: retrievedAt,
  });

  return {
    eligible: true,
    reason: "eligible",
    source,
    authority,
    freshness,
    freshnessScore,
    sourceVersion,
  };
}

export function insufficientKnowledgeResult(input: {
  readonly query: string;
  readonly reason: string;
  readonly retrievalBackend?: "pgvector" | "local";
  readonly filteredOut?: number;
}): KnowledgeSearchResult {
  return knowledgeSearchResultSchema.parse({
    query: input.query,
    hits: [],
    filteredOut: input.filteredOut ?? 0,
    plainLanguage: input.reason,
    retrievalBackend: input.retrievalBackend ?? "local",
  });
}
