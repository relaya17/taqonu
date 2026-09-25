# STAGE 9 MASTER PLAN — 2026-09-26

**Status:** IN PROGRESS — substages 9.1–9.10 sequential  
**Authoritative document:** this file is the single source of truth for Stage 9.  
**Do not create competing Stage 9 master documents.**  
**Stage 10:** PROHIBITED until every Stage 9 acceptance condition in §10 is proven.

---

## 0. Classification of evidence (do not collapse)

| Label | Meaning |
|---|---|
| **IMPLEMENTED** | Code exists and is reachable from the application. |
| **LOCALLY VERIFIED** | Proven on this workstation / local Playwright / local API in this pass. |
| **HISTORICALLY VERIFIED** | Proven in an earlier dated evidence file; not re-run as Stage 9 acceptance. |
| **PRODUCTION VERIFIED** | Proven against live Production (`taqonu-api` / `taqonu-web`). |
| **VERIFICATION INFRASTRUCTURE BLOCKED** | Product path exists; Stage 9 cannot prove it because fixtures/tests/tooling are missing. |
| **ENVIRONMENT BLOCKED** | Proof requires a credential, host, or operator action that is not legitimately available. |
| **NOT STARTED** | No implementation and no verification for this Stage 9 requirement. |

`VERIFIED` in a requirement row means the **required verification for that row actually ran**. It is not a synonym for “code exists.”

---

## 1. Scope

Stage 9 in this program is **authenticated Studio + session + project context + isolation + Ask Agent + patch proposal + SoD + Apply → Verify → Rollback + EN/HE/AR/RTL + authenticated accessibility**.

It is **not**:

- remaining-work.md item `09` (MEMORY) — that numbered item is a different historical workstream.
- Production API boot / CORS remediation (`08e0c40`) — closed separately; see §8.
- Stage 10, Control redesign, Studio visual redesign, marketplace, or new CTRL items.

In scope:

- Create this master plan and keep it current after each substage.
- Add **local/test-only** Playwright authenticated fixtures (REQUESTER + distinct DECIDER).
- Add Stage 9 Playwright coverage around **existing** Studio/Auth/Guardian/SoD paths.
- Investigate `/en/projects` `ERR_ABORTED` without weakening the failing test.
- Classify Production authenticated Stage 9 as proven or **ENVIRONMENT BLOCKED**.
- Focused git commits per substage. Never `git add .` / `git add -A`. Never stage `cookies.txt` or `docs/architecture/studio-web-future-direction-2026-09-25.md`.

Out of scope:

- Reimplementing login, Studio picker, Guardian, or SoD “to make them Stage 9.”
- Inventing Production credentials or enabling demo login in Production.
- Weakening SoD (`decidedBy !== requestedBy`).
- Weakening tests to hide fixture gaps.

---

## 2. Requirements

Twenty-five requirements, grouped A–E. Full rows are in §3.

### A. Authentication

| ID | Title |
|---|---|
| S9-01 | Login |
| S9-02 | Authenticated session |
| S9-03 | Logout |

### B. Studio entry and context

| ID | Title |
|---|---|
| S9-04 | Authenticated Studio entry |
| S9-05 | Project/workspace context |
| S9-06 | Project picker |
| S9-07 | Project selection |
| S9-08 | Project switching |
| S9-09 | Workspace root |
| S9-10 | Project/workspace relationship |
| S9-11 | Context after switching |

### C. Isolation and persistence

| ID | Title |
|---|---|
| S9-12 | Project isolation |
| S9-13 | Refresh persistence |
| S9-14 | Deep links |

### D. Agent and patch workflow

| ID | Title |
|---|---|
| S9-15 | Ask Agent |
| S9-16 | Patch proposal |
| S9-17 | Approval / SoD |
| S9-18 | Apply |
| S9-19 | Verify |
| S9-20 | Rollback |

### E. Localization / accessibility

| ID | Title |
|---|---|
| S9-21 | EN |
| S9-22 | HE |
| S9-23 | AR |
| S9-24 | RTL |
| S9-25 | Accessibility |

---

## 3. Existing implementation evidence (reconciliation inventory)

Inspected 2026-09-26 against repository HEAD at start of this pass: **`08e0c40`**.

### A. Authentication

#### S9-01 Login

| Field | Value |
|---|---|
| Requirement ID | S9-01 |
| Current implementation | `apps/web/app/[locale]/auth/login/page.tsx` → `apiPost /auth/login` → hard navigation to `/${locale}/studio`. API: `apps/api/src/routes/auth.ts` + `createLocalUser` / password verify in `apps/api/src/services/auth-store.ts`. |
| Existing evidence | Unauthenticated Playwright: login form a11y (`e2e/a11y.spec.ts`). API unit/route tests for login. Production unauthenticated login POST returns 401 for invalid password (CORS remediation evidence, not Stage 9 auth success). |
| Missing evidence | Production authenticated login. |
| Required action | Local Playwright fixture + login test. Do not invent Production credentials. |
| Verification method | Browser: fill login, land on Studio. |
| Status | **LOCALLY VERIFIED** (9.3). Production authenticated **ENVIRONMENT BLOCKED**. |
| Commit | Pre-existing login path; Stage 9 proof in 9.2/9.3 commits. |

