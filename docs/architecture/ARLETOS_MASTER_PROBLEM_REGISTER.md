# ArletOS Master Problem Register

**Role:** ACTIVE MASTER for the Taqonu / ArletOS **Web + Studio** workstream. One control document for current status, open gaps, human decisions, and evidence. Source documents stay intact and are referenced, not copied.

**Overall status:** 🔴 **OPEN**. An item is **CLOSED** only with evidence. OPEN register ≠ broken product: the Web/Studio core exists (§11). What remains is verification, decisions, and the gaps in §6.

**Last consolidated:** 2026-09-26 against HEAD `10714506bd22f61399cc2155ee9ef93a8a02a03d`. Stage 4 implementation record added 2026-09-26 (§7.7).

---

## 0. At a glance

| Item | Value |
| --- | --- |
| **Current stage** | Stage 4: ✅ **CLOSED (local verification, 2026-09-26)**: implemented; API 181/1852 passed, Stage 9 19 passed, typechecks clean (§7.7). Not Production-verified. Remaining findings assigned to later stages (§7.7). Stage 5 not started |
| **Next authorized action** | See §15 |
| ✅ Closed | Stage 1 / 1A, Stage 2 (local), ARL-HYDRATION-001 (§5) |
| 🕘 Historical proof | STAGE_9 program, 19 passed at `2587d1b`. Valid history; **requires regression** on current HEAD (§5) |
| Current Stage 9 E2E run | Earlier run (before Stage 4): **NOT GREEN**, 16 passed, 1 failed, 2 flaky, exit 1. After Stage 4 (2026-09-26): **19 passed, exit 0**. Earlier findings A–C not reproduced, cause unexplained (§11.1, §7.8) |
| 🟡 Implemented, unverified | 10 items (§11) |
| 🔴 Open gaps | 7: ARL-WS-001..007 (§6) |
| ✅ Human decisions | D1–D10 and new decisions A–C **approved as direction** on 2026-09-26 (§7.2). None is implemented or verified by approval. Open inside approval: D2 thresholds, D7/D9 detailed placement (Stage 6), D10 ADR, A legacy records, C path mapping. Repository reconciliation in §7.3 |
| ⛔ Environment blocked | 2 (§12). Two more items are unverified, not blocked (§12) |
| 📄 Documentation gaps | 3: Stage 1 evidence detail, Stage 2 evidence artifact, per-stage closure criteria (§3, §5) |
| Golden Loop | **COMPLETE LOOP NOT PROVEN** (§9) |
| Production | **NOT VERIFIED** for Web/Studio (§12) |

### Status legend

The same markers are used in every section.

| Marker | Meaning |
| --- | --- |
| ✅ CLOSED / VERIFIED | Closed or verified with evidence. Location stated (local or production). |
| 🕘 HISTORICAL | Evidence that was true when recorded. Not proof of current HEAD. |
| 🟡 IMPLEMENTED_UNVERIFIED / PARTIAL / UNVERIFIED | Code exists, or a change landed; runtime behavior not verified in this workstream. |
| 🔴 OPEN / MISSING | Gap or capability that does not exist or is not proven. |
| 🧭 DECISION_REQUIRED / PARTIALLY_DEFINED | Needs Arlet's product or architecture decision. Not an implementation task. |
| 🔒 LOCKED | Direction locked in a source document. Implementation still needs verification. |
| ✅ APPROVED (direction) | Approved by Arlet as architectural direction. Not implementation, not verification. |
| ⛔ BLOCKED | Environment blocked. Not a product defect. |
| 📄 DOC-GAP | Evidence or criteria are not recorded in the repository. Not invented here. |
| ⚠️ RECORDED | Current behavior recorded; the policy is pending a decision |
| ▶️ NEXT | The next stage in §3. Later stages are NOT STARTED. |

§14 uses CONFLICTED, STALE, and RECORDED for statements in other documents, not for Web/Studio behavior.

Rules:

- Agent claim ≠ completion. Commit ≠ verification. Code existence ≠ working behavior. A test existing ≠ a test passing. A historical pass ≠ a current regression pass.
- Local runtime evidence ≠ Production evidence. Future direction ≠ current implementation.
- Human decisions are not implementation tasks. Nothing in §7 is authorized for implementation until Arlet locks it.
- Other documents keep their own internal stage numbering. Do not map it onto the sequence in §3 (see §3 and §13).

### Past / Current / Future

| Time | What belongs here | Where |
| --- | --- | --- |
| **PAST** | Stage 1 and Stage 2 closures; hydration investigation; STAGE_9 program (19 passed); 2026-09-20 Studio evidence refresh | §5, §13 |
| **CURRENT** | This master; code state at HEAD (§11); open gaps (§6); open decisions (§7); environment blockers (§12); stale statements in other documents (§14) | §2–§4, §6–§12, §14 |
| **FUTURE** | Direction in FD; remaining WSP plan items (not yet implemented); the intended error-knowledge chain for ARL-WS-004; the "future task" of each decision. None of this is implemented or authorized by being listed. | §6, §7, §13 |

---

## 1. Scope

In scope, and only where it directly affects Web/Studio: Web navigation, Dashboard, Projects, project/workspace context, Studio entry and workspace, file tree and editor, the Studio engineering workflow, Ask Agent and the personal agent inside Web/Studio, patch proposal / review / approval / apply, Checks, verification, Web/Studio memory behavior, error learning relevant to the personal agent, Studio file operations, Web/Studio accessibility and i18n/RTL, Web/Studio security and reliability, and Web/Studio production verification.

Out of scope. **REFERENCE ONLY** when a boundary fact is needed:

- Atlas-wide registers: `remaining-work.md`, `gap-matrix.md`, `product-gap-inventory-2026-09-18.md`, `ATLAS_MASTER_TRUTH.md`
- Control: `CONTROL_10_OF_10_MASTER_PLAN.md`
- Admin implementation, general Atlas architecture, unrelated Fabric work, and connected applications

## 2. Baseline

| Field | Value |
| --- | --- |
| HEAD | `10714506bd22f61399cc2155ee9ef93a8a02a03d` (`main` == `origin/main`) |
| Working tree | At HEAD: untracked `cookies.txt` only, plus uncommitted edits to this file until they are committed. Never open, stage, or commit `cookies.txt`. |
| Last closed stage | Stage 2 (local runtime) |
| Production | **NOT VERIFIED** for Web/Studio (see §12) |

Evidence classes (never collapse them): **SOURCE**, **RUNTIME (local)**, **PRODUCTION**.

## 3. Current working sequence

This is the working sequence of the current Web/Studio workstream. It was first recorded in this document on 2026-09-26. Earlier repository documents do not contain it.

| # | Stage | Status |
| --- | --- | --- |
| 1 | Lock Closure (Stage 1 / 1A) | ✅ **CLOSED** (📄 DOC-GAP, see §5) |
| 2 | Real Project Entry Journey Verification | ✅ **CLOSED** (local) |
| 3 | Human Decisions | ✅ **CLOSED**: technical review done; D1–D10 and A–C approved as direction by Arlet on 2026-09-26 (§7.1–§7.2). Implementation not started |
| 4 | Agent Architecture / Boundaries | ✅ **CLOSED** (local verification, 2026-09-26; D-A, D-B, D-C approved; §7.7–§7.8). Not Production-verified |
| 5 | Actual Golden Engineering Loop | NOT STARTED |
| 6 | Web IA / Navigation | NOT STARTED |
| 7 | UI / Accessibility / i18n | NOT STARTED |
| 8 | Security / Reliability | NOT STARTED |
| 9 | Regression | Historical pass (19 passed, `2587d1b`). Run before Stage 4: NOT GREEN (16 passed, 1 failed, 2 flaky). Run after Stage 4: **19 passed, exit 0** (§11.1). Stage 9 not formally closed: findings A–C unexplained |
| 10 | Production Proof | NOT STARTED (environment-blocked items in §12) |

A side investigation (hydration, ARL-HYDRATION-001) ran after Stage 2 and is ✅ **CLOSED**.

📄 Closure criteria: the repository does not record per-stage closure criteria for any stage (DOC-GAP). None are invented here.

**Stage numbering: do not merge.** "Stage N" means different things in different documents:

| Numbering | Where | Example: what "Stage 9" means there |
| --- | --- | --- |
| **Current working sequence** | This section | Regression |
| WSP internal stages 0–10 | `WEB_STUDIO_MASTER_PLAN_2026-09-26.md` | File operations |
| STAGE_9 program (substages 9.1–9.10, S9-01..25) | `STAGE_9_MASTER_PLAN_2026-09-26.md` | The whole earlier program: auth, Studio, SoD, AVR, i18n, a11y (🕘 HISTORICAL) |
| FD numbered work order 1–10 | `studio-web-future-direction-2026-09-25.md` | File operations on disk (mirrors WSP) |

## 4. Current stage

**Stage 3 — Human Decisions: ✅ CLOSED (2026-09-26).** Arlet approved D1–D10 and new decisions A–C as architectural direction (§7.2). Approval is not implementation.

**Stage 4 — Agent Architecture / Boundaries: ✅ CLOSED (local verification, 2026-09-26).** Arlet approved D-A, D-B, D-C and authorized implementation. The implementation record, tests, verification, and remaining findings are in §7.7. §7.4–§7.6 are kept unchanged as the pre-implementation history. Stages still run one at a time; Stage 5 has not started.

## 5. Closed work (PAST)

| Item | Status | Evidence | Evidence gap |
| --- | --- | --- | --- |
| Stage 1 / 1A — Lock Closure | ✅ **CLOSED** (2026-09-26) | Stage table in the committed version of this file (`4698ee9`): "Evidence lock baseline (2026-09-26)." | 📄 **DOC-GAP:** no evidence detail recorded in the repository. Do not invent any. |
| Stage 2 — Project entry journey | ✅ **CLOSED**. RUNTIME, local only. | Journey `Projects → AMD → Open Studio → same project ID → Studio resolves project → same workspaceRoot → file tree → selected workspace`. HE and EN. Project `bc8c1497-c183-443e-98fd-5e4efb7fd3a3`. Workspace root `C:\Users\User\project\github\amd`. Source: Stage 2 verification pass, 2026-09-26. | 📄 **DOC-GAP:** no evidence artifact (log or screenshot) is committed. Not Production proof. |
| ARL-HYDRATION-001 | ✅ **CLOSED**, VERIFICATION INFRASTRUCTURE ISSUE | Full closure record at the end of this document. | None |

**Stage 2 chronology.** Stage 2 was run on code at or after `93e1ff2`, because before that commit Projects "Open Studio" did not carry the project id (WSP Stage 1 text). **INFERRED.**

**Later commits.** Commits `ad55e6c` (Studio layout, AppShell, `LanguageSwitcher`, welcome) and `c183e6f` (platform auth-path contract) landed after the Stage 2 and hydration evidence. That does not reopen either item. Re-checking the entry journey on current code belongs to §3 Stage 9 (Regression).

**🕘 Prior local proof (HISTORICAL, not a stage of §3).** `STAGE_9_MASTER_PLAN_2026-09-26.md` S9-01..S9-25, **LOCALLY VERIFIED** (`pnpm test:e2e:stage9`, 19 passed).

- **Covers:** authenticated login and session, Studio entry, project picker and switching, isolation, refresh, deep links, CODE_ENGINEER Ask Agent, patch proposal, requester `decide-and-execute` 403, distinct-decider Apply → Verify → Rollback on disk, EN/HE/AR/RTL, and authenticated axe.
- **Does not cover:** the Personal Supervising Agent, Production, or CI.
- **When:** recorded at `51714f8` and re-run at `2587d1b` (2026-09-26, 01:36–01:45).
- **Surfaces changed after that run, with no re-run recorded:**
  - `644c4f3`: `PatchesPanel`
  - `93e1ff2`: Studio page, `StudioPatchWorkflow`, `PatchesPanel`, AppShell, Projects
  - `0353c05`: AppShell, Projects, Dashboard
  - `73a3662`, `d68038a`: `code.ts`
  - `08d21ec`: auth
  - `ad55e6c`: Studio page, AppShell, `LanguageSwitcher`
