/**
 * F-07 — Continuous Agent Verification & Behavioral Monitoring.
 *
 * This module deliberately does NOT introduce a new store, a new audit
 * mechanism, or a new authorization system. It is a pure, read-only
 * aggregation over the SAME evidence F-06 already produces and persists
 * (`UnifiedAuditEntry`, via `listUnifiedAuditEntries` in `audit-log.ts`) --
 * exactly the pattern already established by `agent-reputation.ts`
 * (per-mode success-rate aggregation) and `verification-learning.ts`
 * (`scoreHistoricalOutcomes`, observational-only quality signals). This
 * file adds the one capability those two do not: turning a repeated-
 * violation PATTERN into a typed, honestly-scoped signal that an existing
 * governed enforcement point (`agent-dispatch-guard.ts`'s risk-bucket
 * floors) can consult to require stricter approval on an agent's
 * SUBSEQUENT actions.
 *
 * This module never executes, approves, quarantines, or mutates policy
 * itself -- consistent with every other "intelligence" module in this
 * codebase (`verification-learning.ts`'s `executes: false` / `autoApply:
 * false` convention). It only classifies history. Whether/how a consumer
 * acts on that classification is the consumer's decision -- see
 * `agent-dispatch-guard.ts`'s `behavioralFloored`, which floors a bucket to
 * at least APPROVAL and never grants additional authority, exactly mirroring
 * the existing `floorBucketForUntrustedSource` / `floorBucketForAutomationActor`
 * pattern from F-05.
 */

/** The minimal shape this module needs from a `UnifiedAuditEntry` (or an
 * equivalent record) to classify one agent's recent history. Kept as its
 * own narrow type -- rather than importing `UnifiedAuditEntry` directly --
 * so this module has zero dependency on where the caller's entries came
 * from (a live audit-log read, a test fixture, or a future evidence
 * source), matching how `detectAnomalies`/`scoreHistoricalOutcomes` accept
 * plain data rather than a specific store's row type. */
export interface BehavioralOutcomeRecord {
  readonly agentId: string | null;
  readonly projectId?: string | null;
  readonly result: "SUCCESS" | "FAILURE" | "PARTIAL";
  readonly decision?: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "ESCALATE" | null;
}

export type BehavioralViolationSeverity = "LOW" | "MEDIUM" | "HIGH";

export type RepeatedViolationResult =
  | {
      readonly status: "INSUFFICIENT_DATA";
      readonly agentId: string;
      readonly sampleSize: number;
      readonly minSampleSize: number;
      readonly reason: string;
    }
  | {
      readonly status: "NORMAL";
      readonly agentId: string;
      readonly violationCount: number;
      readonly windowSize: number;
      readonly threshold: number;
      readonly reason: string;
    }
  | {
      readonly status: "VIOLATION_PATTERN_DETECTED";
      readonly agentId: string;
      readonly violationCount: number;
      readonly windowSize: number;
      readonly threshold: number;
      readonly severity: BehavioralViolationSeverity;
      readonly reason: string;
    };

/**
 * Below this many SCOPED (agent+project) entries, a "pattern" verdict would
 * be noise, not signal -- mirrors `anomaly-detection.ts`'s `MIN_SAMPLE_SIZE`
 * epistemic-honesty convention (report `INSUFFICIENT_DATA` explicitly
 * rather than silently returning `NORMAL`, which would be indistinguishable
 * from "genuinely checked and found nothing").
 */
export const MIN_VIOLATION_SAMPLE_SIZE = 5;

/** Trailing window of an agent's (+ project's) most recent scoped entries considered. */
export const DEFAULT_VIOLATION_WINDOW = 20;

/** Governance denials within the window at/above this count are a "pattern," not noise. */
export const DEFAULT_VIOLATION_THRESHOLD = 3;

function severityForCount(count: number, threshold: number): BehavioralViolationSeverity {
  if (count >= threshold * 2.5) return "HIGH";
  if (count >= threshold * 1.5) return "MEDIUM";
  return "LOW";
}

