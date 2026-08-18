import { describe, expect, it } from "vitest";
import type { ToolRisk } from "@atlas/shared";
import {
  bucketForRiskScore,
  computeActionRiskScore,
  explainRiskScore,
  type RiskBucket,
  type RiskScoreInput,
} from "./risk-score.js";

const ALL_TIERS: readonly ToolRisk[] = [
  "READ_ONLY",
  "LOW_RISK_WRITE",
  "HIGH_RISK_WRITE",
  "DESTRUCTIVE",
];

describe("computeActionRiskScore", () => {
  it("returns a score in [0, 100] for every base tier with no other input", () => {
    for (const baseTier of ALL_TIERS) {
      const score = computeActionRiskScore({ baseTier });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("orders best-case (high confidence, sufficient evidence) scores by tier severity", () => {
    const bestCase = (baseTier: ToolRisk) =>
      computeActionRiskScore({ baseTier, confidence: 1, evidenceCount: 10 });

    const readOnly = bestCase("READ_ONLY");
    const lowRisk = bestCase("LOW_RISK_WRITE");
    const highRisk = bestCase("HIGH_RISK_WRITE");
    const destructive = bestCase("DESTRUCTIVE");

    expect(readOnly).toBeLessThan(lowRisk);
    expect(lowRisk).toBeLessThan(highRisk);
    expect(highRisk).toBeLessThan(destructive);
  });

  it("maps each tier's best-case score to a sensible bucket", () => {
    const bestCaseBucket = (baseTier: ToolRisk): RiskBucket =>
      bucketForRiskScore(
        computeActionRiskScore({ baseTier, confidence: 1, evidenceCount: 10 }),
      );

    expect(bestCaseBucket("READ_ONLY")).toBe("AUTO");
    expect(bestCaseBucket("LOW_RISK_WRITE")).toBe("AUTO_LOG");
    expect(bestCaseBucket("HIGH_RISK_WRITE")).toBe("APPROVAL");
    expect(bestCaseBucket("DESTRUCTIVE")).toBe("APPROVAL");
  });

  it("pushes the score up (or keeps it equal) as confidence decreases, for every tier", () => {
    for (const baseTier of ALL_TIERS) {
      const highConfidence = computeActionRiskScore({
        baseTier,
        confidence: 0.95,
        evidenceCount: 5,
      });
      const midConfidence = computeActionRiskScore({
        baseTier,
        confidence: 0.5,
        evidenceCount: 5,
      });
      const lowConfidence = computeActionRiskScore({
        baseTier,
        confidence: 0.05,
        evidenceCount: 5,
      });

      expect(midConfidence).toBeGreaterThanOrEqual(highConfidence);
      expect(lowConfidence).toBeGreaterThanOrEqual(midConfidence);
      expect(lowConfidence).toBeGreaterThan(highConfidence);
    }
  });

  it("never lets more evidence increase the score, for every tier", () => {
    for (const baseTier of ALL_TIERS) {
      const noEvidence = computeActionRiskScore({ baseTier, confidence: 0.5, evidenceCount: 0 });
      const someEvidence = computeActionRiskScore({ baseTier, confidence: 0.5, evidenceCount: 2 });
      const plentyOfEvidence = computeActionRiskScore({
        baseTier,
        confidence: 0.5,
        evidenceCount: 50,
      });

      expect(someEvidence).toBeLessThanOrEqual(noEvidence);
      expect(plentyOfEvidence).toBeLessThanOrEqual(someEvidence);
      // Evidence never makes things *worse* than having none.
      expect(plentyOfEvidence).toBeLessThanOrEqual(noEvidence);
    }
  });

  it("treats missing confidence/evidenceCount conservatively (at least as risky as explicit worst-known values would suggest is unnecessary, but never as risk-free)", () => {
    for (const baseTier of ALL_TIERS) {
      const missing = computeActionRiskScore({ baseTier });
      const explicitBest = computeActionRiskScore({
        baseTier,
        confidence: 1,
        evidenceCount: 100,
      });
      // Omitting the signals must never score better than the best-known case.
      expect(missing).toBeGreaterThanOrEqual(explicitBest);
    }
  });

  it("never returns a bucket of AUTO or AUTO_LOG when requiresApproval is true, across all tiers and a spread of confidence/evidence combinations", () => {
    const confidenceSamples = [undefined, 0, 0.3, 0.5, 0.9, 1];
    const evidenceSamples = [undefined, 0, 1, 3, 10, 1000];

    for (const baseTier of ALL_TIERS) {
      for (const confidence of confidenceSamples) {
        for (const evidenceCount of evidenceSamples) {
          const input: RiskScoreInput = {
            baseTier,
            requiresApproval: true,
            ...(confidence !== undefined ? { confidence } : {}),
            ...(evidenceCount !== undefined ? { evidenceCount } : {}),
          };
          const score = computeActionRiskScore(input);
          const bucket = bucketForRiskScore(score);
          expect(
            bucket === "AUTO" || bucket === "AUTO_LOG",
            `expected bucket for ${JSON.stringify(input)} (score ${score}) not to be ${bucket}`,
          ).toBe(false);
        }
      }
    }
  });

  it("clamps to [0, 100] even with extreme or invalid inputs", () => {
    const extremeCases: RiskScoreInput[] = [
      { baseTier: "DESTRUCTIVE", confidence: -5, evidenceCount: -100 },
      { baseTier: "DESTRUCTIVE", confidence: 0, evidenceCount: -1, requiresApproval: true },
      { baseTier: "READ_ONLY", confidence: 100, evidenceCount: 1_000_000 },
      { baseTier: "READ_ONLY", confidence: Number.NaN, evidenceCount: Number.NaN },
      {
        baseTier: "DESTRUCTIVE",
        confidence: Number.POSITIVE_INFINITY,
        evidenceCount: Number.NEGATIVE_INFINITY,
      },
    ];

    for (const input of extremeCases) {
      const score = computeActionRiskScore(input);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("clamps even when confidence/evidenceCount are absent entirely", () => {
    for (const baseTier of ALL_TIERS) {
      const score = computeActionRiskScore({ baseTier });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("bucketForRiskScore", () => {
  it("maps documented thresholds to the documented buckets", () => {
    expect(bucketForRiskScore(0)).toBe("AUTO");
    expect(bucketForRiskScore(19)).toBe("AUTO");
    expect(bucketForRiskScore(20)).toBe("AUTO_LOG");
    expect(bucketForRiskScore(49)).toBe("AUTO_LOG");
    expect(bucketForRiskScore(50)).toBe("APPROVAL");
    expect(bucketForRiskScore(79)).toBe("APPROVAL");
    expect(bucketForRiskScore(80)).toBe("HUMAN_ONLY");
    expect(bucketForRiskScore(100)).toBe("HUMAN_ONLY");
  });

  it("clamps out-of-range scores before bucketing", () => {
    expect(bucketForRiskScore(-50)).toBe("AUTO");
    expect(bucketForRiskScore(500)).toBe("HUMAN_ONLY");
  });
});

describe("explainRiskScore", () => {
  it("returns a non-empty factors array and a score/bucket consistent with the other functions", () => {
    const inputs: RiskScoreInput[] = [
      { baseTier: "READ_ONLY" },
      { baseTier: "LOW_RISK_WRITE", confidence: 0.8, evidenceCount: 2 },
      { baseTier: "HIGH_RISK_WRITE", confidence: 0.3, evidenceCount: 0 },
      { baseTier: "DESTRUCTIVE", confidence: 0.95, evidenceCount: 5, requiresApproval: true },
      { baseTier: "DESTRUCTIVE", requiresApproval: true },
    ];

    for (const input of inputs) {
      const explanation = explainRiskScore(input);
      const directScore = computeActionRiskScore(input);
      const directBucket = bucketForRiskScore(directScore);

      expect(explanation.factors.length).toBeGreaterThan(0);
      expect(explanation.score).toBe(directScore);
      expect(explanation.bucket).toBe(directBucket);
    }
  });

  it("mentions the base tier in the factors for every tier", () => {
    for (const baseTier of ALL_TIERS) {
      const { factors } = explainRiskScore({ baseTier });
      expect(factors.some((f) => f.includes(baseTier))).toBe(true);
    }
  });

  it("mentions the requiresApproval floor only when it actually changed the score", () => {
    const floored = explainRiskScore({
      baseTier: "READ_ONLY",
      confidence: 1,
      evidenceCount: 100,
      requiresApproval: true,
    });
    expect(floored.factors.some((f) => f.toLowerCase().includes("floor"))).toBe(true);

    const notFloored = explainRiskScore({
      baseTier: "DESTRUCTIVE",
      requiresApproval: true,
    });
    expect(notFloored.factors.some((f) => f.toLowerCase().includes("floor"))).toBe(false);
  });
});
