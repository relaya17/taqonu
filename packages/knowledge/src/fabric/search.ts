import {
  knowledgeSearchResultSchema,
  verifiedTechSourcesAsCorpusSeed,
  type KnowledgeSearchResult,
} from "@atlas/shared";
import { createHash } from "node:crypto";
import {
  loadPersistedCorpus,
  resolveKnowledgeCorpusPath,
  savePersistedCorpus,
} from "./persisted-store.js";
import { CIVIO_RIGHTS_SNAPSHOT } from "./civio-rights.snapshot.js";
import {
  evaluateKnowledgeEligibility,
  insufficientKnowledgeResult,
  isCompleteKnowledgeScope,
  missingKnowledgeScopeReason,
  type KnowledgePin,
  type KnowledgeRetrievalScope,
} from "./eligibility.js";
import { resolveCanonicalKnowledgeSource } from "./source-registry.js";
import { eligibleHitsAreMateriallyConflicting } from "./retrieval-conflict.js";

export interface CorpusDoc {
  id: string;
  title: string;
  sourceClass: string;
  url: string | null;
  excerpt: string;
  sourceUpdatedAt: string | null;
  projectScoped: boolean;
  contentHash: string;
  /** Canonical `knowledge_sources` identity (allow-list id or repository class). */
  sourceId?: string | null;
  /** Pinned source version — content hash of the retrieved document/chunk. */
  sourceVersion?: string | null;
  ownerId?: string | null;
  tenantId?: string | null;
  projectId?: string | null;
  applicationId?: string | null;
  /** Omit for shared documents; scoped documents require an allowed agent identity. */
  allowedAgentIds?: string[] | null;
  /** Optional cached local-hash (or other) embedding for durable hybrid search. */
  embedding?: number[] | null;
}

function hashDoc(title: string, excerpt: string): string {
  return createHash("sha256")
    .update(`${title}|${excerpt}`)
    .digest("hex")
    .slice(0, 16);
}

const TECH_SEED: CorpusDoc[] = verifiedTechSourcesAsCorpusSeed().map((s) =>
  bindSourceFields({
    id: s.id,
    title: s.title,
    sourceClass: s.sourceClass,
    url: s.url,
    excerpt: s.excerpt,
    sourceUpdatedAt: "2026-08-12T00:00:00.000Z",
    projectScoped: false,
    contentHash: hashDoc(s.title, s.excerpt),
  }),
);

const CIVIO_SEED: CorpusDoc[] = CIVIO_RIGHTS_SNAPSHOT.map((doc) =>
  bindSourceFields({
    ...doc,
    allowedAgentIds: [...doc.allowedAgentIds],
  }),
);

/** Seed fabric corpus — verified tech allow-list + a few operational lessons. */
const SEED_CORPUS: CorpusDoc[] = [
  ...TECH_SEED,
  ...CIVIO_SEED,
  bindSourceFields({
    id: "kf_github_rest",
    title: "GitHub REST API overview",
    sourceClass: "OFFICIAL_VENDOR_DOCS",
    url: "https://docs.github.com/en/rest",
    excerpt: "Official GitHub REST API documentation.",
    sourceUpdatedAt: "2026-08-01T00:00:00.000Z",
    projectScoped: false,
    contentHash: hashDoc("GitHub REST API overview", "Official GitHub REST API documentation."),
  }),
  bindSourceFields({
    id: "kf_forum_stale",
    title: "Old forum thread on webhooks",
    sourceClass: "FORUM_DISCUSSION",
    url: "https://example.com/forum/webhooks-2019",
    excerpt: "Anecdotal discussion from 2019 — likely stale.",
    sourceUpdatedAt: "2019-05-01T00:00:00.000Z",
    projectScoped: false,
    contentHash: hashDoc("Old forum thread on webhooks", "Anecdotal discussion from 2019 — likely stale."),
  }),
  bindSourceFields({
    id: "kf_webhook_lesson",
    title: "Lesson: webhook idempotency",
    sourceClass: "REPOSITORY_SOURCE",
    url: null,
    excerpt:
      "Pattern WEBHOOK_IDEMPOTENCY — external webhooks need idempotency key + unique constraint. Validated in lab projects.",
    sourceUpdatedAt: "2026-08-10T00:00:00.000Z",
    projectScoped: false,
    contentHash: hashDoc(
      "Lesson: webhook idempotency",
      "Pattern WEBHOOK_IDEMPOTENCY — external webhooks need idempotency key + unique constraint. Validated in lab projects.",
    ),
  }),
  bindSourceFields({
    id: "kf_auth_pattern",
    title: "Lesson: authz defense in depth",
    sourceClass: "REPOSITORY_SOURCE",
    url: null,
    excerpt:
      "Pattern AUTHZ_DEFENSE — API authZ checks + RLS + audit event. Cross-project engineering lesson only.",
    sourceUpdatedAt: "2026-08-11T00:00:00.000Z",
    projectScoped: false,
    contentHash: hashDoc(
      "Lesson: authz defense in depth",
      "Pattern AUTHZ_DEFENSE — API authZ checks + RLS + audit event.",
    ),
  }),
];