#### S9-02 Authenticated session

| Field | Value |
|---|---|
| Requirement ID | S9-02 |
| Current implementation | Cookie session; `GET /api/v1/auth/session`. Web providers/session used by Studio. |
| Existing evidence | Production unauthenticated `GET /api/v1/auth/session` 200 after `08e0c40` (anonymous session document, **not** authenticated Stage 9). Local API tests. |
| Missing evidence | Production authenticated session. |
| Required action | Playwright after login. |
| Verification method | Browser + session cookie. |
| Status | **LOCALLY VERIFIED** (9.3). Production authenticated **ENVIRONMENT BLOCKED**. |
| Commit | Pre-existing session path; Stage 9 proof in 9.2/9.3 commits. |

#### S9-03 Logout

| Field | Value |
|---|---|
| Requirement ID | S9-03 |
| Current implementation | Web logout → API logout / cookie clear. |
| Existing evidence | API/route tests. |
| Missing evidence | Production logout. |
| Required action | Playwright logout. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.3). Production **ENVIRONMENT BLOCKED**. |
| Commit | Pre-existing logout path; Stage 9 proof in 9.3 commit. |

### B. Studio entry and context

#### S9-04 Authenticated Studio entry

| Field | Value |
|---|---|
| Requirement ID | S9-04 |
| Current implementation | `apps/web/app/[locale]/studio/page.tsx`. |
| Existing evidence | Historical Studio screenshots in `docs/architecture/studio-evidence-refresh-2026-09-20.md` (HEAD then `0f7b92f`) — **HISTORICALLY VERIFIED** appearance, not Stage 9 acceptance. Unauthenticated Playwright smoke exists and is **not** Stage 9. |
| Missing evidence | Production authenticated Studio. |
| Required action | Fixture + Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.3). Production **ENVIRONMENT BLOCKED**. |
| Commit | Pre-existing Studio; Stage 9 proof in 9.3 commit. |

#### S9-05 Project/workspace context

| Field | Value |
|---|---|
| Requirement ID | S9-05 |
| Current implementation | Studio `project=` query + selected project TextField; API `GET /api/v1/projects`; `osStore` workspace root. |
| Existing evidence | API tests (`apps/api/src/routes/projects.test.ts`, `project-access.test.ts`). |
| Missing evidence | Switching/isolation (9.4); Production. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** for selection (9.3). Switch/isolation still 9.4. |
| Commit | Pre-existing; Stage 9 selection proof in 9.3 commit. |

#### S9-06 Project picker

| Field | Value |
|---|---|
| Requirement ID | S9-06 |
| Current implementation | Studio project `<TextField select>`. |
| Existing evidence | Source + historical screenshots. |
| Missing evidence | Production picker. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.3). |
| Commit | Pre-existing picker; Stage 9 proof in 9.3 commit. |

#### S9-07 Project selection

| Field | Value |
|---|---|
| Requirement ID | S9-07 |
| Current implementation | Selecting a project updates `project=` and Studio queries. |
| Existing evidence | Source. |
| Missing evidence | Production selection. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.3). |
| Commit | Pre-existing; Stage 9 proof in 9.3 commit. |

#### S9-08 Project switching

| Field | Value |
|---|---|
| Requirement ID | S9-08 |
| Current implementation | Same picker; switch A → B. |
| Existing evidence | Source. |
| Missing evidence | Production. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.4). |
| Commit | Pre-existing; Stage 9 proof in 9.4 commit. |

#### S9-09 Workspace root

| Field | Value |
|---|---|
| Requirement ID | S9-09 |
| Current implementation | `PUT /api/v1/projects/:id/workspace-root`; `assertSafeWorkspaceRoot`; ask-agent requires local root on API host. |
| Existing evidence | API tests. Ask-agent fails closed without a host-local root. |
| Missing evidence | Production workspace. |
| Required action | Local fixture dirs + PUT workspace-root (test-only paths). |
| Verification method | Local API + browser Ask Agent. |
| Status | **LOCALLY VERIFIED** for linking two roots (9.4). Ask Agent still 9.5. |
| Commit | Pre-existing; Stage 9 workspace fixture in 9.4 commit. |

#### S9-10 Project/workspace relationship

| Field | Value |
|---|---|
| Requirement ID | S9-10 |
| Current implementation | `osStore.setWorkspaceRoot(projectId, root)`; owner bind on create. |
| Existing evidence | API tests. |
| Missing evidence | Production. |
| Required action | Playwright isolation. |
| Verification method | Browser + disk. |
| Status | **LOCALLY VERIFIED** (9.4). |
| Commit | Pre-existing; Stage 9 proof in 9.4 commit. |

#### S9-11 Context after switching

| Field | Value |
|---|---|
| Requirement ID | S9-11 |
| Current implementation | Studio queries keyed by `projectId`. |
| Existing evidence | Source. |
| Missing evidence | Production. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.4). |
| Commit | Pre-existing; Stage 9 proof in 9.4 commit. |

### C. Isolation and persistence

