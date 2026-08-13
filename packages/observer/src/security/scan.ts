/**
 * Atlas Sentinel — defensive security scan orchestration (S1).
 */
import { detectSecrets, type SecretFinding } from "./secrets.js";
import {
  detectAuthzRegressions,
  type AuthzRegressionFinding,
} from "./authz-regression.js";

export type SentinelFinding = SecretFinding | AuthzRegressionFinding;

export interface SentinelScanResult {
  readonly scannedAt: string;
  readonly workspaceRoot: string;
  readonly posture: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "CLEAR";
  readonly summary: string;
  readonly secrets: readonly SecretFinding[];
  readonly authz: readonly AuthzRegressionFinding[];
  readonly findings: readonly SentinelFinding[];
  readonly counts: {
    readonly secrets: number;
    readonly authz: number;
    readonly critical: number;
    readonly high: number;
  };
  readonly nextActions: readonly string[];
}

function postureOf(
  secrets: readonly SecretFinding[],
  authz: readonly AuthzRegressionFinding[],
): SentinelScanResult["posture"] {
  const all = [...secrets, ...authz];
  if (all.some((f) => f.severity === "CRITICAL")) return "CRITICAL";
  if (all.some((f) => f.severity === "HIGH")) return "HIGH";
  if (all.some((f) => f.severity === "MEDIUM")) return "MEDIUM";
  if (all.length > 0) return "LOW";
  return "CLEAR";
}

export function runSentinelScan(workspaceRoot: string): SentinelScanResult {
  const secrets = detectSecrets(workspaceRoot);
  const authz = detectAuthzRegressions(workspaceRoot);
  const findings = [...secrets, ...authz];
  const posture = postureOf(secrets, authz);
  const critical = findings.filter((f) => f.severity === "CRITICAL").length;
  const high = findings.filter((f) => f.severity === "HIGH").length;

  const nextActions: string[] = [];
  if (secrets.length > 0) {
    nextActions.push(
      "Rotate any live credentials · purge from git history · move to secret manager",
    );
  }
  if (authz.length > 0) {
    nextActions.push(
      "Restore AuthN/AuthZ guards · add regression tests that unauthenticated calls fail",
    );
  }
  if (posture === "CLEAR") {
    nextActions.push(
      "Keep scanning on each observe · expand S1.2 dependency advisories when ready",
    );
  }

  const summary =
    posture === "CLEAR"
      ? "No secret or authz-regression signals in this defensive pass."
      : `${critical} critical · ${high} high · ${secrets.length} secret · ${authz.length} authz signals (defensive scan only).`;

  return {
    scannedAt: new Date().toISOString(),
    workspaceRoot,
    posture,
    summary,
    secrets,
    authz,
    findings,
    counts: {
      secrets: secrets.length,
      authz: authz.length,
      critical,
      high,
    },
    nextActions,
  };
}

export type { SecretFinding, AuthzRegressionFinding };