- **Current status:** on current HEAD this proof is HISTORICAL and REQUIRES REGRESSION (§3 Stage 9). A current run of the same suite is **not green** (16 passed, 1 failed, 2 flaky, exit code 1; §11.1). The historical 19 passed stays as history and does not prove current HEAD.
- **Update 2026-09-26 (after Stage 4):** a run on the Stage 4 working tree passed 19, exit 0 (§11.1). The sentence above is kept as the earlier state.
- **How the run executed:** the decider executed the Apply and Rollback disk writes through HTTP `decide-and-execute` (`e2e/stage9/patch-flow.ts`). The Studio Apply and Rollback buttons were proven only to mint the approval (202). Verify was clicked in the Studio UI.

**Hydration note.** `suppressHydrationWarning` already exists on `<html>` and `<body>` in `apps/web/app/[locale]/layout.tsx`. It was added in `e7142b1` (2026-09-19), before the investigation, and the investigation added none, which matches the closure record. The Chrome and Edge non-reproduction predates `ad55e6c`, which changed AppShell and `LanguageSwitcher`. That check is therefore HISTORICAL. It does not reopen the item, because there is no new evidence.

## 6. Open Web/Studio gaps (CURRENT)

| ID | Gap | Status | Priority | Linked decision |
| --- | --- | --- | --- | --- |
| ARL-WS-001 | Patch rejection flow missing | 🔴 **OPEN** | — | D4 |
| ARL-WS-002 | Studio file operations incomplete; behavior and actor authorization need policy | 🔴 **OPEN** | **HIGH** (security / governance; technical review, approved D3) | D3 |
| ARL-WS-003 | UNDERSTAND has no verifiable completion criterion | 🔴 **OPEN** / 🧭 DECISION_REQUIRED | — | D2 |
| ARL-WS-004 | Personal-agent error knowledge architecture incomplete | 🔴 **OPEN** (architecture gap, not scheduled) | **HIGH** (set by Arlet, 2026-09-26) | — |
| ARL-WS-005 | Complete Golden Engineering Loop not proven end-to-end | 🔴 **OPEN** | — | D2 |
| ARL-WS-006 | Web/Studio accessibility verification incomplete; current authenticated Studio contrast violation (§11.1 finding A) | 🔴 **OPEN** | — | — |
| ARL-WS-007 | Studio commit/push policy not finalized | 🔴 **OPEN** / 🧭 DECISION_REQUIRED | — | D5 |

Items that exist in code but are not verified are listed in §11, not here. Related code existing does not change these statuses.

### ARL-WS-001 — Patch rejection

`REJECTED` is declared in `patchStatusSchema` and only read in filters (`admin-oracle-queue.ts`, `remediation-pipeline.ts`). No route, service, or UI sets a patch to it. No rejection audit or recovery path.

### ARL-WS-002 — Studio file operations (SOURCE evidence)

| Operation | Current behavior | Status |
| --- | --- | --- |
| Move / rename file | `POST /api/v1/studio/file/move`, Studio button. Files only (directories are refused). Creates the destination's parent folders. | 🟡 Implemented, unverified |
| Overwrite on move | An existing destination is refused | 🟡 Implemented, unverified |
| Move authorization | Human-only: agent actors get 403 | 🟡 Implemented, unverified |
| Create file | Possible through `PUT /api/v1/studio/file`, which creates missing parent folders (SOURCE: `workspace-browser.ts`). No new-file UI; Web only saves the open file. | 🟡 API only |
| Overwrite on PUT | PUT silently overwrites an existing file | ⚠️ Recorded; policy in D3 |
| PUT authorization | *Before Stage 4:* project write access only, no agent-actor check. **Stage 4 (§7.7 S4-7):** agent-actor requests are denied (403) before any write, at parity with move; the audit records `actorKind: USER` for the human write. | ✅ Agent part corrected; unit/route tests pass. Runtime unverified |
| Atlas-self boundary | Both PUT and move apply it, returning 202 until a second identity approves | 🟡 Implemented, unverified |
| Create folder | Not implemented. Folders appear only as a side effect of PUT or move. | 🔴 Missing |
| Delete file | Not implemented | 🔴 Missing |
| Delete folder | Not implemented | 🔴 Missing |
| Empty folder | Not implemented | 🔴 Missing |

### ARL-WS-003 — Successful UNDERSTAND

Only conceptual loops exist (ADR-009, managed-system). No verifiable criterion.

### ARL-WS-004 — Personal-agent error knowledge

| Element | Current state |
| --- | --- |
| Error events | Exists in source (`DomainEvent`) |
| Recurring-failure grouping | 🟡 `recurring-failure.ts` groups verified failures by signature **at read time** and returns an **INFERRED** recommendation. It writes nothing. |
| Persistent Problem / Knowledge record | 🔴 Missing |
| Duplicate-memory prevention on write | 🔴 Missing (`commitMemory` does not check) |
| Durable event → problem → verified-resolution link | 🔴 Missing |
| Re-validation of a previous resolution | 🔴 Missing |
| Knowledge update only when evidence changes | 🔴 Missing |

**FUTURE (intended direction, not implemented, not authorized):**

```text
ERROR → EVIDENCE → PROBLEM IDENTITY → VERIFIED RESOLUTION → REVALIDATION → REUSABLE KNOWLEDGE
```

Why it matters: the same error recurring must not create uncontrolled duplicate personal-agent memory.

### ARL-WS-005 — Golden loop end-to-end

Only a segment is locally verified, and that evidence is historical (§9). CORRECT and RE-RUN are conceptual. DIAGNOSE is partial.

### ARL-WS-006 — Accessibility

- Unauthenticated hamburger `test.fixme` preserved in `e2e/a11y.spec.ts` (STAGE_9 §9 item 8, B9).
- The authenticated hamburger and Studio axe checks passed locally in STAGE_9 (STAGE_9 §7.9, `a11y-studio.spec.ts`). That is 🕘 HISTORICAL; AppShell changed in `ad55e6c`, so it REQUIRES REGRESSION.
- Visible-focus paint **NOT PROVEN** (`remaining-work.md`, B4 row, REFERENCE ONLY).
- 🔴 **CURRENT failure** (current Stage 9 run, §11.1 finding A): `e2e/stage9/a11y-studio.spec.ts:28`, axe `color-contrast` (wcag2aa, wcag143, impact serious). Contrast 2.89:1, expected 4.5:1: foreground `#6f7680` on background `#2a303a`, 11px (8.3pt) normal weight. Affected elements include "Build ▸" and "Tools & Resources". The authenticated Studio a11y check does **not** currently pass. Not fixed.
- Update 2026-09-26: the same check passed in the post-Stage-4 Stage 9 run (§11.1). Nothing was changed for it; the cause of the earlier failure is **INSUFFICIENT_EVIDENCE**. The item stays OPEN.

### ARL-WS-007 — Commit / push policy

No `git.commit` or `git.push` in the governed Git catalog. FD calls this intentional, but FD is direction only.

## 7. Human decisions (CURRENT)

None of these authorizes implementation. "Implementation verified?" refers to the current behavior column. **This table records the decision state before approval.** The approval of 2026-09-26 is in §7.2, and the repository reconciliation is in §7.3.

| # | Topic | Current state | Decision status | Implementation verified? | Future task (after decision) |
| --- | --- | --- | --- | --- | --- |
| D1 | Project / workspace entry | Projects and Dashboard pass `?project=` (`studioProjectHref`). With no project, `/studio` shows "pick project" and does not auto-select. A missing `workspaceRoot` shows a "need root" notice. | 🧭 **PARTIALLY_DEFINED**: no-project and no-root behavior not decided | Projects path: ✅ local (Stage 2). Dashboard path: 🟡 no | Implement the approved entry rules |
| D2 | Successful UNDERSTAND | Not defined | 🧭 **DECISION_REQUIRED** | n/a | Define acceptance criteria, then verify |
| D3 | Create / delete / empty-folder / overwrite / actor | See ARL-WS-002 | 🧭 **DECISION_REQUIRED** | 🟡 no | Implement the approved set on the governed write path |
| D4 | Patch rejection | See ARL-WS-001 | 🧭 **DECISION_REQUIRED**: where rejection lives, audit, recoverability | n/a (missing) | Implement the approved rejection path |
| D5 | Commit / push inside Studio | Absent. FD calls "no commit" intentional. Push not addressed. | 🧭 **DECISION_REQUIRED** (to lock) | n/a | Implement or record INTENTIONALLY_NOT_SUPPORTED |
| D6 | Dashboard project selection | Selector starts from `?project=` (`useProjectQueryParam`) and is empty by default. Changing the selection does not update the URL. CTA and Checks carry the id. | 🧭 **PARTIALLY_DEFINED** | 🟡 no | Verify, then adjust per decision |
| D7 | Advanced capability discoverability | FD lists capabilities that exist but are not surfaced. WSP moves seven checks into Studio Checks. Gates, eval, artifacts, conflicts, contract, and metrics are "CONNECT" with no placement. | 🧭 **PARTIALLY_DEFINED** | 🟡 no | Place per decision. Do not delete capabilities. |
| D8 | Personal agent vs specialist agents | WSP binding rules and rooms, consistent with FD: the PSA is `psa:<ownerId>`, coordinates, is not a nav item, is not CODE_ENGINEER, and does not approve or apply. The 16 Fabric specialists are separate. Specialist memory is not personal memory. | 🔒 **LOCKED** (direction, WSP "DIRECTION LOCKED") | 🟡 no (§11) | Verify in Stage 4 |
| D9 | Global tools vs permanent navigation | Seven Checks locked as Studio Checks, with old routes as aliases (WSP). Everything else undefined. | 🧭 **PARTIALLY_DEFINED** | 🟡 no | IA work in Stage 6 |
| D10 | Web / Studio / Account / Control / Admin boundary | See §10 | 🧭 **PARTIALLY_DEFINED**: Account vs Settings placement and Atlas/core are not in WSP rooms | n/a | Lock the boundary table |

### 7.1 Stage 3 technical review (2026-09-26)

A technical review of D1–D10 was delivered on 2026-09-26. It was a review and a recommendation, not an implementation. It proposed the directions recorded in §7.2 and three new decisions (A–C).

**Correction recorded after the review (SOURCE evidence, 2026-09-26).** The review stated that specialist agents can read personal memory because of `emptyAllowedAgents: "default-open"` (`memory-pipeline.ts:872`). That was **overstated**:

- Fabric agent ids, including CODE_ENGINEER, which is in `FABRIC_AGENT_IDS` (`packages/shared/src/constants/agents.ts:12`), resolve to a Control profile with `personalScope: false` (`packages/shared/src/platform/control-agent-profile.ts:222-245, 316-335`).
- `memoryIsVisibleToAgent` checks that profile first and denies when the profile does not grant the read (`memory-pipeline.ts:1030-1041`).

What remains default-open:

- (1) calls that omit the requesting agent id, which is the intended rule for human surfaces but also applies to any agent path that fails to pass an id;
- (2) agent ids with no governance profile (`controlGovernedMemoryAllows` returns `governed: false, allowed: true`, `control-agent-profile.ts:394-402`).

That residual behavior contradicts approved Decision A. The review's other findings stand. (Refined in §7.5: Fabric profiles deny **all** memory reads, not only personal ones.)

### 7.2 Human approval record

**Arlet approved D1–D10 and new decisions A–C on 2026-09-26** as the architectural direction of the technical review (§7.1). Status chain:

```text
TECHNICAL RECOMMENDATION → ✅ HUMAN APPROVAL (2026-09-26) → APPROVED ARCHITECTURAL DIRECTION → FUTURE IMPLEMENTATION (not started)
```

Approval is **not** implementation and **not** verification. The table above keeps the decision state before approval, as history.

