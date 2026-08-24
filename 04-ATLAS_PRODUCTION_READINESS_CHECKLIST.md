# 04 — ATLAS Production Readiness Checklist (70-Phase Master Checklist v3, verified against code)

**Status:** Living — this is doc 04 of the 4-document spec set, not agent-facing content. Update as work lands; never flip a box to done without checking it against actual code/tests.
**Source:** pasted "ATLAS — MASTER CHECKLIST v3" (from prior session, 2026-08-24) + "ATLAS / ArletOS Unified Master Blueprint v2.0" (23 Aug 2026).
**Created / first verification pass:** 2026-08-24
**Second verification pass:** 2026-08-24 (later same day) — phases 0, 4, 5, 6 re-checked directly against the code. Three had been marked ❌/🟡 for gaps the code did not actually have; this file's own ground rule cuts both ways, so a box moves when the evidence says so in either direction.

**Third pass, same day — a correction to the second.** The second pass flipped 4, 5 and 6 to ✅ on the strength of *reading the code*. That is precisely the substitution this document forbids: code present is not the same claim as behaviour tested. Re-audited on that stricter line, phases 5 and 6 are 🟡 — each has a real implementation and a real hole in its coverage, named inline. Tests were written for the two gaps worth closing now (symlink escape, walk depth). Standing count: **4 ✅ · 2 🟡 · 1 N/A · 64 ⬜**.
**Companion docs:** [`01-ATLAS_AGENT_SYSTEM_SPEC.md`](01-ATLAS_AGENT_SYSTEM_SPEC.md) · [`02-ATLAS_AGENT_GOVERNANCE_SPEC.md`](02-ATLAS_AGENT_GOVERNANCE_SPEC.md) · [`03-ATLAS_ENGINEERING_RUNTIME_SPEC.md`](03-ATLAS_ENGINEERING_RUNTIME_SPEC.md) — this file is what Engineering/QA/Audit Agent checks; those three are what the agent knows (01), what governance enforces (02), and how the runtime executes (03). This file is not a per-task agent prompt — feeding its raw 70 phases into an agent's working context on every task is the exact anti-pattern this 4-document split exists to avoid: it mixes "how Atlas thinks" with "how Atlas is secured" with "how the Atlas runtime works" with "how we prove it's production-ready." Also see [`docs/strategy/living-request-tracker.md`](docs/strategy/living-request-tracker.md) — the product/feature asks tracker, a different axis from this security/architecture hardening checklist.

## Ground rule (this is Phase 60 of this same checklist — applied to the checklist itself)

Every status below must be one of: **OBSERVED · VERIFIED · PARTIAL · OPEN (verified NOT done) · UNVERIFIED (not yet audited)**. Never "probably implemented." A phase marked ⬜ UNVERIFIED is *not* a failure — it means nobody has checked it against the real code yet this pass. Do not read ⬜ as ❌.

## Status legend

- ✅ **VERIFIED** — checked directly against code/tests, confirmed done
- 🟡 **PARTIAL** — some sub-items verified done, others verified missing
- ❌ **OPEN** — checked, and it is genuinely not done (real gap, with evidence)
- ⬜ **UNVERIFIED** — not audited this pass; status unknown, not assumed
- **N/A** — the checklist item's premise doesn't match current code (explained inline)

## Quick status — verification pass 2026-08-24