#### S9-12 Project isolation

| Field | Value |
|---|---|
| Requirement ID | S9-12 |
| Current implementation | `assertProjectWriteAccess` / `assertProjectReadAccess` in `apps/api/src/services/project-access.ts`. Non-owner `user` denied. `admin` and Control Plane roles bypass ownership (existing product rule — do not change for the fixture). |
| Existing evidence | `project-access.test.ts`, isolation audit. |
| Missing evidence | Cross-user isolation remains API-tested. Production. |
| Required action | Playwright two-project fixture. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** for picker/workspace isolation (9.4). |
| Commit | Pre-existing; Stage 9 proof in 9.4 commit. |

#### S9-13 Refresh persistence

| Field | Value |
|---|---|
| Requirement ID | S9-13 |
| Current implementation | `project=` query string on Studio. |
| Existing evidence | Source. |
| Missing evidence | Production. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.4). |
| Commit | Pre-existing; Stage 9 proof in 9.4 commit. |

#### S9-14 Deep links

| Field | Value |
|---|---|
| Requirement ID | S9-14 |
| Current implementation | `/[locale]/studio?project=<uuid>`. |
| Existing evidence | Source. |
| Missing evidence | Production. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.4). |
| Commit | Pre-existing; Stage 9 proof in 9.4 commit. |

### D. Agent and patch workflow

#### S9-15 Ask Agent

| Field | Value |
|---|---|
| Requirement ID | S9-15 |
| Current implementation | Studio UI POST `/api/v1/studio/ask-agent`. Guardian: `evaluateStudioProposalGuardian` (no LLM). Proposal via `createProposal` in `code.ts`. |
| Existing evidence | API tests; Guardian unit path. |
| Missing evidence | Authenticated browser Ask Agent against a real local workspace. |
| Required action | Fixture workspace + Playwright. |
| Verification method | Browser (real HTTP). |
| Status | **LOCALLY VERIFIED** for the Studio **CODE_ENGINEER** path: button `Ask agent`, `POST /api/v1/studio/ask-agent`, patch id + status `PROPOSED\|EVALUATED\|AWAITING_APPROVAL\|DRAFT`, and the paragraph `Propose → review → approve → apply → verify`. The Personal Supervising Agent is a different panel and is **NOT PROVEN**. Production Ask Agent **ENVIRONMENT BLOCKED**. |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-16 Patch proposal

| Field | Value |
|---|---|
| Requirement ID | S9-16 |
| Current implementation | Patch artifact persisted; Studio patch list; status `PROPOSED` / `AWAITING_APPROVAL` / etc. |
| Existing evidence | `apps/api/src/routes/code.test.ts`, `studio-remediation-truth.test.ts`. |
| Missing evidence | Browser sees proposal after Ask Agent. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.5). Production **ENVIRONMENT BLOCKED**. |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-17 Approval / SoD

| Field | Value |
|---|---|
| Requirement ID | S9-17 |
| Current implementation | Patch `/approve` is PatchArtifact sign-off (`StudioPatchWorkflow` → `/approve`). Disk write Apply uses `ApprovalRequest` + `DOCUMENT.EXECUTE`. Live-human: `POST /api/v1/code/patches/:id/apply/decide-and-execute`. SoD: `decidedBy !== requestedBy` in live-approval + governed execution. **There is no user `approver@atlas.local`.** Tests use distinct ids (`requester@example.com` / `decider@example.com`) via mocked `getRequestUser` — **API-layer HISTORICALLY / locally unit-tested, not browser**. |
| Existing evidence | `code.test.ts` self-approve 403; live-human tests. |
| Missing evidence | Two **real** local identities, real session cookies, requester cannot self-redeem, second identity can decide-and-execute. Studio UI currently stores `approvalId` in requester React state and retries `/apply?approvalId=` — that retry is the **requester** and must remain denied. Second identity has **no dedicated Studio decide panel**; Stage 9 must either add a **minimal** live-human control (not a redesign) or document browser cookie + real HTTP decide-and-execute as the acceptance layer for the SoD transition. |
| Required action | Two-identity Playwright fixture. Do not bypass SoD. Do not change production authz to make the test pass. |
| Verification method | Two Playwright storage states; browser + real API. |
| Status | **LOCALLY VERIFIED** for two storage states: requester `POST .../apply/decide-and-execute` is **403**; decider `/auth/me` email is `stage9-decider@atlas.test`; decider decide returns `APPLIED`. The requester **can** sign the patch artifact with Approve. That click is not the SoD denial. There is still no Studio decide panel. Production SoD unchanged. GitHub Actions still sets `replace-me`, so this path is **ENVIRONMENT BLOCKED** on that job. |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-18 Apply

