/**
 * Control Plane SERVICE hop → apps/api live approval store.
 *
 * Same bearer boundary as `AGENT_RUNTIME_CONTROL_PATH` and
 * `KILL_SWITCH_CONTROL_PATH`: Control never holds the canonical approval
 * records and never decides authorization itself. Tenant-admin cookie
 * routes (`GET/POST /api/v1/approvals`) stay unchanged.
 */
export const APPROVAL_CONTROL_PATH = "/api/v1/internal/approvals";

export function approvalControlDecidePath(id: string): string {
  return `${APPROVAL_CONTROL_PATH}/${id}/decide`;
}

/** CP SERVICE hop → mint a pending live approval (gateway REQUIRE_APPROVAL). */
export const APPROVAL_CONTROL_MINT_PATH = `${APPROVAL_CONTROL_PATH}/mint`;

/** CP SERVICE hop → canonical NDJSON audit-chain verification. */
export const AUDIT_VERIFY_CONTROL_PATH = "/api/v1/internal/audit/verify";
