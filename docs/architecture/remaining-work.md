# Atlas work stages (authoritative)

Do not confuse **missing for stability** with **roadmap**.
Do not mark a stage Done without implementation + tests + runtime evidence.
Do not duplicate: `executeGovernedAction`, `dispatchAgentAction`, `executeTool`, `approvals.ts`, `verifyProposal`, `audit-log.ts`.

## CURRENT AUTHORITATIVE REMAINING (2026-09-18)

This section is the **current** remainder. Sections 01–19 below are
historical stage records. Do not reopen them. Do not treat them as an
open engineering backlog.

**Production gate: NOT PRODUCTION READY.**
**PRODUCTION: NOT PROVEN** (AWS production suspended; R0 EC2 identity remains **BLOCKED — EXTERNAL DEPENDENCY**).

### CONTROL 10/10 PROGRAM (2026-09-23)

Authoritative Control supervision register:
`docs/architecture/CONTROL_10_OF_10_MASTER_PLAN.md`.
Do not treat remaining-work 01–19 or gap-analysis as that source of truth.
Do not create R21/R22 or CTRL-023.

Waves 1–9 are landed for the actionable R01–R20 scope. R01–R03 are **VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED**. R04–R14 and R18–R20 are **IMPLEMENTED + TESTED**. R15–R17 remain **ENVIRONMENT BLOCKED** (HotelOS runtime, repeated FAILURE runtime, offsite DR). Cost attribution is implemented and tested; quantified cost savings are not. The historical canonical audit break at index 605 is preserved; the current writer is fixed and regression-tested. GitHub `verify` passed after test-fixture commit `4689e5f` (**CI FAILURE CLOSED — TEST FIXTURE CORRECTED AND VERIFIED**). That closure did not change production kill behavior. Production verification of Control remains unproven.

### CONTROL AUTHORIZATION / AGENT IDENTITY (2026-09-23)

Application-owned `agentId` is now an explicit optional field on
`atlas.application-preflight.v1` and is preserved on the response and
canonical audit (`null` when the hop has no runtime Agent). HotelOS
`agent.cio` is sent on invoke; embed / CaseFlow wraps / BrokerOS Gemini
remain `agentId = null` (not invented). HotelOS observational events
`ai.gateway.invoke` / `autonomy.act` map onto the existing Control
taxonomy (`agent.completed` / `tool.executed`) and require `X-Atlas-Reason`.
HotelOS `ai.approval.approved` / `payment.intent.created` / `hr.document.*`
remain **rejected** by the closed gateway taxonomy: they are HotelOS local
audit/HITL, not Atlas approval or Control lifecycle events. Do not map them
to `proposal.created`. This is **not** necessity inference, `UNNECESSARY`,
cost avoidance, or Fabric promotion.

### CONSOLIDATED PRODUCTION READINESS (2026-09-19) — ACCEPTED

Repository remediation for currently identified closable gaps is closed and locally verified.
This does **not** prove production. Next evidence gate is R0 when AWS is available. Do not start another generic audit.

| ID | Gap | Status |
| --- | --- | --- |
| OG-01 | Production demo-login fail-closed | **LOCALLY PROVEN — PRODUCTION NOT PROVEN** — source ignores demo flags in production; four `vercel.json` defaults are `0`; Web client identity has no password field. Live Vercel HTML/env not rechecked. |
| OG-02 | Evidence POST defaulted `epistemicState` to FACT | **CLOSED** |
| OG-03 | Studio 401 looked like empty projects | **CLOSED** |
| OG-04 | Admin/CP `vercel.json` public Control/Admin hops | **READY FOR PRODUCTION VERIFICATION** — source now loopback; live public Control Plane not changed. Files not deleted. |
| OG-05 | Unsigned provenance commit mismatch | **CLOSED** (signing remains UNSIGNED / EXTERNAL) |
| OG-06 | CI failed while Vercel READY | **IMPLEMENTED — NOT PROVEN** — workflow documents that GitHub CI does not control Vercel. Run `35363342909` logs 403. |
| OG-07 | API typecheck `userAccessToken` | **CLOSED** |
| P0 | Prior P0 remediation | **CLOSED / PRESERVED** |
| SLU | Studio Level-Up / World Benchmark | **CLOSED BASELINE** |

Final Production Proof remains **PENDING**. Private trust plane remains **NOT PROVEN / PRIOR FAILURE**. No AWS bypass. No production Vercel/Apply/Verify/DB change in this pass.

Repository publish guard (`pnpm production:publish-guard`) fail-closes unsafe checked-in Vercel defaults and SHA mismatch. It does **not** prove Vercel platform enforcement. DR `offsiteStatus` is `OFFSITE_NOT_CONFIGURED` when no destination is set — not backup success.

### OFFLINE GAP CLOSURE (2026-09-19)

### FINAL CLOSING PASS (2026-09-19)

P0 remains CLOSED. Arlet Studio is not Control. Production remains NOT PROVEN.
Empty `allowedAgents` stays default-open (INTENTIONAL). Extensions host is a
deliberate **NON-GOAL** (`STUDIO_EXTENSION_CONTRACT.productGoal: false`).

> **Superseded 2026-09-26 (Stage 4, ADR-024):** memory reads are fail-closed. Empty `allowedAgents` is
> open only to admitted, governed identities; an omitted requester id is visible
> only on a declared human surface. Record: `ARLETOS_MASTER_PROBLEM_REGISTER.md` §7.7.

This is the closing pass after FINAL COMPLETION EXECUTION. Not another audit.

