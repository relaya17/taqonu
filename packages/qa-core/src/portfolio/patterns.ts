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

/**
 * Portfolio QA Brain — detects the same weakness across ≥2 projects.
 */
export function detectPortfolioPatterns(
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
    if (projectIds.length < 2) {
      continue;
    }
    const first = group[0]!;
    patterns.push({
      id: crypto.randomUUID(),
      patternKey,
      title: first.title,
      summary: `${first.summary} — seen in ${projectIds.length} projects (architecture regression pattern).`,
      severity: first.severity,
      domain: first.domain,
      projectIds,
      findingIds: group.map((g) => g.findingId),
      epistemicState: "INFERRED",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  return patterns;
}
