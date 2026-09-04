/**
 * Canonical audit restore drill.
 * Proves a copy of the API NDJSON chain still verifies.
 * This is not offsite backup and does not invent a second system of record.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAuditLogPath, verifyAuditLogChainAt } from "./audit-log.js";

export interface DisasterRecoveryDrillResult {
  readonly drilledAt: string;
  readonly sourcePath: string;
  readonly restoredPath: string;
  readonly ok: boolean;
  readonly status: string;
  readonly checked: number;
  readonly error: string | null;
  readonly offsite: false;
}

export function runCanonicalAuditRestoreDrill(input?: {
  readonly sourcePath?: string;
  readonly drillDir?: string;
}): DisasterRecoveryDrillResult {
  const drilledAt = new Date().toISOString();
  const sourcePath = input?.sourcePath ?? resolveAuditLogPath();
  if (!existsSync(sourcePath)) {
    return {
      drilledAt,
      sourcePath,
      restoredPath: "",
      ok: false,
      status: "INCOMPLETE",
      checked: 0,
      error: "canonical audit log is missing — nothing to restore",
      offsite: false,
    };
  }

  const drillDir =
    input?.drillDir ??
    join(process.cwd(), ".atlas", "dr-drills", drilledAt.replace(/[:.]/g, "-"));
  mkdirSync(drillDir, { recursive: true });
  const restoredPath = join(drillDir, "audit.ndjson");
  copyFileSync(sourcePath, restoredPath);

  const verified = verifyAuditLogChainAt(restoredPath);

  const result: DisasterRecoveryDrillResult = {
    drilledAt,
    sourcePath,
    restoredPath,
    ok: verified.ok,
    status: verified.status,
    checked: verified.checked,
    error: verified.error,
    offsite: false,
  };
  writeFileSync(
    join(drillDir, "receipt.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  return result;
}
