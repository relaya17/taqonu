# ATLAS MASTER TRUTH DOCUMENT

**Status:** Current authoritative implementation/governance document for ATLAS.
**Created:** 2026-09-04
**Supersedes (as execution authority only — none are deleted):** the Portfolio
Governance section of `docs/architecture/remaining-work.md` now points here;
`04-ATLAS_PRODUCTION_READINESS_CHECKLIST.md`, `atlas-gap-analysis-staged-roadmap.md`,
`atlas-master-checklist.md`, `docs/architecture/gap-vs-master-spec.md` remain
preserved as historical/superseded documents (see §22).

**Status vocabulary used throughout this document** (per Owner directive,
2026-09-04): `IMPLEMENTED` · `IMPLEMENTED — UNVERIFIED` · `TESTED` ·
`TESTED — PASS` · `RUNTIME VERIFIED` · `PARTIAL` · `REGRESSION` · `MISSING` ·
`BLOCKED-ENVIRONMENT` · `OWNER DECISION REQUIRED` · `SUPERSEDED`.
"Done"/"complete" are never used unqualified in this document.

---

## 1. ATLAS Mission

Atlas is a governed-execution kernel: a single controlled path through which
agentic actions are authorized, risk-assessed, approved where required,
executed, verified, and audited — plus an oversight layer (Control Plane)
and a static observability layer (Portfolio Governance) over a portfolio of
sibling applications, without Atlas ever executing those sibling
applications' code.

## 2. Target Architecture

Three separate planes (ADR-022):
1. **Fabric runtime** — `FABRIC_AGENT_CATALOG` → identity → `executeGovernedAction`.
2. **Control Plane oversight** — evaluate-only; legacy `GET /api/v1/agents` plus
   a non-executable fabric projection.
3. **Portfolio Governance inventory** — static, provenance-complete, overlay-
   persisted; no ingest, no sibling execution.

## 3. Current Architecture

Matches target. One governed-execution spine:
`executeGovernedAction` (`apps/api/src/services/governed-execution.ts:366`) →
`executeTool` (`packages/agent-core/src/tools/runtime.ts:293`, exactly one
production call site, at `governed-execution.ts:507`). `dispatchAgentAction`
(`apps/api/src/services/agent-dispatch-guard.ts:321`) routes into this spine.
`verifyProposal` (`packages/agent-core/src/verifier/verify-proposal.ts:292`)
and `apps/api/src/services/audit-log.ts` are each singular — no duplicates
found anywhere in this repository across this entire investigation.
**Status: IMPLEMENTED — UNVERIFIED** (architecture confirmed by static
inspection across multiple audit passes; no independent test execution
performed in this environment).

## 4. Repository Baseline

- `apps/`: admin, api, control-plane, web, worker
- `packages/`: agent-core, code-intelligence, config, database, embeddings,
  engineering-loop, experts, integrations, knowledge, observability, observer,
  qa-core, shared, state, synthetic-universe, system-model
- `docs/`: adr, agent, architecture, atlas, case-studies, deployment, github,
  integrations, memory, multi-tenant-design.md, security, strategy,
  verification, web-research
- `scripts/`: dev-surfaces.mjs, generate-sbom.ts, snapshot-civio-knowledge.mjs,
  vercel-bundle-smoke.mjs
- `supabase/migrations/`: 15 files
- `.github/workflows/`: ci.yml, e2e-critical-path.yml

## 5. Git Baseline

- **Branch:** `main`
- **HEAD:** `4b2bb745346924b825f12e6adde339dc24b08529`
- **HEAD message:** `feat(synthetic): add sandboxed business universe and recovery loop`
- **HEAD date:** 2026-09-04 17:23:19 +0300
- **Worktree at time of this document's creation:** clean prior to this
  reconciliation batch (test-label and roadmap edits + this file are the
  only changes in the current working tree).

## 6. Canonical Execution Architecture

`executeGovernedAction → executeTool` is the only production execution path.
It carries identity → policy → risk → approval → artifact-integrity →
execution → verification → audit through every governed action. No
alternate or parallel execution path was found. The legacy
`ApprovalExecutionRepository` ("Unit 2") is explicitly parked per ADR-023
(`83ed006`) and lint-guarded against reactivation (`c55198c`) — see §14.
**Status: IMPLEMENTED — UNVERIFIED.**

## 7. Control Plane

Evaluate-only; never executes tools. `apps/control-plane/src/services/fabric-projection.ts`
is an explicitly non-executable projection of `FABRIC_AGENT_CATALOG`
("This is NOT an execution registry and MUST NOT become one" — file's own
header comment). Its test file's Portfolio-Governance-phase label has been
corrected this cycle (see §22). **Status: IMPLEMENTED — UNVERIFIED.**

## 8. Identity / Authorization

- Tool-call authorization: `authorizeToolCall`,
  `packages/agent-core/src/policies/authorization.ts`
- Entity-action authorization: `authorizeEntityAction`,
  `packages/agent-core/src/policies/entity-policies.ts`
- Entity-write enforcement: `enforceEntityWrite`,
  `apps/api/src/services/risk-audit.ts`

**Status: IMPLEMENTED — UNVERIFIED.**

## 9. Security

- Filesystem path containment: `realpathSync` two-stage canonicalization in
  `packages/agent-core/src/tools/runtime.ts` (`canonicalRoot`/`canonicalTarget`),
  confirmed present by direct grep against current HEAD.
- Walk/scan bounds: `MAX_WALK_DEPTH = 12`, `MAX_SCAN_FILES = 20_000` in
  `packages/agent-core/src/tools/fs-tools.ts`, confirmed present.
- Portfolio Governance invariant guards (`packages/shared/src/portfolio/index.ts`):
  `sourceWriteNeverInherited`, `atlasPermissionsNeverFromSource`,
  `sourceCodeNeverCopied`, `knowledgeNeverIngestedInRecords`,
  `fabricRefsAreNotAnExecutionRegistry`, `verificationDistinctFromRuntime`.
- Portfolio Governance Security test suite: exactly 33 `it()` blocks
  (`packages/shared/src/portfolio/security.test.ts`, Phase 11.11).

**Status: IMPLEMENTED — UNVERIFIED** (static presence confirmed; no test run).

## 10. Audit

`apps/api/src/services/audit-log.ts` is singular (no duplicate audit paths
found). Portfolio Governance Audit test suite: exactly 25 `it()` blocks
(`packages/shared/src/portfolio/audit.test.ts`, Phase 11.12). Synthetic
Universe carries its own canonical NDJSON audit
(`packages/synthetic-universe/src/audit.ts`), architecturally separate from
the production audit log by design (sandbox isolation).
**Status: IMPLEMENTED — UNVERIFIED.**

## 11. Verification / QA

`verifyProposal` is the singular verification entry point. QA/TEST_ENGINEER
are two of the 16 `FABRIC_AGENT_CATALOG` agents; most catalog agents are
stubbed except CODE_ENGINEER and RESEARCHER, which dispatch through a real
LLM proposal path. The PASS/FAIL/BLOCKED discipline (never label anything
PASS without actual execution evidence) is the standing convention this
document also follows. **Status: IMPLEMENTED — UNVERIFIED** for the
verification machinery itself; **BLOCKED-ENVIRONMENT** for exercising it in
this session (see §19).

## 12. Agent Governance

`FABRIC_AGENT_CATALOG` (`packages/shared/src/constants/agents.ts`): 16
`FABRIC_AGENT_IDS` (ORCHESTRATOR, ARCHITECT, CODE_ENGINEER, DEBUGGER, QA,
TEST_ENGINEER, SECURITY, ACCESSIBILITY, UI_UX, DEVOPS, RESEARCHER,
OMISSION_DETECTOR, LEGAL_MEDIA_COMMS, JUDGE, ADVERSARY, DATABASE), each with
`specialty`, `category`, `cognitiveRole`, `allowedTools`/`forbiddenTools`,
`evidenceRequirements`, `maxCostUsd`, `timeoutMs`, `riskLevel`,
`canWriteCode`, `evaluationSuite`, `cannotSelfValidate`, localized (en/he/ar)
strengths/weaknesses. No new agents were created and none should be without
a genuine gap (§24). **Status: IMPLEMENTED — UNVERIFIED.**

## 13. Memory / Knowledge

`packages/shared/src/portfolio/seed.ts` `knowledgeRecords` array: exactly 5
entries with `ingested: true` (4 BrokerOS/LexStudy engineering-pattern
records + 1 Civio "Verified Civic Rights Snapshot," the latter added by
later, separate Civio-integration commits). `ingestedKnowledgeCount` /
`knowledgeIngested` computed in `packages/shared/src/portfolio/index.ts`.
This is Phase 11.15 (§16). Broader `docs/memory/` content was inventoried in
a prior audit pass but not re-examined this cycle.
**Status: IMPLEMENTED — UNVERIFIED.**

