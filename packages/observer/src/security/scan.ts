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

export type SentinelPosture =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "CLEAR"
  | "NOT_RUN";

export interface SentinelScanResult {
  readonly scannedAt: string;
  readonly workspaceRoot: string;
  readonly posture: SentinelPosture;
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
): Exclude<SentinelScanResult["posture"], "NOT_RUN"> {
  if (findings.some((f) => f.severity === "CRITICAL")) return "CRITICAL";
  if (findings.some((f) => f.severity === "HIGH")) return "HIGH";
  if (findings.some((f) => f.severity === "MEDIUM")) return "MEDIUM";
  if (findings.length > 0) return "LOW";
  return "CLEAR";
}

/** GET/read envelope when no last-scan exists. Must not claim CLEAR. */
export function emptySentinelNotRun(workspaceRoot: string): SentinelScanResult {
  return {
    scannedAt: new Date().toISOString(),
    workspaceRoot,
    posture: "NOT_RUN",
    summary:
      "No persisted Sentinel last-scan. Run a governed POST .../sentinel/scan to produce findings.",
    secrets: [],
    authz: [],
    dependencies: [],
    config: [],
    packs: [],
    findings: [],
    counts: {
      secrets: 0,
      authz: 0,
      dependencies: 0,
      config: 0,
      packs: 0,
      critical: 0,
      high: 0,
    },
    nextActions: [
      "POST /api/v1/projects/:id/sentinel/scan (governed) to persist last-scan evidence",
    ],
  };
}

/** Bound for GET/read paths. POST scan may use a larger budget. */
export const SENTINEL_READ_BUDGET_MS = 8_000;

export function runSentinelScan(
  workspaceRoot: string,
  options?: { readonly persist?: boolean; readonly maxMs?: number },
): SentinelScanResult {
  const deadline =
    typeof options?.maxMs === "number" && Number.isFinite(options.maxMs)
      ? Date.now() + Math.max(1, options.maxMs)
      : Number.POSITIVE_INFINITY;
  const remaining = () => deadline - Date.now();

  const secrets =
    remaining() > 0
      ? detectSecrets(workspaceRoot, { deadlineMs: deadline })
      : [];
  const authz =
    remaining() > 0
      ? detectAuthzRegressions(workspaceRoot, {
          persistBaseline: options?.persist !== false,
        })
      : [];
  const dependencies =
    remaining() > 0 ? detectDependencyAdvisories(workspaceRoot) : [];
  const config = remaining() > 0 ? detectConfigSecurity(workspaceRoot) : [];
  const packs = remaining() > 0 ? runSpecialistPacks(workspaceRoot) : [];
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
