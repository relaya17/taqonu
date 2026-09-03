import { randomUUID } from "node:crypto";
import { registerTool } from "@atlas/agent-core";
import type { KnowledgeSearchResult } from "@atlas/shared";
import { searchKnowledgeClosedLoop, type HybridRagEnv } from "./hybrid-rag.js";
import type { KnowledgePin, KnowledgeRetrievalScope } from "@atlas/knowledge";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function scopeFromToolArgs(
  args: Readonly<Record<string, unknown>>,
): KnowledgeRetrievalScope | null {
  const ownerId = asNonEmptyString(args["ownerId"]);
  const tenantId = asNonEmptyString(args["tenantId"]);
  const projectId = asNonEmptyString(args["projectId"]);
  const applicationId = asNonEmptyString(args["applicationId"]);
  const requestingAgentId = asNonEmptyString(args["requestingAgentId"]);
  if (!ownerId || !tenantId || !projectId || !applicationId || !requestingAgentId) {
    return null;
  }
  return { ownerId, tenantId, projectId, applicationId, requestingAgentId };
}

function pinFromToolArgs(args: Readonly<Record<string, unknown>>): KnowledgePin | undefined {
  const sourceId = asNonEmptyString(args["pinnedSourceId"]);
  const sourceVersion = asNonEmptyString(args["pinnedSourceVersion"]);
  if (!sourceId && !sourceVersion) return undefined;
  return {
    ...(sourceId ? { sourceId } : {}),
    ...(sourceVersion ? { sourceVersion } : {}),
  };
}

/** Registers the canonical `knowledge_search` DOCUMENT.READ implementation. */
export function registerKnowledgeSearchTool(env: HybridRagEnv): void {
  registerTool({
    name: "knowledge_search",
    async run(args) {
      const query = asNonEmptyString(args["query"]);
      if (!query) {
        throw new Error('"query" is required and must be a non-empty string');
      }
      const scope = scopeFromToolArgs(args);
      const pin = pinFromToolArgs(args);
      const maxResults =
        typeof args["maxResults"] === "number" ? args["maxResults"] : undefined;
      const minAuthority =
        typeof args["minAuthority"] === "number" ? args["minAuthority"] : undefined;
      const allowStale =
        typeof args["allowStale"] === "boolean" ? args["allowStale"] : undefined;
      const result: KnowledgeSearchResult = await searchKnowledgeClosedLoop(env, {
        query,
        scope,
        ...(maxResults !== undefined ? { maxResults } : {}),
        ...(minAuthority !== undefined ? { minAuthority } : {}),
        ...(allowStale !== undefined ? { allowStale } : {}),
        ...(pin ? { pin } : {}),
      });
      return JSON.stringify(result);
    },
  });
}

export function knowledgeSearchArtifact(query: string): string {
  return `knowledge_search:${query}:${randomUUID()}`;
}
