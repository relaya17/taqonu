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

Grep-depth check performed 2026-09-04: idempotency/retry-related code
confirmed present in `apps/api/src/services/approvals.ts`,
`governed-claimed-execution.ts`, `governed-lifecycle.ts`, and
`automation-engine.ts` — reliability appears handled per-mechanism inside
the governed-execution path rather than as a dedicated subsystem. This was
a filename/grep pass only; none of these mechanisms were read in depth, and
no DR runbook, backup/restore mechanism, or failover path was specifically
inventoried or ruled out. **Status: PARTIAL — grep-level evidence only; a
real read-through is still required (G-5, §24) before this can be called
IMPLEMENTED or ABSENT.**

## 15. Supply Chain

`scripts/generate-sbom.ts` exists (`pnpm sbom:generate` → `tsx
scripts/generate-sbom.ts`, CycloneDX 1.5 output). Execution attempted
2026-09-04: `node_modules/.bin/tsx scripts/generate-sbom.ts` fails with
`Cannot find module 'esbuild'` — the same class of environment issue as
§19 (a native/platform-specific dependency unresolvable through this
bridge), not a code defect. **Status: IMPLEMENTED — UNVERIFIED,
BLOCKED-ENVIRONMENT for execution** (script and its `package.json` wiring
confirmed present; no SBOM content has ever been produced or reviewed in
this environment).

## 16. Portfolio Governance 11.1–11.15

| Phase | Historical Impl. | Current Code | Tests | Test Execution | Runtime Verif. | Current Doc | Current Status |
|---|---|---|---|---|---|---|---|
| 11.1 Foundation/persistence | `82e883e` | present (`portfolio-governance-store.ts`) | present | BLOCKED-ENVIRONMENT | none | remaining-work.md: complete | IMPLEMENTED — UNVERIFIED |
| 11.2 App/Source Agent inventory | `82e883e` | present | present | BLOCKED-ENVIRONMENT | none | remaining-work.md: complete | IMPLEMENTED — UNVERIFIED |
| 11.3 Capability Extraction | `82e883e` | present | present | BLOCKED-ENVIRONMENT | none | remaining-work.md: complete | IMPLEMENTED — UNVERIFIED |
| 11.4 Provenance and Evidence | `82e883e` | present | present (label now correct after this cycle's fix, see §22) | BLOCKED-ENVIRONMENT | none | remaining-work.md: complete | IMPLEMENTED — UNVERIFIED |
| 11.5 Persistence & Data Layer | `82e883e` | present (`portfolio-governance-store.ts` + `.test.ts`, 10+ cases) | present | BLOCKED-ENVIRONMENT | none | now pointed here (§22) | IMPLEMENTED — UNVERIFIED; OWNER DECISION REQUIRED (re-approval wording, §25) |
| 11.6 Global Deduplication | `82e883e` | present (`deduplication.test.ts`, 43 DedupRelation records) | present, correctly labeled | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.7 Canonical Capability Mapping | `82e883e` | present | present | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.8 Governance Decisions | `82e883e` | present (`seed.ts:2440`) | present; `governance-decisions.test.ts` correctly labeled, plus `index.test.ts` label corrected this cycle (§22) | BLOCKED-ENVIRONMENT | none | now pointed here | IMPLEMENTED — UNVERIFIED |
| 11.9 Portfolio UI Interface | `82e883e` | **ABSENT** — deleted by `4883bfd` (unrelated ADR-021 admin restructure; replacement files carry zero portfolio content). Backend data source (`GET /api/v1/portfolio-governance`, `apps/api/src/routes/portfolio-governance.ts`) is still live and its response shape is byte-for-byte compatible with what the deleted UI consumed (`snapshot.applications`, `.sourceAgents`, `.capabilities`, `.evidence`, `.dedupRelations`, `.governanceDecisions`, `.conflicts`, `.canonicalCapabilities` all confirmed present in `packages/shared/src/portfolio/index.ts`). | test file deleted with it | n/a | n/a | now pointed here | **REGRESSION — OWNER DECISION REQUIRED (architecture, not just code).** Investigated 2026-09-04: the pre-deletion UI fetched this data from `CONTROL_API` (Control Plane, static `ATLAS_CONTROL_PLANE_TOKEN` bearer). The route now lives only in `apps/api` (tenant API) behind `requireOperator` → `requireUser` → real Supabase-JWT auth — a static service token cannot satisfy it, and `apps/admin`'s own browser session is a separate HMAC-signed cookie, not a Supabase session. Restoring 11.9 therefore requires an explicit choice of cross-service auth model, not a copy-paste port. See §25 for the three concrete options. No route/rendering code was written this cycle. |
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
capability/decision/portfolio references per grep). Not restored as of
current HEAD.

**Recovery investigation performed 2026-09-04:** the rendering logic
(`renderOwnerHtml`'s portfolio-specific helpers, `packages/shared`-compatible
field names, i18n keys for he/en/ar) is fully recoverable from
`git show 4883bfd^:apps/admin/src/owner-html.ts` and the backend endpoint it
depended on is unchanged and still correctly shaped. The blocker is
architectural, not code-availability: the endpoint's auth model changed
(§16 row for 11.9) between when 11.9 was built and now, in a way the old
fetch pattern cannot satisfy. This is exactly the kind of "genuinely
incompatible" case the Owner directive's §7 anticipated — restoration was
not attempted blind. See §25 for the decision and options.

## 24. True Remaining Work (P0–P3)

