/** Fixture: Commission Waterfall v3 for gates B/C */
export function computeCommissionWaterfall(dealAmount: number, tiers: number[]) {
  // Commission Waterfall v3 — inconsistency paths for QA evidence
  let remaining = dealAmount;
  const parts: number[] = [];
  for (const tier of tiers) {
    const slice = Math.min(remaining, tier);
    parts.push(slice * 0.1);
    remaining -= slice;
  }
  return { waterfall: parts, total: parts.reduce((a, b) => a + b, 0) };
}
