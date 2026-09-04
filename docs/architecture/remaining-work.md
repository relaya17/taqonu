# Atlas work stages (authoritative)

Do not confuse **missing for stability** with **roadmap**.
Do not mark a stage Done without implementation + tests + runtime evidence.
Do not duplicate: `executeGovernedAction`, `dispatchAgentAction`, `executeTool`, `approvals.ts`, `verifyProposal`, `audit-log.ts`.

## 01 BASELINE / FREEZE
Git snapshot + quality-gate evidence of what is actually implemented.
See commit `e7773e0`.

Honest remaining gaps (not a missing executor):
- Approval schema now includes `artifactHash` / `expiresAt` / `REVOKED` so
  consume can actually bind and expire.
- E2E / a11y / full turbo were not run for the freeze.
- CP in-memory audit is observational (stage 05 labels it UNKNOWN, not a second SoR).

**Local DX (not a fourth product):**
- `@atlas/*` dependencies use `workspace:*` (pnpm 9+).
- `apps/api` build/typecheck: `tsconfig.build.json` (excludes tests).
  IDE check: `tsconfig.json` includes tests with `noEmit`. Vitest uses
  `tsconfig.test.json`.
- Four product surfaces (ADR-021 amended): Studio lives on the user-plane
  product `http://localhost:3000`, Control `http://127.0.0.1:3100`, Atlas
  Admin `http://127.0.0.1:3200` (supervises Control and Studio — not a
  Control clone). Tenant API `http://localhost:4000`. Do not merge into one
  port or one Vercel project. `pnpm dev` starts web, api, admin,
  control-plane, worker.

## 02 GATEWAY COMPLETION
**Status: COMPLETE (Atlas-self first).** Control evaluates and hands off.
Control does not run tools. See commit `e7773e0` (evaluate + handoff) and
`332b11e` (Atlas-self ALLOW → tenant `POST /api/v1/gateway/fulfill`,
fail-closed, existing CP SERVICE bearer).

**Definition of Done (this item):** evaluate ALLOW / DENY / REQUIRE_APPROVAL;
ALLOW write-like ops on `def-000` reach
`fulfillGatewayHandoff` → `executeGovernedAction` → `executeTool`; DENY and
REQUIRE_APPROVAL do not execute; missing config / unreachable API fail
closed; no second execution engine.

**NOT PART OF PHASE 02** (do not treat as incomplete 02 work):
- Execution on event ingest. ADR-022 Phase 3: Control evaluates ingest and
  does **not** execute Civio or Atlas tools on ingest. Civio events lack an
  authoritative tool/target/artifact (`ALLOW ≠ EXECUTED` until an Owner-
  authorized execution intent exists). Do not invent
  `knowledge_search(query = eventId)`.
- HTTP fulfill for non-`def-000` applications. Target architecture P6 is
  Atlas-self first. Sibling execute is ADR-022-locked until a later phase.
- Other siblings remain observe-only (target P7/P10).

Phase 2 (2026-09-02) added Control operational contracts
(`GET /api/v1/operational-foundation`, empty `GET /api/v1/processes`).
Phase 3 (2026-09-02) added the first sibling ingress: HMAC
`POST /api/v1/connectors/civio/events` plus `emitCivioEventToControl`.
Civio runtime emit is wired in `github.com/relaya17/civio` at authenticated
`POST /api/ai/legal-query` (housing → `civio.rights.answered`). Those
increments stay as recorded; they are not a reason to keep item 02 open.

```
Application → Gateway → Identity → Registries → Capability
→ Entity Policy / Risk (existing) → ALLOW|DENY|APPROVAL
→ executeGovernedAction → executeTool
→ Receipt → Observation → Verification → Regression → Audit → Memory
```

Regression is a **gate on this hop**, not a QA product: optional `baselineObservations`
on fulfill. No baseline → INCONCLUSIVE (not a pass). Missing a prior observation
after mutation → FAILED, which overrides VERIFIED. Memory stays OBSERVED.

## 03 IDENTITY / AUTHZ
**Status: COMPLETE** for the existing identity model (no redesign).
Real principals. No default `atlas-owner`. Customer admin ≠ operator.