| Track | Status | Evidence |
| --- | --- | --- |
| A1 Durable memory SoR | **CLOSED** (local persist + canonical `commitMemory`) / cloud runtime **BLOCKED — EXTERNAL DEPENDENCY** | Product writes (HTTP POST, agent lessons, patch apply, studio write, process-audit, exemplar clone, validated bug-fix) go through `commitMemory` → local `osStore.addMemory` then `tryPersistMemoryToSupabase` when `env` is live. Tests/demo-seed/QA pattern seed stay local-only by design. Live POST `/memory` 201 `cloudSynced: false` because configured Supabase timed out (Docker/engine absent). Unavailable-cloud unit tests PASS (fail-open; `requireCloudSuccess` fails closed with local row kept). Isolation unchanged. |
| A2 Model gateway + cost | **CLOSED** (honest $0) | Unchanged. |
| A3–A5 Authority / conflict | **CLOSED** | Unchanged. |
| B1 Governed Run | **CLOSED** (local) | Prior live SoD `node.version` on AMD. This pass mint 503 — same live-approval SoR outage. |
| B2 Test Runner | **CLOSED** (local) | Prior live AMD `UNAVAILABLE` / `passed: false`. This pass mint 503 — same SoR outage. |
| B3 Run UX | **CLOSED** (local) | Unchanged. |
| B4 a11y / i18n | **CLOSED** (keyboard/focus tested scope) | EN: skip-link first in tab order; main nav reachable when authed; Files→Chat→Run→Cloud→Checks via ArrowRight after `selectionFollowsFocus` + tab `onKeyDown`; Request run, Apply reachable. HE `dir=rtl`: skip `דלג לתוכן`, Run `הרצה`, Request `בקש הרצה`; Space selected `קבצים`. Visible-focus *paint* **NOT PROVEN** (automation window never matched `:focus-visible`). Reduced-motion CSS present, not instrumented. Not WCAG/screen-reader certification. |
| C Extensions | **OPTIONAL / NON-GOAL** | Unchanged. |
| D Performance | **OPTIONAL** | Unchanged. No work this pass. |
| E Security | **CLOSED** (local remaining items) | Unchanged. SoD not weakened. |
| F E2E | **CLOSED** (local Path 1 re-run) | Fixture `f4db3dc2-…` patch `25c34656-…`: Apply 202 approval `e611ac81-…`; owner self-decide 403 SoD; operator `69ae105a-…` decide-and-execute 200 APPLIED `README.md`; verify 200 PASS / patch VERIFIED / epistemic OBSERVED. Disk marker written. Audit `code.patch.applied` + `code.patch.verified`. Finding unbound (`NOT_ATTEMPTED`) — safe fixture, not a security exception. Project verdict remains BLOCKED (Truth ≠ apply). Production still NOT PROVEN. |

### MASTER GAP CLOSURE (2026-09-19)

P0 remains CLOSED. Arlet Studio is not Control. Production remains NOT PROVEN.

Phase 1 contracts are locked in code:

- `apps/api/src/services/atlas-architecture-contracts.ts`
- `MEMORY_AGENT_VISIBILITY_CONTRACT` — empty `allowedAgents` is **default-open** (INTENTIONAL). Omit requester id stays human-surface-visible. Tenant/owner isolation is fail-closed.
  - **Superseded 2026-09-26 (Stage 4, ADR-024):** the contract is now `emptyAllowedAgents: "open-to-admitted-identities-only"`, `omitRequesterId: "human-surface-declared-only"`, unknown ids denied, PSA bound to the memory owner, mixed ids AND-ed.
- Agent id ≠ model id. Studio `proposePatch` is CODE_ENGINEER **heuristic** (`intelligenceKind: "heuristic"`, `modelInvoked: false`). Model output is not Truth.
- Governed Studio run: `POST /api/v1/projects/:id/studio/terminal` and `/tests` are RECORD.EXECUTE + live-human `decide-and-execute`. Callers send `commandId` only. Spawn is `shell: false` inside the linked workspace. No unrestricted shell. Extensions are a fail-closed manifest registry — no marketplace, no user JS, no host API.

GAP-043 (full IDE terminal/LSP/debugger) remains a non-goal. This pass implemented a governed subset only.

### Personal Agent Guardian (local, 2026-09-19)

New local layer after the closed Studio baseline. Does **not** reopen P0 or GAP-043.

- Deterministic Guardian in `@atlas/shared` returns CONSISTENT / CONFLICT / UNKNOWN without an LLM. Policy violations BLOCK `ask-agent` (no Patch upsert).
- Project knowledge is structured (structure, language/framework, symbols, memories) and scoped to owner+project. Failed fixes stay failed.
- Studio briefing surfaces the evaluation (EN/HE/AR). In-buffer find/replace does not write disk until Save.
- Governed Git catalog adds read-only `git.branch` and `git.diff` (still RECORD.EXECUTE + SoD). Not a PTY. Not unrestricted Agent execution.
- Language intelligence uses TypeScript's language service (diagnostics, hover, definition, references, rename, symbols). Not regex. Not an LLM. Debugger remains unimplemented.

### Interactive user terminal (local, 2026-09-20)

Human-only Studio PTY is separate from governed `commandId` execution.

- Backend: `node-pty` ConPTY on Windows; Fastify WebSocket plus ticketed SSE (`/events`) for browsers that block cross-origin WS; session tickets; start-cwd = linked workspaceRoot (not a filesystem jail; a real shell can `cd` out).
- Frontend: xterm.js (not a textarea). Each PTY session has its own Terminal instance, SSE stream, and scrollback. Output over SSE/fetch; input over REST. Agent cannot open/inherit a PTY (`x-atlas-actor-kind: AGENT` denied). Transcripts are not stored in Atlas.
- Reconnect: cookie-authenticated `POST .../sessions/:id/reconnect` rotates the stream ticket. List still omits tickets. SSE/reload/unmount unsubscribe only; Close/idle/lifetime kill the process. No raw transcript persistence.
- Visible resize handle + FitAddon + backend PTY resize. Copy/Paste buttons for clipboard when the document is unfocused. EOF writes EOT (`0x04`); it does not Close the session.
- Governed Run tab now includes `workspace.build` plus additional Git catalog ids. RECORD.EXECUTE + SoD unchanged. Debugger remains unimplemented.

Still PARTIAL / NOT PROVEN: cloud dual-write for internal `addMemory`, full keyboard a11y, production VM/signing/DR.

### Gap closure execution (2026-09-18, current :4000 / :3000)

Code-completable Studio/PSA ownership defects are closed.
HMAC was proven on the **current** API process (`127.0.0.1:4000`).
Final gap-closure pass (same day) proved live Control UI/supervision
and re-checked sibling/Web blockers. **Production remains NOT PROVEN.**

