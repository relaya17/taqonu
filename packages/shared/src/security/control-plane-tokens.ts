/**
 * Control Plane service-token matching — Node only.
 *
 * Current + previous secrets allow rotation across processes without a
 * silent outage. Collision of an owner secret with an operator secret
 * never elevates to OWNER.
 */
import { timingSafeEqual } from "node:crypto";

export function timingSafeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function readEnvSecret(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function uniqueSecrets(values: ReadonlyArray<string | null>): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (out.some((existing) => timingSafeStringEqual(existing, value))) continue;
    out.push(value);
  }
  return out;
}

export function controlPlaneOperatorSecrets(): readonly string[] {
  return uniqueSecrets([
    readEnvSecret("ATLAS_CONTROL_PLANE_TOKEN"),
    readEnvSecret("ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS"),
  ]);
}

export function controlPlaneOwnerSecrets(): readonly string[] {
  return uniqueSecrets([
    readEnvSecret("ATLAS_CONTROL_PLANE_OWNER_TOKEN"),
    readEnvSecret("ATLAS_CONTROL_PLANE_OWNER_TOKEN_PREVIOUS"),
  ]);
}

export function presentedMatchesAny(
  presented: string,
  secrets: readonly string[],
): boolean {
  return secrets.some((secret) => timingSafeStringEqual(presented, secret));
}

export type ControlPlaneBearerMatch = "OWNER" | "OPERATOR";

/**
 * Match a presented bearer against current/previous owner and operator secrets.
 * A value that sits in both families is OPERATOR (fail closed for elevation).
 */
export function matchControlPlaneBearer(
  presented: string | null,
): ControlPlaneBearerMatch | null {
  if (!presented) return null;
  const matchesOwner = presentedMatchesAny(presented, controlPlaneOwnerSecrets());
  const matchesOperator = presentedMatchesAny(presented, controlPlaneOperatorSecrets());
  if (matchesOwner && matchesOperator) return "OPERATOR";
  if (matchesOwner) return "OWNER";
  if (matchesOperator) return "OPERATOR";
  return null;
}

/** Tenant API / Admin↔CP service hop: operator family only. */
export function matchControlPlaneServiceToken(presented: string | null): boolean {
  if (!presented) return false;
  return presentedMatchesAny(presented, controlPlaneOperatorSecrets());
}