| # | ✅ Approved direction (summary) | Still open inside the approval |
| --- | --- | --- |
| D1 | Projects → Studio keeps the project id. `/studio` without a project shows the picker; no silent selection. Invalid or inaccessible id shows a generic "Project not found / no access". Project name and workspace root are visible in Studio. "Resume last project" only as an explicit choice. A project without a root stays selectable and shows Need Root. | — |
| D2 | UNDERSTAND is a visible, persisted understanding record linked to the proposal: project, root, target files, repository structure, relevant memories, epistemic state (OBSERVED / VERIFIED / INFERRED / UNVERIFIED / CONFLICTED / INSUFFICIENT_EVIDENCE), Guardian verdict, sources. Guardian BLOCK/CONFLICT and insufficient understanding of the target block proposal generation. Diagnostics and symbols are warnings. | Exact thresholds need runtime evidence |
| D3 | No silent overwrite. Existing-file writes need version or hash protection. Create never replaces. Agents do not write files directly; they go through proposal/patch. Direct human operations are explicitly authorized and audited. Supported set may include create file/folder, rename/move, delete file, delete empty folder. No recursive delete in the immediate scope. | — |
| D4 | Reason mandatory. Actor, timestamp, and audit recorded. REJECTED is terminal and stays visible. A correction is a new patch that supersedes the rejected one. Rejection may be evidence but never changes behavior automatically. | — |
| D5 | No push from Studio. No automatic commit; Apply ≠ commit. Commit intentionally unsupported for the current scope. Staging stays path-specific and governed. | — |
| D6 | `?project=<id>` is canonical. Selection updates the URL (replace preferred). Refresh and Back/Forward stay coherent. Studio and Checks inherit it. Invalid or inaccessible ids get a generic state. No silent substitution. | — |
| D7 | Primary navigation = major destinations. Global controls stay global. Workflow actions stay contextual. Advanced capabilities stay discoverable. | Detailed IA is Stage 6 work |
| D8 | PSA, CODE_ENGINEER, and Fabric specialists are distinct. Specialists get no unrestricted personal memory. Personal-memory access is fail-closed. Agent identity is explicit and registry-backed. An unregistered external agent gets no agent privileges, and `agentId: null` never becomes an authenticated agent. Personal context to a specialist is minimal, explicit, authorized, and audited. The PSA coordinates and requests but does not approve or Apply. | — |
| D9 | Primary: Dashboard, Projects, Studio, Agents & Knowledge, Account. Global: search, command palette, notifications, language, theme, identity, system status, help. Contextual: Checks, Explain, Diagnose, Review, file, patch, and memory operations. | Detailed placement is Stage 6 work |
| D10 | Studio requests and presents; Control decides and enforces policy. Studio must not become a hidden Control surface. Control owns policy enforcement, SoD governance, protected decisions, kill switches, and protected analysis. Tenant Web Admin stays distinct from Atlas Platform Admin. | Atlas/Core ↔ Web/Studio boundary must be documented (ADR) before implementation where evidence requires it. *Qualified 2026-09-26 by Arlet's architecture clarification (§7.9); boundary documented in ADR-025* |
| **A** | Memory access is identity-scoped and fail-closed, with scopes PERSONAL, PROJECT, SPECIALIST / DOMAIN, SYSTEM / SHARED. A missing restriction never broadens access. Legacy records need explicit reconciliation. | Legacy-record reconciliation |
| **B** | PERSONAL / APPLICATION AGENT, PSA, CODE_ENGINEER, FABRIC SPECIALIST, and COMPANION are distinct identities, each with its own purpose, authority, memory scope, and audit identity. No renaming or merging without a new decision. | — |
| **C** | One coherent logical verification model. Before implementation, map object identity, lifecycle, audit identity, verification, Apply, and rollback semantics of the current paths, then make the smallest safe reconciliation. | Mapping not done yet |

### 7.3 Repository reconciliation of the approved decisions (read-only, HEAD `178e0d8`)

Legend: MATCH · PARTIAL · CONTRADICTION · MISSING · INSUFFICIENT EVIDENCE. The evidence is SOURCE unless stated otherwise. Runtime behavior is not verified.

| # | Result | Evidence |
| --- | --- | --- |
| D1 | **PARTIAL** | MATCH: picker with no auto-select (`studio/page.tsx:309,804`), no-root project selectable with "(noRoot)" and Need Root (`:744,768`). CONTRADICTION: an unknown or inaccessible id leaves `selectedProject` null, so Need Root is shown instead of "not found / no access" (`:409,768`, INFERRED from source). INSUFFICIENT EVIDENCE: whether the name and root are always visible. MISSING: explicit "resume last". |
| D2 | **PARTIAL** | Guardian gathers repo structure, focus file, project knowledge, and memories, and blocks on BLOCK (`studio-agent-guardian.ts:32-80`, `code.ts:996`). MISSING: diagnostics, symbols, and related files in that record. INSUFFICIENT EVIDENCE: whether the evaluation is persisted and linked to the patch. |
| D3 | **CONTRADICTION** | `PUT /api/v1/studio/file` has no agent-actor check, unlike move (`code.ts:553-560` vs `:744`). It overwrites silently and creates parents (`workspace-browser.ts:466`). No version or hash check. MISSING: create folder, delete file, delete empty folder. MATCH: audit on write and move (`code.ts:574,771`). |
| D4 | **MISSING** | `REJECTED` exists only in `patch.schema.ts:23`. Nothing sets it; no reason, audit, or supersede link. |
| D5 | **MATCH** | No `git.commit` or `git.push` in the catalog. `git.add` stages exactly one path, `["add","--"]`, `pathArg: required` (`governed-command.ts:81-88`). |
| D6 | **PARTIAL** | MATCH: CTAs and Checks carry the id (`studioProjectHref`, `studioCheckHref`). CONTRADICTION: the Dashboard selection does not update the URL (`use-project-query.ts`). Invalid id: see D1. |
| D7 / D9 | **PARTIAL** (Stage 6 input) | Current nav groups main / ops / build / workspace (`AppShell.tsx:94-120`). The ops group lists five checks that are Studio aliases. About 14 routes are not in the nav. |
| D8 | **PARTIAL** | MATCH: Fabric specialists including CODE_ENGINEER, oversight agents, and the PSA resolve to Control profiles, and Fabric profiles deny memory reads (all reads, because records have no scope; §7.1, §7.5). The PSA request requires a Fabric id and rejects `psa:` (`psa-governed-request.ts:19`, `personal-supervising-agent.ts:737`). The PSA panel has no approve or apply call. CONTRADICTION: default-open when the agent id is omitted or unprofiled (§7.1). INSUFFICIENT EVIDENCE: whether the agent id and kind are visible in proposal and audit UI. |
| D10 | **PARTIAL** | MATCH: plane separation (ADR-021, REFERENCE ONLY). Tenant admin is labelled "not Atlas platform Admin" (`apps/web/app/admin/layout.tsx`). Studio decide-and-execute is a governed request from the user's own project (`StudioPatchWorkflow.tsx:179`). MISSING: Atlas/Core ↔ Studio ADR. |
| A | **PARTIAL** | Profile-based deny exists for governed agents (§7.1). MISSING: record-level scope (PERSONAL / PROJECT / SPECIALIST / SYSTEM) and legacy-record reconciliation. CONTRADICTION: the fail-open cases in §7.1. |
| B | **PARTIAL** | PSA, Fabric, and oversight identities are registry-backed. CODE_ENGINEER is itself a member of `FABRIC_AGENT_IDS`, so B's separate listing is a role distinction inside Fabric and is not documented. The Companion (`AiCompanionBar.tsx`) is an AI model and provider preference control (`/api/v1/ai/providers`), not an agent identity (INFERRED from source). Its purpose and authority are not documented. |
| C | **PARTIAL** | Both paths load the same Patch object (`osStore.getPatch`), but with different verification functions and audit identities: `verifyGovernedCodePatch` → `code.patch.verified` (`code.ts:1282-1335`) versus `verifyAppliedRemediation` → `remediation.verify` (`remediation.ts:205-230`, `remediation-pipeline.ts:124,211`). Semantics mapping not done. |

### 7.4 Stage 4 entry package (prepared, NOT started; exact boundary in §7.5)

**Objective (§3 Stage 4: Agent Architecture / Boundaries).** Make the approved agent boundaries true in code at the smallest safe scope:

- (1) Decision A / D8: memory reads by agents fail closed when the agent identity is missing on an agent path or the id has no governance profile. Human surfaces keep their current visibility.
- (2) D8 / B: an unregistered id or `agentId: null` never gets agent privileges; agent id and kind are recorded on proposals and in audit.
- (3) D3 agent-authority part only: agents cannot call direct file write (PUT); agent changes go through proposal/patch.
- (4) D10: write the Atlas/Core ↔ Web/Studio boundary ADR, and document the purpose and authority of each identity in Decision B, including the Companion.

**Prerequisites.**

- Arlet authorizes Stage 4 execution.
- The uncommitted master changes are committed by Arlet, or a commit is authorized.
- The agent environment's git lock issue is resolved: git in this environment cannot remove `.git/index.lock`, so either Arlet runs git index writes or delete permission is granted.
- A read-only inventory of agent memory call sites that omit the agent id, and of unprofiled agent ids in use.

**Boundaries.**

- Only the code paths named in the objective, with focused commits per item.
- No change to SoD, approval, kill switches, tenant or owner isolation, or human memory visibility.
- No memory deletion or migration. Legacy records are only inventoried.

**Verification.**

- Unit tests for the new fail-closed cases: omitted id on an agent path, unprofiled id, `agentId: null`.
- A route test showing PUT with an agent actor is denied.
- The existing memory, PSA, and patch test suites pass unchanged.
- Targeted Stage 9 SoD and isolation specs show no new regression. Their current findings B and C stay open unless separately resolved.

**Rollback.** Each item is its own revertable commit. No destructive data change. A fail-closed change that hides memory from a legitimate agent path is reverted with `git revert`, not by weakening the rule.

**Evidence.** Test commands and outputs, before and after behavior per rule, and commit hashes, all recorded in this master (§11).

**Non-goals.**

- D1 / D6 UX (invalid-id state, URL sync).
- D2 understanding record.
- D4 rejection.
- Decision C verification-path reconciliation.
- D3 overwrite and version protection and new file operations.
- Navigation (Stage 6), a11y (Stage 7), Stage 9 findings A–C, commit/push, and Production.

### 7.5 Stage 4 pre-implementation evidence gate (2026-09-26, read-only)

Evidence is SOURCE, from three read-only investigations with the key lines re-checked. Nothing was run and no code was changed. **Implementation is not authorized.**

**Correction to §7.1.** A Fabric or oversight profile denies **all** memory reads, not only personal ones:

- `controlMemoryDecisionForProfile("read")` returns `canReadPersonalMemory` (`control-agent-profile.ts:371-382`).
- Memory records have no personal/professional field; `scope` is only `GLOBAL | PROJECT | REPOSITORY` (`memory.schema.ts:57`).
- So every path that names a Fabric id gets zero memories. That includes Studio CODE_ENGINEER (`code.ts:938-945`), whose Guardian `memories` is always empty, and agents plan/dispatch.
- This is fail-closed, but it also means no professional memory is reachable.

**Authorization trace.**

```text
caller → buildMemoryContext / retrieveMemories (memory-pipeline.ts:142,1113)
       → osStore.getMemories(key, ownerId)   (tenant filter only if ownerId defined; os-store.ts:880-885)
       → memoryIsVisibleToAgent (1023-1041)
           no id / "" / []            → visible (1031)            [documented "human-surface-visible"]
           unknown / unprofiled id    → visible if allowedAgents empty (control-agent-profile.ts:398-400)
           Fabric / oversight / agent.cio → denied (1037)
           psa:* (any suffix)         → allowed (PSA class profile, 325-328)
       → allowedAgents check (1039-1040) → ranking → audit for governed ids only (1181)
```

**Verified controls.**