/**
 * A genuine governance VIOLATION -- as opposed to any other FAILURE (a
 * downstream tool erroring, a network failure) -- is specifically a
 * governance DENY that also resolved to FAILURE. Requiring both fields
 * avoids conflating "the agent's action failed for operational reasons"
 * with "the agent attempted something governance refused," which is the
 * one behavioral-monitoring scenario 6 (false-positive resistance) and
 * scenario 1 (normal behavior) both depend on: repeated SUCCESSES, and
 * repeated non-DENY failures, must never accumulate toward a violation
 * pattern.
 */
function isGovernanceViolation(entry: BehavioralOutcomeRecord): boolean {
  return entry.result === "FAILURE" && entry.decision === "DENY";
}

/**
 * Classifies one agent's recent behavior for a repeated-violation pattern.
 *
 * Scoping is enforced BY THIS FUNCTION, not left to caller discipline: only
 * entries whose `agentId` matches exactly are ever considered (cross-agent
 * isolation), and when `projectId` is supplied, only entries whose
 * `projectId` also matches exactly are considered (cross-project
 * isolation) -- an entry with a different, or null, `projectId` never
 * contributes evidence toward another project's pattern.
 *
 * Read-only, pure, synchronous: no I/O, no throw on well-typed input, no
 * mutation. A caller wrapping this in try/catch and treating any error as
 * "no pattern detected" degrades to exactly today's (pre-F-07) behavior --
 * see `agent-dispatch-guard.ts`'s `behavioralFloored`, which does exactly
 * that, so a failure here can only ever fail toward the EXISTING baseline
 * enforcement, never toward granting extra authority.
 */
export function detectRepeatedViolations(
  agentId: string,
  entries: readonly BehavioralOutcomeRecord[],
  options: {
    readonly projectId?: string | null;
    readonly windowSize?: number;
    readonly threshold?: number;
  } = {},
): RepeatedViolationResult {
  const windowSize = options.windowSize ?? DEFAULT_VIOLATION_WINDOW;
  const threshold = options.threshold ?? DEFAULT_VIOLATION_THRESHOLD;

  const scoped = entries.filter((entry) => {
    if (entry.agentId !== agentId) return false;
    if (options.projectId !== undefined && entry.projectId !== options.projectId) return false;
    return true;
  });

  const windowed = scoped.slice(Math.max(0, scoped.length - windowSize));
  const sampleSize = windowed.length;

  if (sampleSize < MIN_VIOLATION_SAMPLE_SIZE) {
    return {
      status: "INSUFFICIENT_DATA",
      agentId,
      sampleSize,
      minSampleSize: MIN_VIOLATION_SAMPLE_SIZE,
      reason:
        `only ${sampleSize} scoped outcome${sampleSize === 1 ? "" : "s"} available for ` +
        `agent "${agentId}"${options.projectId ? ` in project "${options.projectId}"` : ""}, ` +
        `need at least ${MIN_VIOLATION_SAMPLE_SIZE} to judge a behavioral pattern -- ` +
        `reporting no pattern would overstate confidence, so this is reported explicitly.`,
    };
  }

  const violationCount = windowed.filter(isGovernanceViolation).length;

  if (violationCount < threshold) {
    return {
      status: "NORMAL",
      agentId,
      violationCount,
      windowSize: sampleSize,
      threshold,
      reason:
        `${violationCount} governance denial${violationCount === 1 ? "" : "s"} in the trailing ` +
        `${sampleSize} scoped outcomes for agent "${agentId}" -- below the ${threshold}-denial ` +
        `pattern threshold.`,
    };
  }

  return {
    status: "VIOLATION_PATTERN_DETECTED",
    agentId,
    violationCount,
    windowSize: sampleSize,
    threshold,
    severity: severityForCount(violationCount, threshold),
    reason:
      `${violationCount} governance denials (DENY + FAILURE) in the trailing ${sampleSize} ` +
      `scoped outcomes for agent "${agentId}" -- at or above the ${threshold}-denial pattern ` +
      `threshold. This is a classification only; it does not itself execute, approve, or ` +
      `mutate policy.`,
  };
}