**Implemented (code + tests):**
- Principal kinds: CUSTOMER_USER, CUSTOMER_ADMIN, ATLAS_OPERATOR,
  ATLAS_OWNER, AGENT, SERVICE.
- Control Plane HTTP ops bind `cp:service` (SERVICE). Body `actorId` is ignored.
- Missing principal → DENY at IDENTITY.
- `requireOperator` rejects customer admin. `requireOwner` is owner-only.
- Gateway fulfill uses the session user id.
- `/admin/users` cannot grant operator/owner.
- **Distinct CP Owner vs Operator tokens:** `ATLAS_CONTROL_PLANE_OWNER_TOKEN`
  authenticates as OWNER; `ATLAS_CONTROL_PLANE_TOKEN` as OPERATOR. Dev loopback
  defaults to OPERATOR.
- **Request-scoped CP role** (`WeakMap` on the request). Concurrent requests
  cannot mix OWNER and OPERATOR. Identical owner/operator secrets never
  elevate to OWNER.
- **`requireOwnerRole` is reachable:** `GET /api/v1/owner/brief` is owner-only.
  Other CP reads stay operator-accessible (Admin uses the operator token).
  Gateway writes and agent-control remain operator + reauth / approval; they
  are not silently converted to owner-only.

**Not claimed (authorized later items, not identity-model defects):**
- Control Plane bearer MFA and token rotation — Phase 04.
- Sibling / non-`def-000` application execution identity — later-scope.

## 04 CONTROL PLANE SECURITY
**Status: COMPLETE** for the existing auth model (no redesign).

**Implemented (code + tests):**
- Secure response headers (nosniff, DENY frame, no-store, noindex).
- `X-Request-Id` echoed or minted.
- In-memory rate limit (120/min per client; liveness `/api/v1/status` excluded).
- Idempotency keys on `POST /api/v1/gateway/ops` (`X-Idempotency-Key`).
- Reauth tickets are one-shot until TTL (replay protection). HMAC reauth is **not MFA**.
- CSRF skipped: Control Plane API is Bearer, not cookie-session.
- **Full TOTP MFA (user auth):** `auth-store.ts` implements TOTP with otplib
  (`/auth/mfa/setup`, `/auth/mfa/confirm`, `/auth/mfa/verify`, `/auth/mfa/disable`).
  Scrypt-hashed backup codes, one-shot consumption, rate limiting. 16+ tests in `auth.test.ts`.
- **Control / Admin browser MFA:** privileged browser login now completes the
  existing tenant TOTP challenge (`/auth/mfa/verify`). A password-only
  response that returns `mfaRequired` does not issue a Control or Admin
  session. Machine bearer tokens remain non-TOTP (no human in the hop).
- **Service-token rotation:** current + previous operator/owner secrets
  (`ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS`,
  `ATLAS_CONTROL_PLANE_OWNER_TOKEN_PREVIOUS`) are accepted across Control,
  Admin, and the tenant API service hop. Collision still never elevates to
  OWNER. Browser cookies and reauth tickets verify against current then
  previous operator secret so rotation does not silently drop sessions.

## 05 CANONICAL AUDIT
**Status: COMPLETE** — API NDJSON is the only system of record.

**Implemented (code + tests):**
- API NDJSON is the system of record.
- `verifyAuditLogChain` returns `VALID | BROKEN | INCOMPLETE | UNKNOWN`.
- Missing or empty file is **INCOMPLETE**, not VALID.
- Tamper → BROKEN.
- CP `verifyAuditChain` is `canonical: false`, `status: UNKNOWN`.
- Self-audit no longer claims the CP trail is the canonical verify.
- **CP audit merge:** `audit-bridge.ts` + `POST /api/v1/audit/cp-import` merges
  Control Plane audit entries into the canonical API hash-chain. Entries prefixed
  with `cp:` to preserve origin. `audit-sync.ts` in CP provides periodic sync
  (`syncAuditToApi`, `startPeriodicSync`).
- **Enhanced unified audit entry schema:** model, toolName, entityType, action,
  verificationVerdict, regressionVerdict, decision, approvalId, authority,
  intent, artifactHash, delegationHopCount, blockedAt fields.
- **ESCALATE as decision:** `OPERATING_DECISIONS` now includes `ALLOW`, `DENY`,
  `REQUIRE_APPROVAL`, and `ESCALATE`.

