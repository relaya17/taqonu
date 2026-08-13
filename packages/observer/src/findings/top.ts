import type { ObserverFinding } from "@atlas/shared";

const BAND_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/** Findings eligible for ATLAS HEALTH "most important" + cycle history top. */
export function isTruthPriorityFinding(f: {
  id: string;
  category: string;
  riskBand: string;
}): boolean {
  if (f.id.startsWith("behavior-")) return true;
  if (f.id.startsWith("adr-conflict-")) return true;
  if (f.id.startsWith("sentinel:") && f.riskBand !== "LOW") return true;
  if (f.id === "sentinel-posture" && f.riskBand !== "LOW") return true;
  if (f.id === "security-graph" && f.riskBand !== "LOW") return true;
  if (f.id === "production-intelligence" && f.riskBand !== "LOW") return true;
  if (f.id === "production-deploy" && f.riskBand !== "LOW") return true;
  if (f.category === "BUG" && f.riskBand !== "LOW") return true;
  if (f.category === "SECURITY" && f.riskBand !== "LOW") return true;
  return false;
}

export function selectTopTruthFinding<T extends ObserverFinding>(
  findings: T[],
): T | null {
  return (
    [...findings]
      .filter(isTruthPriorityFinding)
      .sort((a, b) => {
        const diff =
          (BAND_RANK[b.riskBand] ?? 0) - (BAND_RANK[a.riskBand] ?? 0);
        if (diff !== 0) return diff;
        // Prefer ADR / behavior over coverage notes at same band
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
