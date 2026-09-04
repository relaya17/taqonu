/**
 * Canonical audit restore drill.
 * Proves a copy of the API NDJSON chain still verifies.
 * A configured replica directory is still the same NDJSON SoR, not a second history.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  readonly offsite: boolean;
  readonly offsitePath: string | null;
  readonly offsiteChecksum: string | null;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function configuredOffsiteDir(): string | null {
  const raw = process.env.ATLAS_OFFSITE_BACKUP_DIR?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function runCanonicalAuditRestoreDrill(input?: {
  readonly sourcePath?: string;
  readonly drillDir?: string;
  readonly offsiteDir?: string | null;
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
      offsitePath: null,
      offsiteChecksum: null,
    };
  }

  const drillDir =
    input?.drillDir ??
    join(process.cwd(), ".atlas", "dr-drills", drilledAt.replace(/[:.]/g, "-"));
  mkdirSync(drillDir, { recursive: true });
  const restoredPath = join(drillDir, "audit.ndjson");
  copyFileSync(sourcePath, restoredPath);

  const verified = verifyAuditLogChainAt(restoredPath);
  const localChecksum = sha256File(restoredPath);
  const offsiteDir =
    input && "offsiteDir" in input ? (input.offsiteDir ?? null) : configuredOffsiteDir();

  let offsite = false;
  let offsitePath: string | null = null;
  let offsiteChecksum: string | null = null;
  let error = verified.error;
  let ok = verified.ok;
  let status: string = verified.status;

  if (offsiteDir) {
    if (!verified.ok) {
      error = verified.error ?? "local restore is not valid; offsite replica skipped";
    } else {
      mkdirSync(offsiteDir, { recursive: true });
      const replica = join(offsiteDir, "audit.ndjson");
      copyFileSync(restoredPath, replica);
      offsiteChecksum = sha256File(replica);
      if (offsiteChecksum !== localChecksum) {
        ok = false;
        status = "FAILED";
        error = "offsite replica checksum does not match restored copy";
      } else {
        const replicaVerified = verifyAuditLogChainAt(replica);
        if (!replicaVerified.ok) {
          ok = false;
          status = replicaVerified.status;
          error = replicaVerified.error ?? "offsite replica failed hash verification";
        } else {
          offsite = true;
          offsitePath = replica;
        }
      }
    }
  }

  const result: DisasterRecoveryDrillResult = {
    drilledAt,
    sourcePath,
    restoredPath,
    ok,
    status,
    checked: verified.checked,
    error,
    offsite,
    offsitePath,
    offsiteChecksum,
  };
  writeFileSync(
    join(drillDir, "receipt.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  return result;
}

export interface CanonicalAuditRestoreResult {
  readonly restoredAt: string;
  readonly replicaPath: string;
  readonly restoredPath: string;
  readonly ok: boolean;
  readonly status: string;
  readonly checked: number;
  readonly error: string | null;
  readonly overwrittenCanonical: false;
}

/**
 * Restore from a replica into an isolated directory, then verify the chain.
 * Never overwrites the live canonical path. Operators copy the verified
 * restored file only after reviewing the receipt.
 */
export function restoreCanonicalAuditFromReplica(input: {
  readonly replicaPath: string;
  readonly restoreDir: string;
}): CanonicalAuditRestoreResult {
  const restoredAt = new Date().toISOString();
  if (!existsSync(input.replicaPath)) {
    return {
      restoredAt,
      replicaPath: input.replicaPath,
      restoredPath: "",
      ok: false,
      status: "INCOMPLETE",
      checked: 0,
      error: "replica is missing — nothing to restore",
      overwrittenCanonical: false,
    };
  }

  mkdirSync(input.restoreDir, { recursive: true });
  const restoredPath = join(input.restoreDir, "audit.ndjson");
  copyFileSync(input.replicaPath, restoredPath);
  const verified = verifyAuditLogChainAt(restoredPath);
  const result: CanonicalAuditRestoreResult = {
    restoredAt,
    replicaPath: input.replicaPath,
    restoredPath,
    ok: verified.ok,
    status: verified.status,
    checked: verified.checked,
    error: verified.error,
    overwrittenCanonical: false,
  };
  writeFileSync(
    join(input.restoreDir, "restore-receipt.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  return result;
}
