import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CorpusDoc } from "./search.js";

export const KNOWLEDGE_CORPUS_VERSION = 1 as const;

export interface PersistedCorpusFile {
  version: typeof KNOWLEDGE_CORPUS_VERSION;
  updatedAt: string;
  documents: CorpusDoc[];
}

/** Resolve monorepo root (pnpm-workspace.yaml) then `.atlas/knowledge/corpus.json`. */
export function resolveKnowledgeCorpusPath(override?: string): string {
  if (override?.trim()) return resolve(override.trim());
  if (process.env.ATLAS_KNOWLEDGE_CORPUS_PATH?.trim()) {
    return resolve(process.env.ATLAS_KNOWLEDGE_CORPUS_PATH.trim());
  }
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return resolve(dir, ".atlas", "knowledge", "corpus.json");
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return resolve(process.cwd(), ".atlas", "knowledge", "corpus.json");
    }
    dir = parent;
  }
}

export function loadPersistedCorpus(
  path?: string,
): { path: string; documents: CorpusDoc[] } | null {
  const filePath = resolveKnowledgeCorpusPath(path);
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as PersistedCorpusFile;
    if (!raw || !Array.isArray(raw.documents)) return null;
    const documents = raw.documents.filter(
      (d) =>
        d &&
        typeof d.id === "string" &&
        typeof d.title === "string" &&
        typeof d.excerpt === "string" &&
        typeof d.contentHash === "string",
    );
    if (documents.length === 0) return null;
    return { path: filePath, documents };
  } catch {
    return null;
  }
}

export function savePersistedCorpus(
  documents: readonly CorpusDoc[],
  path?: string,
): string {
  const filePath = resolveKnowledgeCorpusPath(path);
  mkdirSync(dirname(filePath), { recursive: true });
  const payload: PersistedCorpusFile = {
    version: KNOWLEDGE_CORPUS_VERSION,
    updatedAt: new Date().toISOString(),
    documents: [...documents],
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export function persistedCorpusExists(path?: string): boolean {
  return existsSync(resolveKnowledgeCorpusPath(path));
}