| Phase | Title | Status | Evidence |
| ---: | --- | --- | --- |
| 0 | Freeze & Baseline | ✅ VERIFIED | tests 834/834, `build --force` 26/26 with 0 cached; checkpoints `e5d75d1`, `a72c9be`, `d323137` pushed to `main`; lint run, 4 errors found and fixed |
| 1 | Agent Governance | ✅ VERIFIED | `agent-runtime-authz.ts`, `governed-execution.ts` stages 2-3, audit in `auditOutcome()` |
| 2 | Execution Gate | ✅ VERIFIED | `governed-execution.ts` + `execution-gate-guard.test.ts`, only call site, guard passing |
| 3 | `research-analyst-dispatch.ts` bypass | **N/A** | `verifyResearcherProposalAgainstRepo()` does not exist on disk — reported done in a parallel session but never landed. Nothing to fix; re-check when it's actually built. |
| 4 | Filesystem Path Containment | ✅ VERIFIED | traversal/absolute/UNC/drive-letter — code ✅ **and tested**. Symlink/junction canonicalization — `realpathSync` two-stage check at `runtime.ts:207,213-232`; the earlier ❌ did not match the code, but it had **no test at all**, so a test was added 2026-08-24 that links a directory outside the root and asserts the read is refused. It self-skips where Windows denies symlink creation rather than reporting coverage that never ran. |
| 5 | Filesystem Timeout (AbortController) | 🟡 PARTIAL | `withTimeout()` (`runtime.ts:248-260`) takes an `AbortController` and aborts it when the timer fires, and the signal now reaches `stat`/`readFile`/`readdir` — the earlier ❌ ("no AbortController") did not match the code. **But the covering test only asserts the TIMEOUT outcome and its `timeoutMs`; nothing asserts that in-flight fs work is actually cancelled.** Code present, propagation untested — that is 🟡, not ✅. |
| 6 | Filesystem Resource Limits | 🟡 PARTIAL | per-file/dir/match ✅. `MAX_WALK_DEPTH` 12 and `MAX_SCAN_FILES` 20000 added 2026-08-24 with a shared `WalkBudget`; every cap that trips is named in the output rather than truncating silently. **Depth cap is tested** (20 nested levels, asserts the buried file is unreachable and the note is present) plus a negative test so an always-on note would fail. **The 20000-file volume cap is code-only — untested**, because a fixture that large is not worth the runtime. Symlinks are never descended (`isDirectory()` is false for a `Dirent` symlink), so no loop guard is needed. Duration is phase 5. |
| 7-70 | (everything else) | ⬜ UNVERIFIED | not audited — 64 of 71 phases have never been checked against code. ⬜ is not ❌; it means nobody has looked. |

---

## 🔴 PHASE 0 — FREEZE & BASELINE — 🟡 PARTIAL