| Gap ID | Capability | Current state | Missing component | Reason missing | Dependencies | Risk | Priority | Verification required | Definition of Done |
|---|---|---|---|---|---|---|---|---|---|
| G-1 | Native test/typecheck execution | Code implemented, never independently run this session | Execution evidence for all packages except Owner-attested Synthetic Universe | Environment (Windows/pnpm symlinks unreachable from this Linux bridge) | Owner's native terminal | Medium — unverified code could hide defects | **P0** | Run §19a commands natively | Exact command + PASS/FAIL output recorded here |
| G-2 | Phase 11.9 Admin UI | Absent (regressed); rendering logic recoverable, backend compatible, cross-service auth model incompatible (see §16, §23) | A decided auth model for admin→api server-to-server calls, then the route/rendering code itself | Deleted as collateral damage; auth architecture changed independently afterward | Owner decision on auth model (§25); current `platform-html.ts`/`requireOperator` architecture | Medium — wrong choice here creates a new cross-service trust boundary | **P1** | New/restored tests + native run, once auth model is chosen | Auth model decided → feature implemented → tests pass → native-verified → documented |
| G-3 | Owner re-approval of 11.5–11.15 | Implemented, undocumented as approved | A recorded Owner decision superseding the `831410e` retraction | Documentation-only rollback never revisited | none | Low (code already shipped either way) | **P2** | none (decision, not code) | Owner decision recorded with the §16-of-directive metadata schema |
| G-4 | SBOM script execution evidence | Script present; attempted 2026-09-04: `node_modules/.bin/tsx scripts/generate-sbom.ts` fails with `Cannot find module 'esbuild'` — same class of environment issue as G-1, not a code defect | Execution + output review | Native-binary (esbuild) resolution fails through this bridge | native environment | Low | **P3** | Run `pnpm sbom:generate` natively, review sbom.json/sbom.xml | Output reviewed, findings recorded |
| G-5 | Reliability/DR documentation | Partially investigated 2026-09-04: idempotency/retry-related code confirmed present inside specific mechanisms (`apps/api/src/services/approvals.ts`, `governed-claimed-execution.ts`, `governed-lifecycle.ts`, `automation-engine.ts`) — reliability is handled per-mechanism, not as a separate subsystem. No dedicated backup/crash-recovery/failover subsystem was found or ruled out at this depth. | A real backup/failover/crash-recovery inventory (this cycle only found idempotency-adjacent code, did not evaluate it) | Out of scope of prior audits; this cycle's pass was a grep-depth check only | none | Unknown — cannot assess risk without a deeper pass | **P2** | Dedicated audit pass reading the mechanisms found | Section 14 upgraded from UNKNOWN to a real status with evidence per mechanism |

No other gap is asserted. Old-roadmap unchecked boxes that current code and
tests already satisfy are **not** listed here (per directive §10, "do not
manufacture gaps").

## 25. Owner Decisions

1. Whether to formally re-approve the already-implemented 11.5–11.15 work
   (G-3), and with what documentation wording.
2. **Phase 11.9 Admin UI auth model (G-2).** Rendering logic and backend
   are both ready; the open question is how `apps/admin` should reach the
   owner-gated `GET /api/v1/portfolio-governance` on `apps/api`. Three
   options, none implemented yet:
   - **(a) Route it through Control Plane** (matching the pre-deletion
     pattern): add a thin read-only projection endpoint in
     `apps/control-plane` that reads the same `packages/shared/src/portfolio`
     snapshot, reusing the existing static-token trust between admin and
     control-plane. Requires control-plane to gain access to the persisted
     overlay currently owned by `apps/api/src/services/portfolio-governance-store.ts`.
   - **(b) Mint a scoped service credential** for admin→api calls (a new
     `ATLAS_ADMIN_SERVICE_TOKEN` or similar, recognized by `requireUser`/
     `getRequestUser` as a narrow, audit-logged, non-interactive operator
     identity). New cross-service trust boundary — a security-policy
     change, per directive §19, requiring explicit sign-off.
   - **(c) Client-side fetch using the owner's own Studio/API session**
     instead of a server-to-server call — avoids minting new credentials,
     but only works when the owner is separately signed into Studio/API in
     the same browser, since `apps/admin`'s browser session is a distinct
     HMAC cookie today, not a shared Supabase session.
   No code was written for any option this cycle; this is a genuine
   Owner decision, not a technical fact I can establish from evidence.
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
integration is done (§17). **Phase C** (11.9 recovery) — **not started**;
requires an Owner decision (§25.2) before any code is written, because it
cannot be verified in this environment. **Phase D** (gap matrix) — done
this cycle (§24). **Phase E** (build P0/P1) — **not started** for the same
reason as Phase C; G-1 itself (native test execution) is the literal
precondition for safely doing any of Phase E's Build Protocol (§27/§28).
**Phase F** (finalize) — partially done (this document + roadmap pointer);
fully closing it depends on Phases C/E.

## 27. Verification Gates

Level 1 (static inspection) and Level 2 (typecheck/lint/build *by reading*,
not executing) evidence underlies every "IMPLEMENTED" status in this
document. **No Level 3 (unit tests), Level 4 (integration tests), Level 5
(runtime verification), or Level 6 (production-readiness/governance
verification) evidence was produced in this session**, except where
explicitly marked "Owner-reported" for Synthetic Universe (§17), which is
itself not independently confirmed. No capability in this document claims
Level 5 or 6 on the strength of Level 1–3 evidence alone, per the
directive's own rule.

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