| Gap | Status | Exact remaining |
| --- | --- | --- |
| PSA ownership 403 on Atlas Core | **PROVEN** | Owner + owned project → 200; foreign project → 403. Claim unowned UUID once via `assertProjectOwnerOrClaim`. Ownership check not removed. |
| PSA memory API + Studio render | **BROWSER-PROVEN** | `GET /api/v1/supervising-agent/memory?projectId=` returned 1 item; Studio panel rendered it. Empty on apply-proof project (scope). |
| PSA isolation | **PROVEN** | Owner A memory not returned for other project; foreign ensure 403. |
| Patch proposal + human Approve | **BROWSER-PROVEN** | Patch `daaac002-672b-4e26-8c4b-9f5f78e40b78` APPROVED by human. Audit `code.patch.approved`. PSA has no Approve/Apply. |
| Patch Apply → disk | **PROVEN** | Local Supabase `:54321`/`:54322` started. `apps/api/.env` `replace-me` no longer clobbers process `SUPABASE_*`. Owner Apply → 202 `a3642068-aaba-46b5-b9a5-3531a98f0f43`. Owner self-decide 409 SoD. Operator decide 200. Owner Apply `?approvalId=` 200 `APPLIED` at `2026-09-18T11:04:07.423Z`. Disk: 13 files under `C:\Users\User\AppData\Local\Temp\atlas-studio-apply-proof`; README became Mini SaaS exemplar. Audit `code.patch.applied` hash `179be191…`. Replay 403. Foreign user 403 isolation. Unapproved patch 403. Studio tree + Apply disabled + Verify enabled. No in-memory approval fallback. |
| Current `:4000` HMAC ALLOW/DENY | **LIVE-PROVEN** | Unsigned 401 INVALID; invalid HMAC 401 INVALID; valid HMAC 200 ALLOW `executed:false`; destructive `civio.record.delete` 409 DENY `executed:false`. |
| Civio / CaseFlow / HotelOS / BrokerOS | **PROCESS LIVE vs :4000 (bounded)** | HotelOS `:3001` invoke → Atlas `hotelos.gateway.agent.revenue` ALLOW `executed:false` (audit `46ba5bf0…`). HotelOS HITL Suggest→Approve→Act stayed in HotelOS (`4964c41f…` → task `c154844f…`); unsigned decide 401; isolation tenant 404. Civio `:5728` signed-in `POST /api/ai/legal-query` → Atlas `civio.legal.query` ALLOW (audit `386f3e31…`); unsigned 401; Gemini 502 after ALLOW (dummy key, Atlas did not execute). This pass: Control HMAC ingest 202 observe-only; unauthenticated `/api/ai/legal-query` 401. CaseFlow connector ALLOW (audit `9672624d…`); A→B isolation tests 10/10; live HTTP remains DEGRADED 503 missing `ENCRYPTION_KEY`/`SUPABASE_URL`/`SUPABASE_KEY` (do not reuse Atlas keys; `.env` still absent). Foreign HMAC tenant 403 `OUT_OF_SCOPE`. BrokerOS `assertAtlasPreflight` ALLOW (audit `7de8f540…`); Next `:3010` not started — no `apps/web/.env.local` / Supabase (reconfirmed). ADR-022: Atlas still does not execute sibling tools. |
| LexStudy / Vantera | **NOT AVAILABLE IN CURRENT LOCAL REPOSITORY/WORKSPACE** | No app dirs under `C:\Users\User\project` or `github`. Distinct from HMAC contract: `applicationId` lexstudy/vantera valid HMAC → 200 ALLOW on :4000. |
| Control | **LIVE-PROVEN** | Control vitest 80/80 PASS. Live `:3100` status `atlas-control-plane` ok; dashboard `/dashboard` (audit + approvals tabs); Admin `:3200` separate. Supervision `surface=CONTROL` not Studio. Unsigned Civio ingest 401; signed `civio.rights.answered` 202 ALLOW `executed:false` `execution=NOT_IMPLEMENTED`. Live audit 2 entries (`governance.decision` seq 1, `civio.connector.event.accepted` seq 2). Canonical approvals/audit-verify hop fail-closed (`ATLAS_CONTROL_PLANE_TOKEN` unset on the running pair) — Control does not locally approve/apply. PSA/API unauthenticated 401. Planes not merged. |
| Browser regression | **PASS** | After clearing a stale `.next` cache and restarting current Web `:3000`: `/he/studio` RTL 200; `/en/studio` 200; `/ar/studio` 200. Studio first in nav. Control remains `:3100`. |
| Final build / typecheck after this pass | **PASS** | `node scripts/turbo-run.mjs` build `--force --concurrency=1` 30/30 exit 0 (2m56s, `NODE_ENV=production`). typecheck `--force --concurrency=1` 53/53 exit 0 (3m20s). First build attempt failed only because the Control-start shell leaked `NODE_ENV=development` into `next build`; not a source defect. |

### Continuous gap closure (2026-09-18, after V1 `1fdcf372`)

V1 checkpoint stays closed. This pass found and fixed additional locally
actionable G1/G2/G3 items. It does not reopen PSA/Apply/HMAC/isolation/
Control≠Web/ADR-022.

| ID | Finding | Class | Status |
| -- | ------- | ----- | ------ |
| CG-01 | Login→register dropped allowlisted `?next=` on first render (`window.location.search`) | G1 | **FIXED** — `useSearchParams` + `apps/web/lib/audit-return-path.ts`; hops login↔register↔forgot↔reset |
| CG-02 | EN/HE/AR auth fields hardcoded `dir="rtl"` | G2 | **FIXED** — `inputDirForLocale` |
| CG-03 | Password reset success sent an authenticated session to `/` | G2 | **FIXED** — Studio / allowlisted `next` |
| CG-04 | OAuth callback ignored `?next=` | G1 | **FIXED** — `allowlistedAuditNext`; live IdP still G4 |
| CG-05 | AppShell `keepMounted: true` duplicated nav in the a11y tree | G2 | **FIXED** — `keepMounted: false` (Web + Admin) |
| CG-06 | `commercial.test.ts` 500 under leaked `NODE_ENV=production` | G3 | **FIXED** — pin `NODE_ENV=test`; vitest `env`; production `ATLAS_SKIP_AUDIT_LOG` throw unchanged |
| CG-07 | Dashboard Patches ignored `?project=` | G2 | **FIXED** — `useProjectQueryParam` |
| CG-08 | Studio Checks project pickers were dead when `boundProjectId` set | G2 | **FIXED** — hide picker when bound |
| CG-09 | Studio project select did not write `?project=`; projects API error looked empty | G2 | **FIXED** — URL sync + error Alert |
| CG-10 | Companion collapsed chip used `titleEn` | G2 | **FIXED** — locale `title()` |

Browser (local `:3000` next-dev, signed-out): `/en/auth/login?next=/partners` → Register `/en/auth/register?next=/partners` → Sign in `/en/auth/login?next=/partners`; forgot href `/en/auth/forgot?next=/partners`; EN email `dir=ltr`; `/he/auth/login?next=/experts` email `dir=rtl`, html `dir=rtl`. Rejected `next=https://evil.example` is not forwarded to register.

Full turbo `build --force` was **not** re-run in this pass while `next dev` holds `apps/web/.next`. Web `tsc` typecheck exit 0. Production remains **NOT READY**.

### Application preflight (2026-09-18)

Atlas exposes HMAC `POST /api/v1/governance/application-preflight`.
This is **not** sibling execute. `execute` remains `NONE` except `def-000`.
Civio/CaseFlow/HotelOS/BrokerOS local runtimes now call preflight against
current `:4000` (see table). LexStudy and Vantera **application code** is
**NOT AVAILABLE IN CURRENT LOCAL REPOSITORY/WORKSPACE**; their
`applicationId` HMAC contract on Atlas is live. Civio browser BYOK
(user-owned OpenAI key) is **INTENTIONALLY UNGATED**. CaseFlow live
RBAC over HTTP and BrokerOS Next UI remain **EXTERNAL** (their own
Supabase/env). Atlas does not execute sibling tools (ADR-022).

