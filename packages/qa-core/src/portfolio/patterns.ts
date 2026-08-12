import { createHash } from "node:crypto";
import type { QaFinding, QaPortfolioPattern } from "@atlas/shared";

export interface PatternSeed {
  readonly patternKey: string;
  readonly title: string;
  readonly summary: string;
  readonly severity: QaFinding["severity"];
  readonly domain: QaFinding["domain"];
  readonly projectId: string;
  readonly findingId: string;
}

export const DEFAULT_PATTERN_RETRIEVE_BUDGET = 8;

/** Deterministic UUID (v5-style) from patternKey — stable across runs. */
export function patternIdFromKey(patternKey: string): string {
  const hash = createHash("sha1")
    .update(`atlas:qa:pattern:${patternKey}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Extract LEARN seeds only from OBSERVED OPEN findings with evidence tags. */
export function extractPatternSeedsFromFindings(
  findings: readonly QaFinding[],
): PatternSeed[] {
  const seeds: PatternSeed[] = [];
  for (const f of findings) {
    if (!f.projectId || f.status !== "OPEN" || f.epistemicState !== "OBSERVED") {
      continue;
    }
    const match = /\[pattern:([^\]]+)\]/.exec(f.summary);
    if (!match?.[1]) {
      continue;
    }
    seeds.push({
      patternKey: match[1],
      title: f.title,
      summary: f.summary,
      severity: f.severity,
      domain: f.domain,
      projectId: f.projectId,
      findingId: f.id,
    });
  }
  return seeds;
}

/**
 * Build durable portfolio-scoped pattern records from seeds (1+ projects).
 * Single-project rows persist so a later project can promote them to cross-project.
 */
export function durablePatternsFromSeeds(
  seeds: readonly PatternSeed[],
  nowIso: string,
): QaPortfolioPattern[] {
  const byKey = new Map<string, PatternSeed[]>();
  for (const seed of seeds) {
    const list = byKey.get(seed.patternKey) ?? [];
    list.push(seed);
    byKey.set(seed.patternKey, list);
  }

  const patterns: QaPortfolioPattern[] = [];
  for (const [patternKey, group] of byKey) {
    const projectIds = [...new Set(group.map((g) => g.projectId))];
    const first = group[0]!;
    patterns.push({
      id: patternIdFromKey(patternKey),
      patternKey,
      title: first.title,
      summary:
        projectIds.length >= 2
          ? `${first.summary} — seen in ${projectIds.length} projects (architecture regression pattern).`
          : first.summary,
      severity: first.severity,
      domain: first.domain,
      projectIds,
      findingIds: group.map((g) => g.findingId),
      epistemicState: projectIds.length >= 2 ? "INFERRED" : "OBSERVED",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  return patterns;
}

/** Merge pattern records by stable patternKey (union projects + findings). */
export function mergePatternRecords(
  existing: readonly QaPortfolioPattern[],
  incoming: readonly QaPortfolioPattern[],
): QaPortfolioPattern[] {
  const byKey = new Map(
    existing.map((p) => [p.patternKey, p] as const),
  );
  for (const p of incoming) {
    const prev = byKey.get(p.patternKey);
    if (!prev) {
      byKey.set(p.patternKey, p);
      continue;
    }
    const projectIds = [...new Set([...prev.projectIds, ...p.projectIds])];
    byKey.set(p.patternKey, {
      ...p,
      id: prev.id || patternIdFromKey(p.patternKey),
      projectIds,
      findingIds: [...new Set([...prev.findingIds, ...p.findingIds])].slice(-100),
      summary:
        projectIds.length >= 2
          ? `${p.title} — seen in ${projectIds.length} projects (architecture regression pattern). [pattern:${p.patternKey}]`
          : p.summary,
      epistemicState: projectIds.length >= 2 ? "INFERRED" : p.epistemicState,
      createdAt: prev.createdAt,
      updatedAt: p.updatedAt,
    });
  }
  return [...byKey.values()];
}

/**
 * Portfolio QA Brain — detects the same weakness across ≥2 projects.
 * Prefer `accumulatePortfolioPatterns` when prior store rows exist.
 */
export function detectPortfolioPatterns(
  seeds: readonly PatternSeed[],
  nowIso: string,
): QaPortfolioPattern[] {
  return durablePatternsFromSeeds(seeds, nowIso).filter(
    (p) => p.projectIds.length >= 2,
  );
}

/**
 * Closed LEARN accumulate: this-run seeds + prior store → durable + cross-project.
 */
export function accumulatePortfolioPatterns(
  prior: readonly QaPortfolioPattern[],
  seeds: readonly PatternSeed[],
  nowIso: string,
): {
  readonly durableFromRun: QaPortfolioPattern[];
  readonly merged: QaPortfolioPattern[];
  readonly crossProject: QaPortfolioPattern[];
} {
  const durableFromRun = durablePatternsFromSeeds(seeds, nowIso);
  const merged = mergePatternRecords(prior, durableFromRun);
  const crossProject = merged.filter((p) => p.projectIds.length >= 2);
  return { durableFromRun, merged, crossProject };
}

/**
 * Budgeted retrieve of portfolio patterns relevant to a project (or whole portfolio).
 * Prefers cross-project lessons, then patterns touching the project, then severity.
 */
export function retrieveRelevantPortfolioPatterns(input: {
  readonly patterns: readonly QaPortfolioPattern[];
  readonly projectId?: string | null;
  readonly budget?: number;
  readonly query?: string;
  /** When true, only patterns seen in ≥2 projects. Default true for LEARN context. */
  readonly crossProjectOnly?: boolean;
}): QaPortfolioPattern[] {
  const budget = Math.max(
    1,
    Math.min(input.budget ?? DEFAULT_PATTERN_RETRIEVE_BUDGET, 40),
  );
  const crossOnly = input.crossProjectOnly !== false;
  const q = (input.query ?? "").trim().toLowerCase();
  const pool = input.patterns.filter((p) =>
    crossOnly ? p.projectIds.length >= 2 : true,
  );

  const ranked = pool
    .map((p) => {
      let score = 0;
      if (p.projectIds.length >= 2) score += 2 + Math.min(p.projectIds.length, 5) * 0.2;
      if (input.projectId && p.projectIds.includes(input.projectId)) score += 1.5;
      if (p.severity === "CRITICAL") score += 1.2;
      else if (p.severity === "HIGH") score += 0.8;
      else if (p.severity === "MEDIUM") score += 0.4;
      if (p.epistemicState === "INFERRED" || p.epistemicState === "OBSERVED") {
        score += 0.2;
      }
      if (q) {
        const hay = `${p.patternKey} ${p.title} ${p.summary}`.toLowerCase();
        if (hay.includes(q)) score += 0.6;
      }
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, budget).map((r) => r.p);
}

/** Compact lessons for agent/QA memoryContext — evidence-tagged, not FACT. */
export function formatPatternLessonsForContext(
  patterns: readonly QaPortfolioPattern[],
): string[] {
  return patterns.map(
    (p) =>
      `[INFERRED portfolio lesson] [${p.patternKey}] ${p.title} — projects:${p.projectIds.length} epistemic:${p.epistemicState}`,
  );
}

export function filterPortfolioPatterns(input: {
  readonly patterns: readonly QaPortfolioPattern[];
  readonly projectId?: string | null;
  readonly portfolioOnly?: boolean;
  readonly minProjects?: number;
}): QaPortfolioPattern[] {
  const minProjects = input.minProjects ?? (input.portfolioOnly ? 2 : 1);
  return input.patterns.filter((p) => {
    if (p.projectIds.length < minProjects) return false;
    if (input.projectId && !p.projectIds.includes(input.projectId)) return false;
    return true;
  });
}