| Field | Value |
|---|---|
| Requirement ID | S9-18 |
| Current implementation | `POST /api/v1/code/patches/:id/apply` (202 + approval) and `.../apply/decide-and-execute` (live human). `assertPatchWrite` → project owner, or `admin` / Control Plane role. |
| Existing evidence | API tests apply to temp dirs. Historical remaining-work Path 1 API apply — **HISTORICALLY VERIFIED**, not Stage 9 browser. Historical Studio UI: Apply button disabled without approval (`studio-evidence-refresh-2026-09-20.md`). |
| Missing evidence | Local browser sequence that **actually writes** the approved patch. |
| Required action | Substage 9.7 with disk assertion. |
| Verification method | Browser + filesystem. |
| Status | **LOCALLY VERIFIED** (9.7, disk write). Production **ENVIRONMENT BLOCKED**. CI job **ENVIRONMENT BLOCKED** while `replace-me` disables the live approval store. |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-19 Verify

| Field | Value |
|---|---|
| Requirement ID | S9-19 |
| Current implementation | `POST /api/v1/code/patches/:id/verify` via `patchVerifyPath`; Studio Verify button. |
| Existing evidence | API tests. |
| Missing evidence | Browser after real Apply. |
| Required action | Substage 9.7. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.7, Studio Verify after disk apply). Production **ENVIRONMENT BLOCKED**. |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-20 Rollback

| Field | Value |
|---|---|
| Requirement ID | S9-20 |
| Current implementation | `POST /api/v1/code/patches/:id/rollback` (may mint a second ApprovalRequest). Studio Rollback button. |
| Existing evidence | API tests. |
| Missing evidence | Browser rollback + restored file bytes. |
| Required action | Substage 9.7. |
| Verification method | Browser + filesystem. |
| Status | **LOCALLY VERIFIED** (9.7, marker file bytes restored). Production **ENVIRONMENT BLOCKED**. |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

### E. Localization / accessibility

#### S9-21 EN

| Field | Value |
|---|---|
| Requirement ID | S9-21 |
| Current implementation | `apps/web` locale `en`; message catalogs. |
| Existing evidence | Unauthenticated locale tests; historical EN Studio screenshots. |
| Missing evidence | Authenticated Studio EN. |
| Required action | Playwright `/en/studio`. |
| Verification method | Browser (not JSON-file parsing). |
| Status | **LOCALLY VERIFIED** (9.8, `/en/studio` LTR). |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-22 HE

| Field | Value |
|---|---|
| Requirement ID | S9-22 |
| Current implementation | Locale `he`; RTL dir. |
| Existing evidence | Message files. Historical HE/AR/RTL marked **UNKNOWN** in studio-evidence-refresh-2026-09-20.md. |
| Missing evidence | Authenticated Studio HE rendering + route. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.8, `/he/studio` `lang=he` `dir=rtl`). |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-23 AR

| Field | Value |
|---|---|
| Requirement ID | S9-23 |
| Current implementation | Locale `ar`; RTL dir. |
| Existing evidence | Message files only. |
| Missing evidence | Authenticated Studio AR. Do not close from translation-file parsing. |
| Required action | Playwright. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.8, `/ar/studio` `lang=ar` `dir=rtl`). |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-24 RTL

| Field | Value |
|---|---|
| Requirement ID | S9-24 |
| Current implementation | `dir="rtl"` for he/ar layouts. |
| Existing evidence | Layout source. Historical UNKNOWN. |
| Missing evidence | Browser `dir` + no nav regression on direction switch. |
| Required action | Playwright HE and AR. |
| Verification method | Browser. |
| Status | **LOCALLY VERIFIED** (9.8, HE and AR `dir=rtl`). |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

#### S9-25 Accessibility

| Field | Value |
|---|---|
| Requirement ID | S9-25 |
| Current implementation | `e2e/a11y.spec.ts` axe on primary surfaces; hamburger `test.fixme` because **no authed fixture**. |
| Existing evidence | Unauthenticated a11y. Do not weaken `fixme` — solve the fixture. |
| Missing evidence | Authenticated Studio axe. |
| Required action | Fixture + authenticated a11y spec. Preserve existing tests. |
| Verification method | Playwright + axe. |
| Status | **LOCALLY VERIFIED** for authenticated Studio axe, hamburger, and `/en/projects` document navigation (9.9). Unauthenticated `e2e/a11y.spec.ts` hamburger `fixme` **preserved**. |
| Commit | Pre-existing; local proof in operator run after `f21fc9b`. |

---

## 4. Verification requirements

Stage 9 acceptance is **not** satisfied by:

- static source inspection
- mocked `getRequestUser` API tests alone (those remain valid **API** evidence)
- unauthenticated Playwright smoke
- historical 2026-09-20 Studio screenshots
- Production anonymous `/auth/session` or `/auth/providers`
- translation-file parsing for AR/RTL

Required local proofs (substages 9.2–9.10):

1. Deterministic local REQUESTER and DECIDER identities (distinct users).
2. Login, session, logout.
3. Authenticated Studio; picker; select; switch A→B; isolation; refresh; deep link.
4. Ask Agent + visible proposal.
5. Requester cannot self-redeem the live Apply approval (`decide-and-execute` 403). Patch-artifact Approve by the requester is allowed and is not this proof.
6. Second identity performs authorized live-human decide-and-execute.
7. Actual Apply writes files; Verify; Rollback restores.
8. EN / HE / AR / RTL in authenticated Studio.
9. Authenticated accessibility; existing a11y tests preserved.
10. `/en/projects` `ERR_ABORTED` classified (infrastructure vs application) without deleting the assertion.

