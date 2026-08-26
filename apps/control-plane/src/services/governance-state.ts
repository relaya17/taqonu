/**
 * Governance State — unified view of audit trail, approvals, policies,
 * risk scores, and health metrics for the control plane surface.
 *
 * This module aggregates the governance primitives from the engineering
 * surface into a read-only projection suitable for managers, security
 * reviewers, and compliance auditors.
 *
 * ── Architecture ───────────────────────────────────────────────────────
 *
 * In the current deployment model (single-process, in-memory stores),
 * the control plane process maintains its OWN in-memory store that
 * mirrors the engineering surface's state. In production, both surfaces
 * would read from the same durable backing store (database).
 *
 * The control plane NEVER WRITES to governance state — it is a read-only
 * observer. Write operations (creating approvals, recording reputation,
 * appending audit entries) happen exclusively through the engineering
 * surface's governed execution pipeline.
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: string;
  readonly actorId: string;
  readonly actorKind: string;
  readonly reason: string;
  readonly policy: string;
  readonly risk: string;
  readonly approval: string;
  readonly result: string;
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly hash: string;
  readonly prevHash: string;
}

export interface PolicyDefinition {
  readonly entityType: string;
  readonly action: string;
  readonly riskTier: "AUTO_LOG" | "APPROVAL" | "BLOCK";
  readonly description: string;
  readonly requiresApproval: boolean;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly agentId: string;
  readonly entityType: string;
  readonly action: string;
  readonly status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED";
  readonly decidedBy: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly artifactHash: string;
}

export interface HealthMetrics {
  readonly uptimeMs: number;
  readonly totalExecutions: number;
  readonly successfulExecutions: number;
  readonly failedExecutions: number;
  readonly deniedExecutions: number;
  readonly approvalsPending: number;
  readonly approvalsConsumed: number;
  readonly approvalsExpired: number;
  readonly avgRiskScore: number;
  readonly highRiskCount: number;
}

export interface CostSummary {
  readonly totalCostUsd: number;
  readonly costByAgent: ReadonlyMap<string, number>;
  readonly costByEntityType: ReadonlyMap<string, number>;
}

// ── In-memory state ─────────────────────────────────────────────────────

const auditEntries: AuditEntry[] = [];
const approvalRecords: ApprovalRecord[] = [];
const startTime = Date.now();

// ── Audit Trail ─────────────────────────────────────────────────────────

export function appendAuditEntry(entry: AuditEntry): void {
  auditEntries.push(entry);
}

export function listAuditEntries(filter?: {
  readonly actorId?: string;
  readonly type?: string;
  readonly risk?: string;
  readonly result?: string;
  readonly limit?: number;
  readonly offset?: number;
}): readonly AuditEntry[] {
  let filtered = auditEntries;

  if (filter?.actorId) {
    const actorId = filter.actorId;
    filtered = filtered.filter((e) => e.actorId === actorId);
  }
  if (filter?.type) {
    const type = filter.type;
    filtered = filtered.filter((e) => e.type.includes(type));
  }
  if (filter?.risk) {
    const risk = filter.risk;
    filtered = filtered.filter((e) => e.risk === risk);
  }
  if (filter?.result) {
    const result = filter.result;
    filtered = filtered.filter((e) => e.result === result);
  }

  // Most recent first
  const sorted = [...filtered].reverse();

  const offset = filter?.offset ?? 0;
  const limit = filter?.limit ?? 100;
  return sorted.slice(offset, offset + limit);
}

export function getAuditEntryCount(): number {
  return auditEntries.length;
}

export function verifyAuditChain(): {
  readonly ok: boolean;
  readonly checked: number;
  readonly error: string | null;
  readonly status: "UNKNOWN";
  readonly canonical: false;
  readonly note: string;
} {
  const ordered = [...auditEntries].sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (!prev || !cur) continue;
    if (cur.prevHash !== prev.hash) {
      return {
        ok: false,
        checked: i,
        error: `audit chain break at seq ${cur.seq}`,
        status: "UNKNOWN",
        canonical: false,
        note: "Control Plane in-memory hashes are observational. Canonical NDJSON is apps/api audit-log.",
      };
    }
  }
  return {
    ok: true,
    checked: ordered.length,
    error: null,
    status: "UNKNOWN",
    canonical: false,
    note: "Control Plane in-memory hashes are observational. Canonical NDJSON is apps/api audit-log.",
  };
}

/** Historical audit cannot be deleted or rewritten from the Control Plane. */
export function refuseAuditMutation(method: string): {
  readonly allowed: false;
  readonly status: 405;
  readonly error: string;
} {
  return {
    allowed: false,
    status: 405,
    error: `${method} on audit is forbidden — append/read/export/verify only`,
  };
}

// ── Policies ────────────────────────────────────────────────────────────

