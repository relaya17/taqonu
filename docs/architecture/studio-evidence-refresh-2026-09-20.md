# ARLET STUDIO — READ-ONLY FINAL EVIDENCE REFRESH
**Baseline:** `0f7b92fab74b2167e5454fdd239246109861f45f` (`0f7b92f`)
**Branch:** `main`
**Date:** 2026-09-20
**Mode:** Evidence only. No architecture rebuild. No production/AWS/cloud. No filesystem jail claim.
**Working tree extra (not executed as Studio code):** untracked investor docs under `docs/strategy/`; `supabase/.branches/` and `supabase/.temp/` present and untouched.

---

## 1. VERDICT

**Final Confrontation: NOT READY**  
**Classification unchanged:** LATE IMPLEMENTATION / PRE-FINAL-VALIDATION

Core governed architecture remains intact in tests and in the first live Studio Files load this pass.

This pass **did** refresh unit/API evidence for PTY, Guardian, Apply/Verify, memory, language service, build, and replace engine.

This pass **did not** complete the live confrontation path (open file → replace → test explorer → PTY reconnect → Apply→Verify on disk → HE/AR/RTL/a11y). After a 4-worker Playwright run, the local Next server entered a JSON.parse 500 state. Locale files parse cleanly in isolation.

**REGRESSION: NONE OBSERVED IN GOVERNED ARCHITECTURE.**  
**REGRESSION: ONE SOURCE-SCAN TEST FAILED** (Git UI string contract).  
**REGRESSION-FREE SYSTEM: NOT PROVEN.**

---

## 2. GIT BASELINE

| Check | Result |
| --- | --- |
| HEAD | `0f7b92f` feat(studio): add TypeScript language service, governed build, and workspace replace |
| Branch | `main` |
| Dirty Studio source | No |
| Untracked | investor memo files; supabase generated dirs (not staged, not inspected) |

---

## 3. TEST EVIDENCE THIS PASS

### 3.1 Studio / Guardian / memory / PTY / language / replace

`vitest run` on 39 files:

| | |
| --- | --- |
| Passed | **275** |
| Failed | **1** |
| Files | 38 passed / 1 failed |

**Failed:** `apps/api/src/__tests__/web-studio-surfaces.test.ts`  
Assertion: `StudioGitStatus.tsx` contains `commandId: "git.status"`.

**What the file actually has:** a `GitCommandId` union and `requestCommand.mutate("git.status")`, plus `commandId: pendingCommandId` on decide-and-execute. Still no `git commit`. Still SoD path.

**Classification:** stale source-scan contract after `git.log` UI expansion. **Not** unrestricted Git. **Not** SoD break.

### 3.2 Apply / Verify / SoD (API)

`code.test.ts` + `engineering-loop.test.ts` + `patch-write.test.ts`:

| | |
| --- | --- |
| Files | 3 passed |
| Tests | **48 passed** |

Includes decide-and-execute, SoD, APPLIED, `code.patch.verified`.

**Apply / Verify unit+API on `0f7b92f`: PROVEN.**  
**Apply / Verify live browser disk write this pass: NOT EXECUTED** (read-only gate; would mutate a linked workspace).

### 3.3 Playwright (local, reuseExistingServer, 4 workers)

30 tests, **14 passed / 16 failed**, ~6.1 minutes.

**Passed (relevant):** API security suite (auth/session, workspace-root, patch approve, webhooks, redaction); a11y home skip-link/main/h1; HE health + readiness reachable; `/state` → projects; `/chat` → workbench.

**Failed:** mostly `page.goto` timeouts, `ERR_ABORTED`, 30s test timeouts, and Next 500s under concurrent compile. One a11y failure: narrow viewport expected `Open menu` while Studio had **Close menu** (sidebar already open — duplicate nav in snapshot).

**Concurrent load side effect (web log):** `SyntaxError: Unexpected non-whitespace character after JSON at position 4482` on `/en/studio`, `/en/memory`, `/investors`, `/en/observer`, `/en/sentinel`. After that, Studio Files (which had loaded) also 500'd.

**Locale files on disk:** `en.json` / `he.json` / `ar.json` each `JSON.parse` **OK**.

**Browser E2E: UNKNOWN / PARTIAL.** Failures are not a clean product-acceptance signal. They are not proof of a11y/RTL pass either.

**Full turbo `pnpm test`: NOT RUN.**

---

## 4. LIVE BROWSER (before server 500)

Signed-in Studio, English, project **brokerOS** (`34c56498-…`, workspace `C:\Users\User\project\github\brokerOS-main`).