Control Plane observational hashes are imported as `cpHash` / `cpPrevHash`
provenance on the API chain. `startPeriodicSync` is started from
`apps/control-plane/src/server.ts` and authenticates with the Control Plane
service bearer. Duplicate `cpHash` values are skipped. A broken CP hash
sequence is rejected. Historical API lines are never rewritten. There is
still no second system of record.

## 06 EXECUTION SAFETY
**Status: COMPLETE** on the existing runtime (no second execution engine).

**Implemented (code + tests):**
- `executeTool` already has timeout + AbortSignal.
- Approval consume is one-shot (existing).
- `executeGovernedAction` accepts optional `idempotencyKey`.
- **Durable governed idempotency:** EXECUTED outcomes persist to
  `.atlas/governed-idempotency.json` (atomic write). A process restart
  replays the same key instead of executing the tool again. Different
  artifact/target still fail closed.
- **Durable worker jobs + crash recovery:** `apps/worker` persists
  `.atlas/worker-queue.json`. Interrupted RUNNING jobs return to PENDING
  on startup (`recoverPendingJobs`). Retries then terminal FAILED.
- **In-flight approval recovery:** `runGovernedClaimedExecution` will not
  re-run a CLAIMED approval that already has `executionStartedAt`; it
  finalizes `OUTCOME_UNKNOWN` instead of duplicating side effects.

**Not claimed:** a separate distributed queue service (Phase 12). Process-local
automation-engine dedup remains a documented caveat, not this path.

## 07 VERIFICATION
**Status: COMPLETE** — world-state check is the existing Verification loop,
not a QA product.

**Implemented:**
- Receipt verdicts: `VERIFIED | FAILED | PARTIAL | INCONCLUSIVE | BLOCKED`.
- Reads against the application registry can be VERIFIED.
- Default writes: `executed: true` never implies `verified: true`.
- `captureExpectedState` → execute → `compareExpectedActual` on Gateway fulfill
  (the only execution hop). Empty expected observations → INCONCLUSIVE.
  Bound observations that match actual output → VERIFIED; memory stays OBSERVED.
- `assessRegression` on the same fulfill hop. No baseline → INCONCLUSIVE
  (cannot claim absence of regression). Missing baseline observation → FAILED,
  composed over verification so VERIFIED cannot survive a regression fail.
- **Verification plan locked on approval:** `expectedObservations` and
  `baselineObservations` stored on approval record; `fulfillGatewayHandoff`
  uses approval values when `approvalRequestId` is provided — caller cannot
  invent observations at fulfill time.

`evaluateWorldState` is the reusable mechanism:
INTENDED → AUTHORIZED → EXECUTED → VERIFIED.
Gateway fulfill uses it. Execution never implies VERIFIED. Regression
FAILED still overrides VERIFIED. No separate QA suite engine.

## 08 EGRESS GOVERNANCE
**Status: COMPLETE** for governed server hops. Browser same-origin UI
fetches remain classified exceptions.

**Implemented:**
- Operations: WEBHOOK, EMAIL, TELEMETRY, PLUGIN, MESSAGING (same `decideEgress` table).
- SECRET / SYSTEM_CRITICAL still never leave Atlas.
- `assertEgressAllowed` wraps `decideEgress`. Call site: Control Plane event bridge (TELEMETRY / internal).
- Control Plane → tenant API hops (`callAtlasApi`, audit sync) now call
  `assertControlPlaneApiEgress` (same `decideEgress` table, `atlas_internal`).

**Classified exceptions (not wrapped):**
- Control / Admin same-origin dashboard `fetch` (browser UI to its own API).
- Test-harness `fetch` in `*.test.ts`.
- Landing-page public `fetch` (marketing surface, not a governance hop).

No new egress product.

## 09 MEMORY / KNOWLEDGE INTEGRITY
**Status: COMPLETE** for the existing Knowledge Fabric (no second memory product).

**Implemented:** `capEpistemicStateForSource` — AGENT ceiling is PROPOSED
(AGENT+FACT cannot become FACT). `agent.run.completed` is forced to OBSERVED
via `memoryEpistemicAfterAction`. Gateway memory is OBSERVED. No new memory types.

