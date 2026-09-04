#!/usr/bin/env tsx
/**
 * Canonical audit DR drill CLI.
 * Local restore + optional filesystem replica. Never claims S3/GCS.
 *
 * Usage: pnpm dr:drill
 * Optional: ATLAS_AUDIT_LOG_PATH, ATLAS_OFFSITE_BACKUP_DIR
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCanonicalAuditRestoreDrill } from "../apps/api/src/services/disaster-recovery-drill.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = join(root, ".atlas", "audit", "audit.ndjson");
const sourcePath = process.env.ATLAS_AUDIT_LOG_PATH?.trim() || defaultSource;
const sourceExists = existsSync(sourcePath);
const offsiteDirConfigured = Boolean(process.env.ATLAS_OFFSITE_BACKUP_DIR?.trim());

const result = runCanonicalAuditRestoreDrill({ sourcePath });

function classification(): string {
  if (result.destinationKind === "REJECTED" && result.error?.includes("Object-store")) {
    return "DR CODE COMPLETE — EXTERNAL DESTINATION REQUIRED";
  }
  if (!sourceExists) {
    return "LOCAL DR — MISSING SOURCE";
  }
  if (result.ok && result.offsite) {
    return "OFFSITE DR — VERIFIED";
  }
  if (result.ok) {
    return "LOCAL DR — VERIFIED";
  }
  return "LOCAL DR — FAILED";
}

const report = {
  classification: classification(),
  cloudDr: "NOT VERIFIED",
  cloudObjectStore: result.cloudObjectStore,
  offsiteDirConfigured,
  note: "A directory replica is not cloud DR. RPO/RTO are not claimed.",
  result,
};

console.log(JSON.stringify(report, null, 2));
process.exit(result.ok ? 0 : 1);
