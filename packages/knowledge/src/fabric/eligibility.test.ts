import { afterEach, describe, expect, it } from "vitest";
import {
  ingestKnowledgeDocument,
  resetKnowledgeCorpusToSeed,
  searchKnowledgeFabric,
} from "./search.js";
import type { KnowledgeRetrievalScope } from "./eligibility.js";

const SCOPE: KnowledgeRetrievalScope = {
  ownerId: "11111111-1111-4111-8111-111111111111",
  tenantId: "tenant-test",
  projectId: "22222222-2222-4222-8222-222222222222",
  applicationId: "app-test",
  requestingAgentId: "RESEARCHER",
};

describe("knowledge fabric eligibility", () => {
  afterEach(() => {
    resetKnowledgeCorpusToSeed();
  });

  it("fails closed when retrieval scope is missing", () => {
    const result = searchKnowledgeFabric({ query: "webhook idempotency" });
    expect(result.hits).toHaveLength(0);
    expect(result.plainLanguage).toMatch(/INSUFFICIENT_EVIDENCE/);
    expect(result.plainLanguage).toMatch(/scope/);
  });

  it("does not treat unknown authority as a technical article", () => {
    ingestKnowledgeDocument({
      title: "Mystery blog on webhooks",
      excerpt: "Anecdotal webhook idempotency advice from an unknown blog.",
      sourceClass: "MYSTERY_BLOG",
    });
    const result = searchKnowledgeFabric({
      query: "webhook idempotency",
      scope: SCOPE,
    });
    expect(result.hits.some((hit) => hit.title === "Mystery blog on webhooks")).toBe(
      false,
    );
  });

  it("excludes stale knowledge unless allowStale is explicit", () => {
    const stale = searchKnowledgeFabric({
      query: "forum webhooks",
      scope: SCOPE,
      allowStale: false,
    });
    expect(stale.hits.some((hit) => hit.id === "kf_forum_stale")).toBe(false);
  });

  it("enforces projectScoped isolation and does not broaden missing bindings", () => {
    ingestKnowledgeDocument({
      title: "Tenant webhook runbook",
      excerpt: "Project-scoped webhook idempotency procedure.",
      sourceClass: "REPOSITORY_SOURCE",
      projectScoped: true,
      ownerId: SCOPE.ownerId,
      tenantId: SCOPE.tenantId,
      projectId: SCOPE.projectId,
      applicationId: SCOPE.applicationId,
    });
    ingestKnowledgeDocument({
      title: "Other project webhook runbook",
      excerpt: "Project-scoped webhook idempotency procedure for another app.",
      sourceClass: "REPOSITORY_SOURCE",
      projectScoped: true,
      ownerId: SCOPE.ownerId,
      tenantId: SCOPE.tenantId,
      projectId: "33333333-3333-4333-8333-333333333333",
      applicationId: SCOPE.applicationId,
    });

    const result = searchKnowledgeFabric({
      query: "webhook idempotency procedure",
      scope: SCOPE,
    });
    expect(result.hits.some((hit) => hit.title === "Tenant webhook runbook")).toBe(
      true,
    );
    expect(
      result.hits.some((hit) => hit.title === "Other project webhook runbook"),
    ).toBe(false);
  });

  it("pins retrieval to a canonical source version", () => {
    const created = ingestKnowledgeDocument({
      title: "Pinned webhook lesson",
      excerpt: "Pinned webhook idempotency excerpt for source version tests.",
      sourceClass: "REPOSITORY_SOURCE",
    });
    const pinned = searchKnowledgeFabric({
      query: "webhook idempotency",
      scope: SCOPE,
      pin: { sourceId: "repository", sourceVersion: created.contentHash },
    });
    expect(pinned.hits.some((hit) => hit.id === created.id)).toBe(true);

    const missed = searchKnowledgeFabric({
      query: "webhook idempotency",
      scope: SCOPE,
      pin: { sourceId: "repository", sourceVersion: "not-this-version" },
    });
    expect(missed.hits.some((hit) => hit.id === created.id)).toBe(false);
  });

  it("returns INSUFFICIENT_EVIDENCE on material conflict instead of inventing a winner", () => {
    ingestKnowledgeDocument({
      title: "Feature status A",
      excerpt: "Rate limiting exists and is required for production APIs always.",
      sourceClass: "REPOSITORY_SOURCE",
    });
    ingestKnowledgeDocument({
      title: "Feature status B",
      excerpt: "Rate limiting exists and is never required for production APIs.",
      sourceClass: "REPOSITORY_SOURCE",
    });
    const result = searchKnowledgeFabric({
      query: "rate limiting exists production",
      scope: SCOPE,
    });
    expect(result.hits).toHaveLength(0);
    expect(result.plainLanguage).toMatch(/INSUFFICIENT_EVIDENCE/);
    expect(result.plainLanguage).toMatch(/conflict/i);
  });
});
