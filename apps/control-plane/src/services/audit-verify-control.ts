/**
 * Control Plane canonical audit-chain verification overlay.
 *
 * Local `verifyAuditChain()` remains observational (status UNKNOWN,
 * canonical: false). Operator-facing GET /api/v1/audit/verify hops to
 * apps/api's NDJSON chain via the existing callAtlasApi SERVICE hop.
 */
import { AUDIT_VERIFY_CONTROL_PATH } from "@atlas/shared";
import { callAtlasApi } from "./lifecycle-handoff.js";
import { verifyAuditChain } from "./governance-state.js";

export type AuditVerifyControlResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly ok: boolean;
        readonly status: string;
        readonly checked: number;
        readonly error: string | null;
        readonly canonical: true;
        readonly path?: string;
        readonly observational: ReturnType<typeof verifyAuditChain>;
      };
    }
  | { readonly ok: false; readonly reason: string; readonly httpStatus: number };

function httpStatusFromApiFailureReason(reason: string): number {
  const match = /^API returned (\d{3})/.exec(reason);
  return match ? Number(match[1]) : 502;
}

export async function fetchCanonicalAuditVerification(): Promise<AuditVerifyControlResult> {
  const observational = verifyAuditChain();
  const result = await callAtlasApi(AUDIT_VERIFY_CONTROL_PATH, { method: "GET" });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      httpStatus: httpStatusFromApiFailureReason(result.reason),
    };
  }
  const body = result.body as {
    ok?: unknown;
    status?: unknown;
    checked?: unknown;
    error?: unknown;
    canonical?: unknown;
    path?: unknown;
  };
  if (typeof body.ok !== "boolean" || typeof body.status !== "string") {
    return { ok: false, reason: "Malformed response from Atlas API", httpStatus: 502 };
  }
  return {
    ok: true,
    data: {
      ok: body.ok,
      status: body.status,
      checked: typeof body.checked === "number" ? body.checked : 0,
      error: typeof body.error === "string" ? body.error : null,
      canonical: true,
      ...(typeof body.path === "string" ? { path: body.path } : {}),
      observational,
    },
  };
}