**Authoritative G1–G7 landscape:** [`docs/architecture/gap-matrix.md`](gap-matrix.md).

**Product/readiness inventory (2026-09-18):** [`docs/architecture/product-gap-inventory-2026-09-18.md`](product-gap-inventory-2026-09-18.md). Technical closure ≠ product completion ≠ production proof ≠ commercial validation.

**Remaining external / user dependencies (2026-09-22):** [`docs/architecture/remaining-external-dependencies.md`](remaining-external-dependencies.md). `BLOCKED` there is missing credentials/infrastructure/partners — not a local code defect. G-P1-04/05 and listed local closures stay closed. Do not fake Stripe, embeddings, Control token pairing, or a design-partner run.

**CODE-COMPLETABLE remaining security/isolation defects: NONE after the
2026-09-18 landscape pass** (N1/N2 in git `212c077`; S1–S5 plus owner-scoped
daily meters, eval-run listing, architecture-contract IDOR, audit/constitution
report admin-gate, intelligence audit-derived GETs, constitution/audit-engine
write auth in the working tree). That pointer is not production proof. Live
Postgres, private VM, Studio credentials, signing identity, offsite DR, and
external pentest remain blockers. N1/N2 live HEAD/reconcile and exclusive
STARTED on real PostgreSQL are IMPLEMENTED BUT NOT FULLY PROVEN.

Authoritative narrative: `docs/architecture/ATLAS_MASTER_TRUTH.md` §62–§68.

### Final verification pass (2026-09-18)

Lint: turbo 46/46. Build: turbo 30/30. API unit: 1465 passed; two 5s timeouts under concurrent lint were **not** defects (isolated re-run 17/17). Control Plane unit 276/276. Admin 22/22.

Live loopback: API `:4000`, Control `:3100`, Admin `:3200` up. Postgres `:54322` down. `live-session.env` bearer does **not** match the running API (internal routes 401) — unauthenticated denial is live-proven; authenticated CP→API hop is not proven with that file.

Studio Playwright: API security/failure-path E2E passed. After cleaning a hung `::1:3000` Next and a corrupt `.next` cache, critical-path/new-surfaces/security = 21 passed / 3 failed. The three failures resolve to **hidden sidebar duplicates** (`getByText(...).first()`), not missing pages. Signed-in login→Patch→Apply browser flow was not executed (`apps/web/.env.local` still contains `replace-me`).

### Done — do not redo

- Atlas-self governed execution on the **local** private plane
- Local canonical-audit DR drill
- SBOM + unsigned provenance + fail-closed signing CLI
- Internal security live-proof; pentest **scope** package (not a pentest)
- Connected-app inventory with exactly one classification per app

### Minimum remaining (nothing else is a production blocker)

| # | Missing requirement | Type |
| - | --- | --- |
| 1 | Ubuntu + Tailscale + systemd private plane (`docs/deployment/private-plane.md`) | INFRASTRUCTURE |
| 2 | Live Supabase/Postgres (API health is local JSON) | CREDENTIAL |
| 3 | Studio `apps/web/.env.local` (do not commit `replace-me`) | CREDENTIAL |
| 4 | Offsite DR destination: set `ATLAS_OFFSITE_BACKUP_DIR` **or** Owner-authorize a cloud bucket (no object-store client in-repo) | INFRASTRUCTURE / CREDENTIAL |
| 5 | Sigstore/cosign identity + deployed verifier | EXTERNAL PROVIDER |
| 6 | External pentest on an Owner-designated environment (`docs/security/pentest-readiness.md` is SCOPE READY) | SECURITY VENDOR |
| 7 | ADR-022 sibling execute **only if** connected-app execution is part of the production definition | OWNER DECISION |

Live ML training, demo/customer packaging, and Phase 11 re-entry are
**NOT REQUIRED** for this production gate.

ADR-022 request (not an amendment):
`docs/archive/2026-09-05/ADR-022-OWNER-DECISION-REQUEST.md`.

### Control gap closure (2026-09-17)

Landed in git (kill-switch `1421164`, agent memory `e0991a7`, QA/gateway
`52a5dc2`, Control/Studio/embeddings `39b3fc2`). **In-repo implementation,
not production-verified. Do not treat this list as CLOSED.**

- Runtime Kill Switch Control (A1) — in HEAD; live operator UI still needs a running API. Governed-execution test doubles now stub `getKillSwitchOverrides` so the A1 union is consulted on the execute path.
- Agent-scoped memory isolation on plan/dispatch (B1) — in HEAD; omit-`agentId` retrieve remains an open policy (human surfaces still see `allowedAgents` rows)
- Control Approvals hop to the live API store (A2) — unit/route tests; live Postgres and decide→NDJSON not proven
- Agent lifecycle pause/quarantine/revoke Control UI (A3) — UI over existing API enforcement
- Dashboard Applications + Live Execution (A4)
- Operator audit verify hops to canonical NDJSON; local CP chain stays UNKNOWN (A5)
- Live executions hop to `GET /api/v1/internal/executions` (A6)
- Application self-registration stays PENDING until operator decide (A7) — in-memory CP registry
- Operating-cycle RISK scores existing tool-risk/evidence signals (A8) — shared helpers plus a Control copy
- Error aggregator read surface for Control (B4)
- Multi-tenant/org isolation (C1) — **production tenancy is user-level
  `ownerId`**, not `organizations` / `org_id`. ADR-012 non-goal.
  `DRAFT_multi_tenant_orgs.sql` stays draft. Unowned projects remain readable
  when `ownerId` is unset. Conversation memory now uses `authorizedProjectId`.
- Semantic memory/knowledge retrieval (B2) — cosine ranking when an embedding
  provider is configured; otherwise lexical-hash. Live HTTP embeddings are
  BLOCKED BY EXTERNAL DEPENDENCY. pgvector dual-write still expects 64-d hash vectors.
- Bug tracker → memory learning (B3) — OBSERVED SOLUTION memories; unit tests
- Evidence/memory writes no longer stamp `STUB_OWNER_ID` on the observe/learning
  paths (B5). Billing `plan-quota` still has a legacy stub fallback when no
  request identity and no `ATLAS_OWNER_ID` are present. Cloud-link counts,
  GitHub/local integrations, and daily eval/audit/message meters are
  owner-scoped. Instance-wide meter totals remain for operator watchdog
  only.

### Web / Studio gap closure (2026-09-17)

