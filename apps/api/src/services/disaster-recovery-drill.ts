/**
 * Canonical audit restore drill.
 * Proves a copy of the API NDJSON chain still verifies.
 * A configured replica directory is still the same NDJSON SoR, not a second history.
 * Object-store URLs are not implemented — do not claim cloud DR from a folder copy.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  readonly sourceChecksum: string | null;
  readonly restoredChecksum: string | null;
  readonly offsite: boolean;
  readonly offsitePath: string | null;
  readonly offsiteChecksum: string | null;
  readonly destinationKind: "UNSET" | "FILESYSTEM_DIRECTORY" | "REJECTED";
  readonly cloudObjectStore: false;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function configuredOffsiteDir(): string | null {
  const raw = process.env.ATLAS_OFFSITE_BACKUP_DIR?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Object-store URIs are not a supported replica destination. */
export function rejectNonFilesystemOffsiteDir(dir: string): string | null {
  const trimmed = dir.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) || trimmed.startsWith("s3:")) {
    return "ATLAS_OFFSITE_BACKUP_DIR must be a filesystem directory. Object-store URLs are not implemented. Do not claim cloud DR.";
  }
  return null;
}

function ensureWritableDirectory(dir: string): string | null {
  const rejected = rejectNonFilesystemOffsiteDir(dir);
  if (rejected) return rejected;
  try {
    if (existsSync(dir) && !statSync(dir).isDirectory()) {
      return "offsite destination exists and is not a directory";
    }
    mkdirSync(dir, { recursive: true });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "offsite destination is not writable";
  }
}

function emptyResult(
  drilledAt: string,
  sourcePath: string,
  error: string,
  status = "INCOMPLETE",
): DisasterRecoveryDrillResult {
  return {
    drilledAt,
    sourcePath,
    restoredPath: "",
    ok: false,
    status,
    checked: 0,
    error,
    sourceChecksum: null,
    restoredChecksum: null,
    offsite: false,
    offsitePath: null,
    offsiteChecksum: null,
    destinationKind: "UNSET",
    cloudObjectStore: false,
  };
}

export function runCanonicalAuditRestoreDrill(input?: {
  readonly sourcePath?: string;
  readonly drillDir?: string;
  readonly offsiteDir?: string | null;
}): DisasterRecoveryDrillResult {
  const drilledAt = new Date().toISOString();
  const sourcePath = input?.sourcePath ?? resolveAuditLogPath();
  if (!existsSync(sourcePath)) {
    return emptyResult(
      drilledAt,
      sourcePath,
      "canonical audit log is missing — nothing to restore",
    );
  }

  const drillDir =
    input?.drillDir ??
    join(process.cwd(), ".atlas", "dr-drills", drilledAt.replace(/[:.]/g, "-"));
  mkdirSync(drillDir, { recursive: true });
  const restoredPath = join(drillDir, "audit.ndjson");
  copyFileSync(sourcePath, restoredPath);

  const verified = verifyAuditLogChainAt(restoredPath);
  const sourceChecksum = sha256File(sourcePath);
  const restoredChecksum = sha256File(restoredPath);
  const offsiteDir =
    input && "offsiteDir" in input ? (input.offsiteDir ?? null) : configuredOffsiteDir();

  let offsite = false;
  let offsitePath: string | null = null;
  let offsiteChecksum: string | null = null;
  let destinationKind: DisasterRecoveryDrillResult["destinationKind"] = offsiteDir
    ? "FILESYSTEM_DIRECTORY"
    : "UNSET";
  let error = verified.error;
  let ok = verified.ok;
  let status: string = verified.status;

  if (sourceChecksum !== restoredChecksum) {
    ok = false;
    status = "FAILED";
    error = "restored copy checksum does not match source";
  }

  if (offsiteDir) {
    const destError = ensureWritableDirectory(offsiteDir);
    if (destError) {
      ok = false;
      status = "FAILED";
      error = destError;
      destinationKind = "REJECTED";
    } else if (!verified.ok || sourceChecksum !== restoredChecksum) {
      error =
        error ?? "local restore is not valid; offsite replica skipped";
    } else {
      try {
        const replica = join(offsiteDir, "audit.ndjson");
        copyFileSync(restoredPath, replica);
        offsiteChecksum = sha256File(replica);
        if (offsiteChecksum !== restoredChecksum) {
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
      } catch (copyError) {
        ok = false;
        status = "FAILED";
        error =
          copyError instanceof Error
            ? copyError.message
            : "offsite replica copy failed";
        destinationKind = "REJECTED";
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
    sourceChecksum,
    restoredChecksum,
    offsite,
    offsitePath,
    offsiteChecksum,
    destinationKind,
    cloudObjectStore: false,
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
  readonly replicaChecksum: string | null;
  readonly restoredChecksum: string | null;
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
      replicaChecksum: null,
      restoredChecksum: null,
      overwrittenCanonical: false,
    };
  }

  mkdirSync(input.restoreDir, { recursive: true });
  const restoredPath = join(input.restoreDir, "audit.ndjson");
  copyFileSync(input.replicaPath, restoredPath);
  const replicaChecksum = sha256File(input.replicaPath);
  const restoredChecksum = sha256File(restoredPath);
  const verified = verifyAuditLogChainAt(restoredPath);
  let ok = verified.ok;
  let status: string = verified.status;
  let error = verified.error;
  if (replicaChecksum !== restoredChecksum) {
    ok = false;
    status = "FAILED";
    error = "restored file checksum does not match replica";
  }
  const result: CanonicalAuditRestoreResult = {
    restoredAt,
    replicaPath: input.replicaPath,
    restoredPath,
    ok,
    status,
    checked: verified.checked,
    error,
    replicaChecksum,
    restoredChecksum,
    overwrittenCanonical: false,
  };
  writeFileSync(
    join(input.restoreDir, "restore-receipt.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  return result;
}
