import {
  EXTERNAL_SOURCE_CONFIDENCE,
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

export interface CorpusDoc {
  id: string;
  title: string;
  sourceClass: string;
  url: string | null;
  excerpt: string;
  sourceUpdatedAt: string | null;
  projectScoped: boolean;
  contentHash: string;
  /** Optional cached local-hash (or other) embedding for durable hybrid search. */
  embedding?: number[] | null;
}

function hashDoc(title: string, excerpt: string): string {
  return createHash("sha256")
    .update(`${title}|${excerpt}`)
    .digest("hex")
    .slice(0, 16);
}

const TECH_SEED: CorpusDoc[] = verifiedTechSourcesAsCorpusSeed().map((s) => ({
  id: s.id,
  title: s.title,
  sourceClass: s.sourceClass,
  url: s.url,
  excerpt: s.excerpt,
  sourceUpdatedAt: "2026-08-12T00:00:00.000Z",
  projectScoped: false,
  contentHash: hashDoc(s.title, s.excerpt),
}));

/** Seed fabric corpus — verified tech allow-list + a few operational lessons. */
const SEED_CORPUS: CorpusDoc[] = [
  ...TECH_SEED,
  {
    id: "kf_github_rest",
    title: "GitHub REST API overview",
    sourceClass: "OFFICIAL_VENDOR_DOCS",
    url: "https://docs.github.com/en/rest",
    excerpt: "Official GitHub REST API documentation.",
    sourceUpdatedAt: "2026-08-01T00:00:00.000Z",
    projectScoped: false,
    contentHash: hashDoc("GitHub REST API overview", "Official GitHub REST API documentation."),
  },
  {
    id: "kf_forum_stale",
    title: "Old forum thread on webhooks",
    sourceClass: "FORUM_DISCUSSION",
    url: "https://example.com/forum/webhooks-2019",
    excerpt: "Anecdotal discussion from 2019 — likely stale.",
    sourceUpdatedAt: "2019-05-01T00:00:00.000Z",
    projectScoped: false,
    contentHash: hashDoc("Old forum thread on webhooks", "Anecdotal discussion from 2019 — likely stale."),
  },
  {
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
  },
  {
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
  },
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

function freshness(
  updatedAt: string | null,
): "CURRENT" | "STALE" | "UNKNOWN" {
  if (!updatedAt) return "UNKNOWN";
  const ageDays =
    (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 365) return "STALE";
  return "CURRENT";
}

export function ingestKnowledgeDocument(input: {
  title: string;
  excerpt: string;
  sourceClass: string;
  url?: string | null;
  sourceUpdatedAt?: string | null;
  projectScoped?: boolean;
  embedding?: number[] | null;
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
  const doc: CorpusDoc = {
    id: `kf_${contentHash}`,
    title: input.title,
    sourceClass: input.sourceClass,
    url: input.url ?? null,
    excerpt: input.excerpt,
    sourceUpdatedAt: input.sourceUpdatedAt ?? new Date().toISOString(),
    projectScoped: input.projectScoped ?? false,
    contentHash,
    ...(input.embedding ? { embedding: [...input.embedding] } : {}),
  };
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
  embedding?: number[] | null;
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
    if (input.embedding) existing.embedding = [...input.embedding];
    persistIfConfigured();
    return existing;
  }
  if (input.id) {
    const doc: CorpusDoc = {
      id: input.id,
      title: input.title,
      sourceClass: input.sourceClass,
      url: input.url ?? null,
      excerpt: input.excerpt,
      sourceUpdatedAt: input.sourceUpdatedAt ?? new Date().toISOString(),
      projectScoped: input.projectScoped ?? false,
      contentHash,
      ...(input.embedding ? { embedding: [...input.embedding] } : {}),
    };
    CORPUS.push(doc);
    persistIfConfigured();
    return doc;
  }
  return ingestKnowledgeDocument(input);
}

export function listKnowledgeCorpus(): readonly CorpusDoc[] {
  return CORPUS;
}

/** Need-based retrieval → hybrid keyword+vector filter → rank → evidence package. */
export function searchKnowledgeFabric(input: {
  query: string;
  maxResults?: number;
  minAuthority?: number;
  allowStale?: boolean;
  /** Optional vector similarities keyed by doc id (from embeddings / pgvector). */
  vectorScores?: Readonly<Record<string, number>>;
  /** Override active corpus (e.g. pgvector candidate set). */
  corpus?: readonly CorpusDoc[];
  /** Which store produced candidates — surfaced in result + INSUFFICIENT_EVIDENCE copy. */
  retrievalBackend?: "pgvector" | "local";
}): KnowledgeSearchResult {
  const maxResults = input.maxResults ?? 20;
  const minAuthority = input.minAuthority ?? 0.4;
  const allowStale = input.allowStale ?? false;
  const docs = input.corpus ?? CORPUS;
  const q = input.query.toLowerCase();
  const now = new Date().toISOString();
  let filteredOut = 0;

  const scored = docs.map((doc) => {
    const authority =
      EXTERNAL_SOURCE_CONFIDENCE[doc.sourceClass] ??
      EXTERNAL_SOURCE_CONFIDENCE.TECHNICAL_ARTICLE ??
      0.5;
    const tokens = q.split(/\s+/).filter(Boolean);
    const relevance = tokens.filter(
      (t) =>
        doc.title.toLowerCase().includes(t) ||
        doc.excerpt.toLowerCase().includes(t),
    ).length;
    const vector = input.vectorScores?.[doc.id] ?? 0;
    const fresh = freshness(doc.sourceUpdatedAt);
    return { doc, authority, relevance, vector, fresh };
  });

  const kept = scored.filter((row) => {
    if (row.authority < minAuthority) {
      filteredOut += 1;
      return false;
    }
    if (!allowStale && row.fresh === "STALE") {
      filteredOut += 1;
      return false;
    }
    const hybridHit = row.relevance > 0 || row.vector >= 0.35;
    // Need-based retrieval: never return packages that neither keyword nor vector matched.
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

  const hits = kept.slice(0, maxResults).map((row) => ({
    id: row.doc.id,
    title: row.doc.title,
    sourceClass: row.doc.sourceClass,
    authority: row.authority,
    url: row.doc.url,
    retrievedAt: now,
    sourceUpdatedAt: row.doc.sourceUpdatedAt,
    freshness: row.fresh,
    excerpt: row.doc.excerpt,
    contentHash: row.doc.contentHash,
    epistemicState:
      row.fresh === "CURRENT" && row.authority >= 0.9
        ? ("OBSERVED" as const)
        : ("INFERRED" as const),
  }));

  const backend = input.retrievalBackend ?? "local";
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
  maxItems?: number;
}): KnowledgeSearchResult {
  const q = [input.query, ...input.agentSpecialtyHints].join(" ");
  return searchKnowledgeFabric({
    query: q,
    maxResults: input.maxItems ?? 8,
    minAuthority: 0.4,
    allowStale: false,
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