**GEAL sufficiency (same operating cycle, not a second path):**
`assessEvidenceSufficiency` → CONTINUE | HALT | INCONCLUSIVE.
Conflicting evidence or bound `conflictingClaimIds` on a mutation DENY at EVIDENCE.
`boundEvidenceIds` count as present evidence; emptiness is not VERIFIED.
Inspect may CONTINUE in order to observe. This is not a Truth Engine.

**Memory approve gate:** USER- or CONVERSATION-only evidence cannot
promote a memory. That path returns `unverified_evidence` /
`UNVERIFIED_EVIDENCE`. Non-user evidence still required.

**Untrusted prompt data:** `buildLayeredSystemPrompt` wraps retrieved
context in `<<<UNTRUSTED_DATA:...>>>` on `agent.ts` and `conversation.ts`.
Flagged injection logs `agent_prompt_injection_flagged` /
`conversation_prompt_injection_flagged`.

## 10 AGENT GOVERNANCE
**Status: COMPLETE** for the existing catalog + governed execution path.

**Implemented:**
- `agentMayExecute` (ACTIVE/DEGRADED only).
- Delegation hops floor to approval.
- Do not add agents. CP `fs.*` names remain oversight labels — execution uses
  the fabric catalog.
- **Authority scope in identity:** `AuthenticatedAgentIdentity` now includes
  `authorityScope` (e.g. `project:abc123`), `trustLevel` (FULL/DELEGATED/LAB),
  and `runtimeStatus` fields.
- **Control Plane runtime overlay:** `resolveGovernedAgentIdentity` reads
  CP `GET /api/v1/agents/:id` when `ATLAS_CONTROL_PLANE_URL` is set.
  `executeGovernedAction` denies unless `agentMayExecute(runtimeStatus)`.
  Unreachable CP fail-closes as UNKNOWN. A 404 overlay (fabric-only id)
  defaults ACTIVE. Unset CP URL keeps local ACTIVE (tests / API-only).
- **Delegation wiring:** `agentRuntimeStatus` and `delegationHopCount` now wired
  through `submitAgentProposal`, `executeGovernedAction`, and
  `dispatchAgentAction` — enforcement is on every live dispatch path.
- **Session trust:** `resolveAgentIdentity` defaults `trustLevel` to `FULL`
  (signed-in human). `LAB` is opt-in, not the live default.
- **Live tool hop:** `POST /api/v1/agents/tool-execute` derives identity from
  the session and calls `executeGovernedAction`. The body cannot name owner
  or sandbox root.
- **Proposal-first specialists:** CODE_ENGINEER and RESEARCHER dispatch
  await an LLM proposal (`run*SpecialistViaLlm` → `submitAgentProposal`).
  That path proposes; it does not execute tools. Other specialists still
  use the stub unless they have an override (SECURITY / LEGAL_MEDIA_COMMS).
- **SECURITY / LEGAL gate:** `CASE.EXECUTE` (requires approval) runs
  *before* Sentinel / legal-media. DENY or APPROVAL_REQUIRED → SKIPPED.

## 11 TOOL GOVERNANCE
**Status: COMPLETE** for catalog tools that have a registered implementation.

**Implemented:** dangerous tools stay `requiresApproval` in the existing policy
table. `governed-execution.test.ts` uses catalog-granted `knowledge_search` +
`registerTool`. RESEARCHER catalog includes `fs.read_file`,
`fs.read_directory`, `fs.search_repo` (enforced by
`enforceAgentToolAuthorization`). Live execution of those tools is the
`tool-execute` hop, not specialist dispatch (dispatch remains propose-only).
API startup now registers `knowledge_search`, the read-only filesystem tools,
and `analyze_repo`. Unregistered policy names still fail closed. No second
execution engine.

**Proof reports:** stored as `lastProofReport:${projectId}` (or
`lastProofReport:global` when no project) — not a single shared slot.

## 12 RELIABILITY
**Status: COMPLETE** on the existing worker + governed idempotency path.
Distributed multi-process queue is not required by current architecture.