Production:

- Unauthenticated CORS/session after `08e0c40` is **not** authenticated Stage 9.
- Authenticated Production Stage 9 is **ENVIRONMENT BLOCKED** unless a legitimate non-invented Production account exists. Do not enable demo login in Production (`isAtlasDemoLoginEnabled` already ignores the flag when `NODE_ENV=production`).

---

## 5. Known blockers

| ID | Blocker | Class |
|---|---|---|
| B1 | Playwright storageState / login fixture. | **CLOSED locally** — `e2e/stage9` register+UI login. CI job now runs `pnpm test:e2e:stage9`. |
| B2 | No second identity in Playwright. Do not invent `approver@atlas.local`. | **CLOSED locally** — `stage9-requester@atlas.test` + `stage9-decider@atlas.test`. |
| B3 | Apply/Verify/Rollback not proven in browser in this program. | **CLOSED locally** — `avr.spec.ts` reads `hello.ts` before apply, after apply, after verify, and after rollback. |
| B4 | Studio UI has no second-session live-human decide panel; SoD execute may need a **minimal** control or documented cookie+HTTP acceptance layer. | VERIFICATION INFRASTRUCTURE (product gap for dual-session UX, not SoD absence) |
| B5 | `assertPatchWrite` on project-scoped patches: owner, or admin/operator. Fixture must assign DECIDER a role that may write the requester’s project **without** making requester == decider and **without** changing SoD. Planned local-only: `ATLAS_OPERATOR_EMAILS=stage9-decider@atlas.test` on Playwright/API **test process env**, never Production `vercel.json`. | DESIGN CONSTRAINT |
| B6 | Ask-agent requires a filesystem `workspaceRoot` on the API host. Local e2e can satisfy this; Production cannot without a Production workspace. | ENVIRONMENT (Production AVR) |
| B7 | No legitimate Production authenticated account for automation. | ENVIRONMENT BLOCKED |
| B8 | `/en/projects` `ERR_ABORTED` historically observed (studio-evidence-refresh / Playwright). Cause not classified in this pass yet (substage 9.9). | OPEN INVESTIGATION |
| B9 | `e2e/a11y.spec.ts` hamburger `test.fixme` pending authed fixture. | VERIFICATION INFRASTRUCTURE |
| B10 | Untracked `cookies.txt` — never stage. Untracked `docs/architecture/studio-web-future-direction-2026-09-25.md` — design-only, not Stage 9, do not commit unless independently proven relevant. | GIT DISCIPLINE |

**Not a blocker:** Production API boot 503 / missing CORS — closed by **`08e0c40`**. Do not reopen.

---

## 6. Sequential execution order

| Substage | Objective | Exit |
|---|---|---|
| **9.1** | This master plan + reconciliation | Document committed; no product rewrite. |
| **9.2** | Local authenticated Playwright fixtures (REQUESTER + DECIDER) | Register/login against localhost only; two storage states; fail-closed if API origin is not local. |
| **9.3** | Auth + Studio entry + project context | S9-01–S9-07 browser evidence. |
| **9.4** | Switch, isolation, persistence, deep links | S9-08–S9-14. |
| **9.5** | Ask Agent + patch proposal | S9-15–S9-16. |
| **9.6** | Two-identity SoD | S9-17. |
| **9.7** | Apply → Verify → Rollback | S9-18–S9-20, disk proof. |
| **9.8** | EN / HE / AR / RTL | S9-21–S9-24. |
| **9.9** | Accessibility + `/en/projects` ERR_ABORTED | S9-25 + B8 classification. |
| **9.10** | Full Stage 9 regression + closure | §10 criteria or explicit remaining blockers. |

Do not skip a substage. Update this document after each.

---

## 7. Evidence for every completed item

### 7.1 Substage 9.1 — Master plan

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.1 |
| Requirement IDs | Process only (inventory of S9-01–S9-25). No requirement marked CLOSED. |
| Files changed | `docs/architecture/STAGE_9_MASTER_PLAN_2026-09-26.md` |
| Tests executed | None (documentation reconciliation). |
| Runtime evidence | Repository inspection of auth, Studio, `code.ts`, `project-access.ts`, Playwright config, `e2e/*.spec.ts`, `08e0c40` CORS commit. |
| Result | Authoritative Stage 9 document created. Existing product paths recorded as IMPLEMENTED; Stage 9 browser acceptance recorded as blocked or not started. |
| Commit | **`b148d9c`** |
| Remaining blockers | B1–B10 unchanged. |

