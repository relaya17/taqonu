import {
  governanceDecisionSchema,
  type GovernanceDecision,
  type GovernanceDecisionInput,
} from "@atlas/shared";
import { appendAuditLogLine, readAuditLogTail } from "./audit-log.js";

export const GOVERNANCE_DECISION_RECORD_TYPE = "governance.decision" as const;

export function persistGovernanceDecision(
  input: GovernanceDecisionInput,
): GovernanceDecision {
  if (process.env.ATLAS_SKIP_AUDIT_LOG === "1") {
    throw new Error("GovernanceDecision persistence is disabled");
  }
  const decision = governanceDecisionSchema.parse(input);
  appendAuditLogLine({ ...decision, type: GOVERNANCE_DECISION_RECORD_TYPE });
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