## 14. Reliability / Disaster Recovery

Read-through performed 2026-09-04 (supersedes the grep-only pass):

- **Durable job queue with crash recovery** (`apps/worker/src/queue-persistence.ts`,
  197 lines, read in full): jobs are persisted to `.atlas/worker-queue.json`
  via atomic temp-file + rename; `loadPendingJobs()` resets any job stuck
  `RUNNING` back to `PENDING` on startup (crash recovery); `updateJobRetry`
  implements retry with `nextAttemptAt` backoff; `cleanupOldJobs` bounds
  file growth. `apps/worker/src/index.ts` calls `recoverPendingJobs()` on
  startup and logs `queue_recovery`. **This is real, not aspirational** —
  confirmed by reading the code, not just its name.
- **Claim-based execution idempotency** (`apps/api/src/services/governed-claimed-execution.ts`,
  `claimOrResume`, read in full): checks persisted approval-request status
  (`FULFILLED`/`FAILED`/`OUTCOME_UNKNOWN` → do not redo; `CLAIMED` with a
  persisted `executionStartedAt` → resume, do not restart) before doing any
  work. An in-memory `startClaims` Set is only a same-process fast path; the
  authoritative check is the persisted record, so this survives a process
  restart correctly.
- **Automation engine idempotency** (`apps/api/src/services/automation-engine.ts`,
  read in full): `claimIdempotencyKey` is an **in-memory, process-local**
  bounded FIFO (`firedIdempotencyKeys`, 1000-entry cap) — explicitly a
  backstop over an already-idempotent underlying action per its own doc
  comment, not a durable dedup store. **Caveat, not a defect**: this
  specific backstop does not survive a process restart; the action it
  guards is stated to be idempotent on its own.
- **Store-level durability** (per `docs/strategy/living-request-tracker.md`,
  2026-08-12 entry, itself citing exact code): `apps/api/src/store/store-io.ts`
  does atomic temp→rename writes with a `.bak` file, optional
  `ATLAS_STORE_BACKUP_INTERVAL_MS` heartbeat backups, dual-write to
  Supabase for decisions/account_plans, and cloud-hydrate on startup when
  local state is empty. Not independently re-verified by me this cycle;
  cited as existing, code-referenced evidence from a prior audit trail.
- **Explicitly NOT implemented**, per `docs/verification/ATLAS_VERIFICATION_REPORT_2026-08-28.md`
  line 191: "Backup product / offsite replication — NOT IMPLEMENTED — NDJSON
  restore check only." Multi-region HA is noted in the same tracker as an
  accepted residual gap, not a claimed capability.

**Status: IMPLEMENTED — UNVERIFIED** for durable job-queue crash recovery
and claim-based execution idempotency (both read in full this cycle);
**IMPLEMENTED — UNVERIFIED, process-local only** for automation-engine's
backstop dedup; **MISSING**, honestly and pre-existingly documented as such,
for offsite backup/replication and multi-region HA.

## 15. Supply Chain

`scripts/generate-sbom.ts` exists (`pnpm sbom:generate` → `tsx
scripts/generate-sbom.ts`, CycloneDX 1.5 output). Execution attempted
2026-09-04: `node_modules/.bin/tsx scripts/generate-sbom.ts` fails with
`Cannot find module 'esbuild'`.

**Root cause confirmed, not just observed:** `node_modules/.pnpm/` on this
repository contains only `@esbuild+win32-x64` platform packages — this
repository's `node_modules` was installed by `pnpm` on your Windows
machine, which correctly fetched the Windows-only native esbuild binary.
This Linux VM bridge has no matching Linux binary and cannot substitute
one. **This is purely a platform/environment mismatch, confirmed by direct
inspection of the installed platform packages — not a code defect, and not
something a code change could fix.** Resolves automatically the moment this
command runs on your actual Windows machine (native execution, §19).

**Status: IMPLEMENTED — TEST VERIFIED (native Windows, 2026-09-04).**
`pnpm sbom:generate` produced CycloneDX 1.5 at `.atlas/sbom/sbom.json` and
`.atlas/sbom/sbom.xml` (101 components). `.atlas/` is gitignored — artifacts
are local evidence, not committed. The earlier Linux-bridge esbuild miss is
closed for this host. See §35.

## 16. Portfolio Governance 11.1–11.15

