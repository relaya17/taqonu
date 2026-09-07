import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIOLATION_THRESHOLD,
  MIN_VIOLATION_SAMPLE_SIZE,
  detectRepeatedViolations,
  type BehavioralOutcomeRecord,
} from "./behavioral-monitor.js";

const AGENT_A = "CODE_ENGINEER";
const AGENT_B = "RESEARCHER";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

function success(agentId: string, projectId?: string | null): BehavioralOutcomeRecord {
  return { agentId, projectId: projectId ?? null, result: "SUCCESS", decision: "ALLOW" };
}

function violation(agentId: string, projectId?: string | null): BehavioralOutcomeRecord {
  return { agentId, projectId: projectId ?? null, result: "FAILURE", decision: "DENY" };
}

/** A FAILURE that is NOT a governance denial (e.g. a downstream tool error). */
function operationalFailure(agentId: string, projectId?: string | null): BehavioralOutcomeRecord {
  return { agentId, projectId: projectId ?? null, result: "FAILURE", decision: null };
}

describe("detectRepeatedViolations -- INSUFFICIENT_DATA", () => {
  it("reports INSUFFICIENT_DATA below MIN_VIOLATION_SAMPLE_SIZE, even if every entry is a violation", () => {
    const entries = Array.from({ length: MIN_VIOLATION_SAMPLE_SIZE - 1 }, () => violation(AGENT_A));
    const result = detectRepeatedViolations(AGENT_A, entries);
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });

  it("reports INSUFFICIENT_DATA for an agent with zero scoped entries", () => {
    const result = detectRepeatedViolations(AGENT_A, [success(AGENT_B)]);
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });
});

describe("detectRepeatedViolations -- scenario 1: normal behavior", () => {
  it("classifies NORMAL for an agent with an all-success history (no false violation)", () => {
    const entries = Array.from({ length: 10 }, () => success(AGENT_A));
    const result = detectRepeatedViolations(AGENT_A, entries);
    expect(result.status).toBe("NORMAL");
    if (result.status === "NORMAL") {
      expect(result.violationCount).toBe(0);
    }
  });
});

describe("detectRepeatedViolations -- scenario 2: repeated violation", () => {
  it("classifies VIOLATION_PATTERN_DETECTED once denials reach the threshold", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => success(AGENT_A)),
      ...Array.from({ length: DEFAULT_VIOLATION_THRESHOLD }, () => violation(AGENT_A)),
    ];
    const result = detectRepeatedViolations(AGENT_A, entries);
    expect(result.status).toBe("VIOLATION_PATTERN_DETECTED");
    if (result.status === "VIOLATION_PATTERN_DETECTED") {
      expect(result.violationCount).toBe(DEFAULT_VIOLATION_THRESHOLD);
      expect(result.severity).toBeDefined();
    }
  });

  it("does not flag one violation short of the threshold", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => success(AGENT_A)),
      ...Array.from({ length: DEFAULT_VIOLATION_THRESHOLD - 1 }, () => violation(AGENT_A)),
    ];
    const result = detectRepeatedViolations(AGENT_A, entries);
    expect(result.status).toBe("NORMAL");
  });

  it("raises severity as the violation count climbs further past the threshold", () => {
    const lowEntries = [
      ...Array.from({ length: 5 }, () => success(AGENT_A)),
      ...Array.from({ length: DEFAULT_VIOLATION_THRESHOLD }, () => violation(AGENT_A)),
    ];
    const highEntries = Array.from({ length: 15 }, () => violation(AGENT_A));
    const low = detectRepeatedViolations(AGENT_A, lowEntries);
    const high = detectRepeatedViolations(AGENT_A, highEntries);
    expect(low.status).toBe("VIOLATION_PATTERN_DETECTED");
    expect(high.status).toBe("VIOLATION_PATTERN_DETECTED");
    if (low.status === "VIOLATION_PATTERN_DETECTED" && high.status === "VIOLATION_PATTERN_DETECTED") {
      expect(low.severity).toBe("LOW");
      expect(high.severity).toBe("HIGH");
    }
  });
});

describe("detectRepeatedViolations -- scenario 6: false-positive resistance", () => {
  it("never flags a pattern from repeated SUCCESSes, no matter how many", () => {
    const entries = Array.from({ length: 50 }, () => success(AGENT_A));
    const result = detectRepeatedViolations(AGENT_A, entries);
    expect(result.status).toBe("NORMAL");
  });

  it("never counts a non-DENY FAILURE (an operational error) as a governance violation", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => success(AGENT_A)),
      ...Array.from({ length: 10 }, () => operationalFailure(AGENT_A)),
    ];
    const result = detectRepeatedViolations(AGENT_A, entries);
    expect(result.status).toBe("NORMAL");
    if (result.status === "NORMAL") {
      expect(result.violationCount).toBe(0);
    }
  });
});

describe("detectRepeatedViolations -- scenario 8: cross-agent isolation", () => {
  it("does not let Agent B's violations contaminate Agent A's classification", () => {
    const entries = [
      ...Array.from({ length: 10 }, () => violation(AGENT_B)),
      ...Array.from({ length: 8 }, () => success(AGENT_A)),
    ];
    const resultA = detectRepeatedViolations(AGENT_A, entries);
    const resultB = detectRepeatedViolations(AGENT_B, entries);
    expect(resultA.status).toBe("NORMAL");
    expect(resultB.status).toBe("VIOLATION_PATTERN_DETECTED");
  });
});

describe("detectRepeatedViolations -- scenario 9: cross-project isolation", () => {
  it("does not let Project B's violations for the same agent contaminate Project A's classification", () => {
    const entries = [
      ...Array.from({ length: 10 }, () => violation(AGENT_A, PROJECT_B)),
      ...Array.from({ length: 8 }, () => success(AGENT_A, PROJECT_A)),
    ];
    const resultProjectA = detectRepeatedViolations(AGENT_A, entries, { projectId: PROJECT_A });
    const resultProjectB = detectRepeatedViolations(AGENT_A, entries, { projectId: PROJECT_B });
    expect(resultProjectA.status).toBe("NORMAL");
    expect(resultProjectB.status).toBe("VIOLATION_PATTERN_DETECTED");
  });

  it("aggregates across projects only when the caller explicitly omits projectId", () => {
    const entries = [
      ...Array.from({ length: 3 }, () => violation(AGENT_A, PROJECT_A)),
      ...Array.from({ length: 3 }, () => violation(AGENT_A, PROJECT_B)),
    ];
    const unscoped = detectRepeatedViolations(AGENT_A, entries);
    expect(unscoped.status).toBe("VIOLATION_PATTERN_DETECTED");
    if (unscoped.status === "VIOLATION_PATTERN_DETECTED") {
      expect(unscoped.violationCount).toBe(6);
    }
  });
});