**Implemented:** Control Plane SIGTERM/SIGINT graceful close.
**Durable job queue with crash recovery:** `queue-persistence.ts` persists
jobs to `.atlas/worker-queue.json`. On startup, `recoverPendingJobs()` loads
interrupted jobs (RUNNING → PENDING). Jobs survive process crashes. Includes
`getQueueStats()`, `cleanupOldJobs()`.
Worker jobs retry up to 3 times with backoff then log `job_permanently_failed`.
LLM providers retry transient HTTP failures up to
`MAX_PROVIDER_CALL_ATTEMPTS` (3). Event-bus dedup is by `event.id`.

**Not claimed:** a separate distributed queue service (not required by the
current single-worker file-backed architecture). In-flight approval recovery
and durable governed idempotency are Phase 06.

## 13 OBSERVABILITY
**Status: COMPLETE** for the existing per-plane stack plus handoff correlation.

**Implemented:** one request id — CP `X-Request-Id`;
`executeGovernedAction.requestId` already correlated. API global rate limit
300/min (`@fastify/rate-limit`) and `http_request_duration_ms` via
`registerRequestTiming`. CP `callAtlasApi` and lifecycle handoff now forward
`X-Request-Id`. Gateway fulfill uses the incoming header when present so
operators can join CP receipt → API execution. No second telemetry stack.

## 14 SELF-AUDIT
**Status: COMPLETE** for detect → propose (no auto-apply, no active probing).

**Implemented:** detect → propose only. `autoApply: false` on every finding. Checks: CP auth, non-canonical audit, DEF-000, agent denials, egress policy presence, MFA/rotation, runtime overlay, CP-does-not-execute-tools, fabric-vs-oversight registry, catalog/registration drift, policy-without-implementation, CP overlay vs API fail-closed, missing observational audit, verification-gap between gateway success and verification observations, expired-but-PENDING records, production runtime-config drift. Active API probing from Control Plane is not claimed. Findings do not mutate agent status or approvals.

## 15 DISASTER RECOVERY
**Status: BLOCKED** on offsite destination. Local restore proof exists.

**Implemented:** copied canonical NDJSON still verifies (restore check).
`runCanonicalAuditRestoreDrill` copies the API NDJSON chain, verifies hash
continuity, and writes a timestamped receipt with `offsite: false`.

**BLOCKED — Owner decision required:** name the offsite backup destination
and credentials (object store / region / retention). Do not claim disaster
recovery from backup existence or local copies alone. Replication and
timed production drills stay blocked until that destination exists.

## 16 SUPPLY-CHAIN / PRODUCTION SECURITY
**Status: BLOCKED** on signing identity. SBOM remains COMPLETE.

**Implemented:** CI `permissions: contents: read`. Secret scan and eval gate already existed.
**SBOM generation:** `pnpm sbom:generate` produces CycloneDX 1.5 SBOM in
`.atlas/sbom/sbom.json` and `.atlas/sbom/sbom.xml`. Scans all package.json files,
generates component list with hashes, purls, licenses, and dependency graph.

**BLOCKED — Owner decision required:** signing identity for release
artifacts (Sigstore / cosign key or identity). Do not add unsigned
ceremony. SBOM generation remains the enforceable supply-chain control.

## 17 GOVERNANCE TEST SUITE
**Status: COMPLETE** for enforcement proofs on the existing engines.

**Implemented:** `apps/api/src/__tests__/governance-invariants.test.ts` and
`apps/control-plane/src/__tests__/governance-invariants.test.ts`
(unauthenticated DENY, customer admin ≠ operator, missing capability, wrong tenant, audit tamper, executed ≠ verified, world-state execution ≠ verification, CP audit non-canonical, self-audit never auto-applies, CP-does-not-execute-tools).
`governed-execution.test.ts` proves QUARANTINED cannot execute.
`create-app.test.ts` and `production-tool-registry.test.ts` prove production tools are registered and unregistered names fail closed.
`gateway-fulfill.test.ts` proves `X-Request-Id` correlation and CP SERVICE quarantine overlay denial.
`self-audit.test.ts` proves detectors stay detect-only.

## 18 PERFORMANCE / SCALE
**Status: COMPLETE** for the existing in-process limits and latency stack.
Redis / autoscaling are not required by current architecture.

**Implemented:**
- **Response cache:** `ResponseCache` LRU with TTL (`response-cache.ts`). Global
  `readCache` for expensive read operations. `cached()` helper for get-or-compute.
