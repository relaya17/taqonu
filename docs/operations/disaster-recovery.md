# Canonical audit disaster recovery

Atlas’s system of record is the tenant API NDJSON chain
(`.atlas/audit/audit.ndjson` or `ATLAS_AUDIT_LOG_PATH`). Control Plane
observational hashes are not a second SoR.

Customer BYO cloud (`docs/strategy/byo-storage.md`) stores **customer project
data**. It is not the Atlas canonical-audit DR destination. Do not wire
audit replicas into Cloudflare R2 merely because BYO exists.

## Status classes (do not collapse)

| Class | Meaning |
| --- | --- |
| LOCAL DR — VERIFIED | Isolated copy of the NDJSON chain verified on this host |
| OFFSITE DR — VERIFIED | Checksum-matched replica on a **filesystem** directory (`ATLAS_OFFSITE_BACKUP_DIR`) |
| CLOUD DR — VERIFIED | Object-store backup + restore proven with real credentials — **not implemented** |
| DR CODE COMPLETE — EXTERNAL DESTINATION REQUIRED | Code exists; cloud bucket/region/credentials are absent |
| DR CREDENTIALS REQUIRED | Destination exists in architecture but secrets are not provisioned |

RPO and RTO are **NOT CLAIMED**. Retention of `.atlas/dr-drills/` is local
filesystem only; there is no object-store lifecycle policy.

## Backup / replica

1. Run `pnpm dr:drill` (or `runCanonicalAuditRestoreDrill`).
2. Local copy is written under `.atlas/dr-drills/<timestamp>/audit.ndjson`
   and `receipt.json` (includes `sourceChecksum` / `restoredChecksum`).
3. If `ATLAS_OFFSITE_BACKUP_DIR` is a writable **directory**, a checksum-matched
   replica is written there. `offsite: true` only after the replica chain
   verifies. `cloudObjectStore` is always `false`.
4. Object-store URLs (`s3://…`, `gs://…`, `https://…`) are **rejected**.
   A directory replica is not S3/GCS/Azure Blob.

## Restore procedure

1. Point `restoreCanonicalAuditFromReplica` at the replica `audit.ndjson`.
2. The function copies into an **isolated** restore directory, compares
   checksums, and verifies the hash chain.
3. `overwrittenCanonical` is always `false`. Operators copy the verified
   file onto the live path only after reviewing `restore-receipt.json`.
4. Do not swap a `BROKEN`, `FAILED`, or `INCOMPLETE` replica onto production.

## Failure behavior (fail-closed)

- Missing source log → `INCOMPLETE`, no offsite claim
- Missing replica → restore `INCOMPLETE`
- Tampered replica → restore not `ok`, canonical file unchanged
- Offsite path is a file, not a directory → `REJECTED`
- Object-store URL → `REJECTED` (not cloud DR)

## Drill evidence

`disaster-recovery-drill.test.ts` covers local restore, filesystem replica,
restore-from-replica, missing source/replica, tamper, invalid destination,
and object-store URL rejection.

Cloud backup → cloud artifact → restore remains **EXTERNAL INFRASTRUCTURE**.
