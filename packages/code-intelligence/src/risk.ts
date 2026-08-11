/** Adaptive QA risk heuristic (ADR-014 Risk Engine seed). */

export interface RiskInput {
  impact: number; // 1..5
  probability: number; // 1..5
  changeSurface: number; // 1..5
  uncertainty: number; // 1..5
  missingEvidence: number; // 1..5
}

export type RiskBand = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export function computeRiskScore(input: RiskInput): {
  score: number;
  band: RiskBand;
  bar: string;
} {
  const score =
    input.impact *
    input.probability *
    input.changeSurface *
    input.uncertainty *
    input.missingEvidence;
  // max 5^5 = 3125
  let band: RiskBand = "LOW";
  if (score >= 800) band = "CRITICAL";
  else if (score >= 300) band = "HIGH";
  else if (score >= 80) band = "MEDIUM";
  const width = Math.min(20, Math.max(2, Math.round(score / 150)));
  return { score, band, bar: "█".repeat(width) };
}

export function rankRisks<T extends { name: string } & RiskInput>(
  items: readonly T[],
): Array<T & { score: number; band: RiskBand; bar: string }> {
  return items
    .map((item) => ({ ...item, ...computeRiskScore(item) }))
    .sort((a, b) => b.score - a.score);
}
