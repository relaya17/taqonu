/**
 * Atlas Sentinel — defensive security scan orchestration (S1).
 */
import { detectSecrets, type SecretFinding } from "./secrets.js";
import {
  detectAuthzRegressions,
  type AuthzRegressionFinding,
} from "./authz-regression.js";
import {
  detectDependencyAdvisories,
  type DependencyFinding,
} from "./deps.js";
import { detectConfigSecurity, type ConfigFinding } from "./config.js";
import { runSpecialistPacks, type PackFinding } from "./packs.js";
import { saveSentinelLastScan } from "./persist.js";

export type SentinelFinding =
  | SecretFinding
  | AuthzRegressionFinding
  | DependencyFinding
  | ConfigFinding
  | PackFinding;

export interface SentinelScanResult {
  readonly scannedAt: string;
  readonly workspaceRoot: string;
  readonly posture: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "CLEAR";
  readonly summary: string;
  readonly secrets: readonly SecretFinding[];
  readonly authz: readonly AuthzRegressionFinding[];
  readonly dependencies: readonly DependencyFinding[];
  readonly config: readonly ConfigFinding[];
  readonly packs: readonly PackFinding[];
  readonly findings: readonly SentinelFinding[];
  readonly counts: {
    readonly secrets: number;
    readonly authz: number;
    readonly dependencies: number;
    readonly config: number;
    readonly packs: number;
    readonly critical: number;
    readonly high: number;
  };
  readonly nextActions: readonly string[];
}

function postureOf(
  findings: readonly SentinelFinding[],
): SentinelScanResult["posture"] {
  if (findings.some((f) => f.severity === "CRITICAL")) return "CRITICAL";
  if (findings.some((f) => f.severity === "HIGH")) return "HIGH";
  if (findings.some((f) => f.severity === "MEDIUM")) return "MEDIUM";
  if (findings.length > 0) return "LOW";
  return "CLEAR";
}

export function runSentinelScan(
  workspaceRoot: string,
  options?: { readonly persist?: boolean },
): SentinelScanResult {
  const secrets = detectSecrets(workspaceRoot);
  const authz = detectAuthzRegressions(workspaceRoot, {
    persistBaseline: options?.persist !== false,
  });
  const dependencies = detectDependencyAdvisories(workspaceRoot);
  const config = detectConfigSecurity(workspaceRoot);
  const packs = runSpecialistPacks(workspaceRoot);
  const findings = [
    ...secrets,
    ...authz,
    ...dependencies,
    ...config,
    ...packs,
  ];
  const posture = postureOf(findings);
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
  if (dependencies.length > 0) {
    nextActions.push(
      "Upgrade allowlisted vulnerable packages · re-lock · re-run Sentinel verify",
    );
  }
  if (config.length > 0) {
    nextActions.push(
      "Harden CORS/cookies/JWT/TLS/headers · confirm intentional public exceptions",
    );
  }
  if (packs.length > 0) {
    const packIds = [...new Set(packs.map((p) => p.pack))].join(", ");
    nextActions.push(
      `Review specialist pack findings (${packIds}) · propose fix · verify with separate engine`,
    );
  }
  if (posture === "CLEAR") {
    nextActions.push(
      "Keep scanning on observe · expand advisory catalog as stack grows",
    );
  }

  const summary =
    posture === "CLEAR"
      ? "No secret, authz, dependency, config, or pack signals in this defensive pass."
      : `${critical} critical · ${high} high · secrets ${secrets.length} · authz ${authz.length} · deps ${dependencies.length} · config ${config.length} · packs ${packs.length}`;

  const result: SentinelScanResult = {
    scannedAt: new Date().toISOString(),
    workspaceRoot,
    posture,
    summary,
    secrets,
    authz,
    dependencies,
    config,
    packs,
    findings,
    counts: {
      secrets: secrets.length,
      authz: authz.length,
      dependencies: dependencies.length,
      config: config.length,
      packs: packs.length,
      critical,
      high,
    },
    nextActions,
  };

  if (options?.persist !== false) {
    saveSentinelLastScan(workspaceRoot, result);
  }

  return result;
}

export type {
  SecretFinding,
  AuthzRegressionFinding,
  DependencyFinding,
  ConfigFinding,
  PackFinding,
};