### 7.2 Substage 9.2 — Authenticated Playwright fixtures

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.2 |
| Requirement IDs | Infrastructure for S9-01–S9-25. Does **not** close S9-01–S9-07 (that is 9.3). Closes B1 and B2 locally. |
| Files changed | `e2e/stage9/local-api.ts`, `e2e/stage9/identities.ts`, `e2e/stage9/accounts.ts`, `e2e/stage9/auth.setup.ts`, `e2e/stage9/fixture-probe.spec.ts`, `e2e/.auth/.gitkeep`, `playwright.config.ts`, `package.json`, `.gitignore`, `.github/workflows/e2e-critical-path.yml`, this document |
| Tests executed | `pnpm test:e2e:stage9` — 4 passed (setup + 3 probes) in 15.7s |
| Runtime evidence | Register/login via real `/api/v1/auth/register` and `/en/auth/login` UI. REQUESTER `stage9-requester@atlas.test` storageState; DECIDER `stage9-decider@atlas.test` separate context. Probe `/auth/me` 200 for both; ids distinct; Production URL rejected. Authenticated `/en/studio` heading "Project Studio" as requester. |
| Result | Local two-identity fixture **LOCALLY VERIFIED**. Production auth unchanged. Demo login not enabled in Production. |
| Commit | **`e5a29bc`** |
| Remaining blockers | B3–B10 remain. B5 still requires API process `ATLAS_OPERATOR_EMAILS` for 9.6/9.7 (set in Playwright webServer env and e2e CI job only; existing local `pnpm dev` reuse may lack it). |

### 7.3 Substage 9.3 — Auth + Studio entry + project context

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.3 |
| Requirement IDs | S9-01, S9-02, S9-03, S9-04, S9-05 (selection), S9-06, S9-07 |
| Files changed | `e2e/stage9/auth-studio.spec.ts`, `e2e/stage9/projects.ts`, `e2e/stage9/auth.setup.ts`, `e2e/stage9/accounts.ts`, `playwright.config.ts`, this document |
| Tests executed | Operator-run `pnpm test:e2e:stage9` — **9 passed (19.3s)** |
| Runtime evidence | UI login → Studio; `/auth/session` authenticated; Sign out → `/en/auth/login` and `/auth/me` 401; project picker select updates `?project=`; decider cookie jar ≠ requester. Setup uses real `/auth/register` + `/auth/login` cookies on a browser context (UI form still covered by the login test). |
| Result | S9-01–S9-07 **LOCALLY VERIFIED**. Production authenticated still **ENVIRONMENT BLOCKED**. |
| Commit | **`9bf9c30`** |
| Remaining blockers | B3–B10; S9-08–S9-14 are 9.4. |

### 7.4 Substage 9.4 — Switch, isolation, persistence, deep links

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.4 |
| Requirement IDs | S9-08, S9-09, S9-10, S9-11, S9-12, S9-13, S9-14 |
| Files changed | `e2e/stage9/isolation.spec.ts`, `e2e/stage9/projects.ts`, this document |
| Tests executed | Operator-run `pnpm test:e2e:stage9` — **10 passed (1.6m)** including isolation/refresh/deep-link |
| Runtime evidence | Two temp workspaces with distinct marker files. Project A tree/editor shows only A; switch to B shows only B; reload keeps B; deep link `?project=` restores A without B leak. |
| Result | S9-08–S9-14 **LOCALLY VERIFIED**. Production workspace **ENVIRONMENT BLOCKED**. |
| Commit | *(filled after 9.4 commit)* |
| Remaining blockers | B3–B4, B5–B10; Ask Agent is 9.5. |

### 7.5 Substage 9.5 — Ask Agent + patch proposal

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.5 |
| Requirement IDs | S9-15, S9-16 |
| Files changed | `e2e/stage9/ask-agent.spec.ts` |
| Tests executed | Operator-run `pnpm test:e2e:stage9` — **19 passed (1.7m)**, including Ask Agent. |
| Runtime evidence | Authenticated Studio button `Ask agent` posted `/api/v1/studio/ask-agent` (CODE_ENGINEER heuristic, not the Personal Supervising Agent). The response contained a patch id and a proposal-class status, and Studio showed that status plus `Propose → review → approve → apply → verify`. |
| Result | **LOCALLY VERIFIED**. Production Ask Agent **ENVIRONMENT BLOCKED**. |

### 7.6 Substage 9.6 — Two-identity SoD

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.6 |
| Requirement IDs | S9-17 |
| Files changed | `e2e/stage9/sod.spec.ts`, `e2e/stage9/patch-flow.ts` |
| Tests executed | Same operator run, 19 passed. SoD test passed in 8.0s. |
| Runtime evidence | Requester self `decide-and-execute` denied. Distinct decider apply succeeded. Production SoD code unchanged. |
| Result | **LOCALLY VERIFIED** against the live local approval store. GitHub Actions `replace-me` still makes this **ENVIRONMENT BLOCKED** on CI. |

### 7.7 Substage 9.7 — Apply → Verify → Rollback

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.7 |
| Requirement IDs | S9-18, S9-19, S9-20 |
| Files changed | `e2e/stage9/avr.spec.ts` |
| Tests executed | Same operator run. AVR test passed in 12.6s. |
| Runtime evidence | Decider apply changed `hello.ts` on disk. Studio Verify succeeded. Rollback restored the original bytes. |
| Result | **LOCALLY VERIFIED**. Production AVR **ENVIRONMENT BLOCKED**. CI **ENVIRONMENT BLOCKED** while the job sentinel disables the live approval store. |