- **Performance limits:** `PERFORMANCE_LIMITS` config (`performance-limits.ts`):
  pool size, query timeout, HTTP timeout, LLM timeout, max body, max concurrent
  dispatches, memory warning threshold, batch size. All env-overridable.
- **Memory monitoring:** `getMemoryStats()`, `isMemoryPressureHigh()`.
- **Timeout utilities:** `timeoutSignal()`, `withTimeout()` for wrapping promises.
- **Performance routes:** `/api/v1/performance` dashboard, `/memory`, `/cache`,
  `/cache/clear`, `/health`, `/limits`, `/latency` (p50/p90/p95/p99).
- **Latency tracking:** `http_request_duration_ms` already wired in Stage 13;
  percentile computation added.

**Not claimed:** distributed cache (Redis), auto-scaling, load balancer config,
database connection pooling (external to Node), full APM integration.

## 19 INTELLIGENCE ROADMAP
**Status: COMPLETE** for governed suggestions. Live ML training is BLOCKED.

**Implemented:**
- **Hypothesis engine:** `hypothesis-engine.ts` — create, list, update status,
  add supporting/contradicting evidence, confidence scoring. Stored in osStore.
  Routes at `/api/v1/intelligence/hypotheses`.
- **Golden projects registry:** `golden-projects.ts` — register, list, update
  status/scores, find exemplars by domain. Default: BrokerOS fixture. Routes at
  `/api/v1/intelligence/golden-projects`.
- **Agent marketplace:** `agent-marketplace.ts` — rankings, recommendations by
  task type, agent comparison. Routes at `/api/v1/intelligence/marketplace`.
- **Agent reputation:** Already existed in `agent-reputation.ts` with
  `computeAgentReputation`, `ExpertBattleMetrics`, `AgentRanking`. Routes at
  `/api/v1/intelligence/reputation`.

PSA `recommendFromPsa`, hypothesis engine, marketplace rankings, and
Atlas verdict recommended actions already suggest without executing.
Intelligence may recommend. Governance remains authoritative.

**BLOCKED — Owner decision required:** live reputation/training on
production traffic, including whether any automatic policy modification
is ever permitted (default remains never). Do not add an ungoverned ML
privilege path.

## LATER-SCOPE (not a Phase 02 reopen)

**Ingest execution — BLOCKED.** ADR-022: Control evaluates ingest and does
not execute. Owner must define the authoritative tool / target / artifact
intent. Do not invent `knowledge_search(query = eventId)`.

**Non-`def-000` fulfillment — BLOCKED.** No sibling execute contract exists.
Changing `applicationId` is not fulfillment.

**Sibling / connected-application execution — BLOCKED.** Same missing
contract. Applications remain isolated. Atlas does not become their database.

**Production runtime — COMPLETE** for the existing private-plane artifacts:
`deploy/systemd` for Control, Admin, and Worker; `deploy/verify.sh`;
`docs/deployment/private-plane.md`. User-plane API/web remain Vercel per
ADR-021. Do not merge planes.

**ApprovalExecutionRepository** remains parked / historical.

## PHASE 11 PORTFOLIO GOVERNANCE (observability)

New increment (owner-approved sequence). **Stop after each phase. Wait for Owner approval.**

