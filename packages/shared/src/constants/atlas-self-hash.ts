import { hashCanonicalJson } from "../approval/hash.js";
import { ATLAS_SELF_APPLICATION_ID } from "./atlas-gateway.js";

/** Same artifactHash already used by Phase 13 live-approval tests. */
export function atlasSelfControlArtifactHash(
  agentId: string,
  controlAction: string,
): string {
  return atlasSelfArtifactHash({
    applicationId: ATLAS_SELF_APPLICATION_ID,
    agentId,
    controlAction,
  });
}

/** Binding hash stored on Atlas-self approval records (existing artifactHash field). */
export function atlasSelfArtifactHash(
  parts: Record<string, string>,
): string {
  return hashCanonicalJson(parts);
}
