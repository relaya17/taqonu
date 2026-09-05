import {
  governanceDecisionSchema,
  type GovernanceDecision,
  type GovernanceDecisionInput,
} from "@atlas/shared";
import {
  appendCanonicalAuditEntry,
  readAuditLogTail,
} from "./audit-log.js";

export const GOVERNANCE_DECISION_RECORD_TYPE = "governance.decision" as const;

/**
 * Persist a governance decision.
 *
 * P0 persistence fix: this now routes through `appendCanonicalAuditEntry`
 * (Postgres canonical + NDJSON secondary) instead of the raw NDJSON-only
 * `appendAuditLogLine`, using the decision's own required `id` (a stable
 * UUID already part of `governanceDecisionSchema`) as the idempotency key
 * -- no new identity concept is introduced. Because this function now
 * `await`s the canonical write and that write throws on every fail-closed
 * condition (see audit-log.ts), a governance decision can no longer report
 * success while its canonical audit evidence failed to persist: a thrown
 * error here propagates to the caller instead of returning a decision that
 * was never durably recorded.
 */
export async function persistGovernanceDecision(
  input: GovernanceDecisionInput,
): Promise<GovernanceDecision> {
  if (process.env.ATLAS_SKIP_AUDIT_LOG === "1") {
    throw new Error("GovernanceDecision persistence is disabled");
  }
  const decision = governanceDecisionSchema.parse(input);
  await appendCanonicalAuditEntry({ ...decision, type: GOVERNANCE_DECISION_RECORD_TYPE });
  return decision;
}

export function listGovernanceDecisions(limit = 1000): GovernanceDecision[] {
  const decisions: GovernanceDecision[] = [];
  for (const record of readAuditLogTail(limit)) {
    if (record.type !== GOVERNANCE_DECISION_RECORD_TYPE) continue;
    const parsed = governanceDecisionSchema.safeParse(record.payload);
    if (parsed.success) decisions.push(parsed.data);
  }
  return decisions;
}