/** Mutable active corpus — seed by default; prefer persisted file when hydrated. */
let CORPUS: CorpusDoc[] = SEED_CORPUS.map((d) => ({ ...d }));
let corpusSource: "seed" | "persisted" = "seed";
let persistPath: string | null = null;
let hydrated = false;
let lastLoadedPath: string | null = null;

function persistIfConfigured(): void {
  if (!persistPath) return;
  try {
    savePersistedCorpus(CORPUS, persistPath);
    corpusSource = "persisted";
  } catch {
    // Persistence is best-effort for lab MVP — in-memory remains authoritative if write fails.
  }
}

export function getKnowledgeCorpusSource(): "seed" | "persisted" {
  return corpusSource;
}

export function getKnowledgeCorpusPersistPath(): string | null {
  return persistPath;
}

/** Replace active corpus (e.g. after loading from disk). */
export function setKnowledgeCorpus(
  docs: readonly CorpusDoc[],
  source: "seed" | "persisted" = "persisted",
): void {
  CORPUS = docs.map((d) => ({ ...d }));
  corpusSource = source;
  hydrated = true;
}

export function resetKnowledgeCorpusToSeed(): void {
  CORPUS = SEED_CORPUS.map((d) => ({ ...d }));
  corpusSource = "seed";
  hydrated = true;
  lastLoadedPath = null;
}

/**
 * Prefer durable `.atlas/knowledge/corpus.json` when present & non-empty;
 * otherwise keep in-memory seed. Enables write-through on subsequent ingest.
 */
export function hydrateKnowledgeCorpus(opts?: {
  path?: string;
  enablePersist?: boolean;
  /** Force re-read from disk even if already hydrated. */
  force?: boolean;
}): { source: "seed" | "persisted"; path: string; count: number } {
  const path = resolveKnowledgeCorpusPath(opts?.path);
  if (opts?.enablePersist !== false) {
    persistPath = path;
  }
  if (hydrated && !opts?.force && lastLoadedPath === path) {
    return { source: corpusSource, path, count: CORPUS.length };
  }
  const loaded = loadPersistedCorpus(path);
  if (loaded && loaded.documents.length > 0) {
    setKnowledgeCorpus(loaded.documents, "persisted");
    // Merge newly added verified-tech seed docs that older corpus files lack.
    let merged = false;
    for (const seed of SEED_CORPUS) {
      if (!CORPUS.some((d) => d.id === seed.id)) {
        CORPUS.push({ ...seed });
        merged = true;
      }
    }
    if (merged) {
      persistIfConfigured();
    }
    lastLoadedPath = path;
    return { source: "persisted", path: loaded.path, count: CORPUS.length };
  }
  if (!hydrated) {
    resetKnowledgeCorpusToSeed();
  }
  lastLoadedPath = path;
  return { source: corpusSource, path, count: CORPUS.length };
}

