import { ATLAS_SELF_APPLICATION_ID } from "./atlas-gateway.js";
import { ATLAS_SELF_SYSTEM_ID } from "../schemas/managed-system.schema.js";

/** Backing project for DEF-000 self-audit / Atlas-self writes. */
export const ATLAS_SELF_PROJECT_ID = "00000000-0000-4000-8000-def000000001";

/** Tenant label on the Control Plane seed application. */
export const ATLAS_SELF_TENANT_ID = "atlas";

export const ATLAS_SELF_PROJECT_SLUGS = ["atlas", "arletos", "atlas-core"] as const;

/** CP SERVICE bearer → existing live-approval store. Handler authenticates. */
export const ATLAS_SELF_CONTROL_VERIFY_PATH =
  "/api/v1/approvals/verify-atlas-self";
export const ATLAS_SELF_CONTROL_REQUEST_PATH =
  "/api/v1/approvals/atlas-self/control-request";

export { ATLAS_SELF_APPLICATION_ID, ATLAS_SELF_SYSTEM_ID };

export function isAtlasSelfApplicationId(
  value: string | null | undefined,
): boolean {
  return value === ATLAS_SELF_APPLICATION_ID;
}

export function isAtlasSelfProjectId(value: string | null | undefined): boolean {
  return value === ATLAS_SELF_PROJECT_ID;
}

export function isAtlasSelfProjectSlug(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  return (ATLAS_SELF_PROJECT_SLUGS as readonly string[]).includes(
    value.toLowerCase(),
  );
}

/**
 * Approval context that marks a live approval as Atlas-self.
 * Ordinary external-app approvals must not set these fields.
 */
export function atlasSelfApprovalContext(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    applicationId: ATLAS_SELF_APPLICATION_ID,
    projectId: ATLAS_SELF_PROJECT_ID,
    tenantId: ATLAS_SELF_TENANT_ID,
    ...extra,
  };
}

export function isAtlasSelfApprovalContext(context: unknown): boolean {
  if (!context || typeof context !== "object") return false;
  const record = context as Record<string, unknown>;
  const applicationId = record["applicationId"];
  if (
    typeof applicationId === "string" &&
    isAtlasSelfApplicationId(applicationId)
  ) {
    return true;
  }
  const projectId = record["projectId"];
  if (typeof projectId === "string" && isAtlasSelfProjectId(projectId)) {
    return true;
  }
  return false;
}
