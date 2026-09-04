# Canonical audit disaster recovery

Atlas’s system of record is the tenant API NDJSON chain
(`.atlas/audit/audit.ndjson` or `ATLAS_AUDIT_LOG_PATH`). Control Plane
observational hashes are not a second SoR.

## Backup / replica

1. Run `runCanonicalAuditRestoreDrill`.
2. Local copy is written under `.atlas/dr-drills/<timestamp>/audit.ndjson`
   and `receipt.json`.
3. If `ATLAS_OFFSITE_BACKUP_DIR` is set, a checksum-matched replica is
   written there. `offsite: true` only after the replica chain verifies.
4. A directory replica is not S3/GCS. Cloud object-store credentials are
   an Owner deployment decision.

## Restore procedure

1. Point `restoreCanonicalAuditFromReplica` at the replica `audit.ndjson`.
2. The function copies into an **isolated** restore directory and verifies
   the hash chain.
3. `overwrittenCanonical` is always `false`. Operators copy the verified
   file onto the live path only after reviewing `restore-receipt.json`.
4. Do not swap a `BROKEN` or `INCOMPLETE` replica onto production.

## Drill evidence

`disaster-recovery-drill.test.ts` proves:

- local restore verifies
- configured replica checksum-matches
- restore-from-replica verifies and does not overwrite canonical
- missing replica fails closed
