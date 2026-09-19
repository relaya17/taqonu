import { SYSTEM_OWNER_ID, type EvidenceRecord } from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { getProjectOwnerId } from "./project-access.js";

/**
 * Evidence the Verdict / certificate / project-scoped gate graph may count.
 *
 * Store rows are already keyed by `projectId`. This additionally drops
 * records stamped with a *different project's* bound owner so a caller
 * cannot plant Evidence on project B and have project A's (or B's) Verdict
 * count it. Project-owner and SYSTEM rows stay. Unowned projects keep the
 * existing unowned-read contract (all rows on that key).
 *
 * Does not change GET `/api/v1/evidence` (caller-scoped list). USER-plane
 * portfolio gates pass only caller-readable project ids into this helper.
 */
export function evidenceForGovernedProject(projectId: string): EvidenceRecord[] {
  const records = osStore.getEvidence(projectId);
  const projectOwner = getProjectOwnerId(projectId);
  if (!projectOwner) return records;
  const foreignOwners = foreignProjectOwnerIds(projectId);
  return records.filter((record) => {
    if (record.ownerId === projectOwner) return true;
    if (record.ownerId === SYSTEM_OWNER_ID) return true;
    return !foreignOwners.has(record.ownerId);
  });
}

function foreignProjectOwnerIds(thisProjectId: string): Set<string> {
  const foreign = new Set<string>();
  for (const project of osStore.listProjects()) {
    if (project.id === thisProjectId) continue;
    const owner = getProjectOwnerId(project.id);
    if (owner) foreign.add(owner);
  }
  return foreign;
}