function bindSourceFields(doc: CorpusDoc): CorpusDoc {
  const source = resolveCanonicalKnowledgeSource({
    url: doc.url,
    sourceClass: doc.sourceClass,
    title: doc.title,
  });
  return {
    ...doc,
    sourceId: doc.sourceId ?? source.sourceId,
    sourceVersion: doc.sourceVersion ?? doc.contentHash,
  } satisfies CorpusDoc;
}

export function ingestKnowledgeDocument(input: {
  title: string;
  excerpt: string;
  sourceClass: string;
  url?: string | null;
  sourceUpdatedAt?: string | null;
  projectScoped?: boolean;
  allowedAgentIds?: string[] | null;
  embedding?: number[] | null;
  ownerId?: string | null;
  tenantId?: string | null;
  projectId?: string | null;
  applicationId?: string | null;
}): CorpusDoc {
  const contentHash = hashDoc(input.title, input.excerpt);
  const existing = CORPUS.find((d) => d.contentHash === contentHash);
  if (existing) {
    if (input.embedding && (!existing.embedding || existing.embedding.length === 0)) {
      existing.embedding = [...input.embedding];
      persistIfConfigured();
    }
    return existing;
  }
  const doc = bindSourceFields({
    id: `kf_${contentHash}`,
    title: input.title,
    sourceClass: input.sourceClass,
    url: input.url ?? null,
    excerpt: input.excerpt,
    sourceUpdatedAt: input.sourceUpdatedAt ?? new Date().toISOString(),
    projectScoped: input.projectScoped ?? false,
    contentHash,
    ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.applicationId !== undefined
      ? { applicationId: input.applicationId }
      : {}),
    ...(input.allowedAgentIds ? { allowedAgentIds: [...input.allowedAgentIds] } : {}),
    ...(input.embedding ? { embedding: [...input.embedding] } : {}),
  });
  CORPUS.push(doc);
  persistIfConfigured();
  return doc;
}

/** Update a stable source id / URL in place so daily refresh does not fork the corpus. */
export function upsertKnowledgeDocument(input: {
  id?: string;
  title: string;
  excerpt: string;
  sourceClass: string;
  url?: string | null;
  sourceUpdatedAt?: string | null;
  projectScoped?: boolean;
  allowedAgentIds?: string[] | null;
  embedding?: number[] | null;
  ownerId?: string | null;
  tenantId?: string | null;
  projectId?: string | null;
  applicationId?: string | null;
}): CorpusDoc {
  const contentHash = hashDoc(input.title, input.excerpt);
  const existing =
    (input.id ? CORPUS.find((d) => d.id === input.id) : undefined) ??
    (input.url ? CORPUS.find((d) => d.url === input.url) : undefined);
  if (existing) {
    existing.title = input.title;
    existing.excerpt = input.excerpt;
    existing.sourceClass = input.sourceClass;
    existing.url = input.url ?? existing.url;
    existing.sourceUpdatedAt = input.sourceUpdatedAt ?? new Date().toISOString();
    existing.contentHash = contentHash;
    existing.projectScoped = input.projectScoped ?? existing.projectScoped;
    if (input.allowedAgentIds !== undefined) {
      existing.allowedAgentIds = input.allowedAgentIds
        ? [...input.allowedAgentIds]
        : input.allowedAgentIds;
    }
    if (input.ownerId !== undefined) existing.ownerId = input.ownerId;
    if (input.tenantId !== undefined) existing.tenantId = input.tenantId;
    if (input.projectId !== undefined) existing.projectId = input.projectId;
    if (input.applicationId !== undefined) {
      existing.applicationId = input.applicationId;
    }
    if (input.embedding) existing.embedding = [...input.embedding];
    const bound = bindSourceFields(existing);
    existing.sourceId = bound.sourceId ?? null;
    existing.sourceVersion = bound.sourceVersion ?? existing.contentHash;
    persistIfConfigured();
    return existing;
  }
  if (input.id) {
    const doc = bindSourceFields({
      id: input.id,
      title: input.title,
      sourceClass: input.sourceClass,
      url: input.url ?? null,
      excerpt: input.excerpt,
      sourceUpdatedAt: input.sourceUpdatedAt ?? new Date().toISOString(),
      projectScoped: input.projectScoped ?? false,
      contentHash,
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.applicationId !== undefined
        ? { applicationId: input.applicationId }
        : {}),
      ...(input.allowedAgentIds ? { allowedAgentIds: [...input.allowedAgentIds] } : {}),
      ...(input.embedding ? { embedding: [...input.embedding] } : {}),
    });
    CORPUS.push(doc);
    persistIfConfigured();
    return doc;
  }
  return ingestKnowledgeDocument(input);
}

