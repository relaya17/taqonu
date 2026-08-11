import { findFilesByKeyword, readTextFile } from "./analyze.js";

export interface ImpactReport {
  query: string;
  matchedFiles: string[];
  consumers: string[];
  tests: string[];
  riskNotes: string[];
}

/** Heuristic impact analysis from path/keyword (ADR-015). */
export function analyzeImpact(root: string, query: string): ImpactReport {
  const matchedFiles = findFilesByKeyword(root, query, 25);
  const consumers: string[] = [];
  const tests: string[] = [];
  const base = query.split(/[/\\]/).pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") ?? query;

  for (const file of matchedFiles) {
    if (/\.(test|spec)\./i.test(file) || /__tests__/i.test(file)) {
      tests.push(file);
    }
  }

  // Scan a few nearby files for import mentions
  for (const file of matchedFiles.slice(0, 8)) {
    const text = readTextFile(root, file);
    if (!text) continue;
    if (text.includes(base) && !consumers.includes(file)) {
      consumers.push(file);
    }
  }

  const riskNotes = [
    matchedFiles.length === 0
      ? "No matching files — impact UNKNOWN"
      : `${matchedFiles.length} files match query`,
    tests.length === 0
      ? "No adjacent tests found — regression risk elevated"
      : `${tests.length} related test file(s)`,
    "Full call-graph / type-analysis planned in later Code Intelligence milestones",
  ];

  return { query, matchedFiles, consumers, tests, riskNotes };
}