Landed in `apps/web` (Studio stays on the user plane). **Partially verified.**

- D1 Chat persistence — owned threads list/reload/continue (API tests; no browser proof here)
- D2 Studio/Patches apply — patch Approve is not a disk write. Apply mints
  `DOCUMENT.EXECUTE`; HTTP 202 `APPROVAL_REQUIRED` is no longer treated as
  success. A different identity must decide, then retry Apply with `approvalId`.
- D3 Studio Checks — Observer, Sentinel, QA, Process Audit, Health, Readiness,
  Truth; standalone routes remain as redirects. Ops nav highlight follows the
  Studio `check` query.

Dashboard Patches remain. Control Plane was not moved into Web.

### Master gap closure — Studio home + PSA in Studio (2026-09-18)

Studio/PSA slice. **Not production-ready.** Browser: signed-in Studio entry, PSA memory API, and Studio memory render proven this pass. Patch Approve proven. Patch Apply-to-disk is **PROVEN** on local Supabase (see CURRENT table).

**Agent A (Studio architecture)**
- Signed-in entry is `/studio` (`WEB_POST_AUTH_PATH`) from login, register, and OAuth callback.
- Studio is first in the main nav. Brand mark goes to Studio when signed in.
- Dashboard remains at `/{locale}`. Marketing `/` still redirects to welcome. No Web route deleted.

**Agent B (PSA integration)**
- Studio PSA panel now retrieves `GET /api/v1/supervising-agent/memory?projectId=` and can `POST /coordinate` (plan only).
- CODE_ENGINEER `ask-agent` remains a separate Studio control. PSA does not approve/apply patches.
- `professionalDomain` is **NOT IMPLEMENTED**. Existing Atlas memory already scopes by owner + project; a cosmetic field was not added.

**Agent C (engineering workspace classification)**
- REQUIRED for this acceptance slice: project picker, tree, file read/save, checks, governed patch, distinct PSA vs CODE_ENGINEER. Already present.
- OPTIONAL FUTURE: syntax highlighting, multi-file tabs, project search, debugger, Git UI, in-Studio test runner, LSP. Not faked.

**Agent E evidence (2026-09-18, this workstation)**
- Historical `:4010` HMAC remains historical. Current `:4000` HMAC ALLOW/DENY is LIVE-PROVEN (see CURRENT AUTHORITATIVE table).
- PSA ensure Atlas Core 200 after ownership claim; memory GET items:1; Studio rendered `PROPOSED : תזכורת סטודיו: ...`. Isolation: apply-proof project empty memory.
- Patch Approve BROWSER-PROVEN. Apply-to-disk PROVEN on local Supabase (see CURRENT table). Production Postgres is still NOT PROVEN.
- turbo.exe build 30/30 PASS; turbo.exe typecheck 53/53 PASS after the ownership/memory fixes.
- LexStudy / Vantera application dirs: **NOT AVAILABLE IN CURRENT LOCAL REPOSITORY/WORKSPACE**. HMAC `applicationId` contract on Atlas is live.
- Production: **NOT PROVEN**. Eight ownership/memory files plus this remaining-work update remain uncommitted (no commit this pass).

### Verification pass (2026-09-17 evening)

Not a production-readiness claim. Not a 10/10 score.

**VERIFIED (this workstation)**
- Typecheck: `@atlas/api` (build tsconfig), `@atlas/control-plane`, `@atlas/web`, `@atlas/shared`, `@atlas/agent-core`
- `pnpm test:unit`: 317 files / 2871 tests PASS after kill-switch test doubles gained `getKillSwitchOverrides`
- `pnpm exec eslint packages apps --max-warnings 0` PASS
- CI eval gate PASS; secret scan 0 findings
- Supply-chain: SBOM VALID, UNSIGNED, `releaseReady: false`
- Control Plane observational audit: `appendAuditEntry` is the only seq/hash/prevHash allocator. Forged `prevHash: "000"` / `seq: Date.now()` no longer break `verifyAuditChain`. Canonical NDJSON remains apps/api. CP tests 276 PASS. The already-running live CP process can still report `audit-chain-break` until restart.
- Local private plane live-proof: **29 PASS / 0 FAIL / 0 BLOCKED / 3 SKIP** (Ubuntu plane, two-identity approved fulfill, external pentest). Studio probe is `http://localhost:3000` (Next `-H localhost`).
- HTTP 200 local render: `/he`, `/en`, `/he/health`, `/he/studio`. Not signed-in Studio E2E. gitignored `.env.local` is the example copy (`replace-me`) — not live Supabase.
- Live `POST /api/v1/gateway/fulfill` `request_agent_run` without approval → `APPROVAL_REQUIRED`, `executed: false`

**IMPLEMENTED / NOT FULLY VERIFIED**
- Approved fulfill execute (second identity) — route tests only; live-proof SKIP
- Browser E2E / signed-in Studio apply
- Live embeddings provider
- Canonical audit decide→NDJSON on live Postgres
- Live CP `audit-chain-break` until that process restarts onto the new allocator

**STILL OPEN (production gate — unchanged)**
- Ubuntu + Tailscale + systemd
- Live Supabase/Postgres
- Studio production credentials (do not commit `replace-me`)
- Offsite DR destination
- Sigstore identity
- External pentest
- ADR-022 sibling execute (owner decision)

**NOT CLAIMED**
- Production ready
- Completeness of the August vision gap-analysis / staged roadmap

### Runtime completion probes (2026-09-17 night)

Handoff: production evidence. No rewrite of accepted commits. No secrets committed.