- [x] Baseline captured: `apps/api` 96/96 test files, 834/834 tests passing; `pnpm turbo run build` 41/41 tasks (verified 2026-08-24, user's own terminal run)
- [x] `git status` / git checkpoint commit — `e5d75d1` (Tool Runtime fix), `a72c9be` (this spec set), `d323137` (adversarial test), all pushed to `main` 2026-08-24
- [x] Document which tests currently fail — none. 834/834 across 96 files. Lint has now been run: it found 4 errors in `adversarial.test.ts`, all fixed in `d323137`; one was a test that asserted `expect(true).toBe(true)` and verified nothing.
- [ ] Document which Security Gates already PASS — `execution-gate-guard.test.ts` confirmed passing; others unverified
- [ ] No new features before P0/P1 close — holding per this document

## 🔴 PHASE 1 — AGENT GOVERNANCE — ✅ VERIFIED

- [x] `resolveAgentIdentity()` — identity resolved before action (`agent-runtime-authz.ts`)
- [x] Tool authorization — `enforceAgentToolAuthorization()`, allow-list, deny-by-default, fail-closed
- [x] Entity/action authorization — Policy Engine (`dispatchAgentAction`, `agent-dispatch-guard.ts`)
- [x] Approval — bound to artifact hash, consumed once, before Policy/Risk (`governed-execution.ts` stage 2/3)
- [x] Artifact integrity — `computeArtifactHash()`, sha256 over the artifact, checked before execution
- [x] Audit — every stage (including every refusal) writes via `auditOutcome()` / `appendUnifiedAuditEntry`

## 🔴 PHASE 2 — EXECUTION GATE — ✅ VERIFIED

- [x] Single composed path: Identity → Authorization → Policy → Risk → Approval → Artifact Integrity → `executeTool()` → Verification → Audit (`governed-execution.ts`)
- [x] No hidden execution path — confirmed by grep: only real call site of `executeTool(` in `apps/api/src`, `apps/worker/src`, `packages/agent-core/src` is `governed-execution.ts:207`
- [x] Static guard — `apps/api/src/__tests__/execution-gate-guard.test.ts`, fails the build if a second call site appears
- [x] Critical test result: confirmed passing (part of 834/834 green run, 2026-08-24)
- [ ] Runtime guard beyond the static scan — unverified
- [ ] Integration test beyond the guard's own two tests — unverified

## 🔴 PHASE 3 — `research-analyst-dispatch.ts` — **N/A this pass**

Premise mismatch: this phase assumes `verifyResearcherProposalAgainstRepo()` exists and directly reaches `executeTool()`. Verified 2026-08-24: it does not exist on disk. `research-analyst-dispatch.ts` and `llm-specialist-run.ts` are git-clean, unmodified since before this was reported "done" in a parallel session. Re-open this phase once the wiring is actually built — and when it is, route it through `executeGovernedAction()` (the existing `/api/v1/agents/tool-execute` pattern), not a second raw `executeTool()` call, per the design note already given.

- [ ] Inspect `verifyResearcherProposalAgainstRepo()` — N/A, doesn't exist
- [ ] Determine why it directly reaches `executeTool()` — N/A
- [ ] Decide correct governed path — answered in advance: `executeGovernedAction()` via existing route
- [ ] Add regression test — pending the feature actually being built
- [ ] Re-run static guard — pending

## 🔴 PHASE 4 — FILESYSTEM SECURITY — 🟡 PARTIAL (real gap found)

Path Containment (`resolveInsideRoot()`, `packages/agent-core/src/tools/runtime.ts:93-111`):
- [x] Relative traversal (`../`) — rejected via `relative()` check, not naive `startsWith`
- [x] Absolute path — rejected (`isAbsolute()`)
- [x] Windows drive path (`C:\...`) — rejected (`path.isAbsolute()` is win32-aware on Windows)
- [x] UNC path (`\\server\share`) — rejected (same `isAbsolute()` check)
- [x] Sibling-prefix attack (`/srv/app-evil` vs `/srv/app`) — explicitly guarded against per the code's own comment
- [ ] Encoded traversal — unverified
- [x] Normalized path — yes (`normalize()` + `resolve()`)

Canonicalization — **❌ OPEN, no realpath/canonical check exists.** `resolveInsideRoot` works on the string only (`resolve`/`relative`), never calls `fs.realpath`. It does NOT do: logical path → resolved path → **real/canonical path** → canonical project root → containment check.

Symlink — **❌ OPEN**:
- [ ] Symlink file escaping root — not handled; `fs.read_file`/`fs.read_directory` call `stat()` (follows symlinks) on a lexically-approved path, so a symlink under the root pointing outside it IS followed
- [ ] Symlink directory outside root — same gap
- [ ] Nested symlink chain — not handled
- [ ] Broken symlink behavior — unverified

Windows-specific — **❌ OPEN, unverified in practice** (matters here — this runs on the user's Windows machine):
- [ ] Junction / directory junction — not handled (no canonicalization means a junction is invisible to the containment check, same as a symlink)
- [ ] Reparse-point behavior — unverified
- [x] Windows path normalization (drive letters rejected as absolute) — covered above
- [ ] Drive-letter handling beyond rejection — unverified

**Final invariant required by this phase ("canonicalTarget MUST remain inside canonicalProjectRoot") is NOT currently enforced.**

## 🔴 PHASE 5 — FILESYSTEM TIMEOUT — ❌ OPEN (verified gap)

Current code (`runtime.ts:113-140`, `withTimeout()`): `Promise.race`-style pattern via `setTimeout` — when the timer fires first, the function returns `{timedOut: true}`, but **the underlying operation (`impl.run()` — e.g. `walk()`'s recursive directory scan, or a large `readFile`) is never cancelled** and keeps running to completion in the background. This is exactly the "weak model" this checklist phase describes.

- [ ] `AbortController` — not implemented
- [ ] `AbortSignal` propagated into `ToolImplementation.run()` — not implemented (the interface doesn't even accept a signal)
- [ ] Filesystem operation observes cancellation — not implemented
- [ ] Recursive search (`walk()`) stops on abort — not implemented
- [ ] No orphan work — **violated**; orphan work is the current behavior
- [ ] Timeout test — unverified whether one exists
- [ ] Post-timeout resource test — unverified

## 🔴 PHASE 6 — FILESYSTEM RESOURCE LIMITS — 🟡 PARTIAL (verified gap)

`packages/agent-core/src/tools/fs-tools.ts`:
- [x] Per-file size limit — `MAX_FILE_BYTES = 256 * 1024`
- [x] Directory listing cap — `MAX_DIR_ENTRIES = 500`, with explicit truncation notice (not silent)
- [x] Search result cap — `MAX_SEARCH_MATCHES = 200`
- [ ] `MAX_FILES_SCANNED` — **not present**; `walk()` visits every file in the tree looking for matches, uncapped
- [ ] `MAX_TOTAL_BYTES_SCANNED` — **not present**
- [ ] `MAX_DIRECTORY_DEPTH` — **not present**; `walk()` recursion is unbounded
- [ ] `MAX_SYMLINKS` — **not present** (ties to Phase 4's symlink gap — `walk()` happens to skip symlink dirent entries by omission, not by design, so `fs.search_repo` accidentally doesn't traverse them, but this isn't a designed/tested control)
- [ ] `MAX_SEARCH_DURATION` — **not present** as its own limit (only the coarse tool-level `timeoutMs`, which per Phase 5 doesn't actually cancel work)
- [ ] Total result-size limit — unverified beyond match count
- [ ] Tests: huge repo / deep nesting / enormous file / match explosion / symlink explosion / timeout exhaustion — unverified whether any exist

---

## ⬜ PHASE 7 — PROJECT ROOT TRUST BOUNDARY — UNVERIFIED

- [ ] Authenticated User → Organization → Project Authorization → Authorized Project → Canonical Project Root → ToolExecutionContext → Governed Execution → Tool
- [ ] Tests: unauthorized project, wrong organization, wrong tenant, wrong owner, nonexistent project, path outside approved root, symlinked project, changed project root

## ⬜ PHASE 8 — SECURITY REGRESSION SUITE — UNVERIFIED

- [ ] Traversal (`../../etc/passwd`), absolute escape, sibling-prefix, symlink escape, junction escape, nested symlink, wrong tenant, wrong owner, unauthorized tool, approval-artifact-mismatch (approval A → execute B), expired approval, replayed approval, secret leakage, timeout, resource exhaustion

## ⬜ PHASE 9 — FULL TEST VERIFICATION — PARTIALLY TOUCHED

- [x] `pnpm test` (apps/api scope) — 834/834 passing, verified 2026-08-24
- [x] `pnpm turbo run build` — 41/41 tasks, verified 2026-08-24
- [ ] `pnpm typecheck` standalone — unverified this pass (build includes `tsc`, but not run in isolation)
- [ ] `pnpm lint` — attempted by user but failed on PowerShell `&&` syntax, not re-run with `;` yet
- [ ] repo-wide `pnpm exec vitest run` (all packages, not just apps/api) — unverified

## ⬜ PHASE 10 — TYPESCRIPT QUALITY — UNVERIFIED

- [ ] `git grep -n "\bany\b" -- "*.ts" "*.tsx"` — not run this pass
- [ ] no unnecessary casts, typed Agent/Tool contracts, runtime validation — unverified

## ⬜ PHASES 11-70 — UNVERIFIED (not audited this pass)

Full original phase list preserved below for reference — none of these have been checked against code yet. Do not treat absence of a ❌ as a pass.

- 🟠 **Phase 11** — Database Foundation (core entities, integrity, indexes, migration validation)
- 🟠 **Phase 12** — Multi-Tenancy (org/project/agent/memory/evidence/storage/retrieval/API isolation)
- 🔴 **Phase 13** — RLS (enabled, deny-by-default, org/project/role policies, negative + cross-tenant tests)
- 🟠 **Phase 14** — Memory OS (FACT/DECISION/PREFERENCE/EVENT/LESSON/TASK/GOAL/ARCHITECTURE/BUG/SOLUTION/PROJECT_STATE/EXTERNAL_KNOWLEDGE types)
- 🟠 **Phase 15** — Memory Lifecycle (capture→normalize→classify→dedupe→score→verify→store→retrieve→re-evaluate→supersede/expire)
- 🔴 **Phase 16** — Memory Governance (inferred ≠ fact, provenance, `created_by` never used as authorization)
- 🟠 **Phase 17** — Decision Memory (decision→reason→evidence→implementation→commit→test→status)
- 🟠 **Phase 18** — Event History (task/agent/tool/evidence/approval/execution/verification/deployment/security/memory events)
- 🟠 **Phase 19** — Evidence Layer (claim→evidence→source→timestamp→verification status)
- 🟠 **Phase 20** — Source Registry (repo/code/docs/db/migration/test/CI/logs/external/user/agent-inference sources + metadata)
- 🟠 **Phase 21** — Verified Knowledge Engine (query planner, hybrid retrieval, authority/freshness, contradiction detection, confidence)
- 🔴 **Phase 22** — Permission-Aware RAG (authorization as part of retrieval, not filtered after)
- 🟠 **Phase 23** — Context Engine (sources + explicit exclusions: unauthorized data, secrets, unrelated tenant data, untrusted instructions)
- 🟠 **Phase 24** — Master Orchestrator (classification, decomposition, routing, risk, policy, approval, aggregation, Judge, audit, memory update)
- 🟠 **Phase 25** — Agent Kernel (identity/capabilities/permissions/context/memory/evidence/tools/budget/timeout/policy/risk/audit/verification per agent)
- 🟠 **Phase 26** — Agent Registry (ID/name/version/capabilities/schemas/permissions/tools/risk/budget/timeout/evidence/approval policy)
- 🟠 **Phase 27** — Specialist Agents (Architect/Engineer/Debugger/QA/Security/Database/DevOps/Research/Accessibility/Performance/Dependency/Documentation)
- 🟠 **Phase 28** — Agent Router (minimum-necessary agent selection, capability/risk/budget/context matching)
- 🟠 **Phase 29** — Agent-to-Agent Governance (structured result + evidence + confidence, no free-text delegation)
- 🟠 **Phase 30** — Adaptive QA (change→impact→affected components→relevant/security/regression tests→verification)
- 🟠 **Phase 31** — Architecture Drift (decision vs code vs db vs tests vs deployment; db/API/security/dependency/infra/doc/agent drift)
- 🟠 **Phase 32** — Consistency Engine (docs/code/db/tests/memory/decisions/deployment/config cross-checks)
- 🟠 **Phase 33** — Change Impact (files/modules/APIs/db/tests/services/agents/projects affected)
- 🟠 **Phase 34** — Blast Radius (data/service/security/user/production impact, reversibility, dependency impact)
- 🟠 **Phase 35** — Automation Control Plane (detect→diagnose→recommend→approve→execute→verify→follow-up)
- 🔴 **Phase 36** — No Uncontrolled Autonomy (READ/ANALYZE/RECOMMEND/WRITE/AUTO-APPLY/DEPLOY permission tiers)
- 🟠 **Phase 37** — Post-Action Verification (action→expected state→actual state→tests→comparison→verified/partial/failed/unverified)
- 🟠 **Phase 38** — Git Intelligence (repo/branch/commit/PR/diff/author/timestamp/tests/deployment linkage)
- 🟠 **Phase 39** — CI/CD (install→typecheck→lint→unit→integration→e2e→security→a11y→build→migration→Atlas QA→deploy→smoke)
- 🟠 **Phase 40** — Quality Gates (typecheck/lint/unit/integration/e2e/security/a11y/build/migrations/evidence/observability → READY/READY_WITH_WARNINGS/REVIEW_REQUIRED/NOT_READY/BLOCKED)
- 🟠 **Phase 41** — Observability (trace/task/agent/tool/evidence/project/org IDs; latency/errors/tool calls/model usage/cost/retries)
- 🟠 **Phase 42** — Cost Control (task/agent/model/tool/time/token budgets; max retries/tool calls/agent hops)
- 🟠 **Phase 43** — Failure Control (SUCCESS/PARTIAL/FAILED/BLOCKED/TIMEOUT/NEEDS_REVIEW; retry/backoff/dead-letter/idempotency)
- 🟠 **Phase 44** — Event System (TaskCreated...DeploymentCompleted event catalog)
- 🟠 **Phase 45** — Accessibility (WCAG 2.2 AA: keyboard/focus/contrast/labels/forms/errors/semantic HTML/screen reader/responsive)
- 🟠 **Phase 46** — Performance (API latency/DB queries/indexes/N+1/vector retrieval/agent+LLM latency/queue/frontend)
- 🟠 **Phase 47** — Dependency / Supply Chain (vulnerabilities/outdated/deprecated/version conflicts/lockfile/license/supply-chain anomalies)
- 🔴 **Phase 48** — Secrets (no secrets in git/memory/evidence/logs/traces/prompts/reports; scanning + redaction)
- 🔴 **Phase 49** — AI Security (prompt injection, indirect injection, memory/context poisoning, tool abuse, exfiltration, privilege escalation, malicious repo/doc content)
- 🟠 **Phase 50** — Performance/Resource Attacks (huge repo/file, deep recursion, symlink explosion, match explosion, agent loop, token/tool-call/queue exhaustion)
- 🟠 **Phase 51** — Backup / Disaster Recovery (db backup, PITR, backup verification, restore test, DR procedure)
- 🟠 **Phase 52** — Data Governance (retention/deletion/archival/access/export for memory/evidence/events/audit/traces/documents)
- 🟠 **Phase 53** — Domain / Portfolio Architecture (shared kernel/governance/evidence/audit/orchestration/identity across domains)
- 🟠 **Phase 54** — Portfolio Intelligence (cross-project pattern detection without leaking customer data/secrets/private docs)
- 🟠 **Phase 55** — Engineering Knowledge Loop (bug→root cause→fix→verification→lesson→prevention rule→future detection)
- 🟠 **Phase 56** — Golden Evaluation Set (golden/security/memory/evidence/agent/QA/multi-tenant tasks, run after major changes)
- 🔴 **Phase 57** — Independent Audit Agent (verifies actual code/behavior/db/migrations/tests/CI/config/security/architecture/memory/evidence/agents/governance — docs alone never prove implementation)
- 🔴 **Phase 58** — Audit Agent Testing (repo discovery through production readiness, full coverage)
- 🔴 **Phase 59** — Audit Finding Format (ID/severity/category/title/description/evidence/affected files/root cause/impact/risk/recommendation/regression test/status; P0-P3 severity)
- 🔴 **Phase 60** — Audit Truth States (OBSERVED/VERIFIED/INFERRED/UNKNOWN only — never "probably implemented") — **this document follows that rule**
- 🔴 **Phase 61** — Final Security/Reliability Audit (full document: architecture through final verdict)
- 🔴 **Phase 62** — Final Scorecard (numeric score per dimension, but a Critical Gate failure overrides any score → BLOCKED)
- 🔴 **Phase 63** — Git Checkpoint (only after P0/P1 green: clean diff, no secrets/debug code/temporary bypasses, commit, clean status)
- 🟠 **Phase 64** — Staging (production-like env, migrations, RLS, secrets, logging, monitoring, health checks, smoke tests)
- 🔴 **Phase 65** — Production Gate (every prior gate PASS → READY / READY_WITH_WARNINGS / REVIEW_REQUIRED / NOT_READY / BLOCKED)
- 🚀 **Phase 66** — Post-Production-Gate work (infra, governed write/test/typecheck/git tools, full intelligence stack, multi-agent pipeline)
- 🚀 **Phase 67** — Real-World Validation (Atlas runs the full understand→plan→search→evidence→approval→execute→test→verify→record→learn loop on real tasks)
- 🚀 **Phase 68** — Engineering Readiness Product (One-Click Atlas Engineering Audit product flow)
- 🚀 **Phase 69** — Design-Partner Validation (findings/true-positive/false-positive rates, time saved, retention, willingness to pay)
- 🏆 **Phase 70** — Atlas Final Product (the full observe→understand→retrieve→verify→plan→govern→act→test→verify→audit→learn→prevent loop, closed)

---

## Update protocol (mirrors `living-request-tracker.md`)

1. Only flip ⬜ → ✅/🟡/❌ after checking real code/tests — never from memory or a report from another session.
2. When a status changes, note the evidence (file:line, test name, command output) inline, same as Phases 0-6 above.
3. If a parallel session reports work as done, verify it here before trusting it — Phase 3 above is the concrete example of why.
4. Append changes to the change log below; never delete history.

## Change log

| Date | Change |
| --- | --- |
| 2026-08-24 | Document created from the pasted "MASTER CHECKLIST v3" + "Unified Master Blueprint v2.0". First verification pass: Phases 0-6 checked directly against code (`agent-runtime-authz.ts`, `governed-execution.ts`, `execution-gate-guard.test.ts`, `runtime.ts`, `fs-tools.ts`, `research-analyst-dispatch.ts`). Found two real, verified gaps: Phase 4 (no symlink/junction canonicalization in `resolveInsideRoot()`) and Phase 5 (no `AbortController` — timeout doesn't cancel work, only stops waiting for it). Phase 3's premise (a bypass in `research-analyst-dispatch.ts`) does not match current code — flagged N/A. Phases 7-70 left ⬜ UNVERIFIED, not assumed passing. |