/**
 * Static policy definitions matching the engineering surface's
 * `baseRiskTier` in `agent-dispatch-guard.ts`.
 *
 * READ → AUTO_LOG, CREATE/UPDATE → APPROVAL, DELETE → BLOCK,
 * EXECUTE → APPROVAL.
 */
const POLICY_DEFINITIONS: readonly PolicyDefinition[] = [
  {
    entityType: "DOCUMENT",
    action: "READ",
    riskTier: "AUTO_LOG",
    description: "Read documents — observable, not destructive",
    requiresApproval: false,
  },
  {
    entityType: "DOCUMENT",
    action: "CREATE",
    riskTier: "APPROVAL",
    description: "Create new documents — requires human approval",
    requiresApproval: true,
  },
  {
    entityType: "RECORD",
    action: "CREATE",
    riskTier: "APPROVAL",
    description: "Create structured records — requires human approval",
    requiresApproval: true,
  },
  {
    entityType: "RECORD",
    action: "READ",
    riskTier: "AUTO_LOG",
    description: "Read records — auto-logged, no approval needed",
    requiresApproval: false,
  },
  {
    entityType: "CONFIGURATION",
    action: "READ",
    riskTier: "AUTO_LOG",
    description: "Read infrastructure configuration — observable",
    requiresApproval: false,
  },
  {
    entityType: "CONFIGURATION",
    action: "UPDATE",
    riskTier: "APPROVAL",
    description: "Modify infrastructure configuration — requires approval",
    requiresApproval: true,
  },
  {
    entityType: "CODE",
    action: "CREATE",
    riskTier: "APPROVAL",
    description: "Write new code — requires human review and approval",
    requiresApproval: true,
  },
  {
    entityType: "CODE",
    action: "EXECUTE",
    riskTier: "APPROVAL",
    description: "Execute code — requires human approval",
    requiresApproval: true,
  },
  {
    entityType: "*",
    action: "DELETE",
    riskTier: "BLOCK",
    description: "Delete operations — categorically blocked regardless of approval",
    requiresApproval: false,
  },
];

export function listPolicies(): readonly PolicyDefinition[] {
  return POLICY_DEFINITIONS;
}

export function getPolicyForAction(
  entityType: string,
  action: string,
): PolicyDefinition | undefined {
  return POLICY_DEFINITIONS.find(
    (p) =>
      (p.entityType === entityType || p.entityType === "*") &&
      p.action === action,
  );
}

// ── Approvals ───────────────────────────────────────────────────────────

export function addApprovalRecord(record: ApprovalRecord): void {
  approvalRecords.push(record);
}

export function listApprovalRecords(filter?: {
  readonly status?: string;
  readonly agentId?: string;
}): readonly ApprovalRecord[] {
  let filtered: readonly ApprovalRecord[] = approvalRecords;
  if (filter?.status) {
    filtered = filtered.filter((r) => r.status === filter.status);
  }
  if (filter?.agentId) {
    filtered = filtered.filter((r) => r.agentId === filter.agentId);
  }
  return [...filtered].reverse();
}

// ── Health Metrics ──────────────────────────────────────────────────────

export function computeHealthMetrics(): HealthMetrics {
  const total = auditEntries.length;
  const successes = auditEntries.filter((e) => e.result === "SUCCESS").length;
  const failures = auditEntries.filter((e) => e.result === "FAILURE").length;
  const pending = auditEntries.filter((e) => e.result === "PENDING").length;
  const highRisk = auditEntries.filter((e) => e.risk === "HIGH").length;

  const riskScores = auditEntries
    .map((e) => {
      if (e.risk === "HIGH" || e.risk === "BLOCK") return 90;
      if (e.risk === "APPROVAL") return 50;
      if (e.risk === "LOW" || e.risk === "AUTO_LOG") return 10;
      return 50; // Unknown → moderate
    });

  const avgRisk =
    riskScores.length > 0
      ? Math.round(
          riskScores.reduce((sum, s) => sum + s, 0) / riskScores.length,
        )
      : 0;

  const approvalsPending = approvalRecords.filter(
    (r) => r.status === "PENDING",
  ).length;
  const approvalsConsumed = approvalRecords.filter(
    (r) => r.status === "CONSUMED",
  ).length;
  const approvalsExpired = approvalRecords.filter(
    (r) => r.status === "EXPIRED",
  ).length;

  return {
    uptimeMs: Date.now() - startTime,
    totalExecutions: total,
    successfulExecutions: successes,
    failedExecutions: failures,
    deniedExecutions: total - successes - failures - pending,
    approvalsPending,
    approvalsConsumed,
    approvalsExpired,
    avgRiskScore: avgRisk,
    highRiskCount: highRisk,
  };
}

// ── Reset (testing) ─────────────────────────────────────────────────────

export function resetGovernanceStateForTests(): void {
  auditEntries.length = 0;
  approvalRecords.length = 0;
}