| Item | Classification | Evidence |
| --- | --- | --- |
| Production PostgreSQL | **INFRASTRUCTURE BLOCKER** | `DATABASE_URL` host `localhost:54322`; TCP closed. `SUPABASE_*` service/anon keys are placeholders (`replace-me`). `environment:gate` `auditLogPersistence.live=false`. API health remains local JSON. |
| Ubuntu + Tailscale + systemd VM | **INFRASTRUCTURE BLOCKER** | Tailscale peer `ip-172-31-42-218` (`100.93.71.107`) **offline**, last seen ~8d; `tailscale ping` timed out. AWS CLI not installed. Do not fabricate production VM health. |
| Studio production + browser Apply E2E | **EVIDENCE GAP** + **CREDENTIAL** | `http://localhost:3000/he/studio` HTTP 200 (binds `::1`, not `127.0.0.1`). `NEXT_PUBLIC_SUPABASE_ANON_KEY` is `replace-me`. Signed-in two-identity Apply is not live-proven. SoD not weakened. |
| Multi-process occupancy vs live Postgres | **EVIDENCE GAP** blocked by Postgres TCP | In-process exclusive `markExecutionStarted` (second mark fails). SQL migration `20260918010000_mark_started_exclusive.sql` matches. Live multi-node Postgres proof still unavailable (`localhost:54322` closed). |
| Spec consume-before-policy vs live claim path | **DOCUMENTATION/CONTRACT MISMATCH** (spec stale for matching pairs) | Matching execute uses `claim → recheck → STARTED → execute → finalize`. Gateway mismatch (`RECORD.EXECUTE` vs `DOCUMENT.READ`) still consumes the operation approval first. ADR-023 updated. Code not reverted. |
| Local Docker / supabase CLI | **INFRASTRUCTURE BLOCKER** | Docker Desktop daemon not running (`dockerDesktopLinuxEngine` pipe missing). `supabase` CLI not on PATH. Cannot start local Postgres `:54322` from this workstation either. |
| Memory omit-`agentId` retrieve | **POLICY DECISION** | `isVisibleToAgent` returns true when `allowedAgents` is set but no requester id is supplied (human conversation / list). Test: “includes an agent-scoped memory when no requestingAgentId is passed (backward-compat)”. Not a silent bug. |
| ADR-022 sibling execute | **POLICY DECISION** | `docs/archive/2026-09-05/ADR-022-OWNER-DECISION-REQUEST.md`. No shortcut fulfill. |
| Sigstore / cosign | **INFRASTRUCTURE BLOCKER** / **EXTERNAL PROVIDER** | `ATLAS_SIGNING_IDENTITY` unset; `cosign` not on PATH. `pnpm supply-chain:sign` REFUSE. SBOM VALID, UNSIGNED, `releaseReady: false`. |
| External pentest | **EXTERNAL VALIDATION** | Scope package only. Not replaced by unit tests. |

**2026-09-18 remediations (code, local tests):** Control `/api/v1/internal/*` session gate; exclusive STARTED mark; memory export/write owner filter; verdict/report `assertProjectReadAccess` (`1758563`). HEAD follows GET allow-list; global memories tenant-filtered in reconciliation (`212c077`). CP `setBy`/`decidedBy` bound to `cp:service`; per-owner GitHub/local connections; admin-only process-global ops surfaces; owner-scoped cloud-link quota; decision `ownerId` + recon filter. Landscape pass: owner-scoped daily eval/audit/message meters; `GET /eval/runs` admin-only; architecture-contract GET project-scoped; audit/constitution report lists admin-only; intelligence verification-lessons/outcome-signals admin-only; constitution/audit-engine POST signed-in (project write when `projectId` set); kernel eval/lessons writes signed-in. Live Postgres/VM proof still missing. GitHub App installations remain instance-level (not per-user PAT). `STUB_OWNER_ID` remains the personal-instance fallback when no request identity and no `ATLAS_OWNER_ID` are present — authenticated cloud-plan paths pass `identity.ownerId`.

---

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

**Occupancy ordering (not a Phase 02 reopen):** matching entity/action hops use
`runGovernedClaimedExecution` (`claim → recheck → STARTED → execute →
finalize`). The historical “consume then execute” wording is stale for that
path. `request_agent_run` still consumes the operation-level `RECORD.EXECUTE`
approval before the mapped tool runs, because the tool pair can be
`DOCUMENT.READ`. Both are intentional; do not merge them by rewriting working
code.

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
- Sibling / non-`def-000` application execution identity — later-scope (ADR-022).
  Control Plane bearer MFA and token rotation closed in Phase 04.

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
- **Privileged browser mutations:** production, or
  `ATLAS_CONTROL_PLANE_REQUIRE_BROWSER_MFA=1`, refuses `POST /gateway/ops`
  and agent-control from a password-only Control session. MFA-satisfied
  sessions and machine bearers are unchanged. HMAC reauth remains one-shot
  replay protection, not TOTP.

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

**Traceability:** `governance-adversarial.test.ts` joins
`executeGovernedAction.requestId` → unified audit `input.requestId` →
`governance.decision.correlation.requestId`.

## 06 EXECUTION SAFETY
**Status: COMPLETE** on the existing runtime (no second execution engine).

**Implemented (code + tests):**
- `executeTool` already has timeout + AbortSignal.
- Approval consume is one-shot on the gateway *mismatch* path
  (`consumeApprovalRequest` before `executeGovernedAction`). Matching pairs
  use claim/finalize occupancy instead of consume-before-policy.
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
- **Concurrent idempotency:** same `idempotencyKey` is serialized in-process
  so overlapping calls cannot execute the tool twice.

**Not claimed:** a separate distributed queue. Phase 12 confirmed the
process-local `.atlas/worker-queue.json` worker is the architecture; Redis
is not required. Process-local automation-engine dedup remains a documented
caveat, not this path.

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

**OPEN POLICY DECISION (not a bug):** rows with a non-empty `allowedAgents`
list remain visible when retrieve is called with no `requestingAgentId` /
`requestingAgentIds`. That is the documented backward-compat path for human
conversation and generic memory list. Agent-scoped isolation on plan/dispatch
(callers that pass `agentId`) is accepted. Owner must decide whether human
omit-agent retrieve should stay open or hide agent-scoped rows. Do not change
the filter without that decision.

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
  `executeGovernedAction` combines overlay + identity via
  `combineAgentRuntimeStatus` and denies unless `agentMayExecute`.
  Unreachable CP fail-closes as UNKNOWN. A 404 overlay (fabric-only id)
  defaults ACTIVE. Unset CP URL keeps local ACTIVE (tests / API-only).
  CP SERVICE gateway fulfill may pass `agentRuntimeStatus`; operator
  sessions cannot inject it.
- **Delegation wiring:** `effectiveDelegationHopCount` floors omitted hops
  on `DELEGATED` to 1. Wired through `submitAgentProposal`,
  `executeGovernedAction`, `dispatchAgentAction`, specialist LLM runs, and
  SECURITY/LEGAL fabric gates. PSA hop-floor behavior is unchanged.
- **Session trust:** `resolveAgentIdentity` defaults `trustLevel` to `FULL`
  (signed-in human). `LAB` is opt-in, not the live default.
- **Live tool hop:** `POST /api/v1/agents/tool-execute` derives identity from
  the session and calls `executeGovernedAction`. The body cannot name owner
  or sandbox root.
  - **Superseded 2026-09-26 (Stage 4, ADR-024):** `tool-execute` no longer executes. A caller-selected
    `fabricAgentId` is a requested target, not an actor, and no trusted runtime
    agent identity exists on that route, so it returns 403 (`blockedAt: IDENTITY`).
    Governed tool execution remains on `/gateway/fulfill`.
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
> **Superseded 2026-09-26 (Stage 4, ADR-024):** the `tool-execute` hop is closed (403); live
> execution of these tools is only through `/gateway/fulfill`.
API startup (`create-app.ts`) registers `knowledge_search`,
`registerFilesystemTools()`, and `registerAnalyzeRepoTool()`. `analyze_repo`
is a bounded read-only workspace walk (no network, no code execution).
Unregistered policy names still fail closed. A catalog grant is not a
production registration. No second execution engine.

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

