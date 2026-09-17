import { SYSTEM_OWNER_ID } from "@atlas/shared";
import { getProjectOwnerId } from "./project-access.js";

/**
 * Resolve the tenant (or platform) owner to stamp on evidence / memory /
 * domain-event writes.
 *
 * Never falls back to `STUB_OWNER_ID`. Authenticated request owner wins;
 * otherwise the bound project owner; otherwise the explicit system actor.
 */
export function resolveEvidenceOwnerId(input: {
  readonly requestOwnerId?: string | null | undefined;
  readonly projectId?: string | null | undefined;
}): string {
  const fromRequest = input.requestOwnerId?.trim();
  if (fromRequest) return fromRequest;
  if (input.projectId) {
    const projectOwner = getProjectOwnerId(input.projectId);
    if (projectOwner) return projectOwner;
  }
  return SYSTEM_OWNER_ID;
}