| Step | Status | Evidence |
| --- | --- | --- |
| Open Studio EN | **PROVEN** | `/en/studio` — skip link, Files/Agent/Run/Terminal/Cloud/Checks |
| Select project | **PROVEN** | Query `project=` loaded brokerOS; tree listed |
| Open project / files tree | **PROVEN** | README, apps, packages, package.json, … |
| Open file | **UNKNOWN** | Click intercepted by sidebar overlay |
| Search | **PARTIAL** | Search files textbox present; not exercised |
| Replace | **PARTIAL** | In-buffer replace exists in page; workspace-replace API **not** wired in web |
| Run test explorer | **PARTIAL** | No Test Explorer UI; Run catalog exists in code |
| Problems | **PARTIAL** | Quality-gate items only (eval/gates). No TS diagnostics until a file is open |
| Build | **UNKNOWN** | Run tab not opened this pass |
| Terminal tab | **UNKNOWN** | Focused but URL stayed `tab=files`; later `tab=pty` 500 |
| PTY reconnect after reload | **UNKNOWN** | Not re-run live |
| Ask Agent | **PARTIAL** | Ask agent disabled until a file + prompt; CODE_ENGINEER copy present |
| Guardian live | **UNKNOWN THIS PASS** | Architecture tests exist; no live ask-agent this pass |
| Memory panel | **PARTIAL** | “Atlas memory in this project” empty; Open Memory link |
| Approve / Apply / Verify | **PARTIAL** | Buttons present. Apply/Verify/Rollback **disabled**. Approve enabled (pending patch UI). SoD copy visible. No disk Apply this pass |
| Git UI | **PARTIAL** | Request status / branch / diff / `git.log`. No add/unstage/restore/blame/commit/push UI |
| HE / AR | **UNKNOWN** | Not completed (server 500 after Playwright) |
| RTL | **UNKNOWN** | Not audited |
| Accessibility | **PARTIAL** | Skip link + main on EN Studio; Playwright a11y mostly failed under load |
| Responsive | **UNKNOWN** | Playwright narrow-viewport failed; hamburger vs Close menu |
| Debugger | **OPEN** | No debugger/CDP/DAP/breakpoint surface in Studio components |

---

## 5. AREA STATUS vs PRIOR REPORT

| Area | Prior | This pass | Notes |
| --- | --- | --- | --- |
| PTY core | CLOSED | **CLOSED** (tests) | Live reconnect **UNKNOWN** |
| PTY reconnect API | CLOSED | **CLOSED** (tests) | |
| Language Service | CLOSED | **CLOSED** (tests) | Full LSP client **NOT CLAIMED** |
| Governed Build | CLOSED | **CLOSED** (tests) | Live Run tab **UNKNOWN** |
| Guardian | ALREADY CLOSED | **CLOSED** (unit) | Live refresh **UNKNOWN** |
| Apply | UNKNOWN THIS PASS | **PROVEN** API/unit; **UNKNOWN** live disk | |
| Verify | UNKNOWN THIS PASS | **PROVEN** API/unit; **UNKNOWN** live disk | |
| Agent Memory | UNKNOWN THIS PASS | **PROVEN** unit/pipeline tests; **PARTIAL** live empty panel | Isolation live **UNKNOWN** |
| Git workflow | PARTIAL | **PARTIAL** + 1 source-scan fail | Catalog > UI |
| Workspace Replace | PARTIAL | **PARTIAL** | Engine + in-buffer; no workspace-replace UX |
| Test Runner | PARTIAL | **PARTIAL** | No explorer |
| Problems | PARTIAL | **PARTIAL** | Gates visible; TS/build not shown without file |
| Debugger | OPEN | **OPEN** | |
| i18n keys | PARTIAL | **PARTIAL** | Files parse; `ptyTerminal` keys present; live HE/AR unknown |
| Browser E2E | UNKNOWN | **PARTIAL** | 14/30; load 500s |
| Full regression | UNKNOWN | **UNKNOWN** | Targeted only |
| Atlas Cloud | BLOCKED | **BLOCKED** | |
| Production | BLOCKED | **BLOCKED** | |
| Filesystem jail | NOT IN SCOPE | **NOT IN SCOPE** | |

**Preserved (tests + first Studio load):** Agent ≠ PTY, no unrestricted Agent shell, governed Git (no commit UI), SoD copy, Guardian architecture, Control separation, no transcript claim, no secret capture.

---

## 6. CONFRONTATION PATH (required next)

Still required, **after** a healthy Next process (restart local `next dev` if JSON.parse 500 persists):

1. Open file (close overlay first)
2. Search + in-buffer replace
3. Language bar / Problems from TS
4. Run: vitest + `workspace.build`
5. Terminal: start PTY, type, reload, reconnect
6. Ask agent → Guardian CONSISTENT/CONFLICT/UNKNOWN/BLOCK
7. Second identity Apply → Verify (temp fixture, not brokerOS)
8. Memory isolation A vs B
9. HE + AR + `dir=rtl`
10. Keyboard / focus / 375px
11. Fix or explicitly waive the Git source-scan test
12. Debugger: implement or **NOT CLAIMED** for Final Acceptance

Do **not** start an architecture rebuild.  
Do **not** treat Playwright 16 failures as 16 product bugs until rerun **serial** against a recovered server.

---

## 7. BOTTOM LINE

> Studio is still **PRE-FINAL-CONFRONTATION**.

What moved this pass: Apply/Verify and Guardian/memory **unit/API** are no longer “unknown this pass”. They are **proven in tests** and **not proven live**.

What blocked live completion: Next.js 500 (`JSON.parse`) under parallel Playwright; first Files load had already succeeded.

Production and Atlas Cloud remain external and unauthorized.
