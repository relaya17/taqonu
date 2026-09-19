import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveTruthTopFinding,
  saveLastTruthFindings,
} from "./last.js";

describe("last truth findings", () => {
  it("selects a persisted CRITICAL secret finding as top Truth", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-last-truth-"));
    saveLastTruthFindings(root, {
      at: new Date().toISOString(),
      cycleId: "cycle-1",
      findings: [
        {
          id: "sentinel-posture",
          title: "Sentinel posture CRITICAL",
          detail: "rollup",
          claim: "INFERRED",
          epistemicState: "INFERRED",
          riskBand: "CRITICAL",
          category: "SECURITY",
          evidenceRefs: [],
        },
        {
          id: "sentinel:secret:leaked-credential.ts:aws_access_key:1",
          title: "Possible AWS access key id",
          detail: "Potential secret in leaked-credential.ts:1",
          claim: "OBSERVED",
          epistemicState: "OBSERVED",
          riskBand: "CRITICAL",
          category: "SECURITY",
          evidenceRefs: ["file:leaked-credential.ts", "line:1"],
        },
      ],
    });
    const truth = resolveTruthTopFinding(root);
    expect(truth.topFinding?.id).toBe(
      "sentinel:secret:leaked-credential.ts:aws_access_key:1",
    );
    expect(truth.topFinding?.title).toMatch(/AWS access key/i);
  });
});