### 7.8 Substage 9.8 — EN / HE / AR / RTL

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.8 |
| Requirement IDs | S9-21, S9-22, S9-23, S9-24 |
| Files changed | `e2e/stage9/locale.spec.ts` |
| Tests executed | Same operator run. EN, HE, and AR Studio tests passed. |
| Runtime evidence | Authenticated `/en/studio` LTR; `/he/studio` and `/ar/studio` RTL with the locale headings. |
| Result | **LOCALLY VERIFIED**. |

### 7.9 Substage 9.9 — Accessibility + `/en/projects`

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.9 |
| Requirement IDs | S9-25, B8 |
| Files changed | `e2e/stage9/a11y-studio.spec.ts` |
| Tests executed | Same operator run. Axe, hamburger, and `/en/projects` passed. Unauthenticated hamburger `fixme` preserved. |
| Runtime evidence | Authenticated Studio axe and hamburger passed. `/en/projects` document navigation under `domcontentloaded` was not `ERR_ABORTED`. Historical aborts were Playwright `networkidle` / in-flight compile aborts, not a removed assertion. |
| Result | **LOCALLY VERIFIED** for that navigation. |

### 7.5a Fixture notes (2026-09-26)

GitHub Actions `NODE_ENV=production` issues `SameSite=None; Secure` session cookies. Chromium will not send Secure cookies on `http://127.0.0.1`. Production `sessionCookie()` is unchanged. Stage 9 rewrites **loopback-only** cookies to `Secure=false; SameSite=Lax`.

`SUPABASE_SERVICE_ROLE_KEY=replace-me` makes `isLiveSupabase` false. Apply then returns **503** `Live approval store is not configured`. The local Stage 9 API keeps the developer's live Supabase so Apply can mint a real approval. If the parent shell exports that sentinel, the local Playwright API process drops only that value so `apps/api/.env` can supply the live local store. The GitHub Actions job env is unchanged and still sets `replace-me`.

### 7.10 Substage 9.10 — Local regression

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Substage | 9.10 |
| Requirement IDs | S9-01–S9-25 local acceptance |
| Tests executed | Operator-run `pnpm test:e2e:stage9` — **19 passed (1.7m)** |
| Runtime evidence | Setup, auth, isolation, Ask Agent, SoD, AVR, EN/HE/AR/RTL, authenticated a11y, `/en/projects`. |
| Result | **LOCALLY VERIFIED**. Production authenticated Stage 9 **ENVIRONMENT BLOCKED**. CI SoD/AVR **ENVIRONMENT BLOCKED** under `replace-me`. Stage 10 not started. |

---

## 8. Git commit references (separate from Stage 9 implementation)

| Commit | Role |
|---|---|
| **`08e0c40`** | **Production API boot + CORS remediation.** Lazy `node-pty`, `WEB_ORIGIN` on Vercel API, CORS on serverless fallback. **Not a Stage 9 implementation commit.** Do not treat it as Studio/Auth/SoD closure. |
| **`b148d9c`** | Stage 9.1 master plan (this document created). |
| **`e5a29bc`** | Stage 9.2 local two-identity Playwright fixtures. |
| **`9bf9c30`** | Stage 9.3 authenticated Studio entry and project picker. |
| **`ad366c2`** | Control Plane `zod` dependency (Vercel TS2307). **Not a Stage 9 implementation commit.** |
| `14522e9` | Stage 8 genius demotion tests (out of Stage 9 scope). |
| Historical Studio evidence file | `docs/architecture/studio-evidence-refresh-2026-09-20.md` — **HISTORICALLY VERIFIED** screenshots / incomplete Playwright; not Stage 9 acceptance. |
| remaining-work.md F Path 1 | Historical API apply/verify — **HISTORICALLY VERIFIED** at API layer; not Stage 9 browser AVR. |

Stage 9 commits will be listed here as substages land. Starting HEAD for this pass: **`08e0c40`**.

---

## 9. Remaining gaps (after local 9.10)

1. ~~No local Playwright authenticated fixture.~~ Closed locally in 9.2.
2. ~~No second local identity for SoD in the browser.~~ Closed locally in 9.6.
3. ~~Authenticated login/session/logout/Studio/picker.~~ Closed locally in 9.3.
4. ~~Switch / isolation / persistence / deep links.~~ Closed locally in 9.4.
5. ~~Ask Agent + patch proposal.~~ Closed locally in 9.5.
6. ~~Apply → Verify → Rollback.~~ Closed locally in 9.7.
7. ~~Authenticated EN/HE/AR/RTL.~~ Closed locally in 9.8.
8. Authenticated a11y passed. Unauthenticated hamburger `fixme` in `e2e/a11y.spec.ts` is preserved.
9. `/en/projects` document navigation under `domcontentloaded` did not `ERR_ABORTED`. Historical `networkidle` aborts are not reclassified as an application defect.
10. Production authenticated Stage 9 **ENVIRONMENT BLOCKED**.
11. CI SoD/AVR **ENVIRONMENT BLOCKED**: the e2e job sets `SUPABASE_SERVICE_ROLE_KEY=replace-me`, so Apply returns 503.
12. SoD acceptance is two real sessions and `decide-and-execute`. There is still no second Studio decide panel.

