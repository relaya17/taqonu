const BAND_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/** Mirrors packages/observer selectTopTruthFinding — Studio Truth must not invent a second ranking. */
export function isStudioTruthPriorityFinding(f: {
  id: string;
  category: string;
  riskBand: string;
}): boolean {
  if (f.id.startsWith("behavior-")) return true;
  if (f.id.startsWith("adr-conflict-")) return true;
  if (f.id.startsWith("security-policy-") && f.riskBand !== "LOW") return true;
  if (f.id.startsWith("sentinel:") && f.riskBand !== "LOW") return true;
  if (f.id === "sentinel-posture" && f.riskBand !== "LOW") return true;
  if (f.id === "security-graph" && f.riskBand !== "LOW") return true;
  if (f.id === "production-intelligence" && f.riskBand !== "LOW") return true;
  if (f.id === "production-deploy" && f.riskBand !== "LOW") return true;
  if (f.category === "BUG" && f.riskBand !== "LOW") return true;
  if (f.category === "SECURITY" && f.riskBand !== "LOW") return true;
  return false;
}

export function selectStudioTopTruthFinding<
  T extends { id: string; category: string; riskBand: string },
>(findings: readonly T[]): T | null {
  return (
    [...findings]
      .filter(isStudioTruthPriorityFinding)
      .sort((a, b) => {
        const diff =
          (BAND_RANK[b.riskBand] ?? 0) - (BAND_RANK[a.riskBand] ?? 0);
        if (diff !== 0) return diff;
        const weight = (id: string) =>
          id.startsWith("adr-conflict-")
            ? 4
            : id.startsWith("sentinel:")
              ? 3
              : id.startsWith("behavior-")
                ? 2
                : id.startsWith("bug-")
                  ? 1
                  : 0;
        return weight(b.id) - weight(a.id);
      })[0] ?? null
  );
}