- Tenant filter for non-admin callers.
- Fabric, oversight, and `agent.cio` are denied memory, and tests assert it.
- The PSA memory route derives `psa:<user.id>` from the session.
- Plan and dispatch always pass listed Fabric ids.
- `resolveAgentIdentity` rejects unlisted ids and empty owners (`agent-runtime-authz.ts:148-161`).
- Application preflight refuses reserved ids.
- Move, rename, replace, and PTY deny requests that carry the agent header.
- Studio PUT enforces ownership, path containment, and the Atlas-self 202.

**Verified gaps.**

| # | Gap | Evidence | Risk |
| --- | --- | --- | --- |
| G1 | The caller chooses the agent identity: `/api/v1/agents/tool-execute` takes `fabricAgentId` from the body with `trustLevel: "FULL"`. No credential binds a principal to an agent id. | `agent-fabric.ts:551,583-588` | HIGH |
| G2 | Agent/LLM paths read memory with **no** agent identity: `POST /agent/runs` and `POST /conversation/message` inject memories into the LLM prompt | `agent.ts:207-213`, `conversation.ts:220-226` | HIGH |
| G3 | The same paths pass `ownerId: undefined` for `role === "admin"`, so memories from all tenants can reach the prompt. Whether `admin` is platform-only is not established. | `agent.ts:206`, `conversation.ts:219` | HIGH until the role is clarified |
| G4 | Agent detection is a self-asserted header (`x-atlas-actor-kind` / `x-atlas-agent-id`). No production code sends it, so an agent that omits it passes as human. | `studio-actor.ts:6-9` | HIGH (structural) |
| G5 | `PUT /api/v1/studio/file` has no agent-actor check (move does). It overwrites with no existence, version, or hash check, and records every write as "Human edited…" `sourceType: USER`. The only caller in the repo is the Studio save button. | `code.ts:553-608`, `workspace-browser.ts:466-467`, `studio/page.tsx:513` | MEDIUM (reachable only by self-identifying clients today) |
| G6 | Unknown, unprofiled, or empty ids are ungoverned and allowed. Mixing an unknown id with a Fabric id re-opens access (test-locked). | `control-agent-profile.ts:398-400`, `memory-pipeline.test.ts:470-472` | MEDIUM |
| G7 | Any `psa:*` string gets the PSA profile regardless of owner. `GET /api/v1/memory?agentId=` is client-supplied and ignored in list mode. | `control-agent-profile.ts:325-328`, `memory.ts:61,78,101` | MEDIUM (the tenant filter still applies) |
| G8 | Audit identity is inconsistent. Patch governance records `kind: "AGENT", agentId: user.id` while the unified audit says USER. `code.patch.proposed` and `agents.dispatch` have no actor. `POST /code/patches` writes no audit. `requestingAgentId` is not stored on the patch. A PSA request writes two unlinked records with different actors. There is no `agentKind` field anywhere. | `code.ts:252-256,1076-1084,1670-1737`, `agent-fabric.ts:489-499`, `personal-supervising-agent.ts:219-223,746-762` | MEDIUM |
| G9 | A PSA request is human-authored (agentId, claims, evidence, confidence) but dispatched as `actorKind: "AGENT"`, with the PSA's runtime status rather than the named specialist's | `routes/personal-supervising-agent.ts:137-140`, `services/personal-supervising-agent.ts:747-750` | MEDIUM |
| G10 | Memory write governance (`commitMemory({ controlAgentId })`) is never used by production callers | `memory-pipeline.ts:980-995` | LOW (no agent write path found) |

**Test gaps.** None of these has a test:

- An agent header sent to PUT `/studio/file`.
- Agent denial on `replace/apply`.
- A PUT that overwrites an existing file.
- A memory read with `requestingAgentId: null`.
- The real actor kind recorded in PUT audit or memory.

The omitted-id and unprofiled default-open behaviors **are** asserted by tests (`memory-pipeline.test.ts:345,368,374,398`), so changing them means changing locked tests deliberately.

**Insufficient evidence.**

- How QA runs use memory downstream (`qa.ts:367+`).
- Whether reconciliation snapshots that carry memory statements reach agent prompts (`state-reconciliation.ts:33-38`).
- The platform versus tenant meaning of `role === "admin"`.
- Side effects of dispatch or kernel run without a per-agent runtime check (`kernel.ts:131-205`).
- Whether a PSA dispatch marked ALLOWED is executed anywhere.
- Whether the `fs.write_file` / `fs.write_patch` tools have a production implementation.

**Stage 4 exact boundary (replaces the scope sketch in §7.4).**

| Class | Items |
| --- | --- |
| **IMPLEMENT** (after authorization) | 1. Memory reads fail closed for empty, unknown, or unprofiled agent ids (G6), with the locked tests updated deliberately. 2. A `psa:*` id is accepted only when it equals `psa:<session user>`, and a client-supplied `agentId` on `GET /memory` is bound or ignored consistently (G7). 3. `null` or empty never acquires agent status. 4. PUT `/studio/file` agent-header denial, at parity with move (G5, agent part only), plus the real actor kind in its audit. 5. Identity recording consistency where the architecture already requires it (G8): no human id as `agentId`, an actor on proposal and dispatch audits, and a correlation id between the PSA request and its dispatch. 6. ADR: the approved identity model (Decision B, including the Companion as a model/provider preference control) and the Atlas/Core ↔ Web/Studio boundary (D10). |
| **DO NOT IMPLEMENT** | Per-record memory scope and legacy reconciliation (needs migration; migration is a non-goal). Memory write governance (G10). D3 overwrite/version protection and new file operations. D1/D6, D2, D4, Decision C. Navigation, a11y, Stage 9 findings, commit/push, Production. |
| **NEEDS DECISION** | a) Which registered identity `/agent/runs` and `/conversation` act as (G2). The PSA is the natural candidate because it holds personal scope, but that is not decided. b) Agent credential model (G1, G4): a self-asserted header or body string is not identity; binding agents to a credential may exceed a minimal Stage 4. c) Whether a human-authored PSA request is recorded as USER-on-behalf or AGENT (G9). d) When Fabric agents may read professional memory; this requires record scope (Decision A). |
| **NEEDS MORE EVIDENCE** | G3 admin role scope; QA and reconciliation memory consumers; dispatch and kernel side effects; PSA-dispatch consumers; `fs.write_*` tools. |

### 7.6 Stage 4 decision and evidence closure (2026-09-26, read-only)

Evidence is SOURCE only: nothing was run, nothing was probed, no code changed. The four decisions below (A–D of this pass, distinct from approved New Decisions A–C in §7.2) are **proposed contracts awaiting Arlet's approval**. Stage 3 principles are treated as fixed.

| Decision | Current evidence | Proposed contract | Human approval needed? | Stage |
| --- | --- | --- | --- | --- |
| A. `/agent/runs` and `/conversation` identity | Human session is the only principal. The prompts are generic personas: "You are the ArletOS Engineer agent." (`agent.ts:288`) and "You are Atlas — ArletOS Engineering + QA Intelligence OS." (`conversation.ts:295`). The recorded `agentId` is `selectedId` (`agent.ts:340`) or `"conversation"` (`conversation.ts:346`), neither registered. Memory is read with no agent id. The project snapshot, which carries memory-derived TASK/RISK statements, also enters the context (`agent.ts:194,255`; `conversation.ts:208`). | These are human-initiated assistant runs **on behalf of the session user**. Memory authorization uses a server-derived identity, never one from the body. Candidate: `psa:<user.id>`. That keeps current personal-memory access (the PSA profile has personal scope) and makes `allowedAgents` restrictions effective. CODE_ENGINEER would empty the context and is not appropriate. Audit: actor = derived identity, `onBehalfOfUserId` = user. | **Yes**: which identity these personas are | 4 |
| B. Trusted agent identity | Authoritative today only when **server-derived**: PSA from the session (`personalSupervisingAgentId(user.id)`), CODE_ENGINEER as a constant set by the server route (`code.ts:943`), the Control Plane service token (`cp:service`), and application HMAC, which authenticates the **application**, not its agent. Caller-supplied ids (body `fabricAgentId`, query `agentId`, `x-atlas-*` headers) are not authenticated. | Only server-derived identities are authoritative. A caller-supplied agent id is at most a **requested specialist**: validated against the registry, limited to the user's own permissions, and recorded as target, never as authenticated actor. Missing, null, or empty means no agent privileges. Unknown or unregistered means deny. A `psa:` id that does not match `psa:<session user>` means deny. Headers stay a deny signal only, never a grant. No new protocol. | Confirm (consistent with approved D8) | 4 |
| C. Human → PSA audit attribution | Existing fields: `onBehalfOfUserId` (`agent-dispatch-guard.ts:86`), `actorKind`, optional `correlationId` (`unified-audit-entry.schema.ts:141`), `causationId`, `delegationHopCount`, `sourceContext.origin: "user_message"`. The `psa.request` audit has actor `psa:<owner>`. The dispatch record has the named specialist as actor. No `correlationId` is passed (`personal-supervising-agent.ts:746-753`). | **USER REQUEST + AGENT ACTOR** using existing fields: requesting human = `onBehalfOfUserId`/`ownerId`; acting agent = `psa:<owner>`; target specialist = an explicit target field, not `actorId`. One `correlationId` shared by `psa.request` and its dispatch. Human-authored content stays marked `origin: user_message`. No schema change expected (INFERRED). | **Yes**: audit semantics | 4 |
| D. Fabric professional memory | Memory fields: `type`, `category`, `sourceType` (includes INTEGRATION, WEB_RESEARCH, SYSTEM), `scope` (`GLOBAL` / `PROJECT` / `REPOSITORY` = location, not privacy), `agentId` (writer), `allowedAgents` (opt-in). **No personal/professional field** (`memory.schema.ts`). A Fabric read is denied for all records. The governed knowledge corpus (`canReadProfessionalKnowledge`) is already a separate professional channel. | Stage 4 keeps the current Fabric deny unchanged and enforces identity only. Enabling professional memory needs per-record scope (approved New Decision A, §7.2), a schema change, and reconciliation of legacy records. Inferring it from `sourceType` or `category` risks misclassification (e.g. a Studio human write is `sourceType: USER`). Owned by a later stage. | **Yes**: which stage owns it | Later |