export function listKnowledgeCorpus(): readonly CorpusDoc[] {
  return CORPUS;
}

/** Need-based retrieval → eligibility → hybrid keyword+vector filter → rank → evidence package. */
export function searchKnowledgeFabric(input: {
  query: string;
  scope?: KnowledgeRetrievalScope | null;
  maxResults?: number;
  minAuthority?: number;
  allowStale?: boolean;
  requestingAgentIds?: readonly string[];
  pin?: KnowledgePin;
  /** Optional vector similarities keyed by doc id (from embeddings / pgvector). */
  vectorScores?: Readonly<Record<string, number>>;
  /** Override active corpus (e.g. pgvector candidate set). */
  corpus?: readonly CorpusDoc[];
  /** Which store produced candidates — surfaced in result + INSUFFICIENT_EVIDENCE copy. */
  retrievalBackend?: "pgvector" | "local";
}): KnowledgeSearchResult {
  const backend = input.retrievalBackend ?? "local";
  const docs = input.corpus ?? CORPUS;
  const requestedScope = input.scope ?? null;
  if (!requestedScope || !isCompleteKnowledgeScope(requestedScope)) {
    return insufficientKnowledgeResult({
      query: input.query,
      reason: missingKnowledgeScopeReason(requestedScope),
      retrievalBackend: backend,
      filteredOut: docs.length,
    });
  }

  const scope: KnowledgeRetrievalScope = input.requestingAgentIds?.length
    ? { ...requestedScope, requestingAgentIds: input.requestingAgentIds }
    : requestedScope;

  const maxResults = input.maxResults ?? 20;
  const minAuthority = input.minAuthority ?? 0.4;
  const allowStale = input.allowStale ?? false;
  const q = input.query.toLowerCase();
  const now = new Date();
  const retrievedAt = now.toISOString();

  let filteredOut = 0;
  const eligibleDocs: Array<{
    doc: CorpusDoc;
    authority: number;
    freshness: "CURRENT" | "STALE" | "UNKNOWN";
    sourceId: string;
    sourceVersion: string;
  }> = [];

  for (const doc of docs) {
    const decision = evaluateKnowledgeEligibility({
      doc,
      scope,
      minAuthority,
      allowStale,
      now,
      ...(input.pin ? { pin: input.pin } : {}),
    });
    if (!decision.eligible || decision.authority == null) {
      filteredOut += 1;
      continue;
    }
    eligibleDocs.push({
      doc,
      authority: decision.authority,
      freshness: decision.freshness,
      sourceId: decision.source.sourceId,
      sourceVersion: decision.sourceVersion,
    });
  }

  const scored = eligibleDocs.map((row) => {
    const tokens = q.split(/\s+/).filter(Boolean);
    const relevance = tokens.filter(
      (t) =>
        row.doc.title.toLowerCase().includes(t) ||
        row.doc.excerpt.toLowerCase().includes(t),
    ).length;
    const vector = input.vectorScores?.[row.doc.id] ?? 0;
    return { ...row, relevance, vector };
  });

  const kept = scored.filter((row) => {
    const hybridHit = row.relevance > 0 || row.vector >= 0.35;
    if (!hybridHit && q.length > 2) {
      filteredOut += 1;
      return false;
    }
    return true;
  });

  kept.sort(
    (a, b) =>
      b.authority + b.vector * 0.5 + b.relevance * 0.2 -
        (a.authority + a.vector * 0.5 + a.relevance * 0.2) ||
      a.doc.title.localeCompare(b.doc.title),
  );

  const ranked = kept.slice(0, maxResults);
  if (eligibleHitsAreMateriallyConflicting(ranked.map((row) => ({
    id: row.doc.id,
    excerpt: row.doc.excerpt,
    authority: row.authority,
    sourceUpdatedAt: row.doc.sourceUpdatedAt,
  })))) {
    return insufficientKnowledgeResult({
      query: input.query,
      reason: `INSUFFICIENT_EVIDENCE — eligible sources conflict; refusing to invent a resolution (filtered ${filteredOut}).`,
      retrievalBackend: backend,
      filteredOut: filteredOut + ranked.length,
    });
  }

  const hits = ranked.map((row) => ({
    id: row.doc.id,
    title: row.doc.title,
    sourceClass: row.doc.sourceClass,
    authority: row.authority,
    url: row.doc.url,
    retrievedAt,
    sourceUpdatedAt: row.doc.sourceUpdatedAt,
    freshness: row.freshness,
    excerpt: row.doc.excerpt,
    contentHash: row.doc.contentHash,
    sourceId: row.sourceId,
    sourceVersion: row.sourceVersion,
    documentId: row.doc.id,
    epistemicState:
      row.freshness === "CURRENT" && row.authority >= 0.9
        ? ("OBSERVED" as const)
        : ("INFERRED" as const),
  }));

  const plainLanguage =
    hits.length === 0
      ? `INSUFFICIENT_EVIDENCE — hybrid retrieve (${backend}) returned 0 packages (filtered ${filteredOut}). No invented results.`
      : `Hybrid retrieve (${backend}) returned ${hits.length} packages (filtered ${filteredOut}). Keyword + vector — evidence packages only.`;

  return knowledgeSearchResultSchema.parse({
    query: input.query,
    hits,
    filteredOut,
    plainLanguage,
    retrievalBackend: backend,
  });
}

