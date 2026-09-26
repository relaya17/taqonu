# ArletOS Master Problem Register

**Role:** ACTIVE MASTER for the Taqonu / ArletOS **Web + Studio** workstream. One control document for current status, open gaps, human decisions, and evidence. Source documents stay intact and are referenced, not copied.

**Overall status:** 🔴 **OPEN**. An item is **CLOSED** only with evidence. OPEN register ≠ broken product: the Web/Studio core exists (§11). What remains is verification, decisions, and the gaps in §6.

**Last consolidated:** 2026-09-26 against HEAD `10714506bd22f61399cc2155ee9ef93a8a02a03d`.

---

## 0. At a glance

| Item | Value |
| --- | --- |
| **Current stage** | Stage 3 (Human Decisions): **NEXT, NOT STARTED** (§3, §4) |
| **Next authorized action** | **Arlet reviews this master.** No Stage 3 work, implementation, commit, or push before that (§15) |
| ✅ Closed | Stage 1 / 1A, Stage 2 (local), ARL-HYDRATION-001 (§5) |
| 🕘 Historical proof | STAGE_9 program, 19 passed at `2587d1b`. Valid history; **requires regression** on current HEAD (§5) |
| 🟡 Implemented, unverified | 10 items (§11) |
| 🔴 Open gaps | 7: ARL-WS-001..007 (§6) |
| 🧭 Human decisions open | 9: D1–D7, D9, D10. D8 is direction-locked, implementation unverified (§7) |
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
| 3 | Human Decisions | ▶️ **NEXT**, not started |
| 4 | Agent Architecture / Boundaries | NOT STARTED |
| 5 | Actual Golden Engineering Loop | NOT STARTED |
| 6 | Web IA / Navigation | NOT STARTED |
| 7 | UI / Accessibility / i18n | NOT STARTED |
| 8 | Security / Reliability | NOT STARTED |
| 9 | Regression | NOT STARTED |
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

**Stage 3 — Human Decisions: NEXT, NOT STARTED.** It starts only after Arlet reviews this master. Stage 3 records decisions (§7). It does not implement them.

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
- **Current status:** on current HEAD this proof is HISTORICAL and REQUIRES REGRESSION (§3 Stage 9).
- **How the run executed:** the decider executed the Apply and Rollback disk writes through HTTP `decide-and-execute` (`e2e/stage9/patch-flow.ts`). The Studio Apply and Rollback buttons were proven only to mint the approval (202). Verify was clicked in the Studio UI.

**Hydration note.** `suppressHydrationWarning` already exists on `<html>` and `<body>` in `apps/web/app/[locale]/layout.tsx`. It was added in `e7142b1` (2026-09-19), before the investigation, and the investigation added none, which matches the closure record. The Chrome and Edge non-reproduction predates `ad55e6c`, which changed AppShell and `LanguageSwitcher`. That check is therefore HISTORICAL. It does not reopen the item, because there is no new evidence.

## 6. Open Web/Studio gaps (CURRENT)

| ID | Gap | Status | Priority | Linked decision |
| --- | --- | --- | --- | --- |
| ARL-WS-001 | Patch rejection flow missing | 🔴 **OPEN** | — | D4 |
| ARL-WS-002 | Studio file operations incomplete; behavior and actor authorization need policy | 🔴 **OPEN** | — | D3 |
| ARL-WS-003 | UNDERSTAND has no verifiable completion criterion | 🔴 **OPEN** / 🧭 DECISION_REQUIRED | — | D2 |
| ARL-WS-004 | Personal-agent error knowledge architecture incomplete | 🔴 **OPEN** (architecture gap, not scheduled) | **HIGH** (set by Arlet, 2026-09-26) | — |
| ARL-WS-005 | Complete Golden Engineering Loop not proven end-to-end | 🔴 **OPEN** | — | D2 |
| ARL-WS-006 | Web/Studio accessibility verification incomplete | 🔴 **OPEN** | — | — |
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
| PUT authorization | Project write access only. PUT is **not** human-only: unlike move, it has no agent-actor check. | ⚠️ Recorded; policy in D3 |
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

### ARL-WS-007 — Commit / push policy

No `git.commit` or `git.push` in the governed Git catalog. FD calls this intentional, but FD is direction only.

## 7. Human decisions (CURRENT)

None of these authorizes implementation. "Implementation verified?" refers to the current behavior column.

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

Rows that cite S9-xx rest on HISTORICAL local evidence (`2587d1b`) and REQUIRE REGRESSION on current HEAD (§5).

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
| Control | `apps/control-plane :3100`. Authority: policy, SoD, Apply / Verify / Rollback, evidence, kill switches. Studio uses the existing paths. No new approval engine. | WSP; ADR-021 (REFERENCE ONLY) |
| Admin | `apps/admin :3200` platform supervisor, separate from tenant `/admin` in Web. Boundary fact only, not work here. | ADR-021 (REFERENCE ONLY) |
| Atlas / core | Shared engineering and protection core beneath Studio | Not stated in any repository document. Pending D10. |

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

Recorded, not fixed. Source documents are not edited by this master.

| ID | Statement | Current evidence | Status |
| --- | --- | --- | --- |
| K-1 | WSP: "Stage 1 has not started"; IMPLEMENT "Not authorized by Stage 0" | `93e1ff2`, `0353c05`, `383ecb6`, `e89b594`, `73a3662`, `d68038a` implement WSP Stages 1, 2 (partial), and 3–9 | **CONFLICTED** (stale status) |
| K-2 | WSP Stage 1: Dashboard and Projects buttons are `href="/studio"` without an id | They now pass the id (`studioProjectHref`) | **STALE** |
| K-3 | STAGE_9 B4 and STAGE_9 §9 item 12: "no Studio decide panel" | `StudioPatchWorkflow.tsx` has `decide-and-execute` (`93e1ff2`) | **STALE** (panel unverified) |
| K-4 | WSP and STAGE_9: CI Apply/SoD/AVR blocked by `replace-me` | `ab07d6b` replaced it for the Stage 9 suite | **CONFLICTED** (CI result unknown) |
| K-5 | "Stage N" means different things in §3, WSP, STAGE_9, and FD's numbered work order | Numbering systems recorded separately in §3 and §13 | **RECORDED**, do not merge |
| K-6 | FD: Dashboard and Projects open `/studio` without the project id (FD §1); there is no decide panel in Studio (FD §4); file rename and move do not exist (FD §9) | `93e1ff2`, `73a3662` | **STALE** |
| K-7 | STAGE_9 header "Status: IN PROGRESS", and B10 / §14 (FD is untracked, do not commit) | STAGE_9 §10 records "STAGE 9 LOCALLY VERIFIED"; FD was committed in `1071450` | **STALE** |
| K-8 | WSP rooms table: Account user-storage meter "does not exist yet" | `383ecb6` added `GET /memory/storage`; Settings shows it (unverified) | **STALE** |

## 15. Next authorized action

**Arlet reviews this master.** No Stage 3 work, implementation, commit, or push until that review is complete.

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