| Evidence item | Result | Evidence | Risk | Stage |
| --- | --- | --- | --- | --- |
| E. Admin role | **VERIFIED** | Roles `user`, `admin`, `operator`, `owner` (`auth.schema.ts:10`). **The first registered user becomes `admin`** (`auth-store.ts:246-260`: `if (input.isFirstUser) return "admin"`). Owner and operator come from env emails. ADR-021: "`apps/web/app/admin` is tenant administration. Customer role `admin` is not Atlas Admin." `agent.ts:206`, `conversation.ts:219`, and `qa.ts` set `ownerId = undefined` for `admin`, so memories are read across all owners (the "Admins bypass" convention, as in `memory.ts`). In `/agent/runs` and `/conversation` those memories go into the LLM prompt. | **HIGH** where more than one user exists | 4 for agent/LLM contexts (decision required); tenant-admin visibility elsewhere is a separate decision |
| F. QA memory | **VERIFIED** | Human-initiated `POST /qa/runs`. Admin bypass as in E. `memories` are discarded (`void _memories`); `memoryContext` is returned in the API response. **No LLM.** | MEDIUM (admin sees all owners' context in the response) | Same decision as E; not agent work |
| G. Reconciliation snapshots | **VERIFIED** | `memoriesForProjectReconciliation` keeps the project's memories plus the project owner's and SYSTEM globals (tenant-safe). TASKS and RISKS copy `statement` into the snapshot (`state-reconciliation.ts:24-45,107`). The snapshot enters `/agent/runs` and `/conversation` contexts (`agent.ts:194,255`; `conversation.ts:208`). It bypasses `allowedAgents` and has no agent identity. | MEDIUM | 4, covered by Decision A |
| H. Dispatch / kernel / tools | **VERIFIED** for tools; **INFERRED** for kernel; **INSUFFICIENT_EVIDENCE** for dispatch | Registered tools are read-only: `readFile`, `readDirectory`, `searchRepo` (`fs-tools.ts:255-257`), `analyzeRepo`, knowledge search. `tool-execute` runs them on the **server repo** (`findRepoRoot()`). `resolveInsideRoot` enforces path containment and size limits only, with **no secret or `.env` filter** (`runtime.ts`). `kernel/run` self-approves and records events (`kernel.ts:130-205`); internals not traced. Dispatch plan execution not traced. | Possible HIGH: a caller-chosen agent (G1) might read server files including secrets. Not verified and not probed; needs the agent tool catalog and the deployed root contents. | 4 (G1 contract); secret-read question needs evidence first |
| I. `fs.write_*` | **VERIFIED** | `fs.write_file` / `fs.write_patch` are only policy or registry names; no `registerTool`. Production write primitives: store persistence (`store-io`, `auth-*`, portfolio / architecture / artifacts stores), audit and metrics NDJSON, governed-execution temp files, DR drill, worker queue, observer and knowledge persistence, **`patch-engine`** (governed apply and rollback), **`workspace-browser`** (Studio PUT, replace, rename). No agent tool reaches a file-write primitive. The remaining path is a client acting with a human session calling PUT (G5). | LOW for tools; G5 stays MEDIUM | 4 (G5 agent part) |

**Final Stage 4 boundary (replaces §7.5's boundary after Arlet approves A–C).**

| Class | Items |
| --- | --- |
| **IMPLEMENT IN STAGE 4** | 1. Fail-closed memory for missing, null, empty, unknown, unprofiled, or mismatched agent ids (with the locked tests updated deliberately). 2. Only server-derived identities are authoritative (contract B); a caller-supplied id is a requested target, never an actor. 3. `/agent/runs` and `/conversation` read memory and snapshots under the identity chosen in Decision A. 4. PUT `/studio/file` agent denial at parity with move, and actor kind in its audit. 5. Audit attribution per Decision C (PSA actor, specialist target, shared `correlationId`), plus no user id recorded as `agentId`. 6. ADRs: identity model and Atlas/Core ↔ Web/Studio. |
| **LATER STAGE** | Professional memory for Fabric (record scope, schema, legacy reconciliation). Memory write governance. D3 overwrite/version protection and file operations. D1/D6, D2, D4, approved New Decision C (verification path). Navigation, a11y, Stage 9 findings, Production. |
| **HUMAN DECISION** | Decision A identity. Decision C audit model. Confirm contract B. **Admin bypass (E):** may a tenant `admin` see other owners' memories at all, and in any case not in agent/LLM contexts? The Stage 4 part is agent contexts only. Which later stage owns Fabric professional memory. |
| **MORE EVIDENCE** | H: which agents the tool catalog lets use `fs.read_file`, and whether secrets exist under the deployed server root. Verify statically, do not probe. Dispatch plan side effects. Kernel internals. |

### 7.7 Stage 4 implementation record (2026-09-26)

**Authorization.** Arlet approved D-A, D-B, D-C (the proposed contracts A–C of §7.6) and authorized full Stage 4 implementation and verification. Decision E (admin bypass) was decided for agent/LLM contexts: tenant `admin` never widens them. D (Fabric professional memory) stays closed.

**Status chain per finding:** previously vulnerable (§7.5–§7.6, SOURCE) → corrected (code below) → verified by tests (commands below). "Verified" means the API test suite in a clean clone of the same code; it is **not** runtime or Production verification.

| # | Previously (evidence §7.5/§7.6) | Corrected | Verified by |
| --- | --- | --- | --- |
| S4-1 | Memory default-open for omitted or unprofiled requester (`memory-pipeline.ts`, contract `emptyAllowedAgents: "default-open"`) | `memoryIsVisibleToAgent` is fail-closed: no requester → visible only on a declared human surface (`humanSurface: true`); every id must be a non-empty governed id allowed to read; mixed ids AND-ed; a PSA id is valid only as `psa:<memory.ownerId>` (class id and bare `psa:` denied); `allowedAgents` narrows further. Contracts updated (`MEMORY_AGENT_VISIBILITY_CONTRACT`, `MEMORY_OWNERSHIP_CONTRACT`) | `memory-pipeline.test.ts` (missing, null, "", whitespace, [null], unknown, Fabric, oversight, own PSA, other PSA, `psa:`, class id, mixed); `atlas-architecture-contracts.test.ts` |
| S4-2 | `/agent/runs` and `/conversation/message` read memory with no identity; tenant `admin` read all owners into the LLM prompt (E) | Identity `psa:<session user>` from `assistantRunIdentity()` (`agent-context-authorization.ts`), never from body, query, or header. Memory `ownerId` = session user; admin bypass removed. `llm.invocation` and run/message audits carry the PSA actor and `onBehalfOfUserId` | `agent.test.ts`, `conversation.test.ts` (admin does not see owner B; JUDGE-restricted memory excluded; `x-atlas-agent-id` header ignored; audits attributed to `psa:<owner>`); `agent-context-authorization.test.ts` |
| S4-3 | Snapshot TASKS/RISKS copy memory statements into agent context, bypassing `allowedAgents` (G) | `authorizeSnapshotForAgentContext()` removes each memory-derived statement the acting identity may not read before context build; non-memory content kept; stored snapshot unchanged; empty slice shows a "withheld" marker | `agent-context-authorization.test.ts`; `conversation.test.ts` (restricted statement withheld, stored snapshot unchanged, another owner's project withheld); `agent.test.ts` |
| S4-4 | QA memory context: admin read all owners (F) | `ownerId` = caller, `humanSurface: true` (human surface, no LLM) | `qa.test.ts` (admin sees only own memory; this test fails on the pre-Stage-4 `qa.ts`) |
| S4-5 | `GET /memory?agentId=` treated as requesting identity | `agentId` is a **requested target**: results are narrowed to what that target may read; it can never widen and is never recorded as an agent read | `memory.test.ts` (own PSA target narrows; another owner's PSA gets nothing; unknown, CODE_ENGINEER, `psa:` get nothing) |
| S4-6 | `POST /agents/tool-execute` ran a tool as a caller-selected `fabricAgentId` (`agent-fabric.ts:551,583-588`) | No trusted runtime actor exists on this route, so it fails closed: 403 `blockedAt: IDENTITY`, audit `actorKind: USER`, `agentId: null`, `input.requestedTargetAgentId`. Execution code removed from the route; governed execution stays on `gateway/fulfill` | `agent-tool-execute.test.ts` (6 tests: 401; 403 + audit; every id 403; self-asserted header 403; operator 403; 400 on ownerId) |
| S4-7 | `PUT /studio/file` had no agent denial (G5 / D3 agent part) | Agent-actor request denied (403) before any write, parity with move; `studio.file.written` audit adds `actorKind: USER`, `actorId`. D3 overwrite/version protection **not** changed (separate workstream) | `studio-write.test.ts` (agent headers denied, no file written; human write allowed with USER audit) |
| S4-8 | Human id written as `agentId`; PSA request and dispatch not correlated (C) | Dispatch guard audits: human-proxy actor (gate `agentId` = requesting user) → `actorKind: USER`, `agentId: null` (gate classification unchanged; the HUMAN live-decision carve-out is **not** used, so SoD is not weakened). PSA request: actor `psa:<owner>`, specialist in `input.targetAgentId`, shared `correlationId`, `delegationHopCount: 1`; the `psa.request` record is written first and the dispatch record it causes carries `causationId` = that record's id (existing optional field; non-uuid values are ignored). `agents.plan` / `agents.dispatch`: USER actor, `targetAgentIds`. `code.patch.proposed`: AGENT `CODE_ENGINEER` on behalf of user. New `code.patch.submitted`: USER | `agent-dispatch-guard.test.ts`, `personal-supervising-agent.test.ts` (D-C test), `agent-fabric.test.ts`, `code.test.ts` |
| S4-9 | ADRs missing (D10; identity model, Decision B) | ADR-024 (identity, memory authorization, attribution; Companion = model/provider preference, not an agent) and ADR-025 (ArletOS ↔ Control ↔ Atlas boundary per §7.9, and the Stage 4 enforcement points inside ArletOS) | Documents |

**Files changed (code, `apps/api/src`).** `routes/agent.ts`, `routes/conversation.ts`, `routes/qa.ts`, `routes/memory.ts`, `routes/agent-fabric.ts`, `routes/code.ts`, `services/memory-pipeline.ts`, `services/agent-dispatch-guard.ts`, `services/agent-proposal.ts`, `services/personal-supervising-agent.ts`, `services/atlas-architecture-contracts.ts`, new `services/agent-context-authorization.ts`. Tests: `routes/{agent,conversation,qa,memory,agent-fabric,agent-tool-execute,code,studio-write}.test.ts`, `services/{memory-pipeline,agent-dispatch-guard,personal-supervising-agent,atlas-architecture-contracts}.test.ts`, new `services/agent-context-authorization.test.ts`. Docs: ADR-024, ADR-025, this master, supersede notes in `docs/architecture/remaining-work.md`. Test tooling: `e2e/stage9/accounts.ts` (root TypeScript fix).

**Verification (actual output; clean clone of the same code, Linux, Node, `pnpm install --frozen-lockfile`).**

| Command | Result |
| --- | --- |
| `apps/api: npx tsc -p tsconfig.build.json --noEmit` | exit 0 |
| `apps/api: npx vitest run` (before Stage 4) | 180 files, 1842 tests passed |
| Removed `agent-tool-execute.test.ts` cases (61 assertions) | They exercised execution through a route that no longer executes. The same properties stay covered at service level: catalog/forbidden tools, cross-tenant and cross-project payload smuggling, canonical-pair mismatch, secret output, path escape, runtime/kill-switch block, audit chain (`governed-execution.test.ts`, `agent-runtime-authz.test.ts`, `kill-switch-runtime.test.ts`, `packages/agent-core` `governed-target` / `adversarial` tests). **Not re-covered:** the route's own project-ownership gate (claim on first touch, 404, cross-owner 403), because that code was removed with the route's execution path; see remaining findings (`gateway/fulfill`) |
| `apps/api: npx vitest run` (after Stage 4, final code incl. `causationId`) | **181 files, 1852 tests passed**, 0 failed (an earlier run before the `causationId` change: 181 / 1850 passed) |
| Transfer to this working tree | 27 files (25 code/test + ADR-024/025) byte-identical to the tested files (`sha256sum -c`) |
| `npx eslint <changed .ts files>` | exit 0 |
| `git diff --check` | exit 0 (clone and this working tree) |
| `apps/api: npx tsc -p tsconfig.json --noEmit` (the API's own test-inclusive config, not the root config) | 122 `error TS` diagnostics before and 122 after (counted with `grep -c "error TS"`): pre-existing test-fixture type drift (mostly `AuthUser` fields), none introduced. `tsconfig.build.json` (production sources) is exit 0 |
| Stage 9 `pnpm test:e2e:stage9` (Arlet's machine), attempt 1 | Did not run: web server start failed, `ECONNREFUSED 127.0.0.1:15432` (local Supabase not running). **ENVIRONMENT_BLOCKER**, not an application result |
| Stage 9, attempt 2 (after `npx supabase start`; Stage 4 code before the `causationId` change) | **19 passed (2.5m), exit code 0**, 0 failed, 0 flaky, 1 worker. Supplied by Arlet |
| Stage 9, final code (with `causationId`) | **19 passed, exit code 0**. Supplied by Arlet |
| `apps/api` tests on Arlet's machine (final code) | **181 files, 1852 tests passed, exit code 0**. Supplied by Arlet |
| ESLint and `git diff --check` on Arlet's machine | exit 0 / exit 0. Supplied by Arlet |
| Root `npx tsc --noEmit -p tsconfig.json` (covers `e2e/**`, `playwright.config.ts`) | Before: 1 error, `e2e/stage9/accounts.ts(148,25)` TS2353 (a full `Stage9Identity` literal passed where only `Pick<Stage9Identity, "email">` is accepted; pre-existing, not caused by Stage 4). Fix: pass `{ email: "unknown" }`, the only field the function reads; no type widened, nothing suppressed. After: **exit 0** (clean clone) |

No timeouts were raised and no retries were added.

**Parallel change (recorded).** On 2026-09-26 at 14:50–14:53 UTC a separate, uncommitted Stage 4 implementation appeared in the working tree (not made by this pass; source unknown). Arlet chose this pass's implementation. The other one was backed up outside the repository (`C:\Users\User\project\stage4-backup\parallel-device-stage4-tracked.patch`, `agent-context-boundary.ts`) and removed from the working tree; nothing of it is in the commit.

**Static verification (no probing, no secret access).**

- **Read tools and secrets (H).** `fs.read_file`, `fs.read_directory`, `fs.search_repo` appear only in RESEARCHER's `allowedTools` (`packages/shared/src/constants/agents.ts`). Paths are confined to the project root, including symlinks (`resolveInsideRoot`, `runtime.ts:195-237`); there is no filename denylist (`.env` is not blocked by name). The runtime denies output that `detectSecrets` flags when the policy is `secretsAccess: "NONE"` (`runtime.ts:444-450`), which is pattern-based. Callers after Stage 4: `tool-execute` is closed (S4-6); `gateway/fulfill` requires an operator session or the Control Plane service token and runs with `projectRoot = findRepoRoot()` (`gateway-fulfill.ts:47-60`). **Classification: not closable statically → Stage 8 dependency** (whether pattern detection covers every secret format under the deployed root; whether a filename denylist is required).
- **Kernel (was INFERRED).** `POST /kernel/run` requires a write-capable session and runs `runIntelligenceKernel` from `@atlas/agent-core`, which does not read the tenant memory store; it records events only. `kernel/memory/lessons` is a cross-project engineering-lessons store readable by any signed-in user and writable by any write-capable user; `kernel/run` does not check `projectId` ownership. No Stage 4 identity bypass found (no caller-selected actor). **Owner: Stage 8** (lessons store write/read governance; project ownership check).
- **Dispatch (was INSUFFICIENT_EVIDENCE).** `/agents/plan` and `/agents/dispatch` read memory with `ownerId = user.id` and the planned agents as requesters (AND-ed, Fabric → no memory). Caller `agentIds` only choose targets. Dispatch requires `CONFIGURATION.EXECUTE`. No Stage 4 bypass found; audit attribution corrected (S4-8).

**Call-site reconciliation (after implementation).** `buildMemoryContext` / `retrieveMemories` callers: `agent.ts`, `conversation.ts` (PSA, owner), `qa.ts`, `memory.ts` (human surface, declared), `agent-fabric.ts` plan/dispatch (owner, planned agents), `code.ts` (owner, `CODE_ENGINEER` → Fabric profile → no memory; unchanged behavior), `personal-supervising-agent.ts` (owner, own PSA). No call omits both identity and `humanSurface`. Remaining `role === "admin" ? undefined` sites are all in `memory.ts` human surfaces (list/retrieve, moat, approve, delete, TTL): **not** agent/LLM context; see remaining findings.

**Remaining findings (not closed in Stage 4).**

| Finding | Classification | Evidence | Owner stage | Why not closed |
| --- | --- | --- | --- | --- |
| Tenant `admin` sees and manages other owners' memory on human surfaces | HUMAN DECISION | `memory.ts:66,255,482,611,642` | Decision, then Stage 8 | Not agent/LLM context; §7.6 E left it a separate decision |
| Fabric professional memory closed (includes CODE_ENGINEER proposal context and plan/dispatch context, which receive no memory) | DEPENDENCY | Fabric profile `personalScope: false`; no record-level scope in `memory.schema.ts` | Later (record scope + legacy reconciliation + professional-memory authorization) | Must not be inferred from `sourceType`, `scope`, or agent kind |
| Read-tool secret exposure | DEPENDENCY | See static verification above | 8 | Not closable statically; no probing allowed |
| Kernel lessons store and `kernel/run` project ownership | OPEN | See static verification above | 8 | Not an identity bypass; governance of a shared store |
| `tool-execute` has no trusted runtime agent path | BY DESIGN (fail-closed) | S4-6 | Later, if a trusted runtime identity is introduced | No trusted actor exists; none was invented |
| `gateway/fulfill` passes `projectId` without a per-project ownership gate (operator session or CP service token only). The project-ownership gate existed only inside the old `tool-execute` execution path, which Stage 4 closed | OPEN | `gateway-fulfill.ts:47-60`; `gateway-fulfill.test.ts` has no project-ownership case | 8 (with the Control service mapping, ADR-025 §3) | Operator/Control-service path, outside the Stage 4 identity boundary; not changed without a decision |
| D3 overwrite/version protection on PUT | OPEN | `workspace-browser.ts:466` | D3 workstream | Out of Stage 4 boundary |
| Code-level mapping of the Control services ArletOS consumes, and which ArletOS data each may receive | OPEN | ADR-025 §3; §7.9 | D10 follow-up | Direction decided (§7.9); mapping not established by evidence |
| Test-only TypeScript diagnostics in `apps/api/tsconfig.json` (122) | PRE-EXISTING | `apps/api: tsc -p tsconfig.json` | Separate cleanup | Unchanged count; not caused by Stage 4; outside Stage 4 scope |

### 7.8 Historical closure reconciliation after Stage 4 (2026-09-26)

Question asked for each earlier CLOSED item, decision, ADR, and verification claim: does current evidence still support the exact claim? Items are reopened only on a concrete contradiction. Format: previous state → new evidence → contradiction/qualification → action → verification → current status.

| Item | Previous documented state | New evidence | Contradiction / qualification | Action | Verification | Current status |
| --- | --- | --- | --- | --- | --- | --- |
| Stage 1 / 1A Lock Closure | ✅ CLOSED, DOC-GAP (§5) | None touching it | None | None | — | ✅ **CLOSED** (DOC-GAP unchanged) |
| Stage 2 Project entry | ✅ CLOSED, local (§5) | Stage 9 attempt 2 passed `auth-studio.spec.ts:77` (project picker, selection updates context) and `isolation.spec.ts:13` (switch, refresh, deep link). Stage 4 changed no Web file | Qualification only: Stage 9 does not repeat the exact AMD journey of §5 | None | OBSERVED (Stage 9 run, Arlet's machine) | ✅ **CLOSED** (local); supporting current evidence recorded |
| Stage 3 decisions | ✅ CLOSED as approved direction (§7.2) | Stage 4 implementation (§7.7) | §7.3 recorded CONTRADICTIONS for D8/A (default-open) and D3 (PUT without agent check). Those were implementation gaps, not decision errors. Decision B lists CODE_ENGINEER separately, but CODE_ENGINEER is a Fabric id; ADR-024 records it as a Fabric-profile identity with a server-set role | D8/A fail-closed and PUT agent denial implemented (S4-1, S4-7); identity table in ADR-024 | API suite (§7.7) | ✅ **CLOSED** (decisions). §7.3 rows D8/A/D3-agent-part are now *previously contradicted → corrected → verified by tests*; D3 overwrite, A record scope and legacy reconciliation stay OPEN |
| §7.1 correction record (Fabric profiles deny) | Recorded | Code unchanged on this point; `memory-pipeline.test.ts` Fabric denial passes | None | None | Unit tests | Still accurate |
| ARL-HYDRATION-001 | ✅ CLOSED (appendix) | None | None | None | — | ✅ **CLOSED**; appendix unchanged |
| Historical Stage 9 (19 passed @ `2587d1b`) | 🕘 HISTORICAL, requires regression (§5) | Attempt 2: 19 passed, exit 0 on the Stage 4 working tree | None: history stays history | None | OBSERVED | 🕘 HISTORICAL; current result recorded separately |
| Current Stage 9 run (16 / 1 / 2, exit 1; §11.1) | 🔴 NOT GREEN with findings A, B, C | Attempt 2: A, B, C tests all passed; exit 0 | Qualification: one green run does not explain the earlier failures. Stage 4 changed no Web/UI file, so it did not fix A or B. For A, the Studio chrome still uses muted, reduced-opacity labels on `#2A303A` (`AppShell.tsx`, `palette.ts`); whether the failing elements rendered in this run is not known | Nothing changed for A–C | OBSERVED (one run) | Stage 9 regression: **GREEN on this run**. Findings A–C: **NOT REPRODUCED**, cause **INSUFFICIENT_EVIDENCE**, kept OPEN for repeat runs (§11.1) |
| ADR-021 (tenant admin ≠ Atlas Admin) | Accepted | Stage 4 removed tenant-admin widening of agent/LLM memory | Consistent; reinforced | ADR-024/025 reference it | Tests (S4-2, S4-4) | Still accurate |
| `docs/architecture/remaining-work.md` and `docs/strategy/living-request-tracker.md` statements on default-open memory and live `tool-execute` | Source documents (not this master) | S4-1, S4-6 | Now stale | `remaining-work.md` is marked authoritative, so explicit dated "Superseded" notes were added beside the original text (K-9, K-10). The tracker is a dated historical record and stays unedited (K-11) | — | K-9, K-10 **SUPERSEDED**; K-11 **STALE**, preserved |

### 7.9 Architecture clarification: Atlas → Control → ArletOS (2026-09-26, authoritative)

**Source:** Arlet, 2026-09-26. This is a human architecture decision, recorded as such; it is not derived from code evidence.

```text
Atlas    — shared knowledge, registered agents, evidence, governance context
  ↓
Control  — separate application: oversight, control, governance, supervision, knowledge-agent services
  ↓
ArletOS  — independent application (Web + Studio)
```

- ArletOS is an independent application with its own users, application data, personal memory, projects, workspace, personal/user agent, application-owned agents, and application logic.
- Control is a separate application. It obtains applicable knowledge, agent-registry information, evidence, and governance context from Atlas, and provides applicable oversight / control / knowledge-agent services to ArletOS.
- Control does not receive unrestricted ArletOS private application data.
- ArletOS, HotelOS, and CaseFlow remain separate applications. Control is not their shared application runtime.
- The relationship is `Atlas → Control → ArletOS` for applicable services, **not** `ArletOS Studio → Control backend → Apply`.

**Reconciliation with existing text (chronology preserved).**

| Where | Previous text | Relation to the clarification | Action |
| --- | --- | --- | --- |
| §7.2 D10 (approved 2026-09-26) | "Studio requests and presents; Control decides and enforces policy … Control owns policy enforcement, SoD governance, protected decisions, kill switches" | **Qualified.** The SoD, approvals, policy checks, and kill switches that gate ArletOS actions are ArletOS application paths (`apps/api`: dispatch guard, approvals, `decide-and-execute`). Control is a separate application providing oversight services; it is not Studio's backend | Approval text kept as history; ADR-025 states the reconciled boundary |
| §10 row "Control" | "Authority: policy, SoD, Apply / Verify / Rollback, evidence, kill switches. Studio uses the existing paths." | **Superseded** as a description of Control. Apply / Verify / Rollback and SoD for ArletOS run in the ArletOS API | Row annotated in §10 |
| §10 row "Atlas / core" | "Not stated in any repository document. Pending D10." | **Answered at direction level**: Atlas is the shared layer from which Control obtains knowledge, agent registry, evidence, and governance context. Code-level mapping of the services ArletOS consumes is still open | Row annotated in §10; ADR-025 §3 |
| ADR-025 (first draft, same day, uncommitted) | "Control decides and enforces … stay with the existing governed paths (dispatch guard, approvals, `gateway/fulfill`)" | **Contradicted** the clarification (it placed ArletOS's in-app governance under Control) | ADR-025 rewritten before commit |
| WSP `WEB_STUDIO_MASTER_PLAN_2026-09-26.md` "Stage 4 — Control inside Studio"; rooms table "Control: Authority: policy, SoD, Apply, Verify, Rollback …" | Uses "Control" for the SoD decision UI inside Studio | **Stale wording** under the clarification. The work described (second identity and SoD inside the existing patch workflow) is ArletOS work | Recorded as K-12 (§14); source document not edited |
| ADR-021 amendment (Control = operational layer, `apps/control-plane`; Admin separate) | — | Consistent | None |
| Stage 4 code | Studio → ArletOS API only; `gateway/fulfill` is an ArletOS API route reachable by an operator session or the Control Plane service token | **No contradiction found**: Stage 4 adds no Studio → Control coupling and gives Control no new data access | None |

No closed stage is reopened by this clarification (§7.8 stands).

## 8. Web/Studio agent and memory behavior (CURRENT)

| Identity / area | Role | Status | Evidence |
| --- | --- | --- | --- |
| **CODE_ENGINEER Ask Agent** (`POST /api/v1/studio/ask-agent`) | Proposes patches. A heuristic, not a model. Distinct from the PSA. | 🕘 HISTORICAL (LOCALLY VERIFIED) | S9-15, S9-16 |
| **Personal Supervising Agent (PSA) panel** | `psa:<ownerId>`. Calls `/supervising-agent/{observation,memory,coordinate,explain,recommend,escalate,request}`. Does not approve and does not Apply. | 🟡 **IMPLEMENTED_UNVERIFIED**. STAGE_9 records the PSA as NOT PROVEN. | `93e1ff2` |
| **16 Fabric specialists** | Separate from the PSA. Specialist memory is not personal memory. | 🔒 Direction locked (D8) | WSP |
| **Memory** | Owner-scoped. Archive, consolidate (supersede), and storage meter (`383ecb6`). Delete and TTL routes also exist. The Web MemoryPanel exposes delete. Nothing in Web calls `POST /memory/:id/ttl`; TTL is set only as an optional `validUntil` when a memory is created. | 🟡 All **IMPLEMENTED_UNVERIFIED** in Web | `383ecb6`, `93e1ff2` |
| **Recurring failure** | Read-only, INFERRED. Not persistent knowledge. A recommendation is not a verified fact. | 🟡 **IMPLEMENTED_UNVERIFIED** | `e89b594` |
| **Error knowledge** | See ARL-WS-004 | 🔴 OPEN | §6 |

## 9. Golden Engineering Loop (CURRENT)

**COMPLETE GOLDEN LOOP = NOT PROVEN.** No Production proof.

```text
FIND ............. ✅ tree (Stage 2, local) · 🟡 search · symbols API-only
  ↓
UNDERSTAND ....... 🔴 conceptual · 🧭 DECISION_REQUIRED (D2)
  ↓
ASK .............. 🕘 CODE_ENGINEER (historical local) · 🟡 PSA
  ↓
PROPOSE .......... 🕘 historical local
  ↓
REVIEW / DIFF .... 🟡 implemented, no runtime evidence
  ↓
APPROVE / GOVERN . 🕘 SoD over HTTP (historical local) · 🟡 Studio decide UI · 🔴 reject missing
  ↓
APPLY ............ 🕘 historical local (the decider executed it over HTTP)
  ↓
AUDIT ............ 🕘 historical local, API layer
  ↓
RUN / TEST ....... 🟡 implemented, not verified
  ↓
DIAGNOSE ......... 🟡 partial
  ↓
CORRECT .......... 🔴 conceptual
  ↓
RE-RUN ........... 🔴 conceptual
  ↓
VERIFY ........... 🕘 historical local (Studio UI) · rollback 🕘 (over HTTP)
  ↓
EVIDENCE ......... 🕘 historical local, API layer

(RE-RUN returns to RUN / TEST. 🕘 = historical, requires regression (§5). 🔴 conceptual = not implemented.)
```

Rows that cite S9-xx rest on HISTORICAL local evidence (`2587d1b`) and REQUIRE REGRESSION on current HEAD (§5). A current run of the suite is not green (§11.1). In it, the SoD test did not observe `APPROVED` on its first attempt (finding C, unresolved). This does not change any loop status in this table.

| Step | Status | Evidence |
| --- | --- | --- |
| FIND | Tree: **LOCALLY VERIFIED** (Stage 2; S9-12 HISTORICAL). Search: IMPLEMENTED_UNVERIFIED (UI). Symbols: API only, not surfaced in Web. | Stage 2, S9-12, `/api/v1/studio/search` |
| UNDERSTAND | **CONCEPTUAL**, DECISION_REQUIRED | D2 |
| ASK | CODE_ENGINEER **LOCALLY VERIFIED** (HISTORICAL). PSA IMPLEMENTED_UNVERIFIED. | S9-15 |
| PROPOSE | **LOCALLY VERIFIED** (HISTORICAL) | S9-16 |
| REVIEW / DIFF | IMPLEMENTED_UNVERIFIED | No runtime evidence found. No `e2e/stage9` spec asserts a diff or review UI. |
| APPROVE / GOVERN | SoD over HTTP **LOCALLY VERIFIED** (HISTORICAL). Studio decide UI IMPLEMENTED_UNVERIFIED. Reject **MISSING**. | S9-17, `93e1ff2`, ARL-WS-001 |
| APPLY | **LOCALLY VERIFIED** (HISTORICAL; the decider executed the disk write over HTTP) | S9-18 |
| AUDIT | HISTORICAL local evidence only (API layer) | `remaining-work.md`, F Path 1 row (REFERENCE ONLY). No `e2e/stage9` audit assertion. |
| RUN / TEST | IMPLEMENTED_UNVERIFIED (governed `workspace.build`, `vitest.run`) | Not verified in this workstream |
| DIAGNOSE | PARTIAL, IMPLEMENTED_UNVERIFIED: the Diagnose button only pre-fills a CODE_ENGINEER proposal request; recurrence notice | `93e1ff2`, `e89b594` |
| CORRECT / RE-RUN | **CONCEPTUAL** | No linkage between cycles |
| VERIFY | **LOCALLY VERIFIED** (HISTORICAL, Studio UI). Rollback also LOCALLY VERIFIED (HISTORICAL; the decider executed it over HTTP). | S9-19, S9-20 |
| EVIDENCE | HISTORICAL local (API layer) | `remaining-work.md` F E2E / Path 1 row: verify PASS, epistemic OBSERVED (REFERENCE ONLY) |

Production is **ENVIRONMENT BLOCKED**.

## 10. Web/Studio boundaries (CURRENT)

| Surface | Role for this workstream | Source |
| --- | --- | --- |
| PUBLIC (www) | Welcome, plan, approved docs | ADR-021 (REFERENCE ONLY) |
| Web (`apps/web`, user plane) | Hosts Dashboard, Projects, Studio, Account/Settings, and tenant `/admin` | WSP rooms; ADR-021 (REFERENCE ONLY) |
| Dashboard | Command center: what needs attention and where to go. Not a second editor. | WSP |
| Projects | Create a project and bind its workspace folder | WSP |
| Studio | The engineering room. Not a chatbot page. Not an IDE clone. | WSP, FD |
| Account | Identity, settings, plan (WSP). The user memory storage meter is placed under "Account or Dashboard" in WSP Stage 7; it shipped in Settings (`383ecb6`) and is IMPLEMENTED_UNVERIFIED. | WSP, FD |
| PSA / Fabric / Agents & Knowledge | Coordinating personal layer / 16 specialists / catalog | WSP |
| Control | `apps/control-plane :3100`. Authority: policy, SoD, Apply / Verify / Rollback, evidence, kill switches. Studio uses the existing paths. No new approval engine. *Superseded 2026-09-26 (§7.9): Control is a separate application providing oversight / control / knowledge-agent services to ArletOS, fed by Atlas. SoD, approvals, and Apply / Verify / Rollback for ArletOS run in the ArletOS API. Control does not receive unrestricted ArletOS private data.* | WSP; ADR-021 (REFERENCE ONLY); §7.9 |
| Admin | `apps/admin :3200` platform supervisor, separate from tenant `/admin` in Web. Boundary fact only, not work here. | ADR-021 (REFERENCE ONLY) |
| Atlas / core | Shared engineering and protection core beneath Studio. *Clarified 2026-09-26 (§7.9): Atlas is the shared layer from which Control obtains knowledge, registered-agent information, evidence, and governance context. Code-level service mapping is open (ADR-025 §3).* | Not stated in any repository document before 2026-09-26. Arlet's clarification (§7.9) |

## 11. Evidence and verification status: implemented, not verified (CURRENT)

Every row is 🟡 **IMPLEMENTED_UNVERIFIED**. Unit tests were added in most of these commits (none in `d68038a` or `ad55e6c`). They were not run as part of this consolidation.

| Item | Commit(s) | WSP internal ref |
| --- | --- | --- |
| Dashboard → Studio with project id; blocker chips → Checks with project | `93e1ff2`, `0353c05` | WSP Stage 1. The Projects path is covered by Stage 2. |
| Studio Explain / Diagnose / Review buttons. They pre-fill a CODE_ENGINEER proposal request and do not call `/code/explain` or `/code/review`. | `93e1ff2` | WSP Stage 2 (PARTIAL) |
| PSA panel wiring | `93e1ff2` | WSP Stage 3 |
| Studio second-identity `decide-and-execute` UI | `93e1ff2` | WSP Stage 4 |
| Desk verify: auto-remediation drafts use `/remediation/drafts/:id/verify`, others use `/code/patches/:id/verify` | `93e1ff2` | WSP Stage 5 |
| Checks as Studio aliases (`studioCheckHref`; `STUDIO_CHECK_IDS` pre-existing from `39b3fc2`; old routes redirect client-side) | `93e1ff2` | WSP Stage 6 |
| Memory archive, consolidate, storage meter (Settings, MemoryPanel) | `383ecb6`, `93e1ff2` | WSP Stage 7 |
| Recurring-failure recommendation | `e89b594`, `93e1ff2` | WSP Stage 8 |
| Studio file move | `73a3662`, `d68038a` (API), `93e1ff2` (Studio button) | WSP Stage 9 |
| Studio layout (negative margins removed; content still capped at `maxWidth: 1240`), AppShell chrome, signed-in welcome | `ad55e6c` | none |

### 11.1 Current Stage 9 E2E run (CURRENT verification evidence)

Supplied by Arlet on 2026-09-26 as the actual output of a current `pnpm test:e2e:stage9` run. It is not re-run here and nothing was fixed.

```text
16 passed · 1 failed · 2 flaky · ELIFECYCLE · exit code 1
```

**Current Stage 9 verification is NOT GREEN. Regression closure is NOT established.** The historical 19 passed (`2587d1b`, §5) stays as history and does not prove current HEAD.

- **Environment:** the supplied output does not state the commit or the environment. `playwright.config.ts` sets `retries: process.env.CI ? 1 : 0`, and Playwright reports "flaky" only when a test fails and then passes on retry. So this run most likely had `CI` set. **INFERRED.**
- **Which result is which:** finding A is the failure. The output does not name the two flaky tests. That they are findings B and C, which failed on their first attempt, is **INFERRED**.

| Finding | Test | Evidence | Classification | Owner | Root cause | Fixed? |
| --- | --- | --- | --- | --- | --- | --- |
| **A** — authenticated Studio a11y | `e2e/stage9/a11y-studio.spec.ts:28` "authenticated Studio has skip link, main landmark, and no axe violations" (Stage 9.9) | Failed in `expectNoA11yViolations(...)`: axe `color-contrast` (wcag2aa, wcag143), impact serious. Contrast 2.89:1, expected 4.5:1; `#6f7680` on `#2a303a`, 11px (8.3pt) normal weight. Elements include "Build ▸" and "Tools & Resources". | 🔴 **CURRENT accessibility verification failure.** Not flaky, not historical. | ARL-WS-006 | Not investigated | No |
| **B** — project isolation | `e2e/stage9/isolation.spec.ts:13` "switch A → B isolates workspace and survives refresh + deep link" (Stage 9.4) | Strict-mode violation: `getByRole('button', { name: 'beta-1790425418333.txt' })` resolved to two elements, the file-tree button and the Open-files tab/chip. | ⚠️ **UNRESOLVED — TEST SELECTOR VS UI DUPLICATION BEHAVIOR.** The locator is proven ambiguous. That the UI is wrong is **not** proven. | CURRENT VERIFICATION FINDING | Unresolved. Either both representations are intentional (then the selector must target the intended surface), or the duplication is unintended (then it is a UI defect). | No. The selector is unchanged; no `.first()` added. |
| **C** — SoD approval | `e2e/stage9/sod.spec.ts:14` "requester cannot self-decide apply; distinct decider can" (Stage 9.6) | After `getByRole("button", { name: /^approve$/i }).click()`, `expect(page.getByText("APPROVED", { exact: true }).first()).toBeVisible({ timeout: 20_000 })` found no `APPROVED` element within the timeout. | ⚠️ **UNRESOLVED — SOD APPROVAL STATE TRANSITION.** Not proven to be a backend defect or a test defect. | CURRENT VERIFICATION FINDING; related to §9 APPROVE / GOVERN | Unresolved. Candidates: API or state transition, UI state propagation, synchronization or race, test expectation, changed product behavior, or another cause. | No. Timeout and retries unchanged. |

These are three findings with different evidence strength. Only A is a confirmed current product-quality violation. B and C are confirmed test failures whose root cause is open. The Golden Loop status (§9) and the Production status (§12) are unchanged by this run.

**Post-Stage-4 runs (2026-09-26, Arlet's machine, local, 1 worker).** The run above is preserved unchanged.

| Run | Result |
| --- | --- |
| Attempt 1 | Not executed: web server start failed, `ECONNREFUSED 127.0.0.1:15432`. **ENVIRONMENT_BLOCKER** |
| Attempt 2 (after `npx supabase start`) | **19 passed (2.5m), exit code 0**; 0 failed, 0 flaky. `a11y-studio.spec.ts:28` (A), `isolation.spec.ts:13` (B), `sod.spec.ts:14` (C) passed |
| Final code (with `causationId`) | **19 passed, exit code 0**. Supplied by Arlet |

Findings A–C are **NOT REPRODUCED** in these runs. Nothing was changed to fix them, and Stage 4 changed no Web/UI file, so this is not evidence that they are fixed. Their cause stays **INSUFFICIENT_EVIDENCE** and they stay OPEN until explained or repeatedly not reproduced. The earlier run's environment (probably `CI` set, INFERRED) may differ from these local runs.

## 12. Environment blockers directly affecting Web/Studio (CURRENT)

| Blocker | Status | Source |
| --- | --- | --- |
| Authenticated Studio, Ask Agent, Apply, and workspace in Production | ⛔ **ENVIRONMENT BLOCKED**: no legitimate automated Production account; no customer workspace on the API host | STAGE_9 B6, B7; WSP Stage 10 |
| PSA Control telemetry | ⛔ **ENVIRONMENT BLOCKED** without Control Plane URL and token | WSP Stage 10 |
| CI Apply / SoD / AVR | 🟡 **UNVERIFIED** (not blocked). `ab07d6b` starts a disposable Supabase in CI instead of `replace-me`. No CI result observed. | WSP, STAGE_9 (stale, §14) |
| Production auth durability | `08d21ec` (Supabase) may change the Production account blocker. 🟡 **UNVERIFIED** (not blocked). | commit |

## 13. Source-document map

| Document | Role | Notes |
| --- | --- | --- |
| `ARLETOS_MASTER_PROBLEM_REGISTER.md` | **ACTIVE MASTER** (this file). CURRENT. | — |
| `WEB_STUDIO_MASTER_PLAN_2026-09-26.md` (WSP) | SUBORDINATE WEB/STUDIO PLAN. CURRENT plan; status line stale. | Own internal Stage 0–10: Project context, Studio work center, PSA, Control in Studio, Desk verify, Checks, Memory lifecycle, Recurring failure, File ops, Production. These are **not** the stages of §3. Status line is stale (§14). |
| `studio-web-future-direction-2026-09-25.md` (FD) | STRATEGIC DIRECTION. FUTURE. | Direction only. Its numbered work order mirrors WSP. These are not the stages of §3. Header date 2026-09-26. |
| `STAGE_9_MASTER_PLAN_2026-09-26.md` | 🕘 HISTORICAL / STAGE-SPECIFIC. PAST. | "Stage 9" of an earlier program (S9-01..25). Not Stage 9 of §3 and not WSP Stage 9. Some statements are stale (§14). |
| `studio-evidence-refresh-2026-09-20.md` | 🕘 HISTORICAL. PAST. | Studio evidence at `0f7b92f` |
| `remaining-work.md`, `gap-matrix.md`, `ADR-021` | REFERENCE ONLY | Cited for single boundary or evidence facts. `remaining-work.md` stages 01–19 are historical Atlas closure; do not merge blindly. |

## 14. Conflicts and stale statements

Recorded, not fixed. Source documents are not edited by this master, with one exception: on 2026-09-26 explicit dated "Superseded" notes were added to the authoritative `remaining-work.md` beside its original text (K-9, K-10).

| ID | Statement | Current evidence | Status |
| --- | --- | --- | --- |
| K-1 | WSP: "Stage 1 has not started"; IMPLEMENT "Not authorized by Stage 0" | `93e1ff2`, `0353c05`, `383ecb6`, `e89b594`, `73a3662`, `d68038a` implement WSP Stages 1, 2 (partial), and 3–9 | **CONFLICTED** (stale status) |
| K-2 | WSP Stage 1: Dashboard and Projects buttons are `href="/studio"` without an id | They now pass the id (`studioProjectHref`) | **STALE** |
| K-3 | STAGE_9 B4 and STAGE_9 §9 item 12: "no Studio decide panel" | `StudioPatchWorkflow.tsx` has `decide-and-execute` (`93e1ff2`) | **STALE** (panel unverified) |
| K-4 | WSP and STAGE_9: CI Apply/SoD/AVR blocked by `replace-me` | `ab07d6b` replaced it for the Stage 9 suite | **CONFLICTED** (CI result unknown) |
| K-5 | "Stage N" means different things in §3, WSP, STAGE_9, and FD's numbered work order | Numbering systems recorded separately in §3 and §13 | **RECORDED**, do not merge |
| K-6 | FD: Dashboard and Projects open `/studio` without the project id (FD §1); there is no decide panel in Studio (FD §4); file rename and move do not exist (FD §9) | `93e1ff2`, `73a3662` | **STALE** |
| K-9 | `remaining-work.md` (authoritative; FINAL CLOSING PASS and contracts list): empty `allowedAgents` "default-open (INTENTIONAL)"; "Omit requester id stays human-surface-visible" | Stage 4 S4-1: memory is fail-closed; an omitted requester is visible only on a declared human surface; empty `allowedAgents` is open only to admitted identities (`MEMORY_AGENT_VISIBILITY_CONTRACT`) | **SUPERSEDED**: explicit dated notes added next to the original text in `remaining-work.md`; original text kept |
| K-10 | `remaining-work.md`: "`POST /api/v1/agents/tool-execute` derives identity from the session and calls `executeGovernedAction`"; RESEARCHER `fs.*` live execution "is the `tool-execute` hop" | Stage 4 S4-6: `tool-execute` is denied (403, `blockedAt: IDENTITY`); governed tool execution remains on `gateway/fulfill` | **SUPERSEDED**: explicit dated notes added next to the original text in `remaining-work.md`; original text kept |
| K-11 | `living-request-tracker.md` P0.7: "First live HTTP caller: `POST /api/v1/agents/tool-execute`" | Same as K-10. The execution-gate guard test still passes (`gateway/fulfill` → `executeGovernedAction`) | **STALE**, preserved: the tracker is a dated historical record (last updated 2026-08-24) and is not edited |
| K-12 | WSP "Stage 4 — Control inside Studio" and rooms table "Control: Authority: policy, SoD, Apply, Verify, Rollback, evidence, kill switches" | §7.9: Control is a separate application; SoD and Apply for ArletOS are ArletOS paths | **STALE wording**, preserved; source not edited |
| K-7 | STAGE_9 header "Status: IN PROGRESS", and B10 / §14 (FD is untracked, do not commit) | STAGE_9 §10 records "STAGE 9 LOCALLY VERIFIED"; FD was committed in `1071450` | **STALE** |
| K-8 | WSP rooms table: Account user-storage meter "does not exist yet" | `383ecb6` added `GET /memory/storage`; Settings shows it (unverified) | **STALE** |

## 15. Next authorized action

*Superseded 2026-09-26 (history):* "Arlet decides A, C, and E and confirms B (§7.6); then Stage 4 execution may be authorized." Arlet approved D-A, D-B, D-C and authorized Stage 4.

**Now:** Arlet decides the open items in §7.7 (tenant `admin` human-surface memory visibility; owner stage for Fabric professional memory). Stage 5 starts only when Arlet authorizes it. Stage 9 findings A–C stay open and are handled in their own stages.

---

**Appendix (PAST): closure record, preserved unchanged.**

## ARL-HYDRATION-001 — React hydration warning (AppShell theme / language controls)

| Field | Value |
| --- | --- |
| **ID** | ARL-HYDRATION-001 |
| **Status** | **CLOSED** |
| **Classification** | **VERIFICATION INFRASTRUCTURE ISSUE** |
| **Date closed** | 2026-09-26 |
| **Application fix** | **NONE** |

### Original warning

**OBSERVED** in Cursor verification environment (Stage 2 browser verification). React hydration mismatch; stack at `apps/web/components/layout/AppShell.tsx` (~322, `themeToggle` / `IconButton`).

### Reported mismatch

```text
data-cursor-ref="e2"   (theme IconButton)
data-cursor-ref="e3"   (Languages button)
```

Application-owned attributes in the same diff (`aria-label`, `className`, `title`, MUI classes) were not reported as mismatched.

### Repository ownership

Workspace search for `data-cursor-ref`: **0 matches** → **NOT FOUND IN REPOSITORY** (not application-owned).

### Non-Cursor reproduction (2026-09-26, local `pnpm dev`)

| Browser | Route(s) | Hydration warning | `data-cursor-ref` in DOM |
| --- | --- | --- | --- |
| Google Chrome (system, extensions disabled; not Cursor embedded) | `/he/projects`, `/he/studio`, `/he/welcome` | **NOT REPRODUCED** | **Absent** |
| Microsoft Edge (system, InPrivate, extensions disabled) | `/he/projects` | **NOT REPRODUCED** | **Absent** |

### Application-owned hydration mismatch

**NOT DEMONSTRATED** in non-Cursor Chrome or Edge.

### Theme SSR / client alignment (source trace)

```text
apps/web/app/[locale]/layout.tsx
  COLOR_MODE_COOKIE → parseColorMode → initialMode
        ↓
AppProviders → ColorModeProvider(initialMode)
        ↓
useState(initialMode) on first client render
        ↓
AppShell theme toggle (mode-driven aria-label / icon)
```

**VERIFIED** from source: server and first client render use the same `initialMode`. No theme-driven hydration defect demonstrated.

### Stage 2 impact

**NONE.** Hydration console warning does not invalidate Stage 2 Projects → Studio verification (project id, `workspaceRoot`, tree). Stage 2 remains **CLOSED**.

### Limitation (not an application defect)

```text
Manual human-operated Incognito console verification: UNVERIFIED / OPTIONAL
```

Agent pass used Playwright-driven system Chrome/Edge (non-Cursor MCP) for console and DOM checks. Optional human Incognito spot-check does not reopen this item unless new evidence shows an application-owned mismatch without `data-cursor-ref`.

### Required actions

- No AppShell, theme, SSR, or hydration-suppression change.
- Do not treat Cursor-injected `data-cursor-ref` as a product bug.
- If a future **normal** session reproduces hydration mismatch **without** `data-cursor-ref`, open a **new** register item; do not reopen ARL-HYDRATION-001 without new evidence.