**Implemented:** one request id — CP `X-Request-Id` is pinned on the inbound
HTTP request and forwarded on `callAtlasApi` / lifecycle handoff. Tenant API
Fastify uses `requestIdHeader: "x-request-id"` so that value becomes
`request.id` and `executeGovernedAction.requestId`. Gateway fulfill and
`dispatchAgentAction` write `input.requestId`; UUID values also populate
audit `correlationId`. Operators can join CP receipt → API execution →
governed decision. API global rate limit 300/min and
`http_request_duration_ms` via `registerRequestTiming`. No second telemetry
stack.

## 14 SELF-AUDIT
**Status: COMPLETE** for detect → propose (no auto-apply, no active probing).

**Implemented:** detect → propose only. `autoApply: false` on every finding. Checks: CP auth, non-canonical audit, DEF-000, agent denials, egress policy presence, MFA/rotation, runtime overlay, CP-does-not-execute-tools, fabric-vs-oversight registry, catalog/registration drift, policy-without-implementation, CP overlay vs API fail-closed, missing observational audit, verification-gap between gateway success and verification observations, expired-but-PENDING records, production runtime-config drift. Active API probing from Control Plane is not claimed. Findings do not mutate agent status or approvals.

## 15 DISASTER RECOVERY
**Status: COMPLETE** for local restore, configured filesystem replica, and
restore-from-replica. Cloud object-store remains an external infrastructure
blocker.

**Implemented:** `runCanonicalAuditRestoreDrill` copies the API NDJSON chain,
verifies hash continuity, and writes a timestamped receipt. When
`ATLAS_OFFSITE_BACKUP_DIR` (or `offsiteDir`) is set, the verified copy is
replicated and checksum-matched; the receipt records `offsite: true` only
after replica verification. Unset destination → `offsite: false`.
`restoreCanonicalAuditFromReplica` copies a replica into an isolated directory,
re-verifies the chain, and never overwrites canonical (`overwrittenCanonical: false`).
Tampered or missing replicas fail closed. Operator procedure:
`docs/operations/disaster-recovery.md`.

**PARTIALLY COMPLETE — EXTERNAL INFRASTRUCTURE BLOCKER:** cloud object-store
bucket / region / credentials if the replica must leave the host filesystem.
Do not claim S3/GCS existence from a directory replica.

## 16 SUPPLY-CHAIN / PRODUCTION SECURITY
**Status: COMPLETE** for SBOM and unsigned SLSA-shaped provenance.
Signing remains BLOCKED on identity + verifier.

**Implemented:** CI `permissions: contents: read`. Secret scan and eval gate already existed.
**SBOM generation:** `pnpm sbom:generate` produces CycloneDX 1.5 SBOM in
`.atlas/sbom/sbom.json` and `.atlas/sbom/sbom.xml`, plus unsigned
`.atlas/sbom/provenance.json` (in-toto Statement / SLSA provenance v1,
`signed: false`).
**SBOM verify:** `pnpm supply-chain:verify` (`verifySupplyChainArtifacts`)
fails closed on invalid SBOM. Missing signature is `UNSIGNED`, never
`VERIFIED`. A signature blob without `ATLAS_SIGNING_IDENTITY` is `INVALID`.
Unsigned provenance is checked against the SBOM digest; `signed:true` is
rejected. `releaseReady` stays false until a real Sigstore/cosign verifier exists.
CI generates SBOM and verifies it; unsigned is expected (`ATLAS_REQUIRE_SIGNED_RELEASE` is not set).

**BLOCKED — Owner decision required:** signing identity for release
artifacts (Sigstore / cosign key or identity) plus a deployed verifier.
Do not mint a fake signature. SBOM + unsigned provenance remain the
enforceable repository-side controls.

## 17 GOVERNANCE TEST SUITE
**Status: COMPLETE** for enforcement proofs on the existing engines.

**Implemented:** `apps/api/src/__tests__/governance-invariants.test.ts` and
`apps/control-plane/src/__tests__/governance-invariants.test.ts`
(unauthenticated DENY, customer admin ≠ operator, missing capability, wrong tenant, audit tamper, executed ≠ verified, world-state execution ≠ verification, CP audit non-canonical, self-audit never auto-applies, CP-does-not-execute-tools).
`governed-execution.test.ts` proves QUARANTINED / SUSPENDED cannot execute.
`create-app.test.ts` and `production-tool-registry.test.ts` prove production tools are registered and unregistered names fail closed.
`gateway-fulfill.test.ts` proves `X-Request-Id` correlation and CP SERVICE quarantine overlay denial.
`self-audit.test.ts` proves detectors stay detect-only.
`governance-adversarial.test.ts` (15 tests) plus `governed-execution.test.ts`
and `agent-dispatch-guard.test.ts` cover unauthorized tool/agent, quarantine,
suspended, missing runtime status, forged identity payload, forged approval id,
expired approval, delegated hops, hop-bound (10) APPROVAL_REQUIRED, hop >10 DENY,
missing tool registration, policy-cell bypass, executed ≠ verified, missing
audit persistence, production `ATLAS_SKIP_AUDIT_LOG` forbidden, cross-tenant
DENY, approval replay, invalid/unmapped/sibling gateway handoff, and requestId
audit/decision join. Control Plane does not depend on `@atlas/agent-core`.
`fulfillGatewayHandoff` refuses non-`def-000` application ids.

## 18 PERFORMANCE / SCALE
**Status: COMPLETE** for the existing in-process limits, latency stack, and
measured governed-execution concurrency. Redis / autoscaling are not required
by current architecture or measured load.

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
- **Measured governed execution:** `governed-performance.measure.test.ts`
  runs 12 sequential and 8 concurrent `executeGovernedAction` calls.
  Sequential p95 and concurrent p95 stayed under the 5s / 8s fail-closed
  budgets on this workstation. Process-local queue remains sufficient.
  `pnpm runtime:probe` observes local daemons; it does not start them.

**Not claimed:** distributed cache (Redis), auto-scaling, load balancer config,
database connection pooling (external to Node), full APM integration,
production multi-host capacity. Concurrent governed idempotency is serialized
in-process (Phase 06).

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
`GET /api/v1/intelligence/verification-lessons` reads audit verification
verdicts and returns lessons with `executes: false` / `autoApply: false`.
`GET /api/v1/intelligence/outcome-signals` scores historical SUCCESS/FAILURE
rates with `mutatesGovernance: false`. Intelligence may recommend. Governance
remains authoritative.