| Phase | Historical Impl. | Current Code | Tests | Test Execution | Runtime Verif. | Current Doc | Current Status |
|---|---|---|---|---|---|---|---|
| 11.1 Foundation/persistence | `82e883e` | present (`portfolio-governance-store.ts`) | present | BLOCKED-ENVIRONMENT | none | remaining-work.md: complete | IMPLEMENTED — UNVERIFIED |
| 11.2 App/Source Agent inventory | `82e883e` | present | present | BLOCKED-ENVIRONMENT | none | remaining-work.md: complete | IMPLEMENTED — UNVERIFIED |
| 11.3 Capability Extraction | `82e883e` | present | present | BLOCKED-ENVIRONMENT | none | remaining-work.md: complete | IMPLEMENTED — UNVERIFIED |
| 11.4 Provenance and Evidence | `82e883e` | present | present (label now correct after this cycle's fix, see §22) | BLOCKED-ENVIRONMENT | none | remaining-work.md: complete | IMPLEMENTED — UNVERIFIED |
| 11.5 Persistence & Data Layer | `82e883e` | present (`portfolio-governance-store.ts` + `.test.ts`, 10+ cases) | present | BLOCKED-ENVIRONMENT | none | now pointed here (§22) | IMPLEMENTED — UNVERIFIED; G-3 RE-APPROVED as current governance state (§37). Re-approval does not change this row's verification level. |
| 11.6 Global Deduplication | `82e883e` | present (`deduplication.test.ts`, 43 DedupRelation records) | present, correctly labeled | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.7 Canonical Capability Mapping | `82e883e` | present | present | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.8 Governance Decisions | `82e883e` | present (`seed.ts:2440`) | present; `governance-decisions.test.ts` correctly labeled, plus `index.test.ts` label corrected this cycle (§22) | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.9 Portfolio UI Interface | `82e883e` | **RECOVERED / ADAPTED (Option A)** — historical UI lived in `apps/admin/src/owner-html.ts` + `owner-html.test.ts` (`82e883e`), deleted as collateral damage by `4883bfd` (ADR-021 admin restructure). Recovered 2026-09-04 as a new Admin surface (`/portfolio`) that reads Control Plane `GET /api/v1/portfolio-governance` (`getControlPlanePortfolioView()`), not the tenant API. Tenant API `GET/POST /api/v1/portfolio-governance` remains behind `requireOperator` / `requireOwner` → `requireUser` (Supabase JWT / session). No static-token exception was added to `requireUser`. Writes stay on the tenant API; Admin is read-only. | restored: `portfolio-html.test.ts`, `portfolio-projection.test.ts`, `portfolio-route.test.ts`, `portfolio-option-a.runtime.test.ts` (plus existing Admin auth / platform HTML / API portfolio / CP alignment tests) | **PASS** this cycle (`pnpm --filter @atlas/admin test` 21/21; API portfolio+auth 15/15; CP alignment/auth/api/dashboard 68/68) | **PASS** for Admin → Control Plane on ephemeral in-process HTTP servers (`portfolio-option-a.runtime.test.ts`). Default ports `:3200` / `:3100` / `:4000` were not listening. | now pointed here | **IMPLEMENTED — RUNTIME VERIFIED** (Admin → Control Plane projection). Historical deletion record preserved in §23. Selected auth model = Option A (§33, §34). |
| 11.10 Control Plane alignment tests | `82e883e` | present (17 numbered cases, 5 groups) | present | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.11 Security | `82e883e` | present | present, exactly 33 `it()` blocks | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.12 Audit | `82e883e` | present | present, exactly 25 `it()` blocks | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.13 Full Testing sign-off | `82e883e` | n/a — milestone marker by design | n/a by design | n/a | n/a | now pointed here | correctly has no dedicated code |
| 11.14 Final Approval sign-off | `82e883e` | n/a — milestone marker by design | n/a by design | n/a | n/a | now pointed here | correctly has no dedicated code |
| 11.15 Knowledge ingestion audit | `82e883e` | present (`seed.ts:2662,2709`; 5 `ingested:true` records) | present | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |

**Non-phase claim, corrected this cycle:** `fabric-projection.test.ts` previously
mislabeled itself "Phase 11.6"; it is unrelated ADR-022 "Decision, Plane 2"
work and was never assigned a Portfolio Governance phase number in the
original spec. Label corrected, no test behavior changed (§22).

## 17. Synthetic Universe

Sandboxed closed-loop simulation: failure injection → diagnosis →
remediation planning → recovery verification. Package:
`packages/synthetic-universe/` (added at HEAD `4b2bb74`, 34 files, 3336
insertions). API integration: `apps/api/src/routes/synthetic-universe.ts`,
`apps/api/src/services/synthetic-universe-run.ts`. Exports confirmed
correct: `runClosedLoop`/`ClosedLoopResult` (and all other symbols the API
consumes) are present in `packages/synthetic-universe/src/index.ts` and
match consumer usage exactly.

- **Sandboxing:** explicit doc-comment in `closed-loop.ts` — "Does not call
  `executeGovernedAction` or mutate `FABRIC_AGENT_CATALOG`." Enforced via
  `SandboxPolicyError` / `simulateExternal` vs `attemptRealExternal`.
- **Business entities / event model:** `catalog.ts`, `events.ts`, `types.ts`,
  `tenant.ts`.
- **Recovery loop:** `runner.ts` (602 lines), `remediation.ts`, `diagnosis.ts`.
- **Verification model:** `assertions.ts`, `evidence.ts`.
- **Relationship to governed execution:** architecturally separate and
  isolated by design; does not participate in the production spine (§6).
- **Production/non-production boundary:** `TEST-*` isolated scenario IDs per
  the HEAD commit message; policy module `policy.ts` and `authorization.ts`
  gate what a scenario may do.

**Verification:** Owner-reported 34/34 package tests, 12/12 API tests, two
passing typechecks. **This report has not independently reproduced that
execution** — BLOCKED-ENVIRONMENT applies here exactly as it does to every
other subsystem (§19). **Status: IMPLEMENTED — UNVERIFIED (by me); Owner-
reported RUNTIME VERIFIED, not independently confirmed.**

**Documentation gap closed by this document:** Synthetic Universe was
previously absent from every roadmap document. It is now represented here.
`remaining-work.md` was last edited 2026-09-03, one day before this
capability's commit landed, which is why its absence there was lag, not
error.

## 18. Existing Implementations (cross-reference)

Governed execution spine (§6), Control Plane oversight (§7), Portfolio
Governance inventory (§16), Synthetic Universe (§17), FABRIC_AGENT_CATALOG
(§12), legacy parked `ApprovalExecutionRepository` (§14) — all confirmed
present, none duplicated in production. No existing implementation was
rebuilt or replaced by this document's creation.

## 19. Verification Status

No test, typecheck, lint, or build command has been successfully executed
against this repository from this environment, in this session or the prior
one. Root cause, reproduced fresh on 2026-09-04: this Linux VM bridge cannot
resolve the Windows/pnpm-managed `node_modules` layout for this project —
`timeout 20 node_modules/.bin/vitest --version` fails with
`Cannot find module '.../node_modules/vitest/vitest.mjs'` (`MODULE_NOT_FOUND`).
Earlier attempts against `@atlas/*` workspace symlinks failed with `EIO`.
**Every "IMPLEMENTED — UNVERIFIED" status in this document reflects that
specific, reproduced, environmental limitation — not test failure, not
absence of tests, and not fabricated success.** Levels 3–6 verification
(§27) require the Owner to run the commands in §19a on their native Windows
terminal.

### 19a. Commands needed for native verification (not run by me)

```
pnpm install
pnpm --filter @atlas/shared typecheck && pnpm --filter @atlas/shared test
pnpm --filter @atlas/agent-core typecheck && pnpm --filter @atlas/agent-core test
pnpm --filter @atlas/api typecheck && pnpm --filter @atlas/api test
pnpm --filter @atlas/control-plane typecheck && pnpm --filter @atlas/control-plane test
pnpm --filter @atlas/synthetic-universe typecheck && pnpm --filter @atlas/synthetic-universe test
pnpm --filter @atlas/admin typecheck && pnpm --filter @atlas/admin test
pnpm lint
pnpm build
```

## 20. Historical Decisions

ADR-001 through ADR-020: first added 2026-08-12 00:31:36. ADR-021: 2026-08-26
20:59:36 (Admin as platform supervisor over Control and Studio). ADR-022:
2026-08-28 20:54:33 (Portfolio Governance). ADR-023: 2026-09-03 01:42:15
(park `ApprovalExecutionRepository`). Portfolio Governance chain: `82e883e`
(2026-08-28 20:54:33, wrote full 11.1–11.15 spec) → `831410e` (2026-08-28
22:00:30, retracted 11.5–11.15 doc text only, 66 minutes later, same author)
→ `4883bfd` (2026-09-02, unrelated admin restructure, collaterally deleted
11.9's Admin UI).

## 21. Superseded Decisions

The 2026-08-28 22:00:30 documentation retraction (`831410e`) is superseded
**as a technical description of the code** by this document (§16) — the
code it described as "not started" was, in fact, already committed by the
same author 66 minutes earlier and has never been removed. It is **not**
superseded as a historical record: §16 and `remaining-work.md` both preserve
it verbatim per Owner instruction (§2.4 of the directive — never rewrite
history).

On 2026-09-04 the Owner recorded G-3: RE-APPROVE 11.5–11.15 as the current
governance state (§37). That decision supersedes `831410e` **as the current
Owner approval status**. It does not delete or rewrite `831410e`, this
section, §16's historical implementation column, or `remaining-work.md`'s
preserved retraction line.

## 22. Documentation Reconciliation

**Current authoritative document:** this file.

**Historical documents (preserved, unedited, superseded as execution authority):**
- `04-ATLAS_PRODUCTION_READINESS_CHECKLIST.md` (frozen `913a27c`, 2026-08-24;
  only Phases 0–6 ever audited; internally self-contradictory on Phase 4 —
  summary table says `realpathSync` containment is VERIFIED, detailed prose
  says it's open; the table is correct, per §9 above)
- `atlas-gap-analysis-staged-roadmap.md` (frozen `544a29a`, 2026-08-19)
- `atlas-master-checklist.md` (frozen `e9d03ce`, 2026-08-19, Hebrew)
- `docs/architecture/gap-vs-master-spec.md` (frozen `3c2c6bc`, 2026-08-12;
  references an external "Master Spec §0–107" not present in the repo)

**Changed this cycle:**
- `docs/architecture/remaining-work.md` — Portfolio Governance section
  trimmed to a pointer at this document, with the 2026-08-28 rollback
  preserved verbatim as a historical record (§21).
- `packages/shared/src/portfolio/index.test.ts` — describe label
  `"portfolio governance decisions (Phase 11.4)"` → `"...(Phase 11.8)"`.
  Text only; no assertions changed.
- `apps/control-plane/src/__tests__/fabric-projection.test.ts` — describe
  label `"...(Phase 11.6)"` → `"...(ADR-022 Decision, Plane 2 - not a
  numbered Portfolio Governance phase)"`. Text only; no assertions changed.

**Remaining documentation drift:** none identified beyond what is recorded
here and in §16/§24.

## 23. Regressions

**Phase 11.9 — Portfolio Governance Admin UI.** Implemented and tested in
`82e883e` (`apps/admin/src/owner-html.test.ts`,
`it("renders capabilities and decisions in Phase 11.9", ...)`). Deleted as
collateral damage by `4883bfd` (2026-09-02, ADR-021 admin restructure:
`owner-html.ts`/`owner-html.test.ts` removed, replaced by
`platform-html.ts`/`platform-overview.ts`, which contain zero
capability/decision/portfolio inventory). Identified as a regression on
2026-09-04. Recovered/adapted the same day under Option A (Admin → Control
Plane → shared seed/overlay projection). The present implementation is a
recovery of the historical feature, not a claim that `4883bfd` never
deleted it.

**Recovery investigation performed 2026-09-04:** the rendering logic
(`renderOwnerHtml`'s portfolio-specific helpers, `packages/shared`-compatible
field names, i18n keys for he/en/ar) was recovered from
`git show 4883bfd^:apps/admin/src/owner-html.ts`. The old fetch/auth blob
was **not** restored: Admin now reuses `fetchSupervisedJson` +
`ATLAS_CONTROL_PLANE_TOKEN` against Control Plane
`GET /api/v1/portfolio-governance`. Tenant API authorization
(`requireOperator` / `requireOwner` → `requireUser`) was left unchanged.

## 24. True Remaining Work (P0–P3)

| Gap ID | Capability | Current state | Missing component | Reason missing | Dependencies | Risk | Priority | Verification required | Definition of Done |
|---|---|---|---|---|---|---|---|---|---|
| G-1 | Native test/typecheck execution | **Closed this cycle (native Windows).** After the §36 remediation queue: `pnpm test` 47/47 PASS (includes `@atlas/api` 1118/1118 and `memory-pipeline.test.ts` 16/16), `pnpm typecheck` 53/53 PASS. Same host also recorded `pnpm build` 30/30 PASS (includes `@atlas/web`) and `pnpm lint` 46/46 PASS. `@atlas/worker` still has no `package.json` `test` script (unchanged; not a turbo failure). See §35–§36. | none outstanding for the G-1 DoD | Gate leftovers were test isolation, unused lint symbols, and the shared/node client boundary | none | Low — native commands now green in one shot | **closed** | Re-run the four root scripts after any later change | Full `pnpm test` green + typecheck green |
| G-2 | Phase 11.9 Admin UI | **Closed this cycle** — recovered/adapted under Option A (Admin → Control Plane projection). Tenant API `requireUser` / `requireOperator` / `requireOwner` unchanged. See §16, §23, §33, §34. | none outstanding for the selected model | Historical UI deleted by `4883bfd`; recovered 2026-09-04 | Owner chose Option A | Medium if a later cycle reopens Option B (static-token API exception) — that remains forbidden | **closed** | Admin tests 21/21; API portfolio+auth 15/15; CP 68/68; Admin→CP runtime on ephemeral HTTP servers | Auth model decided → feature implemented → tests pass → runtime-verified on in-process servers → documented. Default `:3200`/`:3100`/`:4000` daemons were not running. |
| G-3 | Owner re-approval of 11.5–11.15 | **Closed this cycle.** Owner RE-APPROVED 11.5–11.15 as the current authoritative governance state (2026-09-04). Confirms the existing implementation and Master Truth technical wording. Does not authorize rebuild or change verification levels. `831410e` remains as historical record. See §21, §25, §37. | none | Documentation-only Owner decision now recorded | none | Low | **closed** | Decision present in Master Truth with metadata schema; historical records intact | Owner decision recorded with the §28/§29 metadata schema |
| G-4 | SBOM script execution evidence | **Closed this cycle** — `pnpm sbom:generate` PASS on native Windows; 101 CycloneDX 1.5 components written under `.atlas/sbom/`. | none | Previous miss was Linux-bridge esbuild only | none | Low | **closed** | Artifacts reviewed locally (gitignored) | Command PASS + files exist |
| G-5 | Reliability/DR documentation | **Closed this cycle** — full read-through performed (not grep-only): durable job-queue crash recovery (`apps/worker/src/queue-persistence.ts`) and claim-based execution idempotency (`governed-claimed-execution.ts`) both confirmed real and durable; automation-engine dedup confirmed process-local only (documented caveat, not a defect); store-level atomic-write durability cited from a prior code-verified audit trail (`living-request-tracker.md`). Offsite backup/replication and multi-region HA confirmed MISSING by a prior, pre-existing, honestly-labeled audit (`ATLAS_VERIFICATION_REPORT_2026-08-28.md`) — not newly discovered here, not silently adopted as a new gap either. | Independent re-verification via actual test execution (still BLOCKED-ENVIRONMENT); a decision on whether offsite backup/replication is in scope for the current stage | None outstanding from this cycle's investigation depth | native test execution (for re-verification only) | Low — code read directly, not inferred | **P3** (was P2; downgraded now that real evidence closes most of the open question) | Native test execution of `apps/worker` once available | §14 now carries evidence-based status per mechanism instead of a grep-only placeholder |

No other gap is asserted. Old-roadmap unchecked boxes that current code and
tests already satisfy are **not** listed here (per directive §10, "do not
manufacture gaps").

## 25. Owner Decisions

1. **Owner re-approval of 11.5–11.15 (G-3).** **Decided: RE-APPROVE.**
   Owner decision 2026-09-04 formally re-approves Portfolio Governance
   11.5–11.15 as the current authoritative governance state. This confirms
   the existing implementation and the technical wording already in this
   document. It does not authorize a rebuild, new code, or a change of
   verification level. Historical retraction `831410e` is preserved
   (§20, §21). Full metadata: §37.
2. **Phase 11.9 Admin UI auth model (G-2).** **Decided: Option A.**
   Owner execution directive 2026-09-04 selected
   `Admin → Control Plane → Portfolio Governance API` as the trust
   boundary, with the explicit prohibition on weakening `requireUser` /
   adding a static-token API exception. Implemented the same day: Admin
   reads Control Plane's existing `GET /api/v1/portfolio-governance`
   (shared seed + `.atlas/portfolio-governance.json` overlay). Control
   Plane does **not** HTTP-forward to the tenant API. Writes remain
   `POST /api/v1/portfolio-governance/decisions` on the tenant API
   behind `requireOwner`. Options B and C were not implemented. See §33
   and §34.
3. Whether to schedule native test/typecheck execution (G-1) before any
   further code is written or committed, given §16 of the directive:
   "Never claim Level 5 or Level 6 based only on Level 1–3 evidence."
4. Whether `04-ATLAS_PRODUCTION_READINESS_CHECKLIST.md` becomes formally
   HISTORICAL in status or stays under active maintenance.
5. Whether to keep or eventually retire the parked legacy
   `ApprovalExecutionRepository` (§14) — no action taken, none required now.
6. Whether to run the SBOM script and review supply-chain evidence (G-4).
7. Whether to commission a Reliability/DR audit pass (G-5).

## 26. Final Implementation Order

Per the directive's §20: **Phase A** (this document) — done this cycle.
**Phase B** (repair inconsistencies) — the test-label and `remaining-
work.md` fixes are done this cycle; Synthetic Universe documentation
integration is done (§17). **Phase C** (11.9 recovery) — **executed this cycle under Option A**
(§16, §23, §34). Native Admin/API/CP tests ran in this Windows
environment; default daemon ports were not listening. **Phase D** (gap matrix) — done
this cycle (§24). **Phase E** (build P0/P1) — Phase C (11.9) is no longer waiting;
G-1 native `pnpm test` / `pnpm typecheck` are now green (§36). **Phase F**
(finalize) — this document updated for 11.9 (§34), the §36 remediations,
and G-3 Owner re-approval (§37).

## 27. Verification Gates

Level 1 (static inspection) and Level 2 (typecheck/lint/build *by reading*,
not executing) evidence underlies every "IMPLEMENTED" status in this
document. **Exception this cycle — Phase 11.9 Option A:** Level 3 Admin/
API/CP tests were executed on this Windows host, and Level 5 Admin →
Control Plane runtime was executed on ephemeral in-process HTTP servers
(§34). Default daemon ports `:3200` / `:3100` / `:4000` were not
listening. Level 6 (production-readiness) is **not** claimed. Other
areas remain at the earlier Level 1–2 evidence unless separately marked.

## 28. Build Protocol

Standing template for all future substantive changes:
`Decision → Authorization → Build Protocol → Implementation → Tests →
Runtime Verification → Commit → Documentation Update → Current Status`.

**Applied to this cycle's own changes:**

| Field | Value |
|---|---|
| Decision ID | none assigned (pre-dates the metadata schema) |
| Date | 2026-09-04 |
| Owner | Arlet (directive author) |
| Scope | Create Master Truth doc; correct 2 test labels; reconcile `remaining-work.md` Portfolio Governance section |
| Reason | Close documentation drift identified across this session's audits |
| Affected components | 1 new doc, 2 test files (labels only), 1 existing doc |
| Authorized actions | Documentation creation/reconciliation, non-behavioral test-label correction |
| Forbidden actions | Rebuilding 11.9, new P0/P1 feature code, deleting any historical document |
| Expected verification | Level 1 (static) only — this is a documentation/label change |
| Actual result | Static verification passed (grep-confirmed unique matches before/after each edit) |
| Verification date | 2026-09-04 |
| Commit SHA | recorded in the final report returned with this document |
| Supersedes | `remaining-work.md`'s Portfolio Governance section as execution authority (not as historical record) |
| Status | IMPLEMENTED — UNVERIFIED at Level 3+ (documentation/label change; no runtime behavior to verify) |

## 29. Documentation Protocol

Going forward: this document is the single current authoritative source for
architecture, governance, and Portfolio Governance/Synthetic Universe
status. `remaining-work.md` stays execution-oriented and concise, pointing
here rather than duplicating content. The four historical documents (§22)
are never edited to "look current" — new findings are recorded here
instead. Every future major decision should use the §15-of-directive
metadata schema (Decision ID, Date, Owner, Scope, Reason, Affected
Components, Authorized/Forbidden Actions, Expected/Actual Verification,
Verification Date, Commit SHA, Documentation Updated, Supersedes, Status).

## 30. Definition of Done

Applied honestly to this cycle's own output:
implementation exists — yes (this document + 2 label fixes + roadmap
pointer); tests exist — n/a (documentation); tests pass — n/a; typecheck/
build passes — not attempted, BLOCKED-ENVIRONMENT; runtime behavior
verified — n/a (no runtime behavior introduced); security/governance
verified — n/a; Git commit exists — yes, see final report; documentation
updated — yes, this is the update; Master Truth Document updated — this
is its creation; current status recorded — yes (§16, §24, §25).

## 31. Required Agent Reporting Format

Every future execution cycle against this repository should return the
A–P report structure defined in the Owner's 2026-09-04 directive §22, plus
the REQUIRED FINAL STATUS FORMAT block from the 2026-09-04 reconciliation
directive. Both are reproduced in full in the chat response accompanying
this document's creation, and are not duplicated here to avoid drift
between two copies of the same template.

---

## 32. G-8 — Remaining Stage Verification (2026-09-04)

| Area | Status | Evidence |
|---|---|---|
| Execution Safety | IMPLEMENTED — UNVERIFIED | `realpathSync` two-stage path containment + `MAX_WALK_DEPTH`/`MAX_SCAN_FILES` bounds in `packages/agent-core/src/tools/runtime.ts`/`fs-tools.ts` (§9, confirmed in earlier audits, not re-read this cycle) |
| Egress | IMPLEMENTED — UNVERIFIED | `apps/api/src/services/egress-gate.ts`: `assertLlmEgressAllowed` calls `decideEgress` (data-class + destination → ALLOW/DENY/REQUIRE_APPROVAL) and audit-logs every decision via `appendUnifiedAuditEntry`; used by `control-plane-bridge.ts`. Read directly this cycle. |
| Agent Governance | IMPLEMENTED — UNVERIFIED | Unchanged from §12 — 16-agent `FABRIC_AGENT_CATALOG`, not re-investigated this cycle (no new evidence needed) |
| Reliability | IMPLEMENTED — TEST VERIFIED for worker retry/dead-letter (7/7 via `pnpm exec vitest run` in `apps/worker`). `queue-persistence.ts` still has no dedicated test file. Process-local automation dedup caveat unchanged. | See §14, §35 |
| DR | PARTIAL — durable job-queue recovery IMPLEMENTED; offsite backup/replication and multi-region HA confirmed MISSING by a prior, pre-existing audit (`ATLAS_VERIFICATION_REPORT_2026-08-28.md`) | See §14 |
| Supply Chain | IMPLEMENTED — TEST VERIFIED (`pnpm sbom:generate` PASS, 101 CycloneDX components under `.atlas/sbom/`) | See §15, §35 |
| Intelligence (RAG/knowledge layer) | IMPLEMENTED — UNVERIFIED | `packages/embeddings/src` (provider abstraction) and `packages/knowledge/src/{fabric,ranking,verification}` confirmed present by directory listing this cycle; contents not read in depth — no claim beyond "exists with that structure" |

No area above was found MISSING outright except the specific, already-
documented DR sub-items (offsite backup/replication, multi-region HA),
which were already honestly marked as gaps by a prior audit rather than
newly discovered here.

## 33. Phase 11.9 — Authentication Options (detailed analysis, 2026-09-04)

Owner selected **Option A** on 2026-09-04 and it was implemented the same
day (§34). Options B and C remain recorded here as the rejected
alternatives. The analysis below is the pre-decision text; do not read
"no code was written" as current status.

### Option A — Route through Control Plane (projection endpoint)

Add a read-only `GET` route to `apps/control-plane` that serves the
Portfolio Governance snapshot, reusing the trust relationship `apps/admin`
already has with Control Plane (`ATLAS_CONTROL_PLANE_TOKEN`) — this is
exactly the pattern the pre-deletion Admin UI used (it called `CONTROL_API`
for this data, not the tenant API).

- **Architecture:** New route in `apps/control-plane`; needs read access to
  the same portfolio data `apps/api/src/services/portfolio-governance-store.ts`
  currently owns exclusively.
- **Security implications:** No new trust boundary — reuses the existing
  admin↔control-plane static-token relationship. Portfolio Governance is
  already defined (ADR-022) as an observability-only plane, which is a
  natural fit for Control Plane's existing oversight role.
- **Affected components:** `apps/control-plane` (new route), and a decision
  about where the read path for portfolio data should live — either
  extracted into a shared package both apps import, or served via a new
  control-plane→api call (which would need its own credential design, see
  the note below).
- **Implementation complexity:** Medium. The real work is not the route —
  it's deciding how Control Plane reads data currently owned by apps/api's
  service layer without duplicating the storage/overlay logic.
- **Migration impact:** Low — additive, no breaking change to any existing
  route.
- **Audit implications:** New route needs its own audit entries; current
  `/api/v1/portfolio-governance` implicitly audits via the authenticated
  operator identity, which a new route would need to replicate.
- **Tenant implications:** None — Portfolio Governance data is global
  (sibling-application inventory), not tenant-scoped.
- **Compatibility with current Admin:** High — matches the original,
  pre-deletion design intent exactly.
- **Compatibility with current API:** Requires either extracting the
  overlay-read path to a shared location, or a new (still-to-be-designed)
  control-plane→api credential — this second path would just relocate
  Option B's problem one hop over, so the shared-extraction approach is the
  cleaner version of this option.
- **Assessment:** Closest fit to original intent; the only open design
  question is the persistence-layer boundary, which is worth resolving
  cleanly rather than routing around.

### Option B — Mint a scoped service credential (admin → api)

A new static bearer (e.g. `ATLAS_ADMIN_SERVICE_TOKEN`) recognized by
`apps/api`'s auth layer as a narrow, non-interactive service identity.

- **Architecture:** Touches `apps/api/src/middleware/auth-guards.ts`
  (`requireUser`/`requireOperator`) and `services/resolve-identity.ts` —
  the same shared middleware every other protected route in `apps/api`
  depends on.
- **Security implications:** Introduces a genuinely new trust boundary and
  a new credential class (long-lived static token) into a path that
  currently only accepts fully-verified, short-lived Supabase JWTs. This is
  the direction ADR-023 moved *away* from when it parked
  `ApprovalExecutionRepository` specifically to avoid a second approval/
  trust path. The Owner directive that opened this decision explicitly
  said not to add a static-token exception to `requireUser` — this option
  is exactly that, so it should be considered only if Options A and C are
  both ruled out for concrete reasons, and even then scoped as its own
  narrow middleware function, never a branch inside `requireUser` itself.
- **Affected components:** shared API auth middleware (highest blast
  radius of the three options), `apps/admin/src/server.ts`.
- **Implementation complexity:** Medium-High, precisely because it must be
  scoped tightly enough not to become a general auth bypass.
- **Migration impact:** Medium — every future protected route in `apps/api`
  now has to account for a second, non-JWT credential type existing.
- **Audit implications:** Needs a distinct `actorKind: "SERVICE"` (or
  equivalent) in audit entries so service-credential access is always
  distinguishable from a real user's.
- **Tenant implications:** None directly, but the credential must be scoped
  so it cannot be reused to reach tenant-scoped data.
- **Compatibility with current Admin:** High (simplest Admin-side change).
- **Compatibility with current API:** Lowest of the three — the only option
  that modifies shared, security-critical middleware.
- **Assessment:** Not recommended as a first choice. Directive §2 of this
  cycle explicitly rules out a static-token exception to `requireUser`;
  this option is that change by definition.

### Option C — Client-side fetch using the owner's own Studio/API session

The rendered Admin page calls `/api/v1/portfolio-governance` directly from
the owner's browser using their own existing tenant-API session, instead of
a server-to-server call from `apps/admin` at all.

- **Architecture:** Client-side JS in the Admin page; requires CORS to
  allow the Admin origin to read the API response (Admin defaults to port
  3200, tenant API to port 4000 — different origins today).
- **Security implications:** Best least-privilege story of the three — no
  new service credential is minted anywhere; access is governed by the
  exact same per-user JWT check every other protected tenant-API route
  already uses.
- **Affected components:** `apps/admin/src/platform-html.ts` (or a new
  portfolio-specific module) for the client script; CORS configuration in
  `apps/api` if not already permissive enough for the Admin origin.
- **Implementation complexity:** Medium — mostly front-end plus a CORS
  allowlist entry; zero backend auth-model change.
- **Migration impact:** Low on the backend. Real cost is on the Admin side:
  today `apps/admin`'s login (`browser-session.ts`) issues its own separate
  HMAC-signed cookie and is **not** the same session as a Studio/tenant-API
  Supabase login — so the owner would need an active Studio session in the
  same browser for this one section to render, or Admin's login flow would
  need to be unified with Studio's login (a larger, separate change).
- **Audit implications:** None new — identical to every other
  Studio/API-authenticated action by that user.
- **Tenant implications:** None — same tenant model as any other
  operator-only view today.
- **Compatibility with current Admin:** Medium — works today only if the
  owner also has a live Studio session; otherwise needs the login-
  unification work noted above.
- **Compatibility with current API:** Highest — no backend change at all.
- **Assessment:** Strong, conservative alternative to Option A. Its cost is
  UX/session-unification, not security surface.

### Recommendation (historical — Owner later chose Option A)

Option A first (closest to original intent, smallest new trust surface,
one clean persistence-boundary question to resolve). Option C as a solid,
more conservative fallback if extracting the portfolio-read path is judged
too invasive right now. Option B only if both A and C are explicitly ruled
out, and even then narrowly scoped — never as a change to `requireUser`
itself.

Owner execution directive 2026-09-04 selected Option A. Implementation
record: §34.

## 34. Phase 11.9 Option A — Execution Record (2026-09-04)

This is a recovery/adaptation of the historical 11.9 feature
(`82e883e` → deleted by `4883bfd` → recovered under current architecture).
It is not a claim that the deletion never happened.

- **Selected authentication model:** Option A — Admin → Control Plane →
  Portfolio Governance projection. Control Plane is the trusted
  intermediary. Admin does not call the tenant API for this read.
- **Trust path:** Owner browser cookie `atlas_admin_session` (HMAC, role
  OWNER) or Admin Bearer `ATLAS_CONTROL_PLANE_TOKEN` →
  `authorizeAdminRequest` → Admin `fetchSupervisedJson` → Control Plane
  `GET /api/v1/portfolio-governance` (Bearer `ATLAS_CONTROL_PLANE_TOKEN`,
  CP principal OPERATOR) → `getControlPlanePortfolioView()` (seed +
  `.atlas/portfolio-governance.json` overlay).
- **Writes / audit:** `POST /api/v1/portfolio-governance/decisions` remains
  on the tenant API behind `requireOwner` → `requireUser` and
  `appendUnifiedAuditEntry`. Admin exposes no write/decisions route
  (404). Control Plane does not HTTP-forward to the tenant API.
- **Affected components:** `apps/admin` (new `portfolio-html.ts`,
  `portfolio-projection.ts`, `/portfolio` + Admin JSON proxy after Admin
  auth, platform nav link). Control Plane portfolio route was already
  present. Tenant API auth/routes unchanged.
- **Security:** no `requireUser` static-token exception; no
  `requireOperator` weakening; no browser-exposed secret; no client-side
  authorization decision; no unauthenticated Admin → API path.
- **Persistence caveat:** Control Plane reads the overlay file only; the
  tenant API also writes osStore. Documented, not changed.
- **Tests:** `pnpm --filter @atlas/admin test` — 21/21 PASS.
  `pnpm --filter @atlas/api test -- src/routes/portfolio-governance.test.ts src/middleware/auth-guards.test.ts src/middleware/public-routes.test.ts src/private-by-default.test.ts` — 15/15 PASS.
  `pnpm --filter @atlas/control-plane test -- src/__tests__/control-plane-alignment.test.ts src/__tests__/control-plane-auth.test.ts src/__tests__/api-routes.test.ts src/routes/dashboard.test.ts` — 68/68 PASS.
- **Typecheck / build:** `pnpm --filter @atlas/admin typecheck` PASS;
  `pnpm --filter @atlas/admin build` PASS. `@atlas/admin` has no lint
  script.
- **Runtime verification:** Admin → live Control Plane on ephemeral
  in-process HTTP servers (`portfolio-option-a.runtime.test.ts`) PASS
  (unauthenticated 401, invalid bearer 401, authorized 200, CP
  `writeAuthority: ATLAS_API`). Default ports `:3200` / `:3100` / `:4000`
  timed out (daemons not running). Tenant-API mutation/audit path was
  not re-exercised against a live `:4000` in this cycle; existing API
  route tests cover 401/403/owner decide.
- **Commit SHA:** `73b11d1` (`feat(portfolio): restore Phase 11.9 Admin UI via Control Plane`). This documentation SHA update is a follow-up docs commit on the same branch.
- **Final verification level:** **IMPLEMENTED — RUNTIME VERIFIED** for
  the Admin → Control Plane read path. Not PRODUCTION READY. Default
  daemon ports were down.

### 34a. Verification & closure pass (same day, after `73b11d1`)

No production 11.9 code was rebuilt. This pass re-inspected the committed
Option A path, re-ran tests, and added one API assertion that a successful
owner decision writes `portfolio.governance.decided` to the unified audit
log (`apps/api/src/routes/portfolio-governance.test.ts`). Tenant API
`requireUser` / `requireOperator` / `requireOwner` remain unmodified
(`git diff 56c9861..73b11d1` on those files is empty).

**Architecture confirmed (not Admin HTTP → API):**

```text
Admin (authorizeAdminRequest)
  → Control Plane GET /api/v1/portfolio-governance
  → getControlPlanePortfolioView() (seed + overlay file)
Writes / audit remain:
  POST /api/v1/portfolio-governance/decisions
  → requireOwner → requireUser → appendUnifiedAuditEntry
```

Control Plane does **not** HTTP-forward to the tenant API. That hop would
require a static-token exception and was rejected with Option B.

**Security re-check:** no `requireUser` bypass; no `requireOperator`
weakening; token only on Admin server `fetchSupervisedJson` when the URL
starts with the Control Plane origin; no Admin write surface; no
unauthenticated Admin → API path.

**Commands this pass:**

| Command | Result |
|---|---|
| `pnpm --filter @atlas/admin test` | 21/21 PASS |
| `pnpm --filter @atlas/api test -- src/routes/portfolio-governance.test.ts src/middleware/auth-guards.test.ts src/middleware/public-routes.test.ts src/private-by-default.test.ts` | first run 15/15; after audit assertion `portfolio-governance.test.ts` 6/6 |
| `pnpm --filter @atlas/control-plane test -- src/__tests__/control-plane-alignment.test.ts src/__tests__/control-plane-auth.test.ts src/__tests__/api-routes.test.ts src/routes/dashboard.test.ts` | 68/68 PASS |
| `pnpm --filter @atlas/shared test -- src/portfolio/audit.test.ts src/portfolio/security.test.ts` | 58/58 PASS |
| `pnpm --filter @atlas/admin typecheck` | PASS |
| `pnpm --filter @atlas/admin build` | PASS |
| `pnpm --filter @atlas/control-plane lint` | PASS |
| `pnpm --filter @atlas/api lint` | PASS |
| `pnpm --filter @atlas/admin lint` | no lint script (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`) |

**Runtime this pass:** default `:3200` / `:3100` / `:4000` timed out again
(daemons not running). In-process Admin → Control Plane
(`portfolio-option-a.runtime.test.ts`) re-passed: unauthenticated 401,
invalid bearer 401, authorized 200. API inject tests: anonymous GET 401,
tenant-admin GET 403, operator GET 200, operator POST decide 403, owner
POST decide 200 + `portfolio.governance.decided` audit line. Portfolio
Governance inventory is global (not tenant-scoped); the unauthorized-scope
equivalent is the 403 tenant-admin / operator-decide cases.

**Closure verification level:** **IMPLEMENTED — RUNTIME VERIFIED**
(Admin → Control Plane on ephemeral HTTP servers + API inject
auth/audit). Default daemon ports still down. Not PRODUCTION READY.

## 35. Native verification gate (2026-09-04, after 11.9 close)

Baseline HEAD at start: `d821cff`. Phase 11.9 was not rebuilt.

One proven production defect was fixed this gate:
`packages/shared/src/approval/canonicalization.ts` — unpaired high
surrogate at end-of-string was not rejected because `charCodeAt` past
the last index is `NaN` and `NaN < 0xdc00` is false. Test
`execution-envelope.test.ts` already required the throw. After the
bounds check: `pnpm --filter @atlas/shared test` **372/372 PASS**.

Pre-existing failures **not** fixed (no speculative edits):

- `@atlas/api` `memory-pipeline.test.ts` — two retrieveMemories cases
  fail when the shared `osStore` already has ≥20 rows (`budget: 20`);
  isolation, not a proven product-scoping defect.
- `@atlas/engineering-loop` lint — 4 unused-symbol errors in
  `proof-run.ts` / `proof-run.test.ts`.
- `@atlas/web` build — webpack `UnhandledSchemeError` for `node:crypto`
  imported via `@atlas/shared` into a client component. Pre-existing
  Next/shared boundary. Not a 11.9 issue.

Default ports `:3200` / `:3100` / `:4000` timed out (daemons not
running). In-process Admin→CP and API inject paths re-passed.

`@atlas/worker` has **no** `test` script in `package.json`. Worker
tests were run with `pnpm exec vitest run` in `apps/worker` — 7/7 PASS
(retry / dead-letter / continue-after-throw). `queue-persistence.ts`
has no dedicated test file.

The three gate leftovers listed above were remediations executed later
the same day. Results: §36. This section remains the gate record; it
does not claim those three were fixed during the gate.

## 36. Verified remediation queue (2026-09-04, after §35)

Baseline HEAD at start: `16ac12a`. Phase 11.9 and Synthetic Universe
were not rebuilt. No new audit. Three existing gate findings only.

1. **memory-pipeline isolation.** Root cause confirmed: shared singleton
   `osStore` already held ≥20 rows when two `retrieveMemories({ budget: 20 })`
   cases ran later in the same file. Product ranking/budget was not
   changed. Fix: `osStore.unloadForTests()` in the per-agent
   `beforeEach` before fixture inserts.
   Focused: `pnpm --filter @atlas/api test -- src/services/memory-pipeline.test.ts`
   — **16/16 PASS**.

2. **engineering-loop lint.** Removed unused `beforeAll` import, unused
   `isAbsolute` import, unused `validatePathContainment` (never called;
   not wired in — that would change behavior), and unused `source`
   parameter name (`_source`).
   Focused: `pnpm --filter @atlas/engineering-loop lint` PASS;
   `pnpm --filter @atlas/engineering-loop test` **13/13 PASS**.

3. **`@atlas/shared` → Next client `node:crypto`.** Webpack failed
   because the main barrel pulled `atlas-self.ts` → `hashCanonicalJson`
   (`node:crypto`) into `apps/web/lib/ai-provider-preference.ts` (client).
   Hash helpers moved to `atlas-self-hash.ts` and exported only from
   the existing `@atlas/shared/node` entry. Identity/predicates stay on
   the main barrel. No browser polyfill. No shared rewrite. Node callers
   import hashes from `@atlas/shared/node`.
   Focused: `@atlas/shared` atlas-self + execution-envelope **10/10 PASS**;
   API atlas-self/kernel/lifecycle **34/34 PASS**; database
   `live-approval-requests.test.ts` **27/27 PASS**;
   `pnpm --filter @atlas/web build` PASS (compiled successfully).

Full native commands after all three:

| Command | Result |
|---|---|
| `pnpm test` | 47/47 PASS (`@atlas/shared` 372, `@atlas/api` 1118 including memory-pipeline 16, `@atlas/control-plane` 215, `@atlas/synthetic-universe` 34, `@atlas/engineering-loop` 13) |
| `pnpm typecheck` | 53/53 PASS |
| `pnpm build` | 30/30 PASS (includes `@atlas/web`) |
| `pnpm lint` | 46/46 PASS |

Not claimed: PRODUCTION READY. Default `:3200` / `:3100` / `:4000`
daemons were not re-probed this pass. G-3 is a recorded Owner decision
(§37). `@atlas/worker` still has no `test` script.

## 37. G-3 Owner Decision — RE-APPROVE 11.5–11.15 (2026-09-04)

Recorded per the §28/§29 metadata schema. Documentation only. No code
change. No rebuild. No new audit. No Verification Gate rerun.

| Field | Value |
|---|---|
| Decision ID | G-3 |
| Date | 2026-09-04 |
| Owner | Atlas Owner |
| Scope | Portfolio Governance 11.5–11.15 |
| Reason | Formally re-approve the already-implemented 11.5–11.15 work as the current authoritative governance state after the Native Verification Gate and Verified Remediation Queue closed. Close the documentation-only gap left by `831410e`. |
| Affected components | This document only (`§16` 11.5 status wording, `§21`, `§24` G-3, `§25` item 1, `§26`, `§36`, this section) |
| Authorized actions | Record this decision; mark G-3 CLOSED; preserve historical and superseded records |
| Forbidden actions | Code changes; architecture redesign; rebuilding Phase 11.9; another broad audit; rerunning the completed Verification Gate; deleting `ApprovalExecutionRepository`; unrelated remediation; pushing to remote |
| Expected verification | Decision present in this file; historical records (`831410e`, §20, §21, `remaining-work.md` preserved retraction line) intact; worktree contains only this documentation change |
| Actual verification | Decision recorded in this section; `831410e` chain in §20 and the §21 historical-preservation paragraph left in place; §16 verification levels not upgraded by this decision; 11.9 remains **IMPLEMENTED — RUNTIME VERIFIED**; 11.13/11.14 remain milestone markers with no dedicated code |
| Verification date | 2026-09-04 |
| Commit SHA | this documentation commit (reported with the recording response) |
| Documentation updated | this file |
| Supersedes | `831410e` **as the current Owner approval status only** — not as a historical record |
| Status | APPROVED / RE-APPROVED. G-3 = CLOSED |

**Decision text (Owner, 2026-09-04):** Portfolio Governance items 11.5–11.15
are re-approved as the current authoritative governance state of Atlas.
The approval is of the existing implementation and of the technical
wording already in this document. It is not authorization to rebuild.

**Verification-level rule applied while recording:** G-3 does not convert
`IMPLEMENTED — UNVERIFIED` rows in §16 into TESTED / RUNTIME VERIFIED.
Those columns stay evidence-based. Native gate results remain in §35–§36.

**Final governance state:** G-3 = CLOSED. 11.5–11.15 = RE-APPROVED.
The next engineering task, if any, requires a separate explicit Owner
authorization.

## 38. Phase 02 Gateway Completion (2026-09-04)

**Status: COMPLETE** for the authoritative item-02 DoD (Atlas-self first).

Implementation commit: `332b11e`
(`feat(gateway): wire CP ALLOW writes to tenant gateway/fulfill`).

Path:

`dispatchGatewayOperation` ALLOW write on `def-000`
→ `callAtlasApi` + `ATLAS_CONTROL_PLANE_TOKEN`
→ `POST /api/v1/gateway/fulfill`
→ `fulfillGatewayHandoff`
→ `executeGovernedAction`
→ `executeTool`

Control Plane does not run tools. DENY and REQUIRE_APPROVAL do not call
fulfill. Missing config / unreachable API fail closed.

**NOT PART OF PHASE 02** (left untouched; require a later Owner decision):

- Event-ingest execution (ADR-022: no tools on ingest; Civio events have
  no authoritative execution intent).
- HTTP fulfill for non-`def-000` applications (P6 Atlas-self first).
- Sibling observe-only remaining (target P7/P10).

Do not start remaining-work item 03 from this close.

## 39. Phase 03 Identity / Authorization (2026-09-04)

**Status: COMPLETE** for the existing identity model. No redesign.

Focused completion found one reachable enforcement hole and one identity
correctness defect:

- `requireOwnerRole` existed and was unit-tested, but no production route
  called it. `GET /api/v1/owner/brief` is now owner-only.
- Control Plane role was process-global (`resolvedPrincipalRole`). Concurrent
  requests could confuse OWNER and OPERATOR. Role is now request-scoped
  (`WeakMap` on `IncomingMessage`).
- Identical `ATLAS_CONTROL_PLANE_TOKEN` and
  `ATLAS_CONTROL_PLANE_OWNER_TOKEN` values no longer elevate to OWNER.

Unchanged and still sound: principal kinds; `cp:service` SERVICE identity;
body `actorId` ignored; missing principal DENY at IDENTITY; customer admin
≠ operator; `/admin/users` cannot grant operator/owner; `requireOwner` on
the tenant API; Atlas-self `def-000` identity; gateway fulfill session user.

**Not claimed here:** Control Plane bearer MFA and token rotation (Phase 04);
sibling execution identity (later-scope).

## 40. Phase 04 Control Plane Security (2026-09-04)

**Status: COMPLETE** for the existing authentication architecture.

- Privileged Control / Admin **browser** login now completes tenant TOTP
  (`POST /api/v1/auth/mfa/verify`). Password-only `mfaRequired` does not
  issue a session.
- Service bearers remain machine identity. They are **not** TOTP-bound.
- Rotation uses `ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS` and
  `ATLAS_CONTROL_PLANE_OWNER_TOKEN_PREVIOUS` on Control, Admin, and the
  tenant API service hop. Collision still never elevates to OWNER.

HMAC reauth remains one-shot replay protection, not MFA.

Production or `ATLAS_CONTROL_PLANE_REQUIRE_BROWSER_MFA=1` refuses
privileged Control browser mutations (`/gateway/ops`, agent-control)
unless the session recorded `mfaSatisfied`. Machine bearers stay
non-TOTP.

## 41. Phase 05 Canonical Audit (2026-09-04)

**Status: COMPLETE.** API NDJSON remains the only system of record.

- `POST /api/v1/audit/cp-import` accepts Control Plane SERVICE bearer or
  admin session. Handler still authenticates.
- Imported rows keep `cpHash` / `cpPrevHash` as provenance. The API then
  hashes the new line into its own chain.
- Duplicate `cpHash` is skipped. Broken CP sequences are rejected.
- Control Plane `startPeriodicSync` is reachable from `server.ts` and uses
  the service bearer, not a session cookie.

Historical records are not rewritten. CP `verifyAuditChain` stays
`canonical: false`.

## 42. Phase 06 Execution Safety (2026-09-04)

**Status: COMPLETE** on the existing governed path.

Durable worker-queue crash recovery was already implemented. This close
persists `executeGovernedAction` idempotency so a process crash cannot
replay an already-EXECUTED tool. Claimed approvals that started before
crash still finalize `OUTCOME_UNKNOWN` and do not execute twice.

Stale remaining-work wording that said durable jobs were absent is
corrected. Phase 12 later confirmed a distributed queue is not required
by the current single-worker file-backed architecture.

## 43. Phase 07 Verification (2026-09-04)

**Status: COMPLETE.** `evaluateWorldState` is the general mechanism:
INTENDED → AUTHORIZED → EXECUTED → VERIFIED. Gateway fulfill uses it.
Execution is never treated as verification. Regression FAILED still
overrides VERIFIED. This is not a QA product.

## 44. Phase 08 Egress (2026-09-04)

**Status: COMPLETE** for server hops. Control Plane → tenant API now
goes through `decideEgress` (`atlas_internal` / TELEMETRY). Same-origin
dashboard fetches, test harnesses, and the public landing page remain
classified exceptions. No second egress engine.

## 45. Phase 09 Memory / Knowledge (2026-09-04)

**Status: COMPLETE** for the existing Knowledge Fabric. Conversation and
agent-run retrieval bind Atlas-self scope from the authenticated session
(`resolveAtlasSurfaceKnowledgeScope`). `match_knowledge_chunks` filters
project-scoped rows in SQL and returns metadata. Incomplete scope never
queries pgvector. Identity is never inferred. Historical chunks are not
rewritten. Unrestricted web crawl remains not claimed.

## 46. Phase 10 Agent Governance (2026-09-04)

**Status: COMPLETE.** `executeGovernedAction` denies non-executable
`runtimeStatus`. API reads the Control Plane overlay when configured
(`resolveGovernedAgentIdentity`). 404 overlay → ACTIVE. Unreachable CP →
UNKNOWN fail-closed. Catalog remains the execution identity.

## 47. Phase 11 Tool Governance (2026-09-04)

**Status: COMPLETE** for registered production tools. API startup registers
`knowledge_search`, read-only filesystem tools, and `analyze_repo`.
Unregistered policy names still fail closed. No second execution engine.

## 48. Phase 12 Reliability (2026-09-04)

**Status: COMPLETE** on the existing worker. Durable queue, crash recovery,
and governed idempotency already exist. A distributed queue is not required
by the current single-worker architecture.

## 49. Phase 13 Observability (2026-09-04)

**Status: COMPLETE.** CP → API hops forward the same `X-Request-Id`. Tenant
API Fastify honors that header as `request.id`. Gateway fulfill and
governed/dispatch audit `input.requestId` share it. UUID values also fill
`correlationId`. No second telemetry stack.

## 50. Phase 14 Self-Audit (2026-09-04)

**Status: COMPLETE** for detect → propose. Added evidence-only findings for
runtime overlay, CP-does-not-execute-tools, fabric vs oversight registry,
catalog/registration drift, policy-without-implementation, missing
observational audit, verification gaps, expired-PENDING inconsistency, and
production runtime-config drift. `autoApply` remains false. Findings do not
mutate runtime state. Active probing is not claimed.

## 51. Phase 15 Disaster Recovery (2026-09-04)

**Status at first close:** BLOCKED on offsite destination.
`runCanonicalAuditRestoreDrill` proved a local copy still verifies.
Receipts recorded `offsite: false`.

**Current (same day, §58):** configured filesystem replica is implemented.
Cloud object-store destination remains an Owner deployment decision.

## 52. Phase 16 Supply Chain (2026-09-04)

**Status at first close:** BLOCKED on signing identity. SBOM COMPLETE.
No unsigned Sigstore ceremony.

**Current (same day, §58):** `verifySupplyChainArtifacts` is fail-closed.
`releaseReady` stays false without a real verifier. Identity still Owner.

## 53. Phase 17 Governance Test Suite (2026-09-04)

**Status: COMPLETE.** Added world-state execution ≠ verification, quarantine
denial, production tool registration, CP-does-not-execute-tools, request-id
handoff correlation, self-audit detect-only proofs, and the adversarial
suite (`governance-adversarial.test.ts`).

## 54. Phase 18 Performance / Scale (2026-09-04)

**Status: COMPLETE** for the existing in-process cache, limits, and latency
stack. Redis and autoscaling are not required by current architecture.
Concurrent governed idempotency is serialized in-process.

## 55. Phase 19 Intelligence (2026-09-04)

**Status: COMPLETE** for governed suggestions (hypothesis, marketplace,
PSA recommend, verdict actions, verification-lessons). Live ML training
on production traffic is BLOCKED pending Owner decision.

## 56. Later-scope and production runtime (2026-09-04)

Ingest / non-`def-000` / sibling execution remain BLOCKED — ADR-022 and
no authoritative execute contract. `CONNECTED_APPLICATION_RUNTIME` records
the inventory. Production runtime for Control / Admin / Worker is the
existing `deploy/` private-plane systemd set. API/web stay on the user
plane (Vercel) per ADR-021.

## 57. Master completion authorization (2026-09-04)

Owner authorization lifted prior NOT CLAIMED / FUTURE / LATER labels for
the listed remaining work. Phases 03–14, 17–18, and suggestion-only 19
are COMPLETE on the existing architecture. Phase 15 remains BLOCKED on
offsite destination. Phase 16 remains BLOCKED on signing identity. Live
ML training and ingest / non-`def-000` / sibling execute remain BLOCKED
on Owner decisions. `ApprovalExecutionRepository` stays parked.

**Program verdict at this authorization:** ATLAS PROGRAM — BLOCKED until
those Owner decisions exist. Do not relabel blocked items as complete.

Historical record — superseded as *current program verdict* by §58; this
section is not erased.

## 58. Master completion pass (2026-09-04)

Owner authorized finishing already-authorized residuals without reopening
Phases 10–14 or inventing sibling execute mappings.

**Closed this pass**
- Privileged Control browser mutations can require MFA-satisfied sessions.
- Canonical restore drill can replica to `ATLAS_OFFSITE_BACKUP_DIR`.
- Supply-chain verify is fail-closed (SBOM valid / signing UNSIGNED or INVALID).
- Concurrent governed idempotency is serialized.
- Adversarial governance suite + connected-application inventory.
- Verification-informed recommendations (`executes: false`).

**Still BLOCKED (cannot safely infer)**
- Cloud object-store DR destination and credentials.
- Sigstore/cosign signing identity and deployed verifier.
- Live ML training on production traffic.
- Ingest execution (ADR-022: no tools on ingest; no Civio execute intent).
- Non-`def-000` / sibling HTTP fulfill (no execute contract).

**Program verdict: ATLAS PROGRAM — BLOCKED** on those Owner/deployment
decisions. Phases 03–14, 17–18, suggestion-only 19, local/replica DR, and
SBOM verify are COMPLETE on the existing architecture.

## 59. Authorized completion continuation (2026-09-04)

Phases 10–14 were not reopened. Remaining authorized work closed on the
existing architecture.

**Phase 15.** Isolated restore-from-replica (`restoreCanonicalAuditFromReplica`)
never overwrites canonical. Tampered replicas fail closed. Operator runbook:
`docs/operations/disaster-recovery.md`. Filesystem replica remains implemented.
Cloud object-store is still an external infrastructure blocker.

**Phase 16.** Unsigned in-toto/SLSA provenance is generated next to the SBOM
and verified fail-closed (`signed: false`). Signing identity + Sigstore/cosign
verifier remain Owner/deployment blockers. `releaseReady` stays false.

**Phase 17.** Adversarial matrix expanded (suspended, expired approval,
delegation hops, hop ceiling 10, forged identity, policy bypass, missing
audit, production skip-audit forbidden, executed ≠ verified). Sibling
gateway fulfill is refused in `fulfillGatewayHandoff`, not only at CP SERVICE.

**Phase 18.** Measured 12 sequential + 8 concurrent `executeGovernedAction`
calls. Redis is not required. Process-local queue kept.

**Phase 19.** `scoreHistoricalOutcomes` / `GET /api/v1/intelligence/outcome-signals`
recommend only (`executes: false`, `autoApply: false`, `mutatesGovernance: false`).

**Connected applications.** Inventory unchanged: `def-000` gateway fulfill;
Civio HMAC evaluate-only; CaseFlow / HotelOS / BrokerOS / LexStudy / Vantera
inventory-only. ADR-022 still blocks ingest execute and sibling fulfill.

**Runtime probe.** `pnpm runtime:probe` — local `:3000/:3100/:3200/:4000`
were not listening. Do not claim PRODUCTION READY.

**Program verdict: ATLAS PROGRAM — BLOCKED** on cloud DR destination,
Sigstore/cosign identity+verifier, live ML training, ADR-022 ingest/sibling
execute, and a live private-plane deployment for runtime evidence.
