# Atlas work stages (authoritative)

Do not confuse **missing for stability** with **roadmap**.
Do not mark a stage Done without implementation + tests + runtime evidence.
Do not duplicate: `executeGovernedAction`, `dispatchAgentAction`, `executeTool`, `approvals.ts`, `verifyProposal`, `audit-log.ts`.

## 01 BASELINE / FREEZE
Git snapshot + quality-gate evidence of what is actually implemented.
See commit `e7773e0`.

Honest remaining gaps (not a missing executor):
- `apps/api` `tsc` still has pre-existing errors vs env/auth fields (not this stage).
  Approval schema now includes `artifactHash` / `expiresAt` / `REVOKED` so
  consume can actually bind and expire.
- E2E / a11y / full turbo were not run for the freeze.
- CP in-memory audit is observational (stage 05 labels it UNKNOWN, not a second SoR).

## 02 GATEWAY COMPLETION
Wired. Control Plane does not run tools. See commit `e7773e0`.

```
Application → Gateway → Identity → Registries → Capability
→ Entity Policy / Risk (existing) → ALLOW|DENY|APPROVAL
→ executeGovernedAction → executeTool
→ Receipt → Observation → Verification → Audit → Memory
```

## 03 IDENTITY / AUTHZ
Real principals. No default `atlas-owner`. Customer admin ≠ operator.

**Implemented (code + tests):**
- Principal kinds: CUSTOMER_USER, CUSTOMER_ADMIN, ATLAS_OPERATOR,
  ATLAS_OWNER, AGENT, SERVICE.
- Control Plane HTTP ops bind `cp:service` (SERVICE). Body `actorId` is ignored.
- Missing principal → DENY at IDENTITY.
- `requireOperator` rejects customer admin. `requireOwner` is owner-only.
- Gateway fulfill uses the session user id.
- `/admin/users` cannot grant operator/owner.

**Not claimed:** distinct Owner vs Operator Control Plane credentials.

## 04 CONTROL PLANE SECURITY
**Implemented (code + tests):**
- Secure response headers (nosniff, DENY frame, no-store, noindex).
- `X-Request-Id` echoed or minted.
- In-memory rate limit (120/min per client; liveness `/api/v1/status` excluded).
- Idempotency keys on `POST /api/v1/gateway/ops` (`X-Idempotency-Key`).
- Reauth tickets are one-shot until TTL (replay protection). HMAC reauth is **not MFA**.
- CSRF skipped: Control Plane API is Bearer, not cookie-session.

**Not claimed:** real MFA, distinct Owner/Operator CP credentials, token rotation/revoke across processes.

## 05 CANONICAL AUDIT
**Implemented (code + tests):**
- API NDJSON is the system of record.
- `verifyAuditLogChain` returns `VALID | BROKEN | INCOMPLETE | UNKNOWN`.
- Missing or empty file is **INCOMPLETE**, not VALID.
- Tamper → BROKEN.
- CP `verifyAuditChain` is `canonical: false`, `status: UNKNOWN`.
- Self-audit no longer claims the CP trail is the canonical verify.

**Not claimed:** merging CP hashes into the API file; a second SoR.

## 06 EXECUTION SAFETY
**Implemented on the existing runtime (not a job queue):**
- `executeTool` already has timeout + AbortSignal.
- Approval consume is one-shot (existing).
- `executeGovernedAction` accepts optional `idempotencyKey` (process-local replay).

**Not claimed:** durable jobs, crash-recovery workers, distributed idempotency.

## 07 VERIFICATION
**Implemented:**
- Receipt verdicts: `VERIFIED | FAILED | PARTIAL | INCONCLUSIVE | BLOCKED`.
- Reads against the application registry can be VERIFIED.
- Default writes: `executed: true` never implies `verified: true`.
- `captureExpectedState` → execute → `compareExpectedActual` on Gateway fulfill
  (the only execution hop). Empty expected observations → INCONCLUSIVE.
  Bound observations that match actual output → VERIFIED; memory stays OBSERVED.

**Not claimed:** a general world-state expected-vs-actual checker; regression
product; diagnosis.

## 08 EGRESS GOVERNANCE
**Implemented:**
- Operations: WEBHOOK, EMAIL, TELEMETRY, PLUGIN, MESSAGING (same `decideEgress` table).
- SECRET / SYSTEM_CRITICAL still never leave Atlas.
- `assertEgressAllowed` wraps `decideEgress`. Call site: Control Plane event bridge (TELEMETRY / internal).

**Not claimed:** wrapping every `fetch` in the repo; a new egress product.

## 09 MEMORY / KNOWLEDGE INTEGRITY
**Implemented:** `capEpistemicStateForSource` — AGENT ceiling is PROPOSED
(AGENT+FACT cannot become FACT). `agent.run.completed` is forced to OBSERVED
via `memoryEpistemicAfterAction`. Gateway memory is OBSERVED. No new memory types.

**GEAL sufficiency (same operating cycle, not a second path):**
`assessEvidenceSufficiency` → CONTINUE | HALT | INCONCLUSIVE.
Conflicting evidence on a mutation DENY at EVIDENCE. Empty evidence is not
VERIFIED. Inspect may CONTINUE in order to observe.

## 10 AGENT GOVERNANCE
**Implemented:** `agentMayExecute` (ACTIVE/DEGRADED only). Delegation hops floor to approval. Do not add agents. CP `fs.*` names remain oversight labels — execution uses the fabric catalog.

## 11 TOOL GOVERNANCE
**Implemented:** dangerous tools stay `requiresApproval` in the existing policy table. `governed-execution.test.ts` uses catalog-granted `knowledge_search` + `registerTool`. `fs.read_file` is AUTHORIZATION DENIED for RESEARCHER.

## 12 RELIABILITY
**Implemented:** Control Plane SIGTERM/SIGINT graceful close.

**Not claimed:** durable job queue, retries-as-a-platform, crash recovery of in-flight tool runs.

## 13 OBSERVABILITY
**Implemented:** one request id — CP `X-Request-Id`; `executeGovernedAction.requestId` already correlated. No second telemetry stack.

## 14 SELF-AUDIT
**Implemented:** detect → propose only. `autoApply: false` on every finding. Checks: CP auth, non-canonical audit, DEF-000, agent denials, egress policy presence, MFA-not-bound.

## 15 DISASTER RECOVERY
**Implemented:** copied canonical NDJSON still verifies (restore check).

**Not claimed:** backup product, offsite replication, timed restore drills.

## 16 SUPPLY-CHAIN / PRODUCTION SECURITY
**Implemented:** CI `permissions: contents: read`. Secret scan and eval gate already existed.

**Not claimed:** full SBOM/signing overhaul.

## 17 GOVERNANCE TEST SUITE
**Implemented:** `apps/api/src/__tests__/governance-invariants.test.ts` and
`apps/control-plane/src/__tests__/governance-invariants.test.ts`
(unauthenticated DENY, customer admin ≠ operator, missing capability, wrong tenant, audit tamper, executed ≠ verified, CP audit non-canonical, self-audit never auto-applies).

## 18 PERFORMANCE / SCALE
Skipped until the security path has been run in a real environment. Not part of this completion.

## 19 INTELLIGENCE ROADMAP
Hypothesis engine, golden projects, marketplace, reputation — **not now**.
