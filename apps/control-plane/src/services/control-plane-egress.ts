/**
 * Control Plane outbound hops to the tenant API.
 * Same decideEgress table — no second policy engine.
 * Same-origin dashboard fetches are classified as internal UI, not egress.
 */
import { decideEgress } from "@atlas/shared";

export function assertControlPlaneApiEgress(purpose: string): string | null {
  const result = decideEgress({
    dataClass: "INTERNAL",
    destination: "atlas_internal",
    operation: "TELEMETRY",
    purpose,
    actorId: "cp:service",
  });
  if (result.decision === "DENY") {
    return result.reason;
  }
  if (result.decision === "REQUIRE_APPROVAL") {
    return result.reason;
  }
  return null;
}