---

## 10. Final Stage 9 closure criteria

Mark **STAGE 9 VERIFIED** only when all of the following are true:

- [x] Authenticated browser fixture works (local/test-only).
- [x] Two-identity SoD fixture works (`requester != approver`).
- [x] Authenticated Studio entry works.
- [x] Project selection works.
- [x] Project switching works.
- [x] Isolation is proven.
- [x] Refresh persistence is proven.
- [x] Deep links are proven.
- [x] Ask Agent is proven for the CODE_ENGINEER `POST /api/v1/studio/ask-agent` path. Personal Supervising Agent is **NOT PROVEN**.
- [x] Patch proposal is proven (real patch id and status on that response, then visible in Studio).
- [x] Self-redeem of live Apply is denied (`decide-and-execute` 403). Requester patch Approve is allowed and is not this item.
- [x] Legitimate second identity approval / decide-and-execute is proven.
- [x] Actual Apply is proven (disk).
- [x] Actual Verify is proven.
- [x] Actual Rollback is proven (restored state).
- [x] EN verified in authenticated Studio.
- [x] HE verified in authenticated Studio.
- [x] AR verified in authenticated Studio.
- [x] RTL verified (HE and AR), not from JSON parsing.
- [x] Applicable accessibility checks pass (existing tests preserved; fixture unblocks `fixme` where that was the only bar).
- [x] Relevant regression suite passes.
- [x] Production-required checks are proven **or** explicitly **ENVIRONMENT BLOCKED**.
- [x] Every closed requirement has evidence in §7.
- [x] Implementation changes have focused commits.
- [x] Working tree is understood; `cookies.txt` and unrelated design docs unstaged.
- [x] Stage 10 not started.

Local executive status is **STAGE 9 LOCALLY VERIFIED** for the assertions in `e2e/stage9` (operator run recorded at `51714f8`, re-run **19 passed (2.0m)** after the local fixture stopped inheriting `SUPABASE_SERVICE_ROLE_KEY=replace-me`). That status does not include the Personal Supervising Agent, a Studio decide panel, Production authenticated Studio, or CI Apply/SoD/AVR. Production authenticated Stage 9 remains **ENVIRONMENT BLOCKED**. CI SoD/AVR remains **ENVIRONMENT BLOCKED** under `replace-me`. This is not a Production verification.

---

## 11. Fixture design (authorized for 9.2; not implemented in 9.1)

Local/test-only only. Must not affect Production authentication.

| Identity | Email | Role intent | Password |
|---|---|---|---|
| REQUESTER | `stage9-requester@atlas.test` | Tenant user (project owner) | Deterministic test-only secret, documented in `e2e` fixture module, **never** Production, **never** committed to client bundles as a live Production password. |
| DECIDER | `stage9-decider@atlas.test` | Distinct user; local Playwright/API process may set `ATLAS_OPERATOR_EMAILS` to this email so `bootstrapRole` yields `operator` and existing `assertProjectWriteAccess` admin/operator bypass applies. **Not** `approver@atlas.local`. | Distinct deterministic test-only secret. |

Invariants the fixture must not weaken:

- `requester != approver`
- requester cannot self-redeem the live approval (`decide-and-execute`); patch-artifact Approve by the requester is a different control
- approver cannot impersonate requester (separate cookies)
- approval requires the correct authorization context
- fail closed unless API base URL is localhost / loopback
- `isAtlasDemoLoginEnabled` remains false in Production `NODE_ENV`

Registration: `POST /api/v1/auth/register` (works when demo login is off). First-user-admin bootstrap is a store-order hazard; 9.2 must register in a defined order and assert distinct `user.id` values.

---

## 12. Apply → Verify → Rollback acceptance path (9.7)

Required sequence (local):

```
Requester login
  → Ask Agent
  → Patch proposal
  → AWAITING_APPROVAL / approve-for-apply
  → Requester may Approve the patch artifact
  → Requester self decide-and-execute DENIED (403)
  → Approver authenticates separately
  → Authorized decide-and-execute
  → Apply (disk write)
  → Verify
  → Rollback
  → Restored state
```

Evidence must prove every transition. API unit tests remain supporting evidence, not a substitute for this path unless a specific transition is explicitly classified in this document as non-browser (none are, as of 9.1, except Production AVR which is ENVIRONMENT BLOCKED).

---

## 13. Production (separate ledger)

| Check | Status |
|---|---|
| API boot + CORS + OPTIONS + unauthenticated session/providers | **PRODUCTION VERIFIED** by `08e0c40` (not Stage 9). |
| Authenticated Studio in Production | **ENVIRONMENT BLOCKED** — no legitimate automated Production account; do not invent one; do not enable demo login. |
| Production Ask Agent / Apply / workspace | **ENVIRONMENT BLOCKED** — requires host workspace + authenticated user. |

---

## 14. Working tree policy

Never stage:

- `cookies.txt`
- `docs/architecture/studio-web-future-direction-2026-09-25.md` (unless independently proven relevant — it is not Stage 9)

Stage only files belonging to the current substage.