Full current status, per-phase evidence, and history for all of Phase 11 now
lives in the single authoritative document:
`docs/architecture/ATLAS_MASTER_TRUTH.md` (section "Portfolio Governance
11.1-11.15"). This section is a summary pointer only; it is not the
authoritative source.

**11.1 Foundation / persistence — complete.**
- Separated-plane data model and overlay persistence.
- Safety locks: no ingest, no sibling execution, no Fabric writes, no source
  code copy, no permission inheritance.

**11.2 Application + Source Agent inventory — complete.**
- Owner Portfolio UI is a projection of the Portfolio Governance snapshot.
- Three planes: Atlas Fabric agents ≠ source applications ≠ source agents.
- Duplicate dashboard/admin i18n keys removed; each key exists once per language.
- Source runtime remains UNKNOWN / NOT_PROBED. No FabricAgentId assignment.

**11.3 Capability Extraction — complete.**
- Every capability has semantic fields: purpose, domain, inputs, outputs, tools,
  sideEffects, readAccess, writeAccess, externalCommunication, externalAuthority,
  dependencies, applicationContext.
- Distinguishes physical security (VMS) from software security (SECURITY).
- Classification based on semantic meaning, not just names.

**11.4 Provenance and Evidence — complete (this increment).**
- Provenance enhanced with: sourceApplicationId, extractor, originalStatus, atlasClassification.
- Full 40-char Git SHA for every source agent.
- Evidence ≠ RuntimeStatus explicitly enforced: isRuntimeProbe=false, extractedAt timestamp.
- Evidence kinds extended: SOURCE_CODE, TEST, DOCUMENT, REGISTRY, API_SCHEMA, CONFIGURATION,
  TOOL_REGISTRATION, FACTORY_DEFINITION.
- Authority ranks extended: REPOSITORY_CODE, AUTOMATED_VERIFIED_TEST, ARCHITECTURE_DOCUMENT,
  DEVELOPER_STATEMENT, SOURCE_CODE, TEST_FILE, API_SCHEMA, CONFIGURATION.
- Default source runtime: UNKNOWN / NOT_PROBED. Documentation ≠ OBSERVED_UP.
- 19 Phase 4 provenance/evidence tests.

**11.5-11.15 - implemented, code and tests present in the repository (persistence,
global deduplication, canonical capability mapping, governance decisions,
control-plane alignment tests, security, audit, the 11.13/11.14 QA/sign-off
milestones, and knowledge-ingestion audit). Phase 11.9 Admin UI was deleted
by `4883bfd` and recovered/adapted 2026-09-04 under Option A (Admin →
Control Plane projection). Other 11.5–11.15 items remain IMPLEMENTED —
UNVERIFIED (BLOCKED-ENVIRONMENT) except where Master Truth records a
newer verification level. Authoritative status: ATLAS_MASTER_TRUTH.md
§16/§34/§37. G-3 = CLOSED. 11.5–11.15 = RE-APPROVED.**

### Historical record for Phase 11 - preserved, not erased

On 2026-08-28, commit `82e883e` documented Phase 11.1-11.15 as complete and
owner-approved, with a full specification for each phase written into this
file. 66 minutes later, commit `831410e` removed the 11.5-11.15 detail from
this file and replaced it with the line below, without any corresponding
code change - the 11.5-11.15 code and tests from `82e883e` remain intact
through current HEAD. This was a documentation-only retraction; it was
never technically reversed, and no Owner re-approval of that specific work
has since been recorded in this file.

Original superseded line, kept verbatim for traceability:
> Later (do not start without Owner approval): 11.5 persistence … 11.10 tests.

Current status (2026-09-04): G-3 = CLOSED. 11.5–11.15 = RE-APPROVED.
Recorded in ATLAS_MASTER_TRUTH.md §25/§37. The historical retraction
above remains preserved and is not rewritten.

## OPERATIONAL LIFECYCLE (Decision → Evidence)

Distinct from Portfolio Governance 11.x. Reuses `executeGovernedAction`, live
approvals, and `verification.ts`. Does not replace those engines.

**Implemented:** `apps/api/src/services/governed-lifecycle.ts`
`runGovernedLifecycle` — DENY stops; ALLOW executes only with a validated
authoritative intent via `executeGovernedAction`; REQUIRE_APPROVAL mints the
existing live approval bound to the Phase 9 decision identity.
Control Plane `cp:service` hands the decision to
`POST /api/v1/governance/lifecycle/handoff` after `evaluateSupervisedEvent`.

**Remaining limitation:** Civio observe events (`DOCUMENT.READ`) do not carry
an authoritative tool/target/artifact. Therefore **ALLOW ≠ EXECUTED** on the
Civio path until an execution intent exists. Do not invent
`knowledge_search(query = eventId)`.

**Not claimed:** `/agents/tool-execute` and `/gateway/fulfill` still call
`executeGovernedAction` directly (separate architectural decision).

## PERSONAL SUPERVISING AGENT

**Implemented:** Distinct agent class `PERSONAL_SUPERVISING_AGENT` (not a
Fabric catalog id, not `ORCHESTRATOR`). Stable id `psa:<ownerId>` is a
label only. Authorization is explicit owner / tenant / project /
application scope. Observes existing Control Plane applications, processes,
events, and decisions; pending live approvals; explains from those records;
recommendations/escalations do not execute; user requests enter
`submitAgentProposal`; specialists via `planAgentWork`. Memory uses
`buildMemoryContext`. Disabled/paused PSA cannot dispatch.

Persistence uses `public.personal_supervising_agents` in the existing
database (repository in `@atlas/database`) when Supabase is live, and the
existing local `osStore` (`.atlas/store.json`) otherwise. One PSA per
authorized owner; HTTP sessions only authenticate the owner.

**Not claimed:** Per-user ACL inside the Control Plane process list
(PSA filters declared scope).

## KNOWLEDGE FABRIC GOVERNANCE

**Implemented:** Retrieval converges on `evaluateKnowledgeEligibility`
(owner/tenant/project/application/agent fail-closed). Canonical `source_id`
is bound from the existing allow-list / `knowledge_sources` model, not a
second registry. Unknown authority is ineligible (no `TECHNICAL_ARTICLE`
default). Stale hits require explicit `allowStale`. Source/version pins use
`source_id` + content hash. Live retrieval runs `detectConflict` and returns
`INSUFFICIENT_EVIDENCE` on material conflict. HTTP/kernel search goes
through `executeGovernedAction` (`knowledge_search` / `DOCUMENT.READ`).
Conversation/agent retrieval uses the same eligibility function. Provenance
fields (`sourceId`, `sourceVersion`, `documentId`) attach to hits;
`collectEvidenceRefs` cites them. Unified audit records `knowledge.retrieved`.

Conversation and agent-run retrieval now bind Atlas-self scope from the
authenticated session (`resolveAtlasSurfaceKnowledgeScope`): owner = session
user, tenant = `atlas`, application = `def-000`, agent = `RESEARCHER`.
A requested project is used only when it exists and is owned by the
session; otherwise the path fails closed. Identity is never inferred from
the body.

`match_knowledge_chunks` now filters project-scoped rows by owner / tenant
/ project / application metadata and returns metadata for eligibility.
Unscoped reference rows remain visible. Incomplete scope never queries
pgvector. Historical chunks are not rewritten.

**Not claimed:** Unrestricted web crawl.

## ATLAS SELF-GOVERNANCE

Atlas itself is Managed System `DEF-000`. Mutations that change Atlas
posture reuse the existing identity / policy / risk / live-approval /
live-human / audit path. No second IAM, policy, approval, or audit engine.

**Implemented (code + tests):**
- Canonical identity: `applicationId=def-000`, project
  `00000000-0000-4000-8000-def000000001`, tenant `atlas`, slugs
  `atlas|arletos|atlas-core`. CP actor remains `cp:service`.
- Atlas-self `decide()` enforces separation of duties
  (`decidedBy !== requestedBy`). Ordinary non-self HTTP decide is unchanged.
- Agent enable/disable, kernel `POST /kernel/improve`, and Studio writes to
  the Atlas-self project (id, slug, or same workspaceRoot) mint a live
  approval and execute only via independent live-human
  `{ approvalId, decisionReason }`. Token `?approvalId=` replay cannot
  execute `CONFIGURATION.UPDATE` / `EXECUTE` (HUMAN_ONLY).
- Control Plane `POST /agents/:id/control` no longer calls
  `setAgentRuntimeStatus` directly. Body `approved: true` is ignored for
  `def-000`. Overlay apply requires independently verified approval.
- Gateway `approved: true` in the body is ignored for `def-000`.
- Canonical audit records `input.applicationId=def-000`. After execute,
  `executed: true` does not imply `verified: true`.
- Self-audit remains detect → propose only (`autoApply: false`).

**Remaining limitation:** Control Plane HTTP verifies `approvalId` against
the live API store (`POST /api/v1/approvals/verify-atlas-self`) using the
existing `ATLAS_CONTROL_PLANE_TOKEN` hop. Overlay apply still happens on
the Control Plane agent registry (`setAgentRuntimeStatus`); CP does not
execute tools. Production verifier is fail-closed when the API is unset,
unreachable, or returns anything other than `verified: true`.

**Still deferred:** generic non-Atlas-self HTTP `decide()` SoD.

**Not claimed:** A new policy/approval product; Studio/Admin redesign;
requester self-approval on ordinary (non-Atlas-self) HTTP decide.

