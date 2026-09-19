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
import {
  classifyOffsiteBackupClaim,
  offsiteRequirementBlocks,
  runCanonicalAuditRestoreDrill,
} from "../apps/api/src/services/disaster-recovery-drill.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = join(root, ".atlas", "audit", "audit.ndjson");
const sourcePath = process.env.ATLAS_AUDIT_LOG_PATH?.trim() || defaultSource;
const sourceExists = existsSync(sourcePath);
const offsiteDirConfigured = Boolean(process.env.ATLAS_OFFSITE_BACKUP_DIR?.trim());

const result = runCanonicalAuditRestoreDrill({ sourcePath });

function classification(): string {
  const offsiteClaim = classifyOffsiteBackupClaim(result);
  if (offsiteClaim === "OFFSITE_REJECTED") {
    return "OFFSITE_REJECTED — NOT BACKUP SUCCESS";
  }
  if (offsiteClaim === "OFFSITE_NOT_CONFIGURED") {
    return "OFFSITE_NOT_CONFIGURED — NOT BACKUP SUCCESS";
  }
  if (offsiteClaim === "OFFSITE_VERIFIED") {
    return "OFFSITE_VERIFIED — filesystem replica only; not cloud DR";
  }
  if (!sourceExists) {
    return "LOCAL DR — MISSING SOURCE";
  }
  if (result.ok) {
    return "LOCAL DR — VERIFIED";
  }
  return "LOCAL DR — FAILED";
}

const requireOffsite = process.env.ATLAS_REQUIRE_OFFSITE === "1";
const blockedByOffsiteRequirement = offsiteRequirementBlocks(result, requireOffsite);

const report = {
  classification: classification(),
  offsiteClaim: classifyOffsiteBackupClaim(result),
  cloudDr: "NOT VERIFIED",
  cloudObjectStore: result.cloudObjectStore,
  offsiteDirConfigured,
  requireOffsite,
  blockedByOffsiteRequirement,
  note: "A directory replica is not cloud DR. RPO/RTO are not claimed. OFFSITE_NOT_CONFIGURED is not backup success.",
  result,
};

console.log(JSON.stringify(report, null, 2));
process.exit(result.ok && !blockedByOffsiteRequirement ? 0 : 1);