**BLOCKED — Owner decision required:** live reputation/training on
production traffic, including whether any automatic policy modification
is ever permitted (default remains never). Do not add an ungoverned ML
privilege path.

## LATER-SCOPE (not a Phase 02 reopen)

**Ingest execution — BLOCKED (ADR-022).** Control evaluates ingest and does
not execute. Civio events still have no authoritative tool / target /
artifact. Do not invent `knowledge_search(query = eventId)`. Amending
ADR-022 is required before ingest can execute.

**Non-`def-000` fulfillment — BLOCKED.** No sibling execute contract exists.
`dispatchGatewayOperation` does not HTTP-fulfill `hotel-os` (or other
siblings) even on ALLOW write. `fulfillGatewayHandoff` also refuses non-
Atlas-self `applicationId` (operator path included). Changing `applicationId`
is not fulfillment.

**Sibling / connected-application execution — BLOCKED.** Same missing
contract. Authoritative inventory: `CONNECTED_APPLICATION_RUNTIME` —
`def-000` gateway fulfill; `civio` HMAC evaluate-only; CaseFlow, HotelOS,
BrokerOS, LexStudy, Vantera inventory-only. Atlas does not become their
database.

**Production runtime — COMPLETE** for the existing private-plane artifacts:
`deploy/systemd` for Control, Admin, and Worker; `deploy/verify.sh`;
`docs/deployment/private-plane.md`. User-plane API/web remain Vercel per
ADR-021. Do not merge planes. `pnpm runtime:probe` on 2026-09-04 found
`:3000` / `:3100` / `:3200` / `:4000` not listening on this workstation.
Artifacts exist; live daemons were not running. Do not claim production
readiness from the probe alone.

## PRODUCTIONIZATION PASS (2026-09-04)

Phases 10–14 were not reopened. No sibling execute mapping was invented.

**Local private plane (this workstation):** `pnpm private-plane:start` brought
API `:4000`, Control `:3100`, Admin `:3200`, and Worker online with a
session-only `ATLAS_CONTROL_PLANE_TOKEN`. Studio `:3000` stayed down —
`apps/web/.env.local` is absent. `pnpm production:live-proof` recorded
28 PASS / 0 FAIL / 1 BLOCKED (web) / 1 SKIP (external pentest).

**Live Atlas-self hop:** authenticated SERVICE bearer →
`POST /api/v1/gateway/fulfill` → `executeGovernedAction` →
`executeTool(analyze_repo)` → `executed: true`, `verified: false`
(INCONCLUSIVE without observations). Control inspect is ALLOW observation,
not tool execute. Control `request_agent_run` without independent approval
stays REQUIRE_APPROVAL; body `independentApprovalVerified` is ignored.

**Connected applications:** `CONNECTED_APPLICATION_RUNTIME.executeGap` records
auth/action/target/artifact/ADR-022 per app. Only `def-000` executes. Civio
HMAC ingest evaluated live (`evaluation.executed: false`,
`lifecycle.executed: false`; `execution: HANDED_OFF` is decision handoff,
not a Civio tool). CaseFlow / HotelOS / BrokerOS / LexStudy / Vantera remain
inventory-only.

**Owner decision request:** `docs/archive/2026-09-05/ADR-022-OWNER-DECISION-REQUEST.md`
— not an amendment.

**Production gate:** NOT PRODUCTION READY. Cloud DR destination, Sigstore
signing identity, Studio env, systemd private-plane VM, and external
security assessment remain external. ADR-022 still blocks sibling execute.

## CONNECTED-APP RECONCILIATION (2026-09-05)

Authoritative inventory now includes `reconciliation.classification`
(exactly one value per app). Local sibling inspection:

- Civio clone: outbound HMAC only; `CIVIO_SUPPORTED_ACTIONS = []`.
- HotelOS clone: one-way `gateway/events` telemetry; `intelligenceApiAvailable: false`.
- CaseFlow clone: outbound `gateway/events`; internal `/api/atlas` is not taqonu execute.
- BrokerOS / LexStudy / Vantera clones: not on this workstation.

No sibling execute contract exists. No speculative connector was added.
Owner request updated: `docs/archive/2026-09-05/ADR-022-OWNER-DECISION-REQUEST.md`.

`pnpm environment:gate` reports Studio/DB/DR/signing blockers without inventing secrets.

**ApprovalExecutionRepository** remains parked / historical.

## PRIORITY 1 + 2 — INFRASTRUCTURE AND SECURITY (2026-09-05)

Read-only reconciliation first. No sibling execute. No invented credentials.

**Program verdict: NOT PRODUCTION READY.**

Local private plane (API/CP/Admin/Worker) is IMPLEMENTED — RUNTIME VERIFIED on
loopback. Studio is CREDENTIAL BLOCKED. systemd/Tailscale VM is EXTERNAL
INFRASTRUCTURE BLOCKED. Live Supabase is CREDENTIAL BLOCKED. Signing is
EXTERNAL SERVICE REQUIRED. External pentest is EXTERNAL SECURITY REQUIRED.
Sibling execute is OWNER DECISION REQUIRED (ADR-022).

`pnpm production:live-proof`: 30 PASS / 0 FAIL / 1 BLOCKED / 2 SKIP.
`pnpm environment:gate` listen probes: API/CP/Admin 200 on loopback; Studio
unreachable. SBOM VALID, unsigned.

Admin unauth probe in `deploy/verify.sh` now uses `/api/v1/platform/hierarchy`
(promo `GET /` is 200). CP API hop refuses non-http URLs. Local API honors
`HOST` when set.

Worker HTTP health was not added.

## PRIORITY 3 + 4 — CLOUD DR, SIGNING, EXTERNAL SECURITY (2026-09-05)

No second DR system. No fake signatures. No fabricated pentest.

**Cloud DR:** BLOCKED. Local drill `pnpm dr:drill` VERIFIED (149 chain
entries, checksum match). Filesystem offsite unset. Object-store URLs
rejected. Classification: DR CODE COMPLETE — EXTERNAL DESTINATION REQUIRED.

**Signing:** PARTIAL. SBOM VALID (101). Unsigned provenance verified.
`pnpm supply-chain:sign` refuses placeholder signatures. Identity + cosign
verifier remain EXTERNAL SERVICE REQUIRED. `releaseReady: false`.

**External pentest:** SCOPE READY as a package
(`docs/security/pentest-readiness.md`). Environment is not ready. Status is
not COMPLETED. Internal live-proof 30 PASS / 0 FAIL / 1 BLOCKED / 2 SKIP.

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