export function buildEvidencePackageForAgent(input: {
  query: string;
  agentSpecialtyHints: string[];
  agentIds: readonly string[];
  maxItems?: number;
  scope?: KnowledgeRetrievalScope | null;
}): KnowledgeSearchResult {
  const q = [input.query, ...input.agentSpecialtyHints].join(" ");
  return searchKnowledgeFabric({
    query: q,
    ...(input.scope ? { scope: input.scope } : {}),
    maxResults: input.maxItems ?? 8,
    minAuthority: 0.4,
    allowStale: false,
    requestingAgentIds: input.agentIds,
  });
}

export function listPortfolioLessons() {
  return [
    {
      id: crypto.randomUUID(),
      pattern: "WEBHOOK_IDEMPOTENCY",
      title: "External webhooks need idempotency",
      evidenceProjectSlug: "brokeros",
      applicableDomains: ["payments", "CRM", "external integrations"],
      summary:
        "All external webhook handlers require idempotency key + unique constraint. Cross-project lesson only — no raw project data shared.",
      createdAt: new Date().toISOString(),
      epistemicState: "INFERRED" as const,
    },
    {
      id: crypto.randomUUID(),
      pattern: "AUTHZ_DEFENSE",
      title: "AuthZ defense in depth",
      evidenceProjectSlug: null,
      applicableDomains: ["API", "multi-tenant", "security"],
      summary:
        "API authZ checks + RLS + audit event. Engineering pattern reusable across portfolio.",
      createdAt: new Date().toISOString(),
      epistemicState: "INFERRED" as const,
    },
  ];
}
