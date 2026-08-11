import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getKnowledgeCorpusSource,
  hydrateKnowledgeCorpus,
  ingestKnowledgeDocument,
  listKnowledgeCorpus,
  resetKnowledgeCorpusToSeed,
  searchKnowledgeFabric,
} from "./search.js";
import {
  loadPersistedCorpus,
  savePersistedCorpus,
} from "./persisted-store.js";

describe("durable knowledge corpus", () => {
  const dirs: string[] = [];

  afterEach(() => {
    resetKnowledgeCorpusToSeed();
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("hydrates seed when no file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-kf-"));
    dirs.push(dir);
    const path = join(dir, "corpus.json");
    const result = hydrateKnowledgeCorpus({ path, enablePersist: true });
    expect(result.source).toBe("seed");
    expect(listKnowledgeCorpus().length).toBeGreaterThan(0);
    expect(getKnowledgeCorpusSource()).toBe("seed");
  });

  it("prefers persisted corpus when present and write-through on ingest", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-kf-"));
    dirs.push(dir);
    const path = join(dir, "corpus.json");
    savePersistedCorpus(
      [
        {
          id: "kf_custom",
          title: "Durable webhook lesson",
          sourceClass: "REPOSITORY_SOURCE",
          url: null,
          excerpt: "Persisted hybrid RAG chunk about webhook idempotency.",
          sourceUpdatedAt: "2026-08-11T00:00:00.000Z",
          projectScoped: false,
          contentHash: "abc123persisted01",
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      path,
    );

    const hydrated = hydrateKnowledgeCorpus({ path, enablePersist: true });
    expect(hydrated.source).toBe("persisted");
    expect(listKnowledgeCorpus()).toHaveLength(1);
    expect(listKnowledgeCorpus()[0]?.title).toMatch(/Durable webhook/);

    const doc = ingestKnowledgeDocument({
      title: "Second durable chunk",
      excerpt: "Another persisted knowledge excerpt for correlation IDs.",
      sourceClass: "REPOSITORY_SOURCE",
      embedding: [0.4, 0.5, 0.6],
    });
    expect(doc.id.startsWith("kf_")).toBe(true);

    const reloaded = loadPersistedCorpus(path);
    expect(reloaded?.documents.length).toBe(2);
    expect(reloaded?.documents.some((d) => d.id === doc.id)).toBe(true);

    const search = searchKnowledgeFabric({
      query: "webhook idempotency",
      minAuthority: 0.3,
      vectorScores: { kf_custom: 0.9 },
    });
    expect(search.hits.some((h) => h.id === "kf_custom")).toBe(true);
  });
});
