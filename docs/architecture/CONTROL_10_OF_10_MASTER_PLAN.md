# Atlas Control — 10/10 Supervision Master Plan

**Status:** WAVES 1–9 IMPLEMENTATION LANDED — post-Wave-9 owner reconciliation, plus CI fixture closure (documentation only)
**Created:** 2026-09-23
**Last updated:** 2026-09-23 (documentation reconciliation after CI fixture closure; no new implementation; no R21/R22; no new CTRL)
**Git HEAD at this recon:** `4689e5f8bba1c4bd8a0e129c0f1d8fd4c9db295c` (`main`; message `test: make governed command kill fixture deterministic`)
**CTRL-001 commit:** `400759ac3b0ce1c4a32c8f46c13fda18ad228572`
**CTRL-012 commit:** `a363b5764f19612616d923a4baf214126303996a`
**CTRL-013 commit:** `455b205b07dd507ddeb0407da9abaac5e8b17232`
**CTRL-014 commit:** `28ef9f20177dcdfa62719073182bc32104ecc7b2`
**CTRL-016 commit:** `c0ca916ed28f4147587675aa8fa0a3070fd211ac` (parent `e53681c7f0225b3b62ae3c1de9c110f4a87209f2`)
**CTRL-017:** VERIFIED by LOCAL RUNTIME proof (CaseFlow hop). Process-local decision/report Maps remain the local/test path. Live Postgres authority for decisions/reports is R02 (`39f654b` + Wave 7 local PG proof).
**CTRL-018 commit:** `bd1d2db2fe46e19d54b50332d2aede62cf1597bd` (PARTIAL / ENVIRONMENT BLOCKED — implementation + tests; runtime EXPECTED/UNEXPECTED not proven)
**CTRL-019 commit:** `ecdae7b1facbbb44dfef5e9a7e82956db51995ff` (IMPLEMENTED + TESTED locally; repeated-FAILURE runtime ENVIRONMENT BLOCKED)
**G16 durability commit (R01+R02+R03 code):** `39f654b12c33dd39b2b0c5396b4977e8a80dc5b5`
**Waves 1–9 remaining remediations commit:** `73462307767557257c4c8d9c3f15e816c3543d51`
**CI fixture closure:** `4689e5f8bba1c4bd8a0e129c0f1d8fd4c9db295c` — test-only correction of the governed-command kill fixture. Production `killGovernedExecution` was not changed. GitHub `verify` and Playwright passed on that commit. Classification: **CI FAILURE CLOSED — TEST FIXTURE CORRECTED AND VERIFIED**. Not a production kill-switch defect. Not R21.
**Canonical audit SHA-256 (unchanged this recon):** `ff6b801da227fa983df0f41b2127097dea4685ba0a1338e1ad5d27d84697dfe4`
**Prior baseline HEAD:** `d596564f50cc9481631af203cf61bf2ff5dac898`
**Classification rule:** INTENT ≠ IMPLEMENTATION ≠ REACHABILITY ≠ ENFORCEMENT ≠ TEST COVERAGE ≠ PRODUCTION PROOF

Evidence classes used in this register (do not collapse):

| Class | Meaning |
| ----- | ------- |
| `IMPLEMENTED + TESTED` | Code + automated tests exist. Not production proof. |
| `VERIFIED LOCAL` | Local automated or in-process verification. |
| `VERIFIED AGAINST REAL LOCAL POSTGRES` | Executed against a real local PostgreSQL instance. Not Vercel/production. |
| `LOCAL RUNTIME VERIFIED` | Genuine local application runtime hop. Not production. |
| `PRODUCTION VERIFIED` | Production / Vercel end-to-end proof. None of R01–R20 currently hold this class. |
| `ENVIRONMENT BLOCKED` | Required environment, credentials, or destination does not exist. |
| `HISTORICAL INTEGRITY ISSUE` | Historical evidence defect that must not be rewritten. |
| `FIXED + TESTED` | Current writer/code defect identified, fixed, and regression-tested. |
| `INTENTIONAL / NOT A GAP` | Product/architecture boundary, not a missing Control engine. |
| `PARTIAL` | Implementation or proof exists for only part of the requirement. |

This document is the **only** authoritative Control remediation register. All Task 19 findings (F01–F42 / R01–R20), Task 20 design lock + implementation evidence, CTRL-001–CTRL-022, and intentional non-goals live here. Remaining-work 01–19 stay historical closure. Gap-analysis stays a separate roadmap. Do not implement from conversation claims. Do not create a second gap/remediation file. Do not create R21/R22. Do not create CTRL-023.

---

## 1. Executive Objective

Bring Atlas Control from its current authorization / SoD / audit foundation to a **small, enforceable supervision system** for connected applications and their **application-owned Agents**, without taking ownership of those Agents, application knowledge, Personal Agent memory, application runtime, or Atlas Fabric Agents.

Control is 10/10 only when every **CORE CONTROL** capability has implementation, security review, tests, runtime proof where applicable, audit proof, documented failure behavior, documented ownership, documented operator behavior, no unresolved critical dependency, and evidence recorded here.

10/10 is **not** a visual dashboard, a Fabric Agent registry, a FinOps product, a model router, a RAG engine, or a score.

**Target questions Control must answer (or name the owner if it must not):**

| Question | Owner when Control must not answer |
| -------- | ---------------------------------- |
| WHO acted? | Control (identity + audit) |
| WHAT did they attempt? | Control (operation + class) |
| WHY? | Application attestation of purpose class — not private prompts |
| WAS it authorized? | Control (preflight) |
| WAS it necessary? | Application (cheap-path existence). Control may authorize a declared path later. |
| WHAT risk existed? | Control policy + application-declared risk |
| WAS approval required? | Control |
| WHO approved? | Control / tenant approvals (SoD) |
| WAS execution still authorized? | Control at the next enforceable hop; Fabric at Control eval |
| WHAT actually executed? | Application must report; Control correlates |
| WHAT resources were consumed? | Application / future attribution fields — not a billing platform |
| WHAT evidence supported it? | Atlas Core evidence + application evidence refs |
| WAS the result verified? | Application-owned for sibling hops; Atlas-self fulfill for `def-000` |
| WHAT was the outcome? | Application report-back (`atlas.application-execution-report.v1`); one LOCAL RUNTIME CaseFlow hop VERIFIED |
| WHAT should change? | Human-governed learning (not autonomous policy mutation) |

---

## 2. Current Architecture

Verified from source, not from prior summaries.

```text
Connected application runtime (HotelOS / CaseFlow / Civio / BrokerOS / …)
    │  application-owned Agent (e.g. HotelOS agent.cio)
    │  application-owned knowledge
    │  application runtime / model / cache / FAQ
    │
    ├─ HMAC POST /api/v1/governance/application-preflight   ← LAST SAFE STOP (Atlas API :3001)
    │     evaluateAuthorized()
    │     decisions: ALLOW | DENY | REQUIRE_APPROVAL | KILLED | INVALID | OUT_OF_SCOPE
    │     executed: false
    │     client must use applicationPreflightAllowsExecution (ALLOW-only)
    │
    ├─ Observational POST Control :3100 /api/v1/gateway/events  ← CANNOT STOP sibling execution
    │
    └─ Observational POST Control :3100 /api/v1/connectors/civio/events  (Civio HMAC)

Atlas Control Plane (:3100) + Admin (:3200)
    │  Fabric Agent catalog / pause / quarantine (Atlas-self / Fabric only)
    │  kill categories (global: aiWorkers, agentDispatch, …)
    │  portfolio projection (notAnAgentRegistry: true)
    │  CONTROL_OPERATIONAL_LIFECYCLE
    ▼
Atlas Core (tenant API + memory + evidence + canonical audit)
    │
Atlas Fabric = Atlas-owned specialist Agents (atlasPromotionBlocked: true)
Personal Agent = user-owned (psa:<ownerId>)
```

**Two authorization points exist by cost order (Conclusion B, 2026-09-23):**

1. **Cheap / retrieval hop** — HotelOS `embed` INFORMATIONAL preflight before CIO GOVERNED_DECISION when keyword hits `< MAX_DOCS`.
2. **Paid / model hop** — HotelOS `agent.cio` / CaseFlow wrap / Civio Gemini / BrokerOS Gemini JSON.

Control Plane does **not** execute sibling applications. Only Atlas API preflight can stop a sibling hop, and only if the application calls it and honors ALLOW-only.

### 2.1 Repository baseline (verified 2026-09-23 commit-boundary pass)

Authoritative Atlas commands (`git diff --name-only` + `git ls-files --others --exclude-standard`):

```text
branch: main
CTRL-001 commit: 400759ac3b0ce1c4a32c8f46c13fda18ad228572
message: control: close agent identity and hotelos telemetry boundary
files in that commit: 14 (exact §2.2 list)
parent: d596564f50cc9481631af203cf61bf2ff5dac898
```

The prior report said “13 files” and printed 11 bullets. Both were incomplete as a path list. Two bullets were source+test pairs (`application-preflight.ts` + test, `atlas-gateway.ts` + test). The identity/telemetry set is **13 Atlas paths** (the 12 tracked diffs plus the untracked identity test). This WAVE 0 document is a **14th** Atlas path. Do not use “13” as the operator commit set.

### 2.2 Verified Atlas-only commit boundary

**A. May enter the Atlas-only commit (14 paths, this repo only)**

Identity/telemetry implementation (13):

| # | File | Provenance |
| - | ---- | ---------- |
| 1 | `apps/api/src/routes/application-preflight.test.ts` | tracked; identity tests |
| 2 | `apps/api/src/services/application-preflight.ts` | tracked; echo/fingerprint `agentId` |
| 3 | `apps/control-plane/src/__tests__/api-routes.test.ts` | tracked; ingest `X-Atlas-Reason` |
| 4 | `apps/control-plane/src/__tests__/atlas-gateway.test.ts` | tracked; taxonomy map/reject |
| 5 | `apps/control-plane/src/routes/api.ts` | tracked; extract agentId/occurredAt/riskLevel |
| 6 | `apps/control-plane/src/services/atlas-gateway.ts` | tracked; `resolveApplicationEventType` |
| 7 | `docs/architecture/remaining-work.md` | tracked; identity note + CTRL-015 pointer only; 01–19 untouched |
| 8 | `packages/shared/src/constants/atlas-gateway.test.ts` | tracked; alias + HITL reject |
| 9 | `packages/shared/src/constants/atlas-gateway.ts` | tracked; `APPLICATION_EVENT_TYPE_ALIASES` |
| 10 | `packages/shared/src/platform/application-preflight.test.ts` | tracked; schema agentId |
| 11 | `packages/shared/src/platform/application-preflight.ts` | tracked; optional `agentId` + `applicationOwnedAgentId()` |
| 12 | `packages/shared/src/schemas/unified-audit-entry.schema.ts` | tracked; agentId comment/max |
| 13 | `apps/api/src/services/application-preflight-identity.test.ts` | untracked; Case A/B + embed null |

WAVE 0 documentation (1):

| # | File | Provenance |
| - | ---- | ---------- |
| 14 | `docs/architecture/CONTROL_10_OF_10_MASTER_PLAN.md` | untracked; this source of truth |

**B. Must not enter the Atlas commit**

All sibling-repo paths (separate git roots). See §2.3. No unrelated Atlas untracked files exist.

Sibling dirty trees are **separate git repos**. Do not commit them with Atlas. Do not clean them.

### 2.3 Sibling / pre-existing boundary (verified 2026-09-23)

Working copies on this workstation:

| Repository | Path |
| ---------- | ---- |
| HotelOS | `c:\Users\User\project\github\hotelOS-AI-main` |
| CaseFlow | `c:\Users\User\project\github\CaseFlow-AI-main` |
| Civio (working) | `c:\Users\User\project\github\civio` |
| Civio (unused copy) | `c:\Users\User\project\github\civio-main` (only `?? .atlas/`) |
| BrokerOS | `c:\Users\User\project\github\brokerOS-main` |
| LexStudy / Vantera | NOT ACCESSIBLE |

Identity/telemetry sibling files (must remain outside Atlas commit; separate repos):

- HotelOS this pass: `packages/ai-gateway/src/atlas-preflight.ts`, `packages/ai-gateway/src/atlas-preflight.test.ts`, `packages/ai-gateway/src/gateway.ts`, `packages/ai-gateway/src/gateway.test.ts`, `apps/api/src/infrastructure/atlas-telemetry.ts`, `apps/api/src/infrastructure/atlas-telemetry.test.ts`
- HotelOS pre-existing: `.gitignore`, `.atlas/`
- CaseFlow this pass: `apps/server/src/services/atlas/atlasPreflight.js`, `apps/server/tests/atlasPreflight.test.js`
- CaseFlow pre-existing: `apps/server/src/infrastructure/ai/openai.service.js`, `apps/server/src/routes/ai.js`, `apps/server/src/security/aiSecurityAnalyst.js`, `apps/server/src/security/rootCauseAI.js`, `apps/server/src/services/ai/aiRouter.js`, `apps/server/src/services/ai/chatService.js`, `apps/server/src/services/ai/deadlineExtractor.js`, `apps/server/src/services/ai/readerService.js`, `apps/server/src/services/ai/vectorService.js`, `apps/server/src/services/aiGateway.js`, `apps/server/src/services/aiService.js`, `apps/server/src/services/claudeService.js`, `apps/server/src/services/netMishpatService.js`, `apps/server/src/services/twilioService.js`, `apps/server/tests/claudePreflightWrap.test.js`, `apps/server/tests/openaiPreflightWrap.test.js`
- Civio this pass: `apps/server/src/lib/atlasControlConnector.ts`, `apps/server/src/routes/ai.ts`, `apps/housing-agent/src/lib/atlasPreflight.ts`, `apps/housing-agent/src/lib/formatReply.ts`, `apps/housing-agent/src/lib/formatReply.preflight.test.ts`, `apps/server/src/lib/atlas-preflight.test.ts`
- Civio pre-existing: `apps/housing-agent/src/routes/ask.ts`, `apps/housing-agent/src/routes/whatsapp.ts`, `apps/server/src/controllers/communityController.ts`, `apps/server/tsconfig.build.json`, `packages/logic/package.json`, `.atlas/`, `apps/server/src/__tests__/atlas-preflight-enforcement.test.ts`
- BrokerOS this pass: `packages/api/src/agent/atlas-preflight.ts`, `packages/api/src/agent/atlas-preflight.test.ts`
- BrokerOS pre-existing: `packages/api/src/agent/draft-invoice.ts`, `packages/api/src/agent/gemini.ts`, `packages/api/src/observability/index.ts`, `packages/api/src/agent/gemini.execution.test.ts`
- civio-main unused copy: `.atlas/` only

---

## 3. Ownership Boundaries

| Plane | Owns | Must not own |
| ----- | ---- | ------------ |
| Application | Agents, domain knowledge, runtime, cheap-path existence, result verification of its own hops | Atlas Fabric identity |
| Atlas Control | Authorization, risk class, approval/SoD, kill categories, intervention of Fabric, audit correlation, portfolio projection | Application Agents, application knowledge, user memory contents, model routing, billing |
| Atlas Core | Memory store, evidence store, canonical audit, tenant isolation | Application business decisions |
| Atlas Fabric | Atlas-owned specialist Agents (`atlasPromotionBlocked: true`) | Application Agents |
| Personal Agent | User-owned memory / supervisory context (`psa:<ownerId>`) | Application runtime |

**Hard rules**

- Do not promote application Agents into Fabric.
- Do not invent Agent IDs (`applicationOwnedAgentId()` returns `null` when absent).
- Do not treat document count as knowledge sufficiency.
- Do not infer UNNECESSARY from availability booleans.
- Do not merge remaining-work 01–19 or gap-analysis into this program.

---

## 4. Current Baseline

### 4.1 Connected applications

Source: `packages/shared/src/platform/connected-applications.ts`.

| applicationId | Classification | Preflight | Observe | Execute | Source available |
| ------------- | -------------- | --------- | ------- | ------- | ---------------- |
| `def-000` | REAL EXECUTION READY | n/a (Atlas-self) | Control + API | `GATEWAY_FULFILL` fail-closed | Yes (this repo) |
| `civio` | EVALUATE-ONLY | HMAC Atlas API | HMAC Civio connector | No | Yes (`github/Civio---Municipal-OS-main`) |
| `hotelos` | INVENTORY ONLY | HMAC Atlas API | Gateway events | No | Yes (`github/HotelOS`) |
| `caseflow` | INVENTORY ONLY | HMAC Atlas API | Gateway events | No | Yes (`github/caseflow`) |
| `brokeros` | INVENTORY ONLY | HMAC Atlas API | Gateway events | No | Yes (`github/brokerOS-main`) |
| `lexstudy` | INVENTORY ONLY | Contract only | None | No | **NOT ACCESSIBLE** |
| `vantera` | INVENTORY ONLY | Contract only | None | No | **NOT ACCESSIBLE** |

### 4.2 Existing Control loop (do not rebuild)

`CONTROL_OPERATIONAL_LIFECYCLE` in `packages/shared/src/platform/control-operations.ts`:

```text
APPLICATION → AGENT → PROCESS → EVENT → POLICY → RISK → APPROVAL
  → EXECUTION → VERIFICATION → EVIDENCE → OUTCOME → AUDIT
```

`controlOperationalDomainContracts()` marks every domain **PARTIAL** / `live: false` except the contracts themselves. This is the official honesty of the Control product, not a bug to paper over.

### 4.3 Decision engine (only one that can stop siblings)

`evaluateAuthorized()` in `apps/api/src/services/application-preflight.ts` (HMAC + binding already succeeded):

- `denyImpersonation`
- kill categories
- `delete` / `destroy` / `drop` → DENY
- HIGH / TOOL → REQUIRE_APPROVAL (approval-store failure → DENY + HTTP 503)
- GOVERNED_DECISION / INFORMATIONAL without HIGH/CRITICAL risk → ALLOW
- `executed: false` always
- `unavailablePolicy` always from `unavailablePolicyForClass` (four classes only)
- Client gate: `applicationPreflightAllowsExecution` is ALLOW-only

Secret unset never enters `evaluateAuthorized`. `loadApplicationConnectorBinding` returns HTTP 401 + `INVALID`. Clients interpret `FAIL_OPEN` (GOVERNED/INFORMATIONAL) as skip and `FAIL_CLOSED` (HIGH/TOOL) as block.

### 4.4 Test baseline (this identity/telemetry pass; not a production proof)

| Suite | Result |
| ----- | ------ |
| `packages/shared` application-preflight + atlas-gateway | 17 PASS |
| `apps/api` application-preflight + identity | 18 PASS |
| `apps/control-plane` gateway + api routes | 74 PASS |
| `apps/integrations-civio` | 4 PASS |
| shared + api + control-plane typecheck/build | PASS |
| HotelOS `@hotelos/ai-gateway` vitest | **ENVIRONMENT BLOCKED** (no node_modules / Command not found) |
| BrokerOS `@brokeros/api` vitest | **ENVIRONMENT BLOCKED** (Cannot find module vitest.mjs) |
| CaseFlow `atlasPreflight` jest | 4/4 PASS (sibling tree) |
| Civio housing-agent vitest | PASS when vitest present |

### 4.5 Architecture correction (mandatory)

The 28-gate list is a **question checklist**, not 28 Control products.

**Current proposed architecture (operator brief):** 28 independent gates.

**Evidence:** one decision engine (`evaluateAuthorized`), one operational lifecycle, observational telemetry, Fabric-only pause/quarantine.

**Problem:** building 28 engines would duplicate Control, absorb application ownership, and invent sufficiency.

**Better architecture:**

```text
ENFORCEABLE CORE
  Identity → Authorization → Approval/SoD → Runtime authority at next hop → Canonical audit

APPLICATION-OWNED
  Cheap-path existence, knowledge sufficiency, result verification, outcome, model choice

OBSERVATIONAL
  Telemetry, portfolio, incident reconstruction (when correlation IDs exist)

LATER / ONLY WITH TRUTHFUL ATTESTATION
  Path **declaration** (Model C / CTRL-016) is VERIFIED as `declaredCompletionPath` — not sufficiency, not execution
  Resource attribution, learning proposals (CTRL-017+)

EXTERNAL
  FinOps, OTel backends, DR offsite, production secrets
```

**Why better:** matches code, preserves ownership, avoids fake UNNECESSARY.

**Migration impact:** none now — document-only.

**Risk:** operators may still expect 28 dashboards. This plan forbids that.

---

## 5. 2026 Research Reconciliation

Research is an input. Only requirements that survive code review become tasks.

| 2026 finding | Why it matters | Atlas already addresses | Atlas gap | Class | Action |
| ------------ | -------------- | ----------------------- | --------- | ----- | ------ |
| Unknown / shadow Agents (CSA) | Unexpected activity | HotelOS `agent.cio` now explicit on CIO hop (committed in `400759a`). Null is honest. CTRL-018 (`bd1d2db`) classifies observed vs application-owned Expected on existing audit. `notAnAgentRegistry` remains true. | EXPECTED/UNEXPECTED runtime hop not proven (HotelOS connector env absent; CaseFlow preflight `agentId=null`). | CORE SUPPORTING | CTRL-018 PARTIAL — observe only; no Fabric promotion; do not mark VERIFIED |
| Portable Agent identity | Attribution across hops | Schema `agentId` optional; fingerprint includes it; audit echoes it | Delegation hop fields not implemented; CaseFlow/BrokerOS remain null | CORE | CTRL-001 close commit; later only if a real hop exists |
| Pre-execution authorization | Stop before spend | HMAC preflight; ALLOW-only client | Fail-open when secret unset; CaseFlow cache before preflight | CORE | Document; do not silently fail-closed all classes |
| Runtime intervention | Stop a running Agent | Fabric pause/quarantine; `aiWorkers`/`agentDispatch` next-hop `KILLED` | No sibling live-abort (G12-E NOT A DEFECT) | CORE | CTRL-012 VERIFIED (`a363b57`); no sibling live-abort |
| AI Control Plane (Forrester 3-plane) | Separate control from user plane | ADR-021 PUBLIC / USER / CONTROL / ADMIN | Do not merge ports | CORE | Preserve ADR-021 |
| AI governance | Policy + HITL + SoD | Approvals DB SoD; HIGH/TOOL require approval | HotelOS HITL (`ai.approval.approved`) is **not** Atlas approval | CORE | Keep rejected; do not map HotelOS HITL into Atlas SoD |
| AI FinOps (98% unused spend claims) | Accountable spend | Who/operation can be attributed once `agentId` present. R14 optional supplied-only attribution fields exist (provider/model/tokens/modelCallCount/retries/declaredCompletionPath/actualCost/currency). | FinOps product and cost-savings proof remain absent | EXTERNAL / OPTIONAL | CTRL-020 / R14 IMPLEMENTED + TESTED as optional fields only. Not FinOps. No savings proof. |
| Agent observability | Reconstruct activity | Gateway ingest + aliases `ai.gateway.invoke`→`agent.completed`, `autonomy.act`→`tool.executed` | HITL/domain events rejected; invoke not on HotelOS live emit | CONTROL SUPPORTING | Taxonomy closed for known rejects; do not invent emits |
| Memory quality / poisoning | Isolation + revocation | Owner-scoped ACTIVE/SUPERSEDED; `retrieveMemories` statements | HotelOS `actorId` ≠ Atlas `ownerId` — no join | ATLAS CORE | Memory-based necessity = NOT AVAILABLE |
| Provenance / grounding | Evidence ≠ authorization | Atlas-self evidence sufficiency CONTINUE/HALT/INCONCLUSIVE | Sibling hops have no result verification | APPLICATION + CORE | Do not force NLI |
| HITL | Human gate | Atlas REQUIRE_APPROVAL + SoD | Application HITL stays application-owned | CORE | No merge |
| Kill / intervention | Enforceable stop | Category kill + Fabric quarantine | Global categories, not per-app/per-Agent | CORE | Do not fake per-Agent kill for siblings |
| Agent lifecycle | Known / observed / retired | Fabric catalog only | Application Agents are not lifecycle-managed by Control | APPLICATION | Observe only |
| Unnecessary inference | Avoid paid path | Two preflight points exist | UNNECESSARY decision = not implementable without cheap-path proof | APPLICATION then path-authz | Model C only; no Model B |
| Cost/outcome attribution | Who spent, what resulted | Audit has applicationId/agentId/actorId/operation; one local CaseFlow hop correlated `executionId`↔preflight; R14 optional supplied-only fields exist | Not production; not all siblings; no FinOps; no before/after savings proof | CORE SUPPORTING | CTRL-017 LOCAL RUNTIME only; CTRL-020 / R14 IMPLEMENTED + TESTED as optional fields |
| Durable connector nonce / replay (F02, F24, F25, F26) | Multi-isolate + restart replay safety | HMAC + 5 min skew + 10 min TTL preserved. Live path: Postgres `connector_nonces` T0 (`39f654b`). Wave 7: two OS processes against real local Postgres — first consume accepted, second rejected as already used. Local/test: Maps. | Production Vercel + live PG; production 503 | CORE | R01 → **G3**. VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. |
| Durable decision/report correlation (F08) | G16 on serverless | Live path: `preflight_decisions` + `execution_reports` T1/T2 (`39f654b`). Binding is not `decisionId` alone. Wave 7: real local Postgres persisted ALLOW, idempotency hit, conflicting fingerprint rejection, T2 from a separate process. `extensions.digest` search_path blocker fixed (`20260923214500`). | Production Vercel + live PG | CORE | R02 → **G16**. VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. |
| Canonical application audit (F14) | Shared audit on Vercel | Live path: RPC INSERTs `public.audit_logs` inside T1/T2. Node must not dual-write canonical audit. Wave 7: real local Postgres transaction persistence demonstrated. | Production Vercel + live PG | CORE | R03 → **G20**. VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. |
| Full-file NDJSON audit scan (F30) | Query cost at volume | Incremental in-process audit query index (`audit-log-query-index`). `verifyAuditLogChain` still performs full-chain integrity verification — that is not a contradiction to R04. | Production volume / production query proof | CORE SUPPORTING | R04 → **G20**. IMPLEMENTED + TESTED. Not G16. Not production-VERIFIED. |
| Top-level tenant/project on audit (F15) | Reconstruction without JSON mining | Remaining unified audit writers reconciled for authoritative top-level tenant/project attribution when those values exist. No missing values invented. No first project selected from a PSA list. | Events that never carried tenant/project remain without invented ids | CORE SUPPORTING | R05 → **G20**. IMPLEMENTED + TESTED. |
| Audit export / pagination / retention (F16) | Incidents without SSH; operator UX; compliance | Admin-scoped hashed audit export (R06). Stable cursor pagination over indexed audit data (R18). Product retention policy exists and is gated on verified offsite (R20). | Export is a hashed projection, not a raw-file copy. Retention must not delete canonical audit. Offsite dest absent. | CORE SUPPORTING | R06/R18 → **G20/G27** IMPLEMENTED + TESTED. R20 → **G20/G28** IMPLEMENTED + TESTED, operationally gated on R17. |
| Admin/operator privilege contract (F18) | Prevent silent scope drift | Instance-admin all-owners is **intentional** (F17/F39). Written privilege-scope contract + tests exist. | Not a Control G engine | Control + Web | R07 → §6.2. IMPLEMENTED + TESTED. |
| Kernel lessons GET auth (F38) | Defense in depth | Handler is not on the public-route list. `requireUser` added on the kernel lessons GET path. | Not a Control preflight gap | Shared/API | R08 → §6.2. IMPLEMENTED + TESTED. |
| Learning citation index (F40) | Avoid O(n²) audit walks | Dedicated citation lookup keyed by `decisionId:executionId`. Only `application.execution.reported` records with `executionStatus === FAILURE` are eligible. | No ApprovalRequest. No auto-apply. | CONTROL SUPPORTING | R09 → **G21**. IMPLEMENTED + TESTED. |
| Memory DELETE / TTL (F19) | Ownership completeness | Local Web/API memory store is authoritative for this DoD. Explicit DELETE/TTL implemented on that store. | Not Control. No HotelOS actorId-to-memory join. No Supabase dual-write reopen. | Web/API | R10 → **G6**. IMPLEMENTED + TESTED. |
| SSRF / generic HTTP egress (F21) | Unsafe user-influenced fetch | LLM egress (`assertLlmEgressAllowed`) is SATISFIED (F22). Safe outbound path implemented for the defined Atlas path (DNS resolution/classification/pinning). | Unrelated vendor egress sites outside the defined slice were not reopened. | API (cross-plane) | R11 → **G23**. IMPLEMENTED + TESTED for the defined Atlas path. |
| Studio ask-agent / loop cancel (F31) | Operator stop of runaway run | Studio patch SoD/rollback SATISFIED (F32). Studio client-side AbortController cancellation implemented. | Server-side cancellation is intentionally outside the DoD. | Studio | R12 → §6.2. IMPLEMENTED + TESTED. |
| Measured Control budgets (F29) | G25 honesty | Real local in-process Vitest timing measurements were performed. | No invented budgets or SLOs. Not production measurements. | Control | R13 → **G25 / CTRL-021**. IMPLEMENTED + TESTED (local measure class). |
| Secret redaction residual (F23) | New-route leak risk | `redactSecrets` on memory/agent/governed | Residual on new routes | Shared/API | Recorded on **G23**. Not a new product. |
| Offsite DR (F28, F42) | Audit/loss recovery | Local hash-chain exists | AWS / Supabase / offsite dest | Operations | R17 → **G28 / CTRL-022**. ENVIRONMENT BLOCKED. |
| i18n / accessibility completeness (F34) | Access | Translation parity EN/HE/AR 1679/1679/1679 (missing 0, extra 0). Admin login + Register Plugin native form / Enter / `role="alert"` fixed. | No WCAG certification. No full monorepo a11y audit. No production/browser validation beyond what was performed. | Web/Studio | R19 → §6.2. IMPLEMENTED + TESTED. Not a Control architectural gap. |

### 5.1 Finding → home map (Task 19 F01–F42)

Every investigation finding has exactly one authoritative home in this file. R01–R20 are the remediation IDs for the same findings (see §10). Do **not** treat G16 as a catch-all.

| Finding | Home | Plane | Remediation status | Evidence | Remaining limitation |
| ------- | ---- | ----- | ------------------ | -------- | -------------------- |
| F01 HMAC + binding + impersonation | G3 / CTRL-014 | Control | ALREADY SATISFIED / G3 PROVEN (unit+route) | CTRL-014 DoD: impersonation denied; tenant mismatch; spoofed appId rejected; authorized HMAC; single POST preflight; `evaluateAuthorized` unexported | Not production proof |
| F02 nonce/replay process-local | G3 / R01 | Control | R01 VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED | Wave 7 two-process nonce consume/reject on real local Postgres | Production Vercel + live PG |
| F03 authorization / operation classes | G3 / CTRL-013 | Control | ALREADY SATISFIED | Four classes; HIGH_RISK and TOOL_ACTION fail closed | G24 remains PARTIAL (client FAIL_OPEN) |
| F04 client FAIL_OPEN GOVERNED/INFORMATIONAL | G24 | Control | INTENTIONAL / NOT A GAP | `unavailablePolicyForClass` | Do not globally fail-closed |
| F05 approval SoD + durable store | G11 | Control | ALREADY SATISFIED (prod needs live Supabase) | `decidedBy !== requestedBy` | Production approval store |
| F06 kill = next hop | G12 / CTRL-012 | Control | ALREADY SATISFIED; in-flight abort INTENTIONAL / NOT A GAP | G12-A–D tests; G12-E NOT A DEFECT | No sibling live-abort |
| F07 execution correlation contract | G16 / CTRL-017 | Control | CTRL-017 LOCAL RUNTIME VERIFIED; general siblings PARTIAL | CaseFlow hop `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO` | Not production; not all siblings |
| F08 process-local decisions/reports | G16 / R02 | Control | R02 VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED | Wave 7 T1 persist + T2 separate process + negatives | Production Vercel + live PG |
| F09 CTRL-018 observation runtime | G18 / CTRL-018 / R15 | Control | PARTIAL; runtime ENVIRONMENT BLOCKED | Classifier + reserved-identity reject tests | No genuine HotelOS hop |
| F10 CTRL-019 learning runtime | G21 / CTRL-019 / R16 | Control | IMPLEMENTED + TESTED locally; runtime ENVIRONMENT BLOCKED | shared 9/9; API 14/14; regression 160/160 | No genuine repeated FAILURE runtime |
| F11 sibling result verification | G15 | Application | INTENTIONAL / NOT A GAP | Application-owned | Do not force NLI |
| F12 audit hash chain | G20 | Control | HISTORICAL INTEGRITY ISSUE (canonical file) + FIXED + TESTED (current writer) | Verified prefix 0–604; first break at 605; current writer exclusive lock + disk tail re-read; `audit-log.test.ts` 15/15 | Historical file intentionally unchanged. Not a new R item. |
| F13 dual audit planes (API vs CP) | G20 | Control + Control Plane | INTENTIONAL / NOT A GAP | CP audit observational | Canonical is API NDJSON / PG |
| F14 application audit not Postgres-canonical | G20 / R03 | Control | R03 VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED | Wave 7 T1/T2 `public.audit_logs` persistence | Production Vercel + live PG |
| F15 tenant/project nested in `input` | G20 / R05 | Control | R05 IMPLEMENTED + TESTED | Remaining unified writers reconciled; no invented values | Events that never carried ids stay without invented ids |
| F16 audit export | G20 / G27 / R06 | Control | R06 IMPLEMENTED + TESTED | Admin-scoped hashed projection | Not a raw-file copy; not production |
| F16 retention / TTL | G20 / G28 / R20 | Control + Operations | R20 IMPLEMENTED + TESTED; operationally gated on R17 | Policy refuses destructive canonical deletion; offsite must be VERIFIED | No offsite dest; no production DR |
| F17 customer-admin memory all-owners | G6 | Web/API | INTENTIONAL / NOT A GAP under `ownerId` | Instance-admin model | Do not treat as a leak |
| F18 admin vs operator unscope inconsistency | §6.2 / R07 | Control + Web | R07 IMPLEMENTED + TESTED | Privilege-scope contract + tests | Do not treat F17 as a leak |
| F19 memory DELETE / TTL | G6 / R10 | Web/API | R10 IMPLEMENTED + TESTED | Local Web/API memory store | No HotelOS actorId join |
| F20 epistemic halt on retrieve | G5 | Atlas Core | INTENTIONAL / NOT A GAP (no G5 Control engine) | evidence-sufficiency Atlas-self only | Control must not own |
| F21 SSRF / generic HTTP allow-list | G23 / R11 | API (cross-plane) | R11 IMPLEMENTED + TESTED for the defined Atlas path | `safe-outbound-http` + outbound-address classify/pin | Unrelated vendor egress out of slice |
| F22 LLM egress policy | G23 | API | ALREADY SATISFIED for LLM class | `assertLlmEgressAllowed` / `decideEgress` | Not a substitute for generic SSRF (R11 now covers the defined path) |
| F23 secret redaction | G23 | Shared/API | ALREADY SATISFIED with residual new-route risk | `redactSecrets` | Residual on new routes |
| F24 multi-instance Control API | G3 + G16 + G20 via R01–R03 | Control | Covered by R01–R03 local PG; production still blocked | Wave 7 two-process nonce + T2 | Production Vercel isolates |
| F25 restart recovery of correlation | G3 + G16 via R01–R02 | Control | Covered by R01–R02 local PG; production still blocked | Persisted T1/T2 rows | Production restart |
| F26 preflight idempotency Map | G3 / R01–R02 | Control | Live path durable with T0/T1; Maps remain local/test | Wave 7 idempotency hit + conflict reject | Production Vercel + live PG |
| F27 approval store down | G11 / G24 | Control | ALREADY SATISFIED (DENY + 503) | CTRL-013 / F27 tests | — |
| F28 offsite DR | G28 / CTRL-022 / R17 | Operations | ENVIRONMENT BLOCKED | No genuine offsite dest; local isolated-copy only | Do not provision infrastructure |
| F29 measured Control budgets | G25 / CTRL-021 / R13 | Control | R13 IMPLEMENTED + TESTED (local/in-process Vitest) | `control-performance-measure` | No invented SLOs; not production |
| F30 full-file NDJSON scan | G20 / R04 | Control | R04 IMPLEMENTED + TESTED | Incremental query index | `verifyAuditLogChain` still full-chain; not production |
| F31 Studio ask-agent / loop stop | §6.2 / R12 | Studio | R12 IMPLEMENTED + TESTED | Studio AbortController | Server-side cancel out of DoD |
| F32 Studio patch SoD / rollback | §6.2 | Studio | ALREADY SATISFIED | Existing Studio SoD tests | — |
| F33 Web user memory isolation | G6 | Web/API | ALREADY SATISFIED for `user` | Isolation tests | — |
| F34 i18n key parity vs WCAG | §6.2 / R19 | Web/Studio | R19 IMPLEMENTED + TESTED | 1679×3 keys; admin login + plugin dialog a11y | No WCAG certification |
| F35 Agent 365-style registry | G17 | Control | INTENTIONAL / NOT A GAP | `notAnAgentRegistry: true` | Do not build a sibling registry |
| F36 necessity / UNNECESSARY engine | G4 | Control | INTENTIONAL / NOT A GAP | CTRL-016 is declaration only | Do not build a necessity engine |
| F37 token/cost fields | G9 / CTRL-020 / R14 | Control | R14 IMPLEMENTED + TESTED | Optional supplied-only fields | No FinOps; no savings proof |
| F38 kernel lessons GET no `requireUser` | §6.2 / R08 | Shared/API | R08 IMPLEMENTED + TESTED | Kernel GET `requireUser` | Not a Control preflight gap |
| F39 GET `/audit` customer-admin cross-owner | G20 | Control | INTENTIONAL (same instance-admin model as F17) | Instance-admin read | Do not treat as a leak |
| F40 learning `listRecordedProposals` full scan | G21 / R09 | Control | R09 IMPLEMENTED + TESTED | Citation index `decisionId:executionId` | FAILURE-only; no auto-apply |
| F41 HotelOS/BrokerOS vitest | §16 | Environment | ENVIRONMENT BLOCKED | Sibling tooling absent | Do not claim sibling vitest PASS |
| F42 G-P1-06–09 | §16 / G28 | Operations | ENVIRONMENT BLOCKED | remaining-external-dependencies.md | AWS / Supabase / secrets |

---

## 6. Capability Matrix

Status vocabulary (do not collapse): `PROVEN` | `IMPLEMENTED + TESTED` | `VERIFIED AGAINST REAL LOCAL POSTGRES` | `LOCAL RUNTIME VERIFIED` | `PARTIAL` | `MISSING` | `ENVIRONMENT BLOCKED` | `HISTORICAL INTEGRITY ISSUE` | `FIXED + TESTED` | `INTENTIONAL / NOT A GAP` | `NOT APPLICABLE` | `DUPLICATED / REDUNDANT` | `INCORRECT IMPLEMENTATION` | `ARCHITECTURALLY UNCLEAR`.

`PROVEN` is reserved for production-or-official-DoD verification already recorded in this plan. `IMPLEMENTED + TESTED` means code + automated tests exist and are **not** production-VERIFIED. `VERIFIED AGAINST REAL LOCAL POSTGRES` is not production proof. Do not mark a row `PROVEN` merely because unit tests pass.

| ID | Capability | Current implementation | Evidence | Status | Risk if missing | Dependency | Proposed action |
| -- | ---------- | ---------------------- | -------- | ------ | --------------- | ---------- | --------------- |
| G1 | Identity | `applicationId` required; `agentId` optional nullable; `actorId`/`tenantId`/`projectId`/`operation` on preflight; `idempotencyKey`; response echoes `agentId`. `applicationOwnedAgentId()` never invents. HotelOS CIO sends `agent.cio`; embed sends `null`. CaseFlow/BrokerOS send `null`. Civio letter=`LEGAL_LETTER_AGENT`, housing=`HOUSING_AGENT`, others `null`. | `packages/shared/src/platform/application-preflight.ts`; `apps/api/src/services/application-preflight.ts` `finish()`; HotelOS `packages/ai-gateway/src/gateway.ts`; tests `application-preflight-identity.test.ts` | PARTIAL | Wrong attribution | Wave 1 commit | CTRL-001; do not invent IDs for CaseFlow |
| G2 | Intent / purpose | `operation` + `operationClass` (GOVERNED_DECISION / INFORMATIONAL / HIGH_RISK / TOOL_ACTION). No purpose/intent class/expected outcome fields. Full prompts not sent (correct). | `application-preflight.ts` schema | PARTIAL | Cannot distinguish why two GOVERNED_DECISION differ | G1 | Optional purpose class later — do not send prompts |
| G3 | Authorization | HMAC, tenant/project binding, denyImpersonation, kill, destructive DENY, HIGH/TOOL approval unchanged and still the only sibling stop. Decisions ALLOW/DENY/REQUIRE_APPROVAL/KILLED/INVALID/OUT_OF_SCOPE. **R01 nonce/replay:** live Postgres `consume_application_connector_nonce` (T0) is the shared authority; duplicate nonce → 401 INVALID; nonce stays consumed after DENY/KILLED/INVALID/OUT_OF_SCOPE; 5 min skew and 10 min TTL unchanged; uniqueness is **only within the replay window**, not permanent. Local/test without live Supabase keeps Maps. Vercel production without live Postgres → 503 (no HMAC-success ALLOW). **F26 idempotency:** live path lookup before evaluate; Maps remain local/test. Wave 7: two separate OS processes against real local Postgres — first consume accepted, second rejected as already used. | `evaluateAuthorized()`; `application-preflight.test.ts`; `39f654b` T0 RPC; Wave 7 two-process real local Postgres. Production Vercel **not** run. | PROVEN (HMAC/authz unit+route, F01/F03). R01 **VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED** | Bypass if client ignores ALLOW-only; production replay unproven | — | Do not redesign evaluateAuthorized. Do not widen skew. Do not collapse local Postgres into production proof. |
| G4 | Necessity | No `UNNECESSARY` / `proposedPath` / `knowledgeSufficient`. Semantic Conclusion C: cannot infer from availability. HotelOS pack is LLM context, not an answer. CaseFlow cache is a real cheap path **before** preflight. Civio FAQ can skip Gemini **after** preflight. CTRL-016 adds optional `declaredCompletionPath` (`LOCAL_COMPLETION_PATH` / `MODEL_PATH`) so the app can attest a path. Control does not infer sufficiency from that declaration. F36: do not build a necessity engine. | HotelOS gateway; CaseFlow wrap; Civio `ai.ts`; `c0ca916` preflight contract | INTENTIONAL / NOT A GAP | Inferring UNNECESSARY would be a false DENY. Cheap-path existence stays application-owned. | Application attestation | Necessity engine is outside Control ownership. CTRL-016 is declaration only. Execution/outcome is CTRL-017. |
| G5 | Knowledge sufficiency | Atlas-self `CONTINUE/HALT/INCONCLUSIVE` in `packages/shared/src/constants/evidence-sufficiency.ts`. Not used as sibling knowledge judgment. Document count ≠ sufficiency. F20 retrieve labeling is optional; do not build a Control sufficiency engine. | evidence-sufficiency.ts | INTENTIONAL / NOT A GAP | Sibling knowledge judgment stays application-owned | Application attestation | Control must not own domain sufficiency |
| G6 | Memory | Owner-scoped ACTIVE/SUPERSEDED; `allowedAgents`; retrieve returns statements. HotelOS actorId ≠ Atlas ownerId → no join (CAD-008). Control must not own user memory. **F33:** `user` isolation SATISFIED. **F17:** instance-admin all-owners is INTENTIONAL under `ownerId` (not a leak). **R10 / F19:** explicit memory DELETE / TTL IMPLEMENTED + TESTED on the local Web/API memory store. Local store is authoritative for this DoD. | Atlas memory services; `memory-active.ts`; memory route tests | PARTIAL (store + R10). F17 INTENTIONAL / NOT A GAP | Poisoning / cross-user leak if HotelOS actorId were joined wrongly | Identity join (does not exist; must not be built) | Memory-based necessity = NOT AVAILABLE. Do not reopen Supabase dual-write. Do not introduce HotelOS actorId-to-memory joins. |
| G7 | Retrieval / tool necessity | HotelOS embed INFORMATIONAL preflight is the cheap-hop gate. Tools/HIGH require approval. Retrieval may already have happened before Control if app skips preflight. | HotelOS `atlas-preflight.ts`; evaluateAuthorized TOOL_ACTION | PARTIAL | Spend after the fact | App calls preflight first | Keep two-point model; do not add a third invented gate |
| G8 | AI necessity | No Control “does this need AI?” engine. CaseFlow cache and Civio FAQ are application-owned skips. Model choice stays application-owned. | CaseFlow cache; Civio FAQ | INTENTIONAL / NOT A GAP | Model choice stays application-owned | G4 declaration | Do not build a model router |
| G9 | Cost / resource | Optional supplied-only attribution fields exist on the execution report: provider, model, tokens, modelCallCount, retries, declaredCompletionPath, actualCost, currency. Control does not invent missing values. Not a FinOps product. No cost-savings proof. | `application-execution-report.ts`; R14 tests; commit `7346230` | PARTIAL. R14 **IMPLEMENTED + TESTED**. Not FinOps. | Unaccountable spend where siblings do not supply fields | G1, G16, CTRL-020 | Attribution only; FinOps stays external. Do not claim savings without before/after workload evidence. |
| G10 | Risk | HIGH/CRITICAL via operation class + body `riskLevel` on telemetry. Global kill categories. Not Agent-specific. | evaluateAuthorized; atlas-gateway preserve riskLevel | PARTIAL | Under-gated destructive work | G3 | Keep operation-class risk; do not invent Agent risk scores |
| G11 | Human approval / SoD | Atlas approvals: `decidedBy !== requestedBy`, DB-enforced. Approval context may include optional agentId. HotelOS `ai.approval.approved` is **rejected** at gateway (not Atlas SoD). | approvals path; `atlas-gateway.test.ts` reject HITL | PROVEN (Atlas SoD) | Silent cross-action approval | G3 | Do not map HotelOS HITL |
| G12 | Runtime authority | Next-hop only: `aiWorkers`/`agentDispatch` → preflight `KILLED` + `executed:false`. `payments`/`webhooksInbound`/`webhooksOutbound` do not kill application preflight. Fabric pause/quarantine is `def-000` registered Agents only; `agent.cio` is not found. No abort API. In-flight sibling work is not Control-stopped (G12-E NOT A DEFECT). G12-F fail-open/cache bypass stays out of this task. | `application-preflight.test.ts` G12-A/B/D; `atlas-self-agent-control.test.ts` G12-C/D | PARTIAL | In-flight sibling continues after kill | G3 | Do not add live-abort or per-Agent sibling kill |
| G13 | Execution observability | authorized via preflight audit. CaseFlow reports `executionStatus` via `atlas.application-execution-report.v1` (CTRL-017). Other siblings do not report executed/failed/skipped. Telemetry is observational, not a gate (`atlas-gateway.test.ts`). | finish() audit; CTRL-017 report hop; gateway | PARTIAL | Cannot prove execution where siblings do not report | Outcome contract | Wave 4 |
| G14 | Evidence / provenance | Canonical audit + Atlas-self evidence. Authorization ≠ grounding. | unified-audit-entry.schema.ts; evidence-sufficiency | PARTIAL | Ungrounded claims look authorized | G3, G15 | Do not assume authz = evidence |
| G15 | Result verification | Atlas-self ALLOW writes verify on fulfill hop. Sibling hops: application-owned, not federated. F11 / `verificationVerdict: NOT_APPLICABLE`. | control-operations execution notes | INTENTIONAL / NOT A GAP | Sibling result verification stays application-owned | Application report-back | Do not force NLI. Do not take result-verification ownership into Atlas. |
| G16 | Outcome | Generic `atlas.application-execution-report.v1` exists: application-owned `executionId` + `executionStatus` SUCCESS\|FAILURE correlated to a preceding ALLOW. ALLOW is not SUCCESS. One local CaseFlow hop proven (CTRL-017). General sibling coverage remains unproven. Optional `actualCost` is G9 / CTRL-020 / R14, not this contract. **R02 durability:** live Postgres `preflight_decisions` + `preflight_idempotency` + `execution_reports`. T1 commits decision+idempotency+canonical preflight audit before HTTP 200 ALLOW. T2 validates **applicationId, tenantId, projectId, operation, requestId, decision===ALLOW, not expired, agentId when both non-null** — `decisionId` alone is not enough. Duplicate identical report is idempotent; conflicting report → 409. Local/test Maps remain. Vercel production without live Postgres → 503. Wave 7: real local Postgres demonstrated persisted ALLOW, idempotency hit, conflicting fingerprint rejection, T2 from a separate process, execution report persist, mismatch/unknown/expiry/non-ALLOW/replay/conflict negatives. `extensions.digest` search_path blocker fixed. **Not absorbed into this row:** R01 (G3), R03–R06/R18/R20 (G20), R11 (G23), R13 (G25), R14 (G9), R15 (G18), R16 (G21). | CTRL-017 LOCAL RUNTIME hop (unchanged). `39f654b` + Wave 7 real local Postgres. Production Vercel+PG: **not run**. | PARTIAL (contract + one hop + sibling coverage). R02 **VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED** | Allowed ≠ completed where siblings do not report; production correlation unproven | G1, G13 | Wave 4 contract exists. Do not collapse local Postgres into production proof. |
| G17 | Portfolio | `portfolio-governance-view.ts` `notAnAgentRegistry: true`. Supervision snapshot observational. Registry seeded Atlas-self; Civio after HMAC event. F35 Agent 365-style registry is INTENTIONAL / NOT A GAP. | portfolio-governance-view.ts; supervision-snapshot.ts | PARTIAL. F35 INTENTIONAL / NOT A GAP | Operator inspects source instead | Telemetry identity | No arbitrary scores. Do not build a sibling Agent registry. |
| G18 | Unknown / shadow Agents | Application-owned Expected set (`ATLAS_{APP}_EXPECTED_AGENT_IDS`); observed `agentId` classified EXPECTED / UNKNOWN / UNEXPECTED on existing `application.preflight.evaluated` / `application.execution.reported`. Null, missing Expected, or empty Expected = UNKNOWN. Reserved `psa:*` / `cp:*` / Fabric stay CTRL-014, not UNEXPECTED. UNEXPECTED does not change ALLOW/DENY. **R15 / F09:** runtime EXPECTED/UNEXPECTED hop is the remaining proof, not more classifier work. | Commit `bd1d2db`; `application-agent-observation.ts`; CP `notAnAgentRegistry: true` | PARTIAL. R15 ENVIRONMENT BLOCKED | Shadow activity still not runtime-proven | G1, G22, CTRL-018 | Runtime EXPECTED/UNEXPECTED blocked on HotelOS connector env. CaseFlow has no legitimate non-null preflight Agent ID. No Fabric registry. Do not invent hops. |
| G19 | Multi-hop / delegation | No originAgent / delegatingAgent fields. Identity may drop on hop. | schema has single optional agentId | MISSING | Accountability break | Real hop evidence | Add fields only when a hop exists |
| G20 | Audit integrity | Canonical NDJSON + unified audit remain. F13 CP audit observational is INTENTIONAL. F39 instance-admin `/audit` cross-owner is INTENTIONAL (same model as F17). **R03 / F14:** live path RPC INSERTs `public.audit_logs` **inside** T1/T2. Wave 7: real local Postgres transaction persistence demonstrated; `extensions.digest` search_path fix applied. Local/test without live Supabase still uses NDJSON via `appendUnifiedAuditEntry`. **R05 / F15:** remaining unified writers reconciled for authoritative top-level tenant/project when those values exist; no invented ids. **R04 / F30:** incremental in-process audit query index IMPLEMENTED + TESTED. `verifyAuditLogChain` still performs full-chain integrity verification — not a contradiction to R04. **R06:** admin-scoped hashed audit export IMPLEMENTED + TESTED (hashed projection, not a raw-file copy). **R18:** stable cursor pagination over indexed audit data IMPLEMENTED + TESTED. **R20:** product retention policy IMPLEMENTED + TESTED and gated on `offsiteStatus === VERIFIED`; refuses destructive canonical deletion. **F12 / historical NDJSON:** canonical `.atlas/audit/audit.ndjson` has a HISTORICAL INTEGRITY ISSUE at index 605 (verified prefix 0–604). Current writer FIXED + TESTED (exclusive append lock + disk tail re-read). Historical file intentionally unchanged. Not a new R item. | `unified-audit-entry.schema.ts`; `39f654b` + Wave 7 real local Postgres; `7346230` R04/R05/R06/R18/R20 + current writer lock; canonical SHA `ff6b801da227fa983df0f41b2127097dea4685ba0a1338e1ad5d27d84697dfe4` | PARTIAL. R03 **VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED**. R04/R05/R06/R18/R20 **IMPLEMENTED + TESTED**. F12 historical **HISTORICAL INTEGRITY ISSUE**; current writer **FIXED + TESTED** | Production PG unproven; historical NDJSON chain remains broken after 604; offsite dest absent | G1 | Do not claim R03 production-VERIFIED. Do not repair the historical file. Do not create R21. |
| G21 | Feedback / learning | Observe→proposal→authenticated-human-decision→audit exists (`atlas.application-learning-proposal.v1`, Alt 2). Citations must be unified-audit `application.execution.reported` with `executionStatus === FAILURE`, scoped to the same applicationId+tenantId+projectId+operation. Literals `autoApply/executes/mutatesGovernance/mutatesMemory/mutatesKnowledge: false`. No ApprovalRequest and no execution authority. `requestedBy=cp:service`; `decidedBy` is requireAdmin `user.id`; SoD rejects `cp:service` as decider. Stops at audit — no policy/memory/knowledge apply. Positive: proposals are **rebuilt from unified audit**, not a process Map. **R09 / F40:** citation lookup keyed by `decisionId:executionId` IMPLEMENTED + TESTED. **R16 / F10:** repeated-FAILURE runtime still ENVIRONMENT BLOCKED. Seeded NDJSON is not runtime proof. | Commit `ecdae7b`; `application-learning-proposal.ts`; `audit-learning-citation-index` | PARTIAL. R09 **IMPLEMENTED + TESTED**. R16 ENVIRONMENT BLOCKED | No real repeated-FAILURE runtime; no production or autonomous learning | G16, CTRL-019 | autoApply false; not VERIFIED. Do not build a second approval engine. Do not invent FAILURE hops. |
| G22 | Telemetry contract | Aliases: `ai.gateway.invoke`→`agent.completed`, `autonomy.act`→`tool.executed`. Reject: `ai.approval.approved`, `payment.intent.created`, `hr.document.*`. HotelOS live emit uses X-Atlas-Reason + top-level agentId (uncommitted sibling). `ai.gateway.invoke` is HotelOS local onAudit only — **not** on live emit. | atlas-gateway.ts; HotelOS alert-on-sensitive-audit.ts SENSITIVE_ACTIONS | PARTIAL | Rejected legitimate / wrong channel | G1 | Taxonomy closed for known types; do not invent invoke emit |
| G23 | Security / isolation | HMAC, tenant/project, denyImpersonation, owner memory remain. Fail-open GOVERNED/INFORMATIONAL is documented (G24). F22 LLM egress (`assertLlmEgressAllowed` / `decideEgress`) ALREADY SATISFIED for the LLM class. F23 `redactSecrets` ALREADY SATISFIED with residual new-route risk. **R11 / F21:** safe outbound path IMPLEMENTED + TESTED for the defined Atlas path (DNS resolution, classification, connect pinning). Unrelated vendor egress sites outside that slice were not reopened. | evaluateAuthorized; `safe-outbound-http.ts`; `outbound-address.ts`; lifecycle-handoff SSRF tests | PARTIAL. F22 SATISFIED. R11 **IMPLEMENTED + TESTED** for the defined Atlas path | Residual new-route redaction; vendor egress outside the defined slice | G3 | Security review on each CORE close. Do not reopen unrelated egress sites. |
| G24 | Failure / recovery | Fail-open vs fail-closed by the four existing operation classes. F04 client FAIL_OPEN GOVERNED/INFORMATIONAL is INTENTIONAL / NOT A GAP. F27 approval-store failure DENY+503 ALREADY SATISFIED. Atlas secret unset: API 401 INVALID; client skip only if FAIL_OPEN. Duplicate/retry: live path uses durable nonce + idempotency (G3/G16); Maps remain local/test. Durable store unavailable on Vercel production → 503 (no ALLOW, no accepted report). | evaluateAuthorized comments; `unavailablePolicyForClass`; CTRL-013 tests; `applicationGovernanceMode()` | PARTIAL. F04 INTENTIONAL / NOT A GAP | Silent skip of governed hops remains a client FAIL_OPEN path | CTRL-013 docs + tests | Do not globally fail-closed |
| G25 | Performance | Real local in-process Vitest timing measurements exist (`control-performance-measure`). `PERFORMANCE_LIMITS` defaults remain defaults, not SLOs. No invented budgets. Measurement class is local/in-process, not production. | `control-performance-measure.ts` + tests; commit `7346230` | PARTIAL. R13 **IMPLEMENTED + TESTED** (local measure class) | No production SLO; no invented budgets | Measure first | Do not convert local timings into production budgets. |
| G26 | Operator experience | Admin :3200 + Control :3100 surfaces exist. Every widget must bind real data. Portfolio is not a live connector. **R19:** two actionable a11y defects fixed (admin login form + Register Plugin dialog); EN/HE/AR key parity 1679/1679/1679. **R07:** privilege-scope contract IMPLEMENTED + TESTED. Neither is a Control architectural gap — see §6.2. | apps/admin; apps/web admin login + marketplace; `admin-a11y.test.ts` | PARTIAL. R19 **IMPLEMENTED + TESTED**. R07 **IMPLEMENTED + TESTED** | No WCAG certification; no full monorepo a11y audit | Real fields only | Do not claim WCAG or production/browser proof beyond what was performed. |
| G27 | Incident / investigation | Reconstructable when audit has applicationId+agentId+actorId+operation+decision. One local CaseFlow hop has execution/outcome (CTRL-017). Other siblings still missing execution/outcome. **R06** hashed admin export and **R18** cursor pagination IMPLEMENTED + TESTED over indexed audit data. | audit input; CTRL-017 hop; audit routes + tests | PARTIAL. R06/R18 **IMPLEMENTED + TESTED** | Incomplete incident story where siblings do not report; export is hashed projection | G13, G16, G20 | Do not treat hashed export as a raw-file copy. |
| G28 | DR / audit preservation | Production DR / offsite / AWS / Supabase classified as environment. **R17 / F28 / F42:** no genuine offsite destination exists — ENVIRONMENT BLOCKED. Local isolated-copy behavior exists; that is not offsite DR. **R20:** retention policy IMPLEMENTED + TESTED and gated on verified offsite; refuses destructive canonical deletion. Historical canonical NDJSON is already broken at 605 and must not be overwritten to “prove” DR. | remaining-external-dependencies.md G-P1-06–09; `audit-retention-policy.ts`; Wave 8 env audit | ENVIRONMENT BLOCKED (R17). R20 **IMPLEMENTED + TESTED**, operationally gated | Audit loss without offsite dest; no production DR | External / CTRL-022 | Do not hide as “not implemented”. Do not provision or purchase infrastructure. Do not claim production disaster recovery. |

### 6.1 Ownership class per capability

| ID | Class |
| -- | ----- |
| G1, G3, G11, G12 (Fabric + next-hop), G20, G23 | CORE CONTROL |
| G2, G10, G13, G17, G18, G22, G24, G26, G27 | CONTROL SUPPORTING |
| G4 cheap-path existence, G5 sufficiency, G8 model choice, G15 sibling verify, G16 facts | APPLICATION RESPONSIBILITY |
| G6 store, G14 Atlas-self evidence | ATLAS CORE RESPONSIBILITY |
| G9 FinOps product, G28 offsite DR, OTel backends | EXTERNAL INTEGRATION |
| G4 Model C declaration (CTRL-016 VERIFIED), G8 router, G9 FinOps product, G19 hop fields | OPTIONAL / EXTERNAL — CTRL-016 declaration exists; G9 optional fields are R14 IMPLEMENTED + TESTED; FinOps / hop fields remain out of scope |
| Fabric promotion, Control-owned app knowledge, fake UNNECESSARY, NLI everywhere | NOT NEEDED |

### 6.2 Cross-plane / non-Control tracked findings

These are material Task 19 findings with **no Control G-engine home**. They are tracked here so they cannot disappear. They are **not** Control capability rows and are **not** counted in §17 G1–G28 totals. No new CTRL IDs.

| ID | Finding | Plane | Owner | Status | Related | Implementation authorized? |
| -- | ------- | ----- | ----- | ------ | ------- | -------------------------- |
| R07 | Written admin vs operator unscope contract (memory / projects / audit). F17/F39 instance-admin all-owners behavior stays INTENTIONAL. | Control + Web | Privacy / ADR-021 | IMPLEMENTED + TESTED. F17 INTENTIONAL / NOT A GAP | F18; do not silently revoke admin instance read | Done in Waves 1–9 |
| R08 | Kernel lessons GET `requireUser` (not on the public-route list) | Shared/API | Shared Core | IMPLEMENTED + TESTED | F38 | Done in Waves 1–9 |
| R10 | Explicit memory DELETE / TTL / erasure completeness on the local Web/API store | Web/API | Web | IMPLEMENTED + TESTED | G6, F19. F33 user isolation SATISFIED. No HotelOS join. | Done in Waves 1–9 |
| R12 | Cancel in-flight Studio ask-agent / engineering loop (client AbortController) | Studio | Studio | IMPLEMENTED + TESTED | F31. Server-side cancel out of DoD. F32 Studio patch SoD ALREADY SATISFIED | Done in Waves 1–9 |
| R19 | i18n key parity + two actionable a11y defects (admin login; Register Plugin) | Web/Studio | Web / Studio | IMPLEMENTED + TESTED | F34. Not WCAG certification. Not a Control gap | Done in Wave 9 |
| F23-residual | Secret redaction residual risk on new routes | Shared/API | Shared Core | ALREADY SATISFIED with residual | G23 | **No** (keep existing helper) |
| F32 | Studio patch SoD / rollback | Studio | Studio | ALREADY SATISFIED | — | n/a |

---

## 7. Dependency Graph

Actual code dependencies (not the 28-gate wishlist order):

```text
WAVE 0  Master Plan + baseline evidence
   ↓
WAVE 1  CTRL-001 identity/telemetry VERIFIED (`400759a`)
   ↓
        G1 identity ──┬── G22 telemetry taxonomy (closed for known rejects)
                      ├── G3 authorization (already PROVEN; do not redesign)
                      └── G11 SoD (already PROVEN; do not map HotelOS HITL)
   ↓
PARALLEL after WAVE 1
   ├── CTRL-012  G12 kill ≠ sibling live-stop (docs + tests)
   ├── CTRL-013  G24 fail-open/closed matrix (docs + tests)
   └── CTRL-014  G23 impersonation / binding regression lock
   ↓
WAVE 2  Model C path **declaration** VERIFIED (`c0ca916`) — not sufficiency, not execution
BLOCKED ON SIBLING REPORT-BACK (do not start)
   WAVE 4  outcome / executionId report-back (G13/G15/G16)
            G16 R02 durability VERIFIED AGAINST REAL LOCAL POSTGRES (`39f654b` + Wave 7); PRODUCTION NOT VERIFIED
            G3 R01 nonce durability VERIFIED AGAINST REAL LOCAL POSTGRES (`39f654b` + Wave 7); PRODUCTION NOT VERIFIED
            G20 R03 canonical application audit VERIFIED AGAINST REAL LOCAL POSTGRES (`39f654b` + Wave 7); PRODUCTION NOT VERIFIED
   WAVE 5  resource attribution fields (G9 / R14) — IMPLEMENTED + TESTED (`7346230`); not FinOps
   WAVE 7  human-governed learning proposals (G21) — CTRL-019 IMPLEMENTED + TESTED (`ecdae7b`); runtime ENVIRONMENT BLOCKED
   ↓
AFTER CORRELATION EXISTS
   WAVE 6  portfolio / shadow Agents / incidents (G17/G18/G27)
   ↓
IMPLEMENTED + TESTED in Waves 1–9 (not production-VERIFIED)
   G23 R11 SSRF defined Atlas path
   G20 R04/R05/R06/R18/R20 audit query/export/pagination/retention policy
   G21 R09 citation index
   G25 R13 local measurements
   §6.2 R07/R08/R10/R12/R19
   ↓
ENVIRONMENT (still blocked)
   WAVE 8  G28/R17 offsite DR — no dest
   R15 HotelOS runtime hop
   R16 repeated FAILURE runtime
   R01/R02/R03 production proofs (Vercel + live PG) remain BLOCKED
```

**Parallelizable now:** documentation of fail modes, kill semantics, security regression tests — after CTRL-001.

**Must not parallelize with Wave 1:** necessity, knowledge sufficiency, FinOps, Fabric registries, outcome schema.

---

## 8. Implementation Waves

| Wave | Name | Verdict from source |
| ---- | ---- | ------------------- |
| 0 | Baseline and Evidence | **VERIFIED** as living baseline (CTRL-000 / CTRL-015). This document remains the source of truth. Not CLOSED. |
| 1 | Identity and Contract Closure | CTRL-001 **VERIFIED** and committed (`400759a`). Not CLOSED (CORE still 0). |
| 2 | Decision Engine (necessity / path) | Path **declaration** CTRL-016 **VERIFIED** (`c0ca916`). A necessity/UNNECESSARY engine is **INTENTIONAL / NOT A GAP** (G4). Execution/outcome is CTRL-017 **VERIFIED** (LOCAL RUNTIME, one CaseFlow hop). |
| 3 | Runtime Governance | Fabric already pause/quarantine; sibling live-stop **not** claimed |
| 4 | Evidence and Verification | CTRL-017 **VERIFIED** for one local CaseFlow OpenAI hop. Not production. G16 is **PARTIAL** (generic contract + one hop; general sibling coverage unproven). R02 durability is **VERIFIED AGAINST REAL LOCAL POSTGRES** (Wave 7), not production-VERIFIED. G15 remains separate and **MISSING** (intentional as a Control engine). |
| 5 | Resource and Cost | R14 / CTRL-020 optional supplied-only fields **IMPLEMENTED + TESTED**. FinOps external. No savings proof. |
| 6 | Portfolio Supervision | Projection exists; no scores. CTRL-018 PARTIAL / ENVIRONMENT BLOCKED. |
| 7 | Learning | CTRL-019 **IMPLEMENTED + TESTED** (`ecdae7b`). Human proposals + decide exist. Repeated-FAILURE runtime ENVIRONMENT BLOCKED. Not VERIFIED. |
| 8 | Resilience | R13 local measurements IMPLEMENTED + TESTED. R17 offsite DR ENVIRONMENT BLOCKED. R20 retention policy IMPLEMENTED + TESTED and gated on R17. |

Wave 2 is **not** “build a Decision Engine.” The engine exists (`evaluateAuthorized`). Wave 2 is the optional `declaredCompletionPath` attestation on v1. It does not authorize a different decision and does not prove execution.

---

## 9. Calendar

Start: **2026-09-23**. Dates are targets, not promises. BLOCKED / DEFERRED items keep far targets so they are not silently started.

| Window | Work |
| ------ | ---- |
| 2026-09-23 | WAVE 0 Master Plan (this file). No feature implementation. |
| 2026-09-23 → 2026-09-25 | CTRL-001 Atlas-only commit of identity/telemetry **after operator authorization**. |
| 2026-09-25 → 2026-09-30 | CTRL-012, CTRL-013, CTRL-014 (docs + lock tests). |
| 2026-10-01 → 2026-10-07 | After CTRL-001: confirm HEAD contains the 14 Atlas paths and CTRL-015 pointer. |
| 2026-10-08 → 2026-10-21 | Wave 2 path declaration recorded (`c0ca916`). Do not reopen as a necessity/UNNECESSARY engine. |
| 2026-10-22 → 2026-11-11 | Wave 3 sibling-authority documentation + Fabric intervention regression (no per-Agent sibling kill). |
| 2026-11-12 → 2026-12-09 | Wave 4 outcome contract design (schema only after hop evidence). |
| 2026-12-10 → 2027-01-20 | Wave 5–6 attribution + portfolio/shadow observe. |
| 2027-01-21 → 2027-02-17 | Wave 7 learning proposals (autoApply false). |
| Ongoing | Wave 8 / G-P1-06–09 environment — no fake close dates |

---

## 10. Task Registry

| ID | Wave | Task | Status | Start | Target | Dependency | DoD | Evidence | Blocker |
| -- | ---- | ---- | ------ | ----- | ------ | ---------- | --- | -------- | ------- |
| CTRL-000 | 0 | Repository reconciliation + this Master Plan | VERIFIED | 2026-09-23 | 2026-09-23 | — | Document exists; 24 sections; matrix from source; A–N report recorded | Commit `400759a` includes this file | Evidence recorded; later HEAD is `a363b57` |
| CTRL-001 | 1 | Commit identity + HotelOS telemetry (Atlas-only) | VERIFIED | 2026-09-23 | 2026-09-23 | CTRL-000; operator authorization | Implementation verified; tests verified (shared 17 / API 18 / CP 74); HotelOS ai-gateway + BrokerOS vitest ENVIRONMENT BLOCKED; Atlas-only 14-file commit made; siblings excluded; no UNNECESSARY fields | `git show --name-only 400759a` = 14 paths | Pushed to `origin/main` with `a363b57`. CORE still 0 |
| CTRL-012 | 3 | Prove kill/quarantine vs sibling live-stop | VERIFIED | 2026-09-23 | 2026-09-23 | CTRL-001 | G12-A–D tests PASS; G12-E documented NOT A DEFECT; G12-F excluded; no abort API; no Fabric promotion; no runtime capability | `git show --name-only a363b57` = 3 paths; shared 8 / API 20 / CP 14 | Committed `a363b57`, pushed. G12 remains PARTIAL. CORE still 0 |
| CTRL-013 | 8 | Document and test fail-open / fail-closed by operation class | VERIFIED | 2026-09-23 | 2026-09-30 | CTRL-001 | Matrix in §15 matches `evaluateAuthorized`; tests for unset secret | shared `CTRL-013: unavailablePolicyForClass covers only the four existing operation classes`; API `CTRL-013: unset connector secret returns 401 INVALID…`; shared 9/9; API preflight+identity 27/27 | Committed `455b205`. Not pushed. G24 remains PARTIAL |
| CTRL-014 | 1 | Lock impersonation / application-binding regressions | VERIFIED | 2026-09-23 | 2026-09-30 | CTRL-001 | Existing denyImpersonation tests remain green; no new bypass route | `denies PSA impersonation`; `denies Fabric impersonation`; `rejects a caller-supplied tenant that does not match the binding`; `rejects a spoofed applicationId that does not match the HMAC secret`; `allows a valid HMAC-bound informational/governed request`; `only Atlas-self has a gateway fulfill execute contract`; API preflight+identity 27/27; shared preflight+connected 13/13; commit `28ef9f2` | Committed `28ef9f2`. Not pushed. No production change. G24 remains PARTIAL |
| CTRL-015 | 0 | Keep remaining-work 01–19 historical; pointer only | VERIFIED | 2026-09-23 | 2026-09-23 | CTRL-000 | Pointer exists; 01–19 not rewritten | In `400759a` as `docs/architecture/remaining-work.md` | None |
| CTRL-016 | 2 | Model C path declaration (not sufficiency, not execution) | VERIFIED | 2026-09-23 | 2026-09-23 | Proven cheap **completion** exists in-app (CaseFlow cache before preflight; Civio FAQ after). HotelOS pack is not a completion. CTRL-001 | Optional nullable `declaredCompletionPath` on `atlas.application-preflight.v1` (`LOCAL_COMPLETION_PATH` \| `MODEL_PATH`); omit/null valid and fingerprint-compatible (append path only when present); `evaluateAuthorized` has no path branch; `executed: false`; no `UNNECESSARY` / `knowledgeSufficient` / `executionId` | Commit `c0ca916`; exactly 6 Atlas files; shared 11/11; API 37/37; Civio 2/2; CP G12-C 14/14; `@atlas/shared` typecheck+build PASS; `@atlas/api` typecheck PASS | Declaration ≠ execution. CTRL-017 owns correlation. Sibling send of the field is APPLICATION-OWNED. Not pushed. Gate 1: no new Control knowledge gap; do not create CTRL-023 |
| CTRL-017 | 4 | Outcome / execution correlation contract | VERIFIED | 2026-09-23 | 2026-09-23 | CTRL-001; app report-back design | Schema + one sibling hop proving executionId↔preflight | LOCAL RUNTIME CaseFlow wrap (not tests, not production). `atlas.application-execution-report.v1` POST `/api/v1/governance/application-execution-report`. Hop: preflight ALLOW `decisionId` `f3a2539c-8499-462e-b600-8a9b9bf1a0bc` · `requestId` `2fb06f9a-c1c2-4622-bde4-79423bff0ed2` · operation `caseflow.openai.chat` · provider `executionId` `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO` · `executionStatus` SUCCESS · Atlas `accepted=true` · audit `application.preflight.evaluated` + `application.execution.reported`. Not a second OpenAI call. Initial audit miss was reader-path (`row.input` vs canonical `payload.input`), not a correlation failure. HMAC replay only confirmed already-accepted report. | LOCAL RUNTIME only. Not Vercel/production. Not HotelOS/Civio/BrokerOS. Process-local Maps remain the **local/test** path. Live Postgres authority for decisions/reports is R02 — VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. |
| CTRL-018 | 6 | Observed vs expected application Agent IDs (no Fabric registry) | PARTIAL | 2026-09-23 | 2026-09-23 | CTRL-001 | Surface unexpected agentId; `notAnAgentRegistry` remains true | Commit `bd1d2db` (6 Atlas files). Expected is application-owned (`ATLAS_{APP}_EXPECTED_AGENT_IDS`). Classifier EXPECTED/UNKNOWN/UNEXPECTED is observational only. Tests: shared observation 8/8; API observation+identity 12/12; CP 58/58 (`notAnAgentRegistry` true; `agent.cio` not a Fabric target). No registry, Fabric promotion, or authorization change. | NOT VERIFIED. HotelOS `agent.cio` is a legitimate application-owned identity in repository evidence; HotelOS connector env is ABSENT — no real HotelOS→Atlas hop. CaseFlow verified hop is `agentId=null` → UNKNOWN; CaseFlow has no legitimate non-null Agent ID on the Atlas preflight path. EXPECTED and UNEXPECTED runtime observations remain unproven. Not an Atlas implementation defect. Not production. |
| CTRL-019 | 7 | Human-governed learning proposals from repeated failures | IMPLEMENTED + TESTED | 2026-09-23 | 2026-09-23 | CTRL-017 | Proposals only; `autoApply: false` | Commit `ecdae7b` (8 Atlas files). Alt 2 non-redeemable human learning decision. Contract `atlas.application-learning-proposal.v1`. Audit-grounded FAILURE citations; same applicationId+tenantId+projectId+operation. Tests: shared 9/9; API 14/14; regression 160/160. requireAdmin + SoD (`requestedBy=cp:service`, `decidedBy=user.id`). Decision ACCEPT/REJECT on unified audit (`approval: NOT_REQUIRED`). | NOT VERIFIED as runtime. No genuine repeated `application.execution.reported` FAILURE. Not production. No ApprovalRequest. No execution authority. R16 remains ENVIRONMENT BLOCKED. |
| CTRL-020 | 5 | Resource attribution fields (not FinOps) | IMPLEMENTED + TESTED | 2026-09-23 | 2026-09-23 | CTRL-017; R02 | Optional supplied-only who/Agent/operation/resource/outcome refs | Same work as **R14 / G9**. Fields: provider, model, tokens, modelCallCount, retries, declaredCompletionPath, actualCost, currency. Commit `7346230`. | Not FinOps. No cost-savings proof. Not production. |
| CTRL-021 | 8 | Performance budgets for preflight/audit/telemetry | IMPLEMENTED + TESTED | 2026-09-23 | 2026-09-23 | CTRL-001 | Local measurements recorded; no invented SLOs | Same work as **R13 / G25**. Local/in-process Vitest measurements in `control-performance-measure`. | Measurement class is local. Not production. No invented budgets. |
| CTRL-022 | 8 | Production DR / audit offsite | ENVIRONMENT BLOCKED | — | — | G-P1-06–09 | External restore | Same work as **R17 / G28**. No genuine offsite dest. Local isolated-copy is not offsite DR. | AWS / Supabase / offsite dest. Do not provision infrastructure. |

IDs CTRL-002–CTRL-011 reserved unused (never reuse). Next unused ID remains CTRL-023. **Do not create CTRL-023.** Gate 1 (Knowledge Integration Audit) found no new Control knowledge gap.

R01–R20 are remediation IDs from the Task 19 investigation. They are **not** CTRL IDs. Each maps to an existing G/CTRL/§6.2 home. Do **not** create R21/R22. Waves 1–9 implemented the authorized remediations; this recon records evidence only.

| ID | Home | Task | Status | Evidence | Blocker / next proof | Authorized? |
| -- | ---- | ---- | ------ | -------- | -------------------- | ----------- |
| R01 | **G3** | Durable/shared connector nonce (T0). Keep 5 min skew, 10 min TTL. Uniqueness only inside the replay window. | **VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED** | `39f654b`; T0 RPC; Wave 7 two OS processes on real local Postgres — first consume accepted, second rejected as already used | Production Vercel + live PG; production 503 | Code + local PG done. Production verify **not** claimed. |
| R02 | **G16** | Durable preflight decision + accepted execution report correlation (T1/T2). Binding is not `decisionId` alone. | **VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED** | `39f654b`; T1/T2 RPCs; Wave 7 real local Postgres persist + idempotency + conflict reject + `extensions.digest` fix (`20260923214500`) | Production Vercel + live PG | Code + local PG done. Production verify **not** claimed. |
| R03 | **G20** | Canonical application audit: RPC INSERTs `public.audit_logs` inside T1/T2. No Node post-commit canonical write. | **VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED** | `39f654b`; Wave 7 T2 from a separate process; execution report persist; mismatch/unknown/expiry/non-ALLOW/replay/conflict negatives | Production Vercel + live PG | Code + local PG done. Production verify **not** claimed. |
| R04 | **G20** | Incremental in-process audit query index | **IMPLEMENTED + TESTED** | `audit-log-query-index`; `7346230`. `verifyAuditLogChain` still full-chain — not a contradiction. | Production query volume | Done in Waves 1–9. Not production. |
| R05 | **G20** | Top-level `tenantId`/`projectId` on unified audit | **IMPLEMENTED + TESTED** | Remaining unified writers reconciled; no invented values; no first-project-from-PSA | Events that never carried ids stay without invented ids | Done in Waves 1–9. |
| R06 | **G20 / G27** | Admin-scoped hashed audit export | **IMPLEMENTED + TESTED** | Hashed projection, not a raw-file copy; `7346230` | requireAdmin; not production | Done in Waves 1–9. |
| R07 | §6.2 | Written admin vs operator privilege contract | **IMPLEMENTED + TESTED**. F17 INTENTIONAL | `privilege-scope.contract.test.ts` | Do not revoke admin read as a “fix” | Done in Waves 1–9. |
| R08 | §6.2 | Kernel lessons GET `requireUser` | **IMPLEMENTED + TESTED** | `kernel.ts` + `kernel.test.ts` | Not a Control preflight gap | Done in Waves 1–9. |
| R09 | **G21** | Learning citation index by `decisionId:executionId` | **IMPLEMENTED + TESTED** | FAILURE-only `application.execution.reported`. No ApprovalRequest. No auto-apply. | R16 runtime still blocked | Done in Waves 1–9. |
| R10 | **G6 / Web** | Memory DELETE / TTL on the local Web/API store | **IMPLEMENTED + TESTED** | Local store is authoritative for this DoD | No HotelOS actorId join; no Supabase dual-write reopen | Done in Waves 1–9. |
| R11 | **G23** | Safe outbound / SSRF path for the defined Atlas path | **IMPLEMENTED + TESTED** | `safe-outbound-http` + outbound-address classify/pin | Unrelated vendor egress out of slice | Done in Waves 1–9. |
| R12 | §6.2 Studio | Client AbortController cancel of Studio ask-agent / loop | **IMPLEMENTED + TESTED** | `studio-run-abort.ts` | Server-side cancel intentionally out of DoD | Done in Waves 1–9. |
| R13 | **G25 / CTRL-021** | Measure Control preflight/audit/telemetry locally | **IMPLEMENTED + TESTED** | Local/in-process Vitest measurements of Control itself | No invented SLOs; not production; **not AI cost-savings proof** | Done in Waves 1–9. |
| R14 | **G9 / CTRL-020** | Optional supplied-only cost **attribution** fields (not FinOps, not savings proof) | **IMPLEMENTED + TESTED** | provider/model/tokens/modelCallCount/retries/declaredCompletionPath/actualCost/currency | COST SAVINGS NOT YET QUANTIFIED. No before/after benchmark. | Done in Waves 1–9. |
| R15 | **G18 / CTRL-018** | EXPECTED/UNEXPECTED runtime hop | **ENVIRONMENT BLOCKED** | Classifier + reserved-identity reject tests exist | No genuine HotelOS runtime/credentials/hop | Env, not code. Do not fabricate. |
| R16 | **G21 / CTRL-019** | Repeated FAILURE runtime proof | **ENVIRONMENT BLOCKED** | Alt 2 + tests exist | No genuine repeated FAILURE runtime. Seeded NDJSON is not proof. | Env, not code. Do not fabricate. |
| R17 | **G28 / CTRL-022** | Offsite DR + restore drill | **ENVIRONMENT BLOCKED** | No genuine offsite dest; local isolated-copy only; canonical file already broken at 605 | AWS / Supabase / offsite dest | Env. Do not provision infrastructure. |
| R18 | **G20 / G27** | Stable cursor pagination on indexed audit data | **IMPLEMENTED + TESTED** | Cursor over query index | Not production | Done in Waves 1–9. |
| R19 | §6.2 Web/Studio | Actionable a11y + i18n key parity | **IMPLEMENTED + TESTED** | Admin login + Register Plugin forms; EN/HE/AR 1679/1679/1679 | No WCAG certification; no full monorepo a11y audit | Done in Wave 9. |
| R20 | **G20 / G28** | Retention policy gated on verified offsite | **IMPLEMENTED + TESTED** | `audit-retention-policy.ts`; refuses destructive canonical deletion | Operational retention gated on R17 VERIFIED offsite | Done in Wave 8. Not production DR. |

---

## 11. Acceptance Criteria

A CORE capability is 10/10-closed only when all ten hold:

1. Implementation in reachable code
2. Security review recorded
3. Tests on the real path
4. Runtime proof where the path can run locally
5. Audit proof (canonical record)
6. Documented failure behavior
7. Documented ownership
8. Documented operator behavior
9. No unresolved critical dependency
10. Evidence block in this plan (closed date, commit, files, tests, remaining limitation)

**Not sufficient:** TypeScript compile, a unit test, a UI widget, an Agent claim.

---

## 12. Test Strategy

| Layer | What | Command / suite |
| ----- | ---- | --------------- |
| Schema | agentId null/present/empty-reject | `packages/shared` application-preflight.test |
| API decision | HMAC, impersonation, kill, ALLOW-only | `apps/api` application-preflight*.test |
| Identity cases | hotelos `agent.cio`; embed null; caseflow null | `application-preflight-identity.test.ts` |
| Telemetry | aliases + HITL/domain reject | `apps/control-plane` atlas-gateway.test |
| Ingest | X-Atlas-Reason + autonomy.act | api-routes.test |
| Civio | connector HMAC | integrations-civio |
| Siblings | HotelOS/BrokerOS vitest | **ENVIRONMENT BLOCKED** — do not claim PASS |
| CaseFlow | atlasPreflight jest | sibling tree 4/4 — not Atlas CI |

Do not add tests that invent Agent IDs or UNNECESSARY decisions.

---

## 13. Runtime Proof Strategy

| Claim | How to prove | Current |
| ----- | ------------ | ------- |
| Preflight stops CIO | HotelOS calls API; ALLOW-only before Gemini | Local tests; HotelOS package test blocked |
| Telemetry does not authorize | CP test: ingest ≠ execution gate | PASS in CP suite |
| Fabric pause | atlas-self-agent-control path | Code + existing CP tests |
| Sibling Agent live-stop | **Cannot** be proven — not implemented (G12-E NOT A DEFECT) | CTRL-012 tests + this row |
| Production HMAC | Needs live secrets | ENVIRONMENT BLOCKED |
| LexStudy / Vantera | Repos not on workstation | NOT ACCESSIBLE |

---

## 14. Security Requirements

- HMAC on application-preflight and Civio connector.
- `denyImpersonation` — no Agent/app may mint another app’s authority.
- Never invent `agentId`.
- Tenant / project / application binding on every governed hop.
- SoD: approver ≠ requester (Atlas approvals).
- HotelOS HITL must not become Atlas approval.
- Memory remains owner-scoped; no HotelOS actorId join.
- Secrets never printed; `.env` never committed.
- Fail-open GOVERNED/INFORMATIONAL and fail-closed HIGH/TOOL stay explicit.
- No secondary execute path for siblings (`applicationMayExecuteViaGateway` is `def-000` only).
- Durable application governance (R01–R03) uses `service_role` RPCs only; `public`/`anon`/`authenticated` revoked on the new tables/functions.
- Generic SSRF/HTTP allow-list (R11) is **not** implemented. LLM egress policy is not a substitute.
- Nonce uniqueness is only guaranteed inside the existing replay-protection window (5 min skew / 10 min TTL).

---

## 15. Failure / Recovery Requirements

This matrix matches `evaluateAuthorized` / `evaluateApplicationPreflight` / `unavailablePolicyForClass`. No additional policy classes.

| Condition | Behavior | Reason |
| --------- | -------- | ------ |
| Atlas API connector secret unset (any of the four classes) | Binding fails **before** `evaluateAuthorized`. HTTP 401 + `INVALID` + `executed: false`. Response still stamps `unavailablePolicyForClass`. | HMAC cannot authenticate. `evaluateAuthorized` is not entered. |
| Client secret unset / Atlas unreachable, GOVERNED_DECISION / INFORMATIONAL | Client may skip (`FAIL_OPEN`). This is **not** an Atlas ALLOW. | Local/dev siblings must not hard-stop. Matches `unavailablePolicyForClass`. |
| Client secret unset / Atlas unreachable, HIGH_RISK / TOOL_ACTION | Client must block (`FAIL_CLOSED`). | Destructive / tool hops must not run ungoverned. |
| Control Plane :3100 down | Sibling execution **continues** if preflight already ALLOW or skipped | CP is observational for siblings |
| Atlas API down | Client skip only if FAIL_OPEN class; else block | Client interprets `unavailablePolicyForClass`. `evaluateAuthorized` is unreachable. |
| Approval store unavailable, HIGH_RISK / TOOL_ACTION | `evaluateAuthorized` DENY + HTTP 503 + reason `Fail closed: …`. No ALLOW. | Fail closed for those classes. Not REQUIRE_APPROVAL. |
| Approval store unavailable, GOVERNED_DECISION / INFORMATIONAL (no HIGH/CRITICAL risk) | Not reached — those classes ALLOW without creating an approval | `evaluateAuthorized` does not consult the approval store |
| HIGH/TOOL authorized, approval store available, no approvalId | REQUIRE_APPROVAL (HTTP 202) + `FAIL_CLOSED` stamp | Human gate |
| Telemetry unavailable | Execution may proceed | Telemetry is not a gate |
| Audit unavailable | Treat as reliability incident; do not silently drop CORE proof | Canonical audit is the record |
| Live Postgres unavailable, local/test | Maps remain the authority (existing unit-test path) | Not a second competing store. Dual-write Map+Postgres is forbidden. |
| Live Postgres unavailable, Vercel production | HTTP 503. No ALLOW. No `accepted: true`. No connector-HMAC success path. | Fail-closed. Simulated in unit test only — **not** a production 503 proof. |
| T1 persist fails | No decision row, no idempotency row, no canonical `application.preflight.evaluated`. No HTTP 200 ALLOW. | RPC transaction: all three or none. |
| T2 persist fails | No execution report, no canonical `application.execution.reported`. No HTTP 200 `accepted: true`. | RPC transaction: validate + report + audit or none. |
| Duplicate nonce (same isolate or another) | 401 INVALID. Nonce stays consumed. | T0 committed before evaluate. |
| Same idempotency key + same fingerprint | Return stored response. No second T1. No second audit. | Lookup before evaluate. |
| Same idempotency key + different fingerprint | 409. Loser evaluation must not persist. | Concurrent: at most one T1 winner. |
| Duplicate / retry | Nonce + idempotency (durable on live path; Maps on local/test) | Replay resistance inside the 10 min nonce TTL / 5 min skew. Not permanent uniqueness. |
| Kill category engaged | Next preflight `KILLED` for `aiWorkers`/`agentDispatch` only | Not a mid-flight sibling abort (G12-E). `payments`/webhook kills do not apply to application preflight |
| Policy change | Next evaluate | No live rewrite of in-flight tokens |
| Model unavailable | Application failure | Application-owned |
| LexStudy/Vantera missing | NOT ACCESSIBLE | Do not invent connectors |

---

## 16. Environment Blockers

| Blocker | Affected capability | Exact command / error | Local still possible | Needs restore |
| ------- | ------------------- | --------------------- | -------------------- | ------------- |
| HotelOS `@hotelos/ai-gateway` tooling | G1 HotelOS runtime proof | `pnpm --filter @hotelos/ai-gateway exec vitest --version` → Command not found / missing node_modules | Atlas API identity tests; read gateway.ts | Install HotelOS deps (do not clean dirty tree) |
| BrokerOS vitest | G1 BrokerOS runtime proof | Cannot find module `vitest.mjs` | Read `atlas-preflight.ts`; Atlas schema tests | Install BrokerOS test deps |
| LexStudy repo | G1/G22 lexstudy | Not on workstation | Contract row only | Clone / access |
| Vantera repo | G1/G22 vantera | Not on workstation | Contract row only | Clone / access |
| G-P1-06–09 | G28, production proof | `docs/architecture/remaining-external-dependencies.md` | Local HMAC tests | AWS / Supabase / production secrets |
| Operator commit not authorized | CTRL-001 | Cleared 2026-09-23 | Commit `400759a` | None |
| Sibling dirty trees (pre-existing + this pass) | Commit hygiene | Separate repos | Atlas-only commit path B | Do not reset siblings |
| Real PostgreSQL migration/apply (local Docker) | R01/R02/R03 local close | Applied on local Docker Postgres in Wave 7 (`20260923180000` + `20260923214500` digest qualify) | Local real-PG proof exists | Production/Vercel apply remains unverified |
| Real PostgreSQL transaction execution (local) | R03 T1/T2; R01 T0 | Wave 7 executed T0/T1/T2 against real local Postgres | Local real-PG proof exists | Production txn proof remains unverified |
| Multi-process validation (local) | G3 replay + G16 correlation | Wave 7 two OS processes on real local Postgres | Local two-process proof exists | Two Vercel isolates remain unverified |
| Production Vercel + live PostgreSQL | R01/R02/R03 | Not run | Local code + tests + real local Postgres | Production env |
| Production Vercel 503 without live Postgres | G24 fail-closed | Unit simulation (`VERCEL=1`, `NODE_ENV=production`) only | Simulated 503 | Production 503 proof |
| HotelOS connector env (CTRL-018 / R15) | G18 | Connector absent; no genuine HotelOS runtime/credentials/hop | Classifier tests | HotelOS env. Do not fabricate a hop. |
| Repeated FAILURE hop (CTRL-019 / R16) | G21 | No genuine repeated `application.execution.reported` FAILURE | Learning unit tests | Real FAILURE hop. Seeded NDJSON is not proof. |
| Offsite DR destination (R17 / CTRL-022) | G28 | No genuine offsite backup destination; no paid backup | Local isolated-copy only | Do not provision or purchase infrastructure |
| Historical canonical NDJSON chain | G20 / F12 | First break at index 605; verified prefix 0–604 | Current writer FIXED + TESTED | Historical file intentionally unchanged. Not a new R item. |

### 16.1 Production / Vercel

R01–R03 have genuine real local Postgres evidence (Wave 7), including two-process nonce consume/reject, T1 persist + idempotency + conflict reject, T2 from a separate process, and binding negatives. Production / Vercel end-to-end durability remains **unverified**. Local Postgres is not production proof.

### 16.2 HotelOS

R15 / CTRL-018 remain **ENVIRONMENT BLOCKED**. Application-owned expected agent IDs and observational states (EXPECTED / UNKNOWN / UNEXPECTED) exist. Reserved Fabric/PSA/CP identities are rejected as impersonation. No genuine HotelOS runtime, credentials, or hop was available. Do not fabricate one.

### 16.3 Repeated FAILURE

R16 remains **ENVIRONMENT BLOCKED**. CTRL-019 / R09 implementation and tests exist. No genuine repeated `application.execution.reported` FAILURE runtime was available. Seeded NDJSON is not runtime proof.

### 16.4 Offsite DR

R17 remains **ENVIRONMENT BLOCKED**. No genuine offsite backup destination exists. R20 retention policy is implemented and gated on verified offsite; it refuses destructive canonical deletion. Local isolated-copy behavior is not offsite DR. Do not provision or purchase infrastructure. Do not claim production disaster recovery.

### 16.5 Historical audit integrity (not a new R item)

This is a historical integrity note. It is **not** a new remediation item. Do not create R21/R22.

Canonical file: `.atlas/audit/audit.ndjson`

| Fact | Value |
| ---- | ----- |
| SHA-256 (this recon) | `ff6b801da227fa983df0f41b2127097dea4685ba0a1338e1ad5d27d84697dfe4` |
| Line count | 1573 |
| First broken index | 605 |
| Verified prefix | indices 0–604 |
| Failed invariant | `entry[605].prevHash !== entry[604].hash` |
| Entry 605 own hash | Recomputes correctly from its own `prevHash` |
| Stale predecessor | `entry[605].prevHash` equals the hash of entry 601 |
| Pre-existing suffix | entries 602–604 already existed before 605 |
| Later mismatches | additional historical predecessor mismatches exist later in the file |
| Canonical file | byte-for-byte unchanged by Wave 9 and by this recon |

**Current writer (separate from the historical file):** the pre-fix writer used stale in-memory tail state without an exclusive append lock. The failure class was reproduced with a disposable interleave. The current fix in `apps/api/src/services/audit-log.ts` uses an exclusive lock around disk tail re-read, `prevHash` acquisition, hash creation, and append. Hash algorithm, payload format, and APIs were preserved. Regression: `audit-log.test.ts` 15/15.

| Subject | Class |
| ------- | ----- |
| Historical canonical audit | `HISTORICAL INTEGRITY ISSUE` |
| Current writer | `FIXED + TESTED` |

Do not interpret the historical broken file as evidence that the current writer fix failed. Do not repair, rehash, resequence, truncate, delete, or replace the historical file.

---

## 17. Current Progress

Counts are mechanical from the registers in this file. They are **not** scores.

### 17.1 Capability rows (§6 G1–G28)

Primary status of each G row (R-substatuses do not change the G primary count):

```text
Total gated capabilities:     28
PROVEN:                       2   (G3 HMAC/authz unit+route; G11 Atlas SoD)
PARTIAL:                      20  (G1, G2, G6, G7, G9, G10, G12, G13, G14, G16, G17, G18, G20, G21, G22, G23, G24, G25, G26, G27)
MISSING:                      1   (G19 delegation hop fields)
INTENTIONAL / NOT A GAP:      4   (G4 necessity engine, G5 sibling sufficiency, G8 model router, G15 sibling result verification)
ENVIRONMENT BLOCKED:          1   (G28)
IMPLEMENTED + TESTED (G primary): 0
F35 Agent 365 registry and F04 client FAIL_OPEN are INTENTIONAL / NOT A GAP annotations. They are not the primary status of G17 or G24.
NOT APPLICABLE:               0
INCORRECT IMPLEMENTATION:     0
2 + 20 + 1 + 4 + 1 = 28
```

G4, G5, G8, and G15 are **INTENTIONAL / NOT A GAP**: they are outside Control ownership. They are not counted as missing Control functionality. G19 remains MISSING because delegation hop fields are not implemented and are not an ownership exclusion. G9 and G25 are PARTIAL because R14/R13 are IMPLEMENTED + TESTED; R13 is local timing, R14 is cost attribution. Neither is a quantified cost-savings result.

R01/R02/R03 are **VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED** remediations living on G3/G16/G20. Those G rows stay PROVEN (G3 authz) or PARTIAL (G16/G20) because production verification and remaining sibling coverage are incomplete. Do **not** count G16 as PROVEN.

### 17.2 Remediation rows (§10 R01–R20)

```text
Total remediations:           20
VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED: 3  (R01, R02, R03)
IMPLEMENTED + TESTED:         14  (R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R18, R19, R20)
ENVIRONMENT BLOCKED:          3   (R15, R16, R17)
MISSING:                      0
3 + 14 + 3 = 20
Production-VERIFIED remediations: 0
Do not create R21/R22.
```

### 17.3 CTRL task rows (§10 CTRL-000–CTRL-022, excluding unused 002–011)

```text
CTRL VERIFIED:                8   (000, 001, 012, 013, 014, 015, 016, 017)
CTRL IMPLEMENTED + TESTED:    3   (019, 020, 021) — 019 runtime ENVIRONMENT BLOCKED; 020 not FinOps; 021 local measure only
CTRL PARTIAL / ENVIRONMENT BLOCKED: 1  (018)
CTRL ENVIRONMENT BLOCKED:     1   (022)
CTRL unused reserved:         10  (002–011)
Do not create CTRL-023.
```

### 17.4 Cross-plane §6.2

```text
Tracked non-Control / cross-plane rows: 7
IMPLEMENTED + TESTED:         5   (R07, R08, R10, R12, R19)
ALREADY SATISFIED:            2   (F32; F23-residual with residual risk)
MISSING:                      0
```

### 17.5 CORE / remaining

```text
CORE CONTROL rows:            G1, G3, G11, G12, G20, G23
CORE closed (10/10 ten-point): 0
CORE remaining:               6 (G3/G11 PROVEN but not 10/10-closed — no security-review + production runtime + plan evidence block yet)
CONTROL SUPPORTING remaining: see §6
Environment blockers:         §16 (Production/Vercel; HotelOS; Repeated FAILURE; Offsite DR)
Historical audit:             §16.5 HISTORICAL INTEGRITY ISSUE (file) / FIXED + TESTED (current writer)
```

Identity/telemetry is **committed** (`400759a`) and CTRL-001 is VERIFIED, not CORE-closed. CTRL-012 is VERIFIED and pushed (`a363b57`). CTRL-013 is VERIFIED and committed (`455b205`). CTRL-014 is VERIFIED and committed (`28ef9f2`). CTRL-016 is VERIFIED and committed (`c0ca916`) as a **declaration** contract, not execution proof. CTRL-017 is VERIFIED by one LOCAL RUNTIME CaseFlow OpenAI hop. CTRL-018 is PARTIAL / ENVIRONMENT BLOCKED (`bd1d2db`). G16 is PARTIAL. R02 on G16 is VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. G20 is PARTIAL; R03 is VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED; R04/R05/R06/R18/R20 are IMPLEMENTED + TESTED; historical NDJSON is a HISTORICAL INTEGRITY ISSUE. G21 is PARTIAL (proposal/decision/audit loop exists; R09 IMPLEMENTED + TESTED; R16 ENVIRONMENT BLOCKED). G15 is INTENTIONAL / NOT A GAP. G4 is INTENTIONAL / NOT A GAP (no necessity engine). G12 remains PARTIAL. G18 is PARTIAL (not PROVEN). G23 remains PARTIAL (R11 IMPLEMENTED + TESTED for the defined Atlas path). G24 remains PARTIAL. G9/G25 are PARTIAL. CTRL-019 is IMPLEMENTED + TESTED locally — do **not** mark runtime VERIFIED. CORE closed remains 0. Production-VERIFIED remediations remain 0.

---

## 18. Completed Work

Nothing in this program is CLOSED. CLOSED still requires a commit reference.

| Item | Date | Commit | Files | Tests | Runtime | Remaining limitation |
| ---- | ---- | ------ | ----- | ----- | ------- | -------------------- |
| CTRL-000 VERIFIED | 2026-09-23 | `400759a` | this file (as committed) | n/a (docs) | n/a | Later HEAD `75ec586` |
| Docs reconciliation | 2026-09-23 | `75ec58675db95941155e2cd0e9f52edfad0fc0a9` | this file | n/a (docs) | n/a | Status/evidence only. Not pushed. CTRL-013 remains NOT STARTED. |
| CTRL-001 VERIFIED | 2026-09-23 | `400759ac3b0ce1c4a32c8f46c13fda18ad228572` | 14 paths from `git show --name-only --format="" 400759a` | shared 17 / API 18 / CP 74 (prior pass) | HotelOS ai-gateway + BrokerOS vitest ENVIRONMENT BLOCKED | Pushed. Not CORE-closed. Sibling trees not committed. |
| CTRL-015 VERIFIED | 2026-09-23 | `400759a` | `docs/architecture/remaining-work.md` | n/a (docs) | n/a | 01–19 unchanged |
| CTRL-012 VERIFIED | 2026-09-23 | `a363b5764f19612616d923a4baf214126303996a` | `application-preflight.test.ts`; `atlas-self-agent-control.test.ts`; this file | shared 8 / API 20 / CP 14 | n/a — no new runtime | G12 PARTIAL. G12-E not a defect. G12-F out of scope. Pushed. |
| CTRL-013 VERIFIED | 2026-09-23 | `455b205b07dd507ddeb0407da9abaac5e8b17232` | `application-preflight.ts` comments; shared + API tests; this §15 | shared 9/9; API preflight+identity 27/27 | n/a — no new runtime | G24 remains PARTIAL. No invented production evidence. Not pushed. |
| CTRL-014 VERIFIED | 2026-09-23 | `28ef9f20177dcdfa62719073182bc32104ecc7b2` | this file only (audit lock; no production edit) | API preflight+identity 27/27; shared preflight+connected 13/13; public-routes 4/4 | n/a — no new runtime | Existing tests remain the lock. No new bypass route. G24 remains PARTIAL. Not pushed. |
| CTRL-016 VERIFIED | 2026-09-23 | `c0ca916ed28f4147587675aa8fa0a3070fd211ac` | 6 Atlas files in that commit (this file is docs recon only) | shared 11/11; API 37/37; Civio 2/2; CP 14/14 | n/a — declaration is not execution | Fingerprint appends path only when present. No path branch in `evaluateAuthorized`. `executed: false`. CTRL-017 owns outcome. Not pushed. |
| CTRL-017 VERIFIED | 2026-09-23 | none recorded as a dedicated commit | Gate 3B contract in tree | existing Gate 3B tests are not the VERIFIED proof | LOCAL RUNTIME: CaseFlow `caseflow.openai.chat` cache-miss wrap → real `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO` → HMAC report accepted → `application.execution.reported` | DoD met by one sibling hop. Not production. Process-local Maps remain local/test. Live durability is R02 (`39f654b`), not this CTRL-017 proof. |
| CTRL-018 PARTIAL | 2026-09-23 | `bd1d2db2fe46e19d54b50332d2aede62cf1597bd` | 6 Atlas files in that commit (this file is docs recon only) | shared observation 8/8; API observation+identity 12/12; CP 58/58 | No HotelOS→Atlas hop. CaseFlow hop remains `agentId=null` → UNKNOWN | NOT VERIFIED. Expected is application-owned. Classification observational only. `notAnAgentRegistry` remains true. No Fabric registry. HotelOS connector env absent — not an Atlas implementation defect. Not production. |
| CTRL-019 PARTIAL | 2026-09-23 | `ecdae7b1facbbb44dfef5e9a7e82956db51995ff` | 8 Atlas files in that commit (this file is docs recon only) | shared 9/9; API 14/14; regression 160/160 | No real repeated `application.execution.reported` FAILURE | NOT VERIFIED. Alt 2 only. No ApprovalRequest. No execution authority. No policy/memory/knowledge mutation. Not production. |
| G16 durability R01+R02+R03 IMPLEMENTED + TESTED | 2026-09-23 | `39f654b12c33dd39b2b0c5396b4977e8a80dc5b5` | 13 Atlas files (`git show --name-only 39f654b`). Master Plan not in that commit. | database 100/100 (17 new); API durability+Map path 81/81; shared contracts 34/34; schema 7/7; Control regression 118/118 | Wave 7 later applied real local Postgres. Production Vercel+PG still not run | Code-level close only at this commit. See Wave 7 row for local PG. |
| Wave 7 R01–R03 real local Postgres | 2026-09-23 | `7346230` includes `20260923214500_audit_logs_chain_digest_qualify.sql` | Additive digest-qualify migration; existing durability SQL applied locally | Two-process nonce; T1 persist + idempotency + conflict; T2 separate process + negatives | PRODUCTION NOT VERIFIED | VERIFIED AGAINST REAL LOCAL POSTGRES. Do not collapse into production proof. |
| Waves 1–6 remediations R04–R14 / R18 | 2026-09-23 | `7346230` | audit index/export/pagination; privilege contract; kernel auth; citation index; memory DELETE/TTL; safe outbound; Studio abort; local measure; attribution fields | Focused unit/integration tests in that commit | Local only | IMPLEMENTED + TESTED. Not production. |
| Wave 8 R17 / R20 | 2026-09-23 | `7346230` | `audit-retention-policy.ts` + tests | Retention gated on offsite VERIFIED; refuses canonical deletion | R17 ENVIRONMENT BLOCKED — no offsite dest | R20 IMPLEMENTED + TESTED. Not production DR. |
| Wave 9 R19 + current audit writer | 2026-09-23 | `7346230` | admin login + Register Plugin a11y; `audit-log.ts` exclusive lock + disk tail re-read | admin-a11y; i18n 1679×3; `audit-log.test.ts` 15/15 | Historical file unchanged (break at 605) | R19 IMPLEMENTED + TESTED. Current writer FIXED + TESTED. Historical file HISTORICAL INTEGRITY ISSUE. Not R21. |

**Not CORE-closed:** identity/telemetry does not satisfy the ten-point CORE definition (no security-review close, HotelOS ai-gateway runtime blocked, no closed CORE evidence block). §17.1 counts are 28 / PROVEN 2 / PARTIAL 20 / MISSING 1 / INTENTIONAL 4 / ENVIRONMENT BLOCKED 1 / CORE 0. R01–R03 local Postgres does not change those G-primary totals and is not production-VERIFIED.

---

## 19. Remaining Work

This documentation recon does **not** authorize a new implementation wave. What remains unproven is environment / production evidence, not missing R21+ items.

Still open as **environment / production proof** (do not hide):

1. **Production / Vercel verification of R01/R02/R03.** Real local Postgres is done (Wave 7). Production Vercel + live PG + production 503 remain unverified.
2. **R15 / HotelOS runtime hop** — ENVIRONMENT BLOCKED. Do not invent a hop.
3. **R16 / repeated FAILURE runtime** — ENVIRONMENT BLOCKED. Do not use seeded NDJSON as proof.
4. **R17 / offsite DR** — ENVIRONMENT BLOCKED. No dest. Do not provision infrastructure. R20 policy exists and is gated.
5. **Historical canonical NDJSON** — HISTORICAL INTEGRITY ISSUE at index 605. Do not repair. Do not create R21.

Closed outside the remediation register (not a new R item):

6. **Governed-command CI kill test** — **CI FAILURE CLOSED — TEST FIXTURE CORRECTED AND VERIFIED** at `4689e5f`. The Node 22 fixture exited before kill (code 13, unsettled top-level await). The fixture now stays alive until SIGTERM. Production `killGovernedExecution` was not changed. GitHub `verify` and Playwright passed. This is not a production kill-switch defect.

Implemented + tested locally and **not** production-proven: R04–R14, R18–R20, CTRL-019–CTRL-021.

Still true:

1. CTRL-013 is VERIFIED (`455b205`). G24 remains PARTIAL.
2. CTRL-014 is VERIFIED (`28ef9f2`). Do not turn this into production proof.
3. CTRL-016 is VERIFIED (`c0ca916`) as path **declaration**. It is not execution, outcome, cost, or sufficiency proof.
4. CTRL-017 is VERIFIED by one LOCAL RUNTIME CaseFlow OpenAI hop (`decisionId` `f3a2539c-8499-462e-b600-8a9b9bf1a0bc` ↔ `executionId` `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO`). CTRL-018 is PARTIAL / ENVIRONMENT BLOCKED (`bd1d2db`) — do **not** mark VERIFIED. G16 is PARTIAL. R02 is VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. G15 is INTENTIONAL / NOT A GAP. CTRL-019 is IMPLEMENTED + TESTED locally — do **not** mark runtime VERIFIED. Do not create CTRL-023.
5. Do **not** implement UNNECESSARY, proposedPath, knowledgeSufficient, FinOps, Fabric app-Agent registry, a new Knowledge Authority, a second learning approval engine, live sibling abort, IDE clone, Redis-only SoT, or NLI sibling verification.
6. Keep G-P1-06–09 blocked.
7. LexStudy / Vantera remain NOT ACCESSIBLE.
8. Do not create R21/R22. Do not reopen Waves 1–9.

---

## 20. Architecture Decisions

| ID | Decision | Status |
| -- | -------- | ------ |
| CAD-001 | 28 gates are a checklist, not 28 products | Active |
| CAD-002 | Only Atlas API preflight can stop sibling hops | Active (Conclusion B) |
| CAD-003 | UNNECESSARY must not be inferred (Conclusion C). Model C is optional `declaredCompletionPath` (CTRL-016 VERIFIED), not sufficiency or execution | Active |
| CAD-004 | `applicationOwnedAgentId()` never invents IDs | Active |
| CAD-005 | HotelOS HITL / payment / HR events stay rejected at Atlas gateway | Active |
| CAD-006 | Telemetry is not an execution gate | Active |
| CAD-007 | Fabric ≠ application Agent ≠ PSA ≠ `cp:service` | Active |
| CAD-008 | Memory-based necessity is NOT AVAILABLE (no owner join) | Active |
| CAD-009 | ADR-021 trust planes stay separate | Active |
| CAD-010 | Remaining-work 01–19 and gap-analysis stay out of this register | Active |
| CAD-011 | CTRL-001 (`400759a`) and CTRL-012 (`a363b57`) are VERIFIED and pushed. CTRL-013 is VERIFIED (`455b205`). CTRL-014 is VERIFIED (`28ef9f2`). CTRL-016 is VERIFIED (`c0ca916`) as declaration only. CTRL-017 is VERIFIED by LOCAL RUNTIME CaseFlow hop. CTRL-018 is PARTIAL / ENVIRONMENT BLOCKED (`bd1d2db`). CTRL-019 is IMPLEMENTED + TESTED (`ecdae7b`); repeated-FAILURE runtime ENVIRONMENT BLOCKED. CTRL-020/CTRL-021 are IMPLEMENTED + TESTED locally (not FinOps / not production SLOs). CTRL-022 is ENVIRONMENT BLOCKED. R01–R03 are VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. R04–R14 and R18–R20 are IMPLEMENTED + TESTED. R15–R17 remain ENVIRONMENT BLOCKED. Historical canonical audit is a HISTORICAL INTEGRITY ISSUE; current writer is FIXED + TESTED. Remediation commit remains `7346230`. Later `main` includes test-fixture commit `4689e5f`: CI FAILURE CLOSED — TEST FIXTURE CORRECTED AND VERIFIED; production kill path unchanged. Do not create R21 or CTRL-023. | Active |
| CAD-012 | Sibling live-abort is not a Control capability. Kill = next preflight. Fabric pause = registered `def-000` Agents only | Active |
| CAD-013 | Live production authority for connector nonces, preflight decisions, idempotency, execution reports, and application canonical audit is Postgres RPCs. Local/test without live Supabase may use Maps. Vercel production without live Postgres fails closed (503). Do not dual-write Map+Postgres as competing authorities. Do not rebuild ALLOW from audit. Do not use Redis as the sole source of truth. | Active |
| CAD-014 | Do not create CTRL-023. Do not build an Agent 365 / sibling Fabric registry. Do not mint sibling Agent IDs. Do not build a second learning approval engine or redeemable ApprovalRequest. Do not build necessity / knowledge-sufficiency / router engines to close G4/G5/G8. Do not take G15 sibling result verification into Atlas. Do not clone VS Code/Cursor into Studio. Do not create FinOps as a product. | Active |

If a task is wrong: mark `ARCHITECTURE REVIEW`, record evidence, propose replacement, update this graph, keep history in §23.

---

## 21. Deferred Work

Environment / production proofs (not missing implementation of R01–R20):

- R01/R02/R03 **production** verification (Vercel + live PG, production 503) — local Postgres is done; production is not
- CTRL-018 / R15 runtime EXPECTED/UNEXPECTED hop (HotelOS connector env absent; not an Atlas implementation defect)
- CTRL-019 / R16 repeated-FAILURE runtime proof (implementation committed; runtime ENVIRONMENT BLOCKED)
- Production DR (CTRL-022 / R17 / G28) — no offsite dest
- Historical canonical NDJSON repair — forbidden. File stays as-is. Not R21.

Intentionally not Control engines (unchanged):

- Purpose/intent class on preflight
- Delegation hop fields
- LexStudy / Vantera runtime wiring
- FinOps product / invented SLOs / WCAG certification
- HotelOS actorId-to-memory joins
- Server-side Studio cancellation

---

## 22. Non-Goals

- FinOps product, OTel vendor, model marketplace, model router, RAG, NLI everywhere
- Memory database owned by Control
- Application Agent runtime or Fabric promotion
- Fake Agent IDs, fake cost savings, fake verification, fake scores, fake EXPECTED/FAILURE hops
- Decorative Control dashboards
- Merging HotelOS HITL into Atlas SoD
- Global fail-closed
- Cleaning sibling dirty trees
- Implementing gap-analysis as this program
- Investor-doc edits unless separately asked
- Agent 365-style registry / minting sibling Agent identities
- Second learning approval engine / redeemable ApprovalRequest for learning
- Necessity / knowledge-sufficiency / AI-router engines merely to close G4/G5/G8
- NLI / result-verification ownership in Atlas for G15
- Live sibling abort (next-hop kill is the architecture)
- Cloning VS Code / Cursor into Studio (LSP, debugger, extensions) for benchmark parity
- Redis-only source of truth
- CTRL-023
- Treating Web/Studio/Operations findings as Control architectural gaps
- Marking R01/R02/R03 PROVEN or production-VERIFIED from unit tests, in-process doubles, or real local Postgres
- Claiming HotelOS runtime, repeated FAILURE runtime, offsite DR, or WCAG certification without evidence
- Creating R21/R22 or repairing the historical canonical audit file
- Claiming “everything is production verified”, “all gaps are closed”, “100% proven”, “audit is healthy”, or “DR is production proven”

---

## 23. Change Log

| Date | Change | Evidence |
| ---- | ------ | -------- |
| 2026-09-23 | Created Master Plan from repository reconciliation. No Control feature implementation in that step. Pointer added in remaining-work.md. | HEAD `d596564` |
| 2026-09-23 | Commit-boundary reconciliation. Corrected “13 files / 11 bullets” to 12 tracked + 2 untracked = 14 Atlas paths. CTRL-000 and CTRL-015 → VERIFIED (not CLOSED). CTRL-001 remains NOT STARTED. Capability counts unchanged (2+15+10+1=28). CORE closed remains 0. No implementation in this pass. | `git diff --name-only` (12); untracked identity test + this file; `git diff --check` PASS |
| 2026-09-23 | CTRL-001 Atlas-only commit `400759ac3b0ce1c4a32c8f46c13fda18ad228572` — 14 files, message `control: close agent identity and hotelos telemetry boundary`. Not pushed. Trailing whitespace stripped from this file so `git diff --cached --check` could PASS; no second commit of this evidence update. Counts unchanged. CORE closed 0. | `git show --name-only --format="" 400759a` |
| 2026-09-23 | CTRL-012 Atlas-only tests for G12-A–D. No runtime capability, no abort API, no Fabric promotion, no sibling edits. G12-E NOT A DEFECT. G12-F excluded. G12 stays PARTIAL. Counts unchanged. CORE closed 0. Status READY FOR VERIFY — not committed. | API 20/20; CP 14/14 |
| 2026-09-23 | Docs-only reconciliation: CTRL-001/CTRL-012 marked VERIFIED and pushed (`400759a`, `a363b57`). G12 stays PARTIAL. Counts unchanged. CORE closed 0. CTRL-013 remains NOT STARTED. | `origin/main` at `a363b57` |
| 2026-09-23 | Current-state docs reconciliation after local commit `75ec586`. Header/§8/§18 no longer say Wave 0 IN PROGRESS, Wave 1 uncommitted, or origin in sync. Historical Change Log rows unchanged. G12 PARTIAL. Counts unchanged. CORE closed 0. CTRL-013 NOT STARTED. | local HEAD `75ec586`; `main` ahead of `origin/main` by 1 |
| 2026-09-23 | Docs-only current-state references after `75ec586` committed as `78f6a66`. CTRL-013/CTRL-014 status unchanged in that commit. | `78f6a664c5365d61dc193db056696b8cbd366ed1` |
| 2026-09-23 | CTRL-013 lock: §15 aligned to `evaluateAuthorized`; unset-secret tests for the four existing classes; authorized/impersonation paths preserved. G24 stays PARTIAL. Counts unchanged. CORE closed 0. Status READY FOR VERIFY — not committed. CTRL-014 not started. | shared 9/9; API preflight+identity 27/27 |
| 2026-09-23 | CTRL-013 operator verification accepted. Status VERIFIED. G24 remains PARTIAL. CTRL-014 not started. Not pushed. | shared 9/9; API preflight+identity 27/27; this commit |
| 2026-09-23 | CTRL-014 audit: existing denyImpersonation + binding tests already satisfy DoD. No production change. No new bypass route (`evaluateAuthorized` unexported; single POST preflight; `applicationMayExecuteViaGateway` is `def-000` only). G24 remains PARTIAL. Status VERIFIED — not committed. | API 27/27; shared 13/13; public-routes 4/4 |
| 2026-09-23 | Current-state docs reconciliation after local commits `455b205` and `28ef9f2`. Header/§10 blockers/§17/§18/§19/CAD-011 no longer say HEAD `78f6a66` or CTRL-014 uncommitted. Historical Change Log rows unchanged. G24 PARTIAL. Counts unchanged. CORE closed 0. | local HEAD `28ef9f2`; `main` ahead of `origin/main` by 4 |
| 2026-09-23 | Prior docs recon `e53681c` is the parent of CTRL-016 implementation. | `e53681c7f0225b3b62ae3c1de9c110f4a87209f2` |
| 2026-09-23 | CTRL-016 documentation reconciliation. Implementation already committed as `c0ca916` (6 Atlas files). Status VERIFIED from existing DoD: written review + cheap completion exists + app can attest via `declaredCompletionPath` + Control authorizes path not sufficiency. Runtime/production sibling proof is **not** in the CTRL-016 DoD (declaration ≠ execution; CTRL-017). G4 remains MISSING. Counts unchanged. CORE closed 0. Gate 1: no new Control knowledge gap; no CTRL-023. Not committed in this pass. | local HEAD `c0ca916`; `main` ahead of `origin/main` by 6 |
| 2026-09-23 | CTRL-017 documentation reconciliation. Status VERIFIED from official DoD: schema + one sibling hop proving `executionId`↔preflight. Proof is LOCAL RUNTIME (CaseFlow OpenAI wrap), not tests and not production. `decisionId` `f3a2539c-8499-462e-b600-8a9b9bf1a0bc`; `requestId` `2fb06f9a-c1c2-4622-bde4-79423bff0ed2`; operation `caseflow.openai.chat`; provider `executionId` `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO`; `executionStatus` SUCCESS; Atlas `accepted=true`; audit `application.preflight.evaluated` + `application.execution.reported`. Initial audit miss was reader-path (`row.input` vs canonical `payload.input`), not an execution/correlation failure. HMAC replay was not another OpenAI call. Implementation uncommitted. No CTRL-018. Counts unchanged. CORE closed 0. Not committed in this pass. | local HEAD `b70f555`; `main` ahead of `origin/main` by 7 |
| 2026-09-23 | CTRL-018 documentation reconciliation. Implementation already committed as `bd1d2db` (6 Atlas files). Status PARTIAL, not VERIFIED. Official DoD (`Surface unexpected agentId`; `notAnAgentRegistry` remains true) is satisfied in CODE+TEST only. HotelOS `agent.cio` is application-owned in repository evidence; HotelOS connector env ABSENT — no real hop. CaseFlow preflight remains `agentId=null` → UNKNOWN; no legitimate CaseFlow non-null Agent ID. EXPECTED/UNEXPECTED runtime unproven. G18 MISSING→PARTIAL (mechanical count 15/10 → 16/9). CORE closed 0. No CTRL-023. Not committed in this pass. | local HEAD `bd1d2db`; `main` ahead of `origin/main` by 10 |
| 2026-09-23 | G16 documentation reconciliation. Status MISSING→PARTIAL. Generic `atlas.application-execution-report.v1` exists (`executionId` + `executionStatus` SUCCESS\|FAILURE, correlated to a preceding ALLOW; ALLOW is not SUCCESS). One local CaseFlow hop proven (CTRL-017). General sibling coverage remains unproven. No `resultStatus` / `outcomeStatus` / `actualCost` added as G16 requirements. `actualCost` remains G9 / CTRL-020. G15 remains MISSING. CTRL-019 unchanged (DEFERRED; Outcome missing). Mechanical count 16/9 → 17/8. CORE closed 0. Not committed in this pass. | local HEAD `dc94361`; `main` ahead of `origin/main` by 10 |
| 2026-09-23 | CTRL-019 documentation reconciliation. Implementation already committed as `ecdae7b` (8 Atlas files). Status DEFERRED→PARTIAL, not VERIFIED. Alt 2 non-redeemable human learning decision. G21 MISSING→PARTIAL (proposal/decision/audit loop; no production or autonomous learning). Repeated real FAILURE runtime unproven. G15/G16/CTRL-017/CTRL-018/CTRL-020–022 unchanged. Mechanical count 17/8 → 18/7. CORE closed 0. No CTRL-023. Not committed in this pass. | local HEAD `ecdae7b` |
| 2026-09-23 | Full Task 19 + Task 20 documentation reconciliation **into this file only**. No new documents. R01/R02/R03 recorded IMPLEMENTED + TESTED at `39f654b` (13 files; not pushed); not production-VERIFIED. Homes: R01→G3, R02→G16, R03→G20. R04–R20 mapped to existing G/CTRL/§6.2 rows — G16 is not a catch-all. F01–F42 finding map added. G-primary counts unchanged (28 / 2 / 18 / 7 / 1 / CORE 0). R counts: 3 IMPLEMENTED+TESTED / 1 PARTIAL / 12 MISSING / 3 ENVIRONMENT BLOCKED / 1 OPTIONAL. No CTRL-023. No implementation in this pass. | local HEAD `39f654b`; this file uncommitted |
| 2026-09-23 | Final owner reconciliation after Waves 1–9 **into this file only**. No implementation. No R21/R22. No new CTRL. R01–R03 → VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED (Wave 7). R04–R14, R18–R20 → IMPLEMENTED + TESTED. R15–R17 remain ENVIRONMENT BLOCKED. R19 a11y/i18n IMPLEMENTED + TESTED (1679×3). Historical canonical audit recorded as HISTORICAL INTEGRITY ISSUE (break at 605; SHA `ff6b801d…`); current writer FIXED + TESTED. G9/G25 MISSING→PARTIAL. G-primary 28 / 2 / 20 / 5 / 1 / CORE 0. Production-VERIFIED remediations remain 0. | HEAD `7346230`; this file uncommitted |
| 2026-09-23 | Documentation correction only. CTRL-020/021/022 confirmed pre-existing on `7346230` and retained. G4/G5/G8/G15 classified INTENTIONAL / NOT A GAP (not MISSING). Added Control Outcome Evidence, Cost Efficiency Evidence, and the value chain. R13 is local timing, not savings. R14 is attribution. COST SAVINGS NOT YET QUANTIFIED. No new R. No new CTRL. No percentage or ROI. | This file only |
| 2026-09-23 | Documentation reconciliation after CI fixture closure. No implementation. No R21/R22. No CTRL-023. R01–R20 statuses unchanged. Governed-command CI failure recorded as **CI FAILURE CLOSED — TEST FIXTURE CORRECTED AND VERIFIED** at `4689e5f`. Production `killGovernedExecution` unchanged. Historical audit file unchanged. | HEAD at recon start `4689e5f`; GitHub verify and Playwright passed |

---

## 24. Evidence Index

| Artifact | Path / ref |
| -------- | ---------- |
| Preflight schema + `applicationOwnedAgentId` + `declaredCompletionPath` | `packages/shared/src/platform/application-preflight.ts` |
| CTRL-018 observation classifier + Expected parse | `packages/shared/src/platform/application-agent-observation.ts` |
| Execution-report schema `atlas.application-execution-report.v1` | `packages/shared/src/platform/application-execution-report.ts` |
| Learning-proposal schema `atlas.application-learning-proposal.v1` | `packages/shared/src/platform/application-learning-proposal.ts` |
| Learning-proposal service + routes | `apps/api/src/services/application-learning-proposal.ts`; `apps/api/src/routes/application-learning-proposal.ts` |
| Execution-report evaluate + ALLOW correlation | `apps/api/src/services/application-execution-report.ts` |
| CaseFlow OpenAI wrap + HMAC report | sibling `apps/server/src/infrastructure/ai/openai.service.js`, `apps/server/src/services/atlas/atlasExecutionReport.js` |
| CTRL-017 LOCAL RUNTIME hop | `decisionId` `f3a2539c-8499-462e-b600-8a9b9bf1a0bc` ↔ `executionId` `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO`; `.atlas/audit/audit.ndjson` `application.execution.reported` |
| Decision engine | `apps/api/src/services/application-preflight.ts` `evaluateAuthorized` |
| Identity tests | `apps/api/src/services/application-preflight-identity.test.ts` |
| Connected apps | `packages/shared/src/platform/connected-applications.ts` |
| Operational lifecycle | `packages/shared/src/platform/control-operations.ts` |
| Kill categories | `packages/agent-core/src/policies/kill-switches.ts` |
| Portfolio not a registry | `apps/control-plane/src/services/portfolio-governance-view.ts` |
| Supervision snapshot | `apps/control-plane/src/services/supervision-snapshot.ts` |
| Evidence sufficiency (Atlas-self) | `packages/shared/src/constants/evidence-sufficiency.ts` |
| Telemetry aliases | `packages/shared/src/constants/atlas-gateway.ts` |
| Gateway ingest | `apps/control-plane/src/services/atlas-gateway.ts` |
| External blockers | `docs/architecture/remaining-external-dependencies.md` |
| Historical closure | `docs/architecture/remaining-work.md` |
| ADR-021 | `docs/architecture` ADR-021 trust planes |
| HotelOS CIO / embed | sibling `packages/ai-gateway/src/gateway.ts`, `atlas-preflight.ts` |
| HotelOS telemetry | sibling `apps/api/src/infrastructure/atlas-telemetry.ts` |
| CaseFlow | sibling `apps/server/src/services/atlas/atlasPreflight.js` |
| Civio | sibling `atlasControlConnector.ts`, `ai.ts` |
| BrokerOS | sibling `packages/api/src/agent/atlas-preflight.ts` |
| G16 durability migration / T0 T1 T2 RPCs | `supabase/migrations/20260923180000_application_governance_durability.sql` |
| G16 durability SQL tests | `supabase/tests/20260923180000_application_governance_durability.test.sql` (in-process). Wave 7 additionally executed T0/T1/T2 against real local Postgres. |
| Digest qualify migration (Wave 7) | `supabase/migrations/20260923214500_audit_logs_chain_digest_qualify.sql` |
| Incremental audit query index (R04) | `apps/api/src/services/audit-log-query-index.ts` |
| Learning citation index (R09) | `apps/api/src/services/audit-learning-citation-index.ts` |
| Retention policy (R20) | `apps/api/src/services/audit-retention-policy.ts` |
| Safe outbound path (R11) | `packages/shared/src/node/safe-outbound-http.ts`; `packages/shared/src/security/outbound-address.ts` |
| Local Control measurements (R13) | `apps/api/src/services/control-performance-measure.ts` |
| Studio client abort (R12) | `apps/web/lib/studio-run-abort.ts` |
| Admin a11y (R19) | `apps/web/app/admin/login/page.tsx`; `apps/web/components/admin/Marketplace/RegisterPluginDialog.tsx`; `apps/web/lib/admin-a11y.test.ts` |
| Current audit writer lock (Wave 9) | `apps/api/src/services/audit-log.ts` (`withAuditAppendLock` + `readTailHashFromDisk`) |
| Canonical audit file (unchanged) | `.atlas/audit/audit.ndjson` SHA-256 `ff6b801da227fa983df0f41b2127097dea4685ba0a1338e1ad5d27d84697dfe4` |
| Application governance repository | `packages/database/src/repositories/application-governance.ts` |
| In-process governance double | `packages/database/src/repositories/application-governance.in-process.ts` |
| Mode switch (maps / durable / unavailable) | `apps/api/src/services/application-governance-store.ts` |
| Durability service tests | `apps/api/src/services/application-governance-durability.test.ts` |
| G16 durability commit | `39f654b12c33dd39b2b0c5396b4977e8a80dc5b5` (13 files) |
| Waves 1–9 remediations commit | `73462307767557257c4c8d9c3f15e816c3543d51` |
| Governed-command kill fixture (test only) | `4689e5f8bba1c4bd8a0e129c0f1d8fd4c9db295c` — CI FAILURE CLOSED. Production kill path unchanged. |

---

## Answers to architectural questions (source)

1. **Last safe point before a paid/resource-consuming operation:** the application’s HMAC call to `POST /api/v1/governance/application-preflight` immediately before the model/tool hop (HotelOS CIO / CaseFlow wrap / Civio Gemini / BrokerOS Gemini). HotelOS embed is an earlier INFORMATIONAL gate before retrieval expansion.
2. **Where Control can still prevent it:** only that Atlas API evaluateAuthorized path, and only if the client uses ALLOW-only. Control Plane `:3100` cannot stop sibling execution.
3. **Cheaper path without owning knowledge:** only if the application already has a proven cheap **completion** (CaseFlow cache before preflight; Civio FAQ after preflight). HotelOS pack is not a completion. Control cannot infer sufficiency. CTRL-016 lets the app declare `LOCAL_COMPLETION_PATH` or `MODEL_PATH`; omit/null is legacy. That declaration is not proof the path ran.
4. **Control vs application:** Control = identity, authz, risk class, approval/SoD, next-hop authority, audit. Application = cheap path, sufficiency, model choice, result, outcome facts.
5. **Signals that may cross the boundary:** applicationId, agentId (or null), actorId, tenantId, projectId, request/idempotency, operation, operationClass, riskLevel, decision, evidence refs, optional `declaredCompletionPath` — not prompts, not memory contents, not domain documents. The path field is a declaration, not execution evidence.
6. **Request → Agent → execution → result:** PARTIAL. Identity on preflight/audit after CTRL-001. One LOCAL RUNTIME CaseFlow hop reported (`CTRL-017` VERIFIED). Live-path decision/report durability is R02 VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. Other siblings and production are not proven.
7. **Stop an Agent:** Fabric/Atlas-self at Control eval. Application Agent: record kill / deny next preflight — not a live abort.
8. **Continue after authorization expires:** yes until the next evaluateAuthorized; no mid-flight sibling revoke.
9. **Bypass:** fail-open skip, CaseFlow cache (intentional cheap path), unconfigured secret, any hop that never calls preflight, CP ingest (not a gate).
10. **Why a decision was made:** PARTIAL — audit has decision + policy/operation class; no purpose/necessity explanation.
11. **What actually happened:** PARTIAL — authorized is recorded; one local CaseFlow OpenAI hop has correlated `executionId` (CTRL-017). Live-path correlation is VERIFIED AGAINST REAL LOCAL POSTGRES (R02), not production-proven. Other sibling executions remain unreported.
12. **Outcome acceptable:** MISSING for siblings; Atlas-self fulfill only.
13. **Learn without autonomous policy change:** PARTIAL — CTRL-019 (`ecdae7b`) proposal/decision/audit exists; `autoApply: false`. Repeated-FAILURE runtime unproven. No autonomous policy mutation.
14. **2026 research core vs optional:** see §5 and §5.1. Core = identity, pre-exec authz, SoD, kill honesty, audit, plane separation. Production-scale durability of nonce/decision/audit is VERIFIED AGAINST REAL LOCAL POSTGRES, not PRODUCTION VERIFIED. Optional/external = FinOps product, router, NLI, OTel, portable hop fields until a hop exists.
15. **Smallest architecture:** Identity → Authorization → Approval → next-hop authority → Audit, plus observational telemetry/portfolio. Everything else waits for truthful application attestation.
16. **What remains:** §19. Production/Vercel, HotelOS, repeated FAILURE, and offsite DR stay environment-blocked or unverified. Do not create R21. Do not repair historical audit. Do not start a new wave from this documentation pass.

---

## 25. Final G1–G28 Reconciliation Matrix

Owner-facing matrix after Waves 1–9. Primary G status is not collapsed into “verified.”

| G | Requirement / original gap | Current implementation | Evidence | Evidence class | Remaining limitation | Final status |
| - | -------------------------- | ---------------------- | -------- | -------------- | -------------------- | ------------ |
| G1 | Identity of application-owned Agents | Optional nullable `agentId`; never invented; HotelOS CIO sends `agent.cio` | CTRL-001 `400759a`; identity tests | VERIFIED LOCAL (schema/API). HotelOS package vitest ENVIRONMENT BLOCKED | CaseFlow/BrokerOS remain null | PARTIAL |
| G2 | Intent / purpose class | `operation` + `operationClass` only | preflight schema | IMPLEMENTED + TESTED (class only) | No purpose/expected-outcome fields | PARTIAL |
| G3 | Authorization / nonce replay | HMAC + binding + denyImpersonation + T0 durable nonce | CTRL-014 tests; Wave 7 two-process real local Postgres | PROVEN (HMAC/authz). R01 VERIFIED AGAINST REAL LOCAL POSTGRES | Production Vercel + live PG | PROVEN (authz) + R01 PRODUCTION NOT VERIFIED |
| G4 | Necessity / UNNECESSARY engine | Outside Control ownership. CTRL-016 is declaration only | CTRL-016 `c0ca916`; F36 | INTENTIONAL / NOT A GAP | Cheap-path existence stays application-owned | INTENTIONAL / NOT A GAP |
| G5 | Knowledge sufficiency | Atlas-self CONTINUE/HALT/INCONCLUSIVE only. Sibling sufficiency is application-owned | evidence-sufficiency.ts; F20 | INTENTIONAL / NOT A GAP | Control does not judge sibling knowledge | INTENTIONAL / NOT A GAP |
| G6 | Memory ownership + DELETE/TTL | Owner-scoped store; R10 DELETE/TTL on local Web/API store | memory services; `7346230` | IMPLEMENTED + TESTED (R10). F17 INTENTIONAL | No HotelOS actorId join | PARTIAL |
| G7 | Retrieval / tool necessity | Two-point preflight; TOOL/HIGH approval | HotelOS embed INFORMATIONAL; evaluateAuthorized | VERIFIED LOCAL (tests) | App may skip preflight | PARTIAL |
| G8 | AI necessity / model router | Model choice stays application-owned | CaseFlow cache; Civio FAQ | INTENTIONAL / NOT A GAP | Control does not route models | INTENTIONAL / NOT A GAP |
| G9 | Cost / resource attribution | Optional supplied-only R14 fields | execution-report + tests; `7346230` | IMPLEMENTED + TESTED | No FinOps; no savings proof | PARTIAL |
| G10 | Risk | Operation class + telemetry riskLevel | evaluateAuthorized; gateway | VERIFIED LOCAL (tests) | Not Agent-specific scores | PARTIAL |
| G11 | Human approval / SoD | Atlas SoD `decidedBy !== requestedBy` | approvals path; HITL reject tests | PROVEN (Atlas SoD) | HotelOS HITL is not Atlas approval | PROVEN |
| G12 | Runtime authority | Next-hop kill only; Fabric pause `def-000` | CTRL-012 `a363b57`; G12-A–D | VERIFIED LOCAL | G12-E sibling live-abort INTENTIONAL / NOT A GAP | PARTIAL |
| G13 | Execution observability | Preflight audit + CaseFlow report hop | CTRL-017 LOCAL RUNTIME | LOCAL RUNTIME VERIFIED (one hop) | Other siblings do not report | PARTIAL |
| G14 | Evidence / provenance | Canonical audit + Atlas-self evidence | unified-audit schema | IMPLEMENTED + TESTED | Authz ≠ grounding | PARTIAL |
| G15 | Sibling result verification | Application-owned; `NOT_APPLICABLE` | F11 | INTENTIONAL / NOT A GAP | Control does not own sibling result verification | INTENTIONAL / NOT A GAP |
| G16 | Outcome correlation + durability | Generic report contract + T1/T2 + one CaseFlow hop | CTRL-017 hop; Wave 7 real local Postgres | LOCAL RUNTIME VERIFIED (one hop). R02 VERIFIED AGAINST REAL LOCAL POSTGRES | General siblings + production | PARTIAL |
| G17 | Portfolio (not a registry) | Observational snapshot; `notAnAgentRegistry` | portfolio-governance-view.ts | IMPLEMENTED + TESTED | Projection is observational | PARTIAL |
| G18 | Unknown / shadow Agents | EXPECTED / UNKNOWN / UNEXPECTED classifier | CTRL-018 `bd1d2db`; R15 | IMPLEMENTED + TESTED. Runtime ENVIRONMENT BLOCKED | No genuine HotelOS hop | PARTIAL |
| G19 | Multi-hop / delegation fields | Single optional `agentId` | schema | — | Add fields only when a hop exists | MISSING |
| G20 | Audit integrity / query / export / retention | PG T1/T2 audit; query index; hashed export; cursor; retention policy; historical NDJSON break | Wave 7 real local Postgres; `7346230`; SHA `ff6b801d…` | R03 VERIFIED AGAINST REAL LOCAL POSTGRES. R04/R05/R06/R18/R20 IMPLEMENTED + TESTED. F12 HISTORICAL INTEGRITY ISSUE + current writer FIXED + TESTED | Production PG; historical file after 604; offsite dest | PARTIAL |
| G21 | Feedback / learning | Alt 2 proposals + citation index | `ecdae7b`; R09; R16 | R09/CTRL-019 IMPLEMENTED + TESTED. R16 ENVIRONMENT BLOCKED | No genuine repeated FAILURE | PARTIAL |
| G22 | Telemetry contract | Aliases + known rejects | atlas-gateway.ts | VERIFIED LOCAL (taxonomy tests) | HotelOS live invoke emit not proven | PARTIAL |
| G23 | Security / isolation / defined-path SSRF | HMAC + binding + LLM egress + R11 defined-path outbound | CTRL-014; F22; `safe-outbound-http` | IMPLEMENTED + TESTED (defined Atlas path) | Residual new-route redaction; vendor egress out of slice | PARTIAL |
| G24 | Failure / recovery by class | Four-class fail-open/closed; durable 503 without live PG | CTRL-013 `455b205`; F04 | VERIFIED LOCAL (tests). F04 INTENTIONAL | Client FAIL_OPEN remains; production 503 unproven | PARTIAL |
| G25 | Performance measurement | Local in-process Vitest measurements | `control-performance-measure`; R13 | IMPLEMENTED + TESTED (local measure class) | No invented SLOs; not production | PARTIAL |
| G26 | Operator experience | Admin/CP surfaces + R19 a11y/i18n + R07 contract | admin login; plugin dialog; 1679×3 | R19/R07 IMPLEMENTED + TESTED | No WCAG certification | PARTIAL |
| G27 | Incident / investigation | Reconstructable fields + hashed export + cursor | CTRL-017; R06; R18 | IMPLEMENTED + TESTED (export/pagination). One hop LOCAL RUNTIME | Other siblings incomplete | PARTIAL |
| G28 | DR / audit preservation | No offsite dest; R20 policy gated | Wave 8 env audit; retention tests | R17 ENVIRONMENT BLOCKED. R20 IMPLEMENTED + TESTED (gated) | No production DR | ENVIRONMENT BLOCKED |

---

## 26. Final CTRL Matrix

| CTRL | Requirement | Implementation evidence | Test evidence | Runtime evidence | Production evidence | Remaining limitation | Status |
| ---- | ----------- | ----------------------- | ------------- | ---------------- | ------------------- | -------------------- | ------ |
| CTRL-000 | Master Plan as register | This file | n/a (docs) | n/a | n/a | Living document | VERIFIED |
| CTRL-001 | Agent identity + HotelOS telemetry boundary | `400759ac3b0ce1c4a32c8f46c13fda18ad228572` | shared/API/CP identity suites | HotelOS package vitest ENVIRONMENT BLOCKED | None | Sibling vitest blocked | VERIFIED |
| CTRL-012 | Kill ≠ sibling live-stop | `a363b5764f19612616d923a4baf214126303996a` | shared 8/8; API 20/20; CP 14/14 | n/a — no new runtime | None | G12-E INTENTIONAL / NOT A GAP | VERIFIED locally |
| CTRL-013 | Fail-open/closed by class | `455b205b07dd507ddeb0407da9abaac5e8b17232` | shared 9/9; API 27/27 | Secret-unset fails at binding first | None | G24 remains PARTIAL | VERIFIED locally |
| CTRL-014 | Impersonation / binding lock | `28ef9f20177dcdfa62719073182bc32104ecc7b2` | impersonation/tenant/appId/HMAC/single POST/`evaluateAuthorized` unexported | n/a | None | DoD satisfied; not production proof | VERIFIED (DoD) |
| CTRL-015 | remaining-work 01–19 historical | `400759a` pointer | n/a (docs) | n/a | n/a | 01–19 unchanged | VERIFIED |
| CTRL-016 | Optional `declaredCompletionPath` | `c0ca916ed28f4147587675aa8fa0a3070fd211ac` | shared 11/11; API 37/37 | Declaration is not execution | None | Not execution proof | VERIFIED (declaration) |
| CTRL-017 | Outcome / execution correlation | `atlas.application-execution-report.v1` | Gate 3B tests exist but are not the VERIFIED proof | LOCAL RUNTIME: `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO` / `f3a2539c-8499-462e-b600-8a9b9bf1a0bc` / `2fb06f9a-c1c2-4622-bde4-79423bff0ed2` / `caseflow.openai.chat` ALLOW→SUCCESS; replay accepted | None | One hop; not production | VERIFIED (LOCAL RUNTIME) |
| CTRL-018 | Observed vs expected Agent IDs | `bd1d2db2fe46e19d54b50332d2aede62cf1597bd` | observation + reserved-identity reject | No genuine HotelOS hop | None | EXPECTED/UNEXPECTED runtime ENVIRONMENT BLOCKED | PARTIAL / ENVIRONMENT BLOCKED |
| CTRL-019 | Human-governed learning proposals | `ecdae7b1facbbb44dfef5e9a7e82956db51995ff` | shared 9/9; API 14/14; regression 160/160 | No genuine repeated FAILURE | None | R16 ENVIRONMENT BLOCKED | IMPLEMENTED + TESTED |
| CTRL-020 | Optional attribution fields | `7346230` / R14 | execution-report tests | None as FinOps | None | No savings proof | IMPLEMENTED + TESTED |
| CTRL-021 | Measure Control timings | `control-performance-measure` / R13 | local/in-process Vitest | Local measure class only | None | No invented SLOs | IMPLEMENTED + TESTED |
| CTRL-022 | Production / offsite DR | None — dest absent | Drill `OFFSITE_NOT_CONFIGURED` | None | None | R17 ENVIRONMENT BLOCKED | ENVIRONMENT BLOCKED |

CTRL-002–CTRL-011 remain unused reserved. Do not create CTRL-023.

---

## 27. Final R01–R20 Matrix

| R | Status | Implementation | Tests | Local runtime | Real local Postgres | Production | Environment blocker / limitation |
| - | ------ | -------------- | ----- | ------------- | ------------------- | ---------- | -------------------------------- |
| R01 | VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED | T0 `consume_application_connector_nonce` (`39f654b`) | durability + database | Two OS processes | First consume accepted; second rejected as already used | Not verified | Production Vercel + live PG |
| R02 | VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED | T1 `record_application_preflight_outcome` (`39f654b` + digest qualify) | durability + Wave 7 | Separate-process T2 path | Persist + idempotency + conflict reject | Not verified | Production Vercel + live PG |
| R03 | VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED | T2 `record_application_execution_report` + in-txn `audit_logs` | durability + Wave 7 negatives | T2 from a separate process | Report persist + mismatch/unknown/expiry/non-ALLOW/replay/conflict | Not verified | Production Vercel + live PG |
| R04 | IMPLEMENTED + TESTED | Incremental in-process query index | `audit-log-query-index` tests | n/a | n/a | Not verified | Full-chain `verifyAuditLogChain` remains (correct) |
| R05 | IMPLEMENTED + TESTED | Remaining unified writers; no invented ids | `audit-r05-attribution` tests | n/a | n/a | Not verified | Events that never carried ids stay empty |
| R06 | IMPLEMENTED + TESTED | Admin hashed export | audit route tests | n/a | n/a | Not verified | Hashed projection, not raw-file copy |
| R07 | IMPLEMENTED + TESTED | Privilege-scope contract | `privilege-scope.contract.test.ts` | n/a | n/a | Not verified | F17 instance-admin remains INTENTIONAL |
| R08 | IMPLEMENTED + TESTED | Kernel lessons GET `requireUser` | `kernel.test.ts` | n/a | n/a | Not verified | Not a Control preflight gap |
| R09 | IMPLEMENTED + TESTED | Citation index `decisionId:executionId` | citation-index tests | n/a | n/a | Not verified | FAILURE-only; no auto-apply |
| R10 | IMPLEMENTED + TESTED | Local Web/API DELETE/TTL | memory-active + memory route tests | n/a | n/a | Not verified | No HotelOS actorId join |
| R11 | IMPLEMENTED + TESTED | Defined Atlas safe-outbound path | `safe-outbound-http` + lifecycle SSRF tests | n/a | n/a | Not verified | Vendor egress outside slice not reopened |
| R12 | IMPLEMENTED + TESTED | Studio client AbortController | `studio-run-abort.test.ts` | n/a | n/a | Not verified | Server-side cancel out of DoD |
| R13 | IMPLEMENTED + TESTED | Local in-process measurements of Control itself | `control-performance-measure` tests | Local Vitest timings | n/a | Not verified | No invented SLOs. Does not prove AI cost savings. |
| R14 | IMPLEMENTED + TESTED | Optional supplied-only cost attribution | execution-report tests | n/a | n/a | Not verified | COST ATTRIBUTION IMPLEMENTED + TESTED. COST SAVINGS NOT YET QUANTIFIED. |
| R15 | ENVIRONMENT BLOCKED | Classifier + reserved-identity reject | observation tests | None | n/a | None | No genuine HotelOS runtime/credentials/hop |
| R16 | ENVIRONMENT BLOCKED | Alt 2 learning loop | shared 9/9; API 14/14; 160/160 | None | n/a | None | No genuine repeated FAILURE; seeded NDJSON is not proof |
| R17 | ENVIRONMENT BLOCKED | Local isolated-copy only | drill `OFFSITE_NOT_CONFIGURED` | None | n/a | None | No genuine offsite dest |
| R18 | IMPLEMENTED + TESTED | Stable cursor pagination | audit route tests | n/a | n/a | Not verified | Over indexed audit data |
| R19 | IMPLEMENTED + TESTED | Admin login + Register Plugin forms; 1679×3 keys | `admin-a11y.test.ts` | Source/i18n checks | n/a | Not verified | No WCAG certification; no full monorepo a11y audit |
| R20 | IMPLEMENTED + TESTED | Retention policy gated on offsite VERIFIED | `audit-retention-policy.test.ts` | n/a | n/a | Not verified | Operational retention gated on R17; no canonical deletion |

Do not create R21/R22.

---

## 28. Demonstrated vs not production-proven

### Demonstrated

A substantial amount of Control implementation and testing is complete. There is genuine local Postgres durability evidence for R01–R03. There is genuine local runtime evidence for one CaseFlow OpenAI hop (CTRL-017). There is substantial focused regression evidence for identity, kill honesty, fail-open/closed, impersonation binding, path declaration, learning proposals, audit query/export/pagination, privilege scope, kernel auth, citation index, memory DELETE/TTL, defined-path outbound, Studio cancel, local measurements, optional attribution fields, retention policy, and the current audit writer lock.

### Not production-proven

Production/Vercel end-to-end durability. Genuine HotelOS runtime evidence. Genuine repeated FAILURE runtime evidence. Offsite disaster recovery. Historical canonical NDJSON integrity after index 604. Any other item whose environment proof is explicitly unavailable.

---

## 29. CONTROL OUTCOME EVIDENCE

What Control has actually done, using evidence already established. Code existence is recorded in the registers above. This section records outcomes.

### A. Governance outcomes

Demonstrated Control outcomes:

* Unauthorized application, tenant, project, and operation bindings are rejected (CTRL-014; Wave 7 R02/R03 binding negatives on real local Postgres).
* Invalid or unknown decisions are rejected (Wave 7 unknown-decision rejection).
* Non-ALLOW execution is rejected (Wave 7 non-ALLOW rejection).
* Agent mismatch is rejected (Wave 7).
* Expiry is rejected (Wave 7).
* Replay and idempotency are enforced (Wave 7: duplicate nonce rejected; same fingerprint returns the stored response; conflicting fingerprint rejected).
* Approval and separation-of-duties constraints are enforced (G11 / CTRL-013: approver ≠ requester; HIGH_RISK and TOOL_ACTION fail closed; secret-unset fails at binding before `evaluateAuthorized`).
* Kill-boundary behavior is enforced where already proven (CTRL-012): next-hop `aiWorkers` / `agentDispatch` preflight returns `KILLED`. Sibling in-flight abort remains INTENTIONAL / NOT A GAP.

### B. Execution outcomes

One local CaseFlow / OpenAI hop is `LOCAL RUNTIME VERIFIED`:

`preflight ALLOW → execution SUCCESS → executionId → decisionId → requestId → audit`

Established identifiers:

* provider `executionId`: `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO`
* `decisionId`: `f3a2539c-8499-462e-b600-8a9b9bf1a0bc`
* `requestId`: `2fb06f9a-c1c2-4622-bde4-79423bff0ed2`
* operation: `caseflow.openai.chat`
* preflight: `ALLOW`
* execution: `SUCCESS`
* Atlas correlation accepted
* audit: `application.preflight.evaluated` + `application.execution.reported`
* replay accepted without a duplicate audit

This is one selected path. It does not prove every sibling application.

### C. Failure / learning outcomes

Demonstrated:

* failure outcomes can be represented (`executionStatus === FAILURE`)
* failure citation lookup exists (R09), keyed by `decisionId:executionId`
* only `application.execution.reported` records with `executionStatus === FAILURE` are eligible
* the learning proposal path exists (CTRL-019 / Alt 2), with `autoApply: false` and no ApprovalRequest

Therefore: the learning mechanism is implemented and tested.

Genuine repeated-failure runtime learning outcome is not yet proven (R16 ENVIRONMENT BLOCKED). No learning-improvement percentage is claimed.

---

## 30. CONTROL COST EFFICIENCY EVIDENCE

### What is already implemented

Control has optional execution attribution for supplied data:

* provider
* model
* tokens
* modelCallCount
* retries
* declaredCompletionPath
* actualCost
* currency

This is cost attribution / measurement capability (R14 / CTRL-020).

### What is actually demonstrated

Implementation and tests show that these supplied attribution fields can travel with the execution report and audit record.

Class: `COST ATTRIBUTION IMPLEMENTED + TESTED`

### What is NOT demonstrated

There is no controlled before/after experiment establishing:

* fewer model calls because of Control
* fewer tokens because of Control
* fewer retries because of Control
* lower actual cost because of Control
* a specific percentage of cost savings
* a specific monetary saving

Class: `COST SAVINGS NOT YET QUANTIFIED`

This is an evidence boundary. It is not a new Control implementation defect, not a new R item, and not a new CTRL item.

R13 measures Control’s own local execution timing. It does not prove AI cost savings.

R14 provides optional AI execution attribution. It does not prove cost savings.

Control contains the mechanisms and attribution required to measure AI execution cost and to identify potential unnecessary work, but the current evidence does not quantify net cost savings.

Cost attribution is implemented and tested; cost-savings impact remains unquantified because no controlled before/after workload benchmark was established in the completed Control remediation work.

### Control value chain

| Control stage | Evidence currently available |
| ------------- | ---------------------------- |
| Agent/application identity | Implemented + tested |
| Preflight / authorization | Proven locally |
| Governance decision | Proven locally |
| Execution correlation | Local runtime verified |
| Execution outcome | Local runtime verified for selected path |
| Failure representation | Implemented + tested |
| Failure citation / learning path | Implemented + tested |
| Model/token/cost attribution | Implemented + tested |
| Measured cost reduction | NOT QUANTIFIED |

### 30.1 Evidence Matrix — 7-Layer Framework (recorded 2026-09-29)

**Purpose:** apply one consistent evidence-grading framework across both existing cost-related sections of this document — this section (§29/§30, Control's oversight of **external connected applications** via `applicationId`) and §33 GAP-RESOURCE (Atlas's **own internal** Fabric-agent AI usage) — so a savings claim is never asserted without naming exactly which of 7 layers supports it, and exactly which layer is missing when it cannot be asserted.

**The 7 layers (every claim below is checked against all 7):**
1. **Attribution** — is the AI action unambiguously joined to Application → Project → Task → Agent → Model?
2. **Actual usage** — real input/output/total tokens, calls, retries, cache/dedup, tools, retrieval — not estimated.
3. **Actual cost** — from a real provider-reported figure, or calculated from real usage × a real price, or merely estimated.
4. **Baseline** — a defined, reproducible reference to compare against (not a marketing number).
5. **Outcome** — did the task actually succeed? A resource reduction that did not achieve the task is not a proven business saving.
6. **Reproducibility** — can an independent reader rerun the same measurement and reach the same number?
7. **Longitudinal evidence** — can this be accumulated over time, per application, without mixing applications together?

**Evidence grades used below (exactly as defined by the operator):** `VERIFIED` (real measurement + real source data + reproducible calculation) · `CALCULATED` (real data, but the value is a derived calculation) · `ESTIMATED` (based on a defined baseline/price-list/assumption) · `OBSERVED` (seen in practice, not yet sufficient to prove savings) · `INFERRED` (conclusion from code structure alone) · `UNVERIFIED` (insufficient evidence).

**Evidence Matrix:**

| Claim | Application | Source | Measurement | Baseline | Outcome | Reproducible | Evidence Grade |
| ----- | ----------- | ------ | ------------ | -------- | ------- | -------------- | ---------------- |
| Attribution (applicationId → task correlation) | CaseFlow (external, `applicationId`-scoped) | §29.B — one real hop: `executionId`/`decisionId`/`requestId`/operation `caseflow.openai.chat` | Correlation chain present for exactly 1 recorded hop | N/A | N/A | Audit record is inspectable — YES, for that one hop | **VERIFIED (single instance, n=1 — not general/production coverage)** |
| Cost-attribution field capability (`actualCost`/`currency`) | Any connected application (schema-level) | `packages/shared/src/platform/application-execution-report.ts` (R14/CTRL-020) | Field exists, optional, supplied-only; schema + unit tests pass | N/A | N/A | Schema/tests are inspectable — YES | **INFERRED** — the capability to carry a real cost value is code-confirmed; whether any connected application has ever actually populated it in a live report is not confirmed by evidence gathered |
| Task/execution outcome | CaseFlow | §29.B (`execution: SUCCESS`) | Categorical (succeeded) | N/A | SUCCESS | YES, for that one hop | **OBSERVED (single instance)** |
| Calls avoided (exact-match dedup) | Atlas-internal (Fabric/LLM layer — see cross-reference below; **not** an `applicationId`-scoped external application) | §33.8 R2 / `packages/agent-core/src/providers/llm.test.ts` | 2 logical calls → 1 real provider call, 1 cache hit, 3 negative controls correct | "2 calls without the cache" (demonstrated by the negative-control tests themselves) | Cached response identical to the original (`usage` deep-equal) — task outcome preserved | YES — `pnpm vitest run packages/agent-core/src/providers/llm.test.ts` reproduces the exact same call counts | **VERIFIED** |
| Tokens "saved" by the avoided call | Atlas-internal | Same dedup test — mocked provider fixture (`input_tokens:100`, `output_tokens:50`) | 150 tokens not resent, in that test | Test fixture only — **not real production traffic** | N/A | YES (deterministic fixture) | **CALCULATED** — real formula, but the input token count is a test fixture, not measured production usage |
| Cost "saved" by the avoided call (worked example) | Atlas-internal | `MODEL_PRICING_USD_PER_1M_TOKENS` (real vendor list price) applied to the fixture's 150 tokens | (100/1e6×$3)+(50/1e6×$15) ≈ **$0.00105, if** those exact tokens were real production traffic | "1 fewer provider call" | N/A | YES (deterministic formula) | **ESTIMATED** — real price table, hypothetical (test-fixture-scale) input; explicitly **not** a verified production dollar saving |
| Money saved in live production (either application) | CaseFlow or Atlas-internal | — | No live token/cost telemetry exists for either | No baseline exists for either | — | — | **UNVERIFIED** — no real production usage/cost data and no baseline exist for any application today |
| Longitudinal, per-application accumulation without mixing | CaseFlow and Atlas-internal | — | No time-series store exists for either (§33.5/§33.6; §29 records single instances only) | — | — | — | **UNVERIFIED** |

**Headline conclusions (exactly the distinction the operator asked to preserve):**
- **CaseFlow (external, `applicationId`-scoped):** attribution and one successful-outcome instance are **VERIFIED**, but **usage savings are not measured and monetary savings are NOT YET VERIFIED** — no populated cost figure was observed for that hop, and no baseline exists to compare against.
- **Atlas-internal Fabric/LLM layer:** call-avoidance is **VERIFIED** (real, reproducible). **Token/cost savings are ESTIMATED at test-fixture scale only** — they are **NOT YET VERIFIED** as a real production dollar figure, because no live provider telemetry or baseline exists.
- **No claim of quantified monetary savings is made for either application.** This matches, rather than contradicts, §30's own pre-existing conclusion (`Measured cost reduction: NOT QUANTIFIED`) and §33's Stage 3–5 conclusions (`BASELINE PARTIALLY VERIFIED`, `SAVING NOT QUANTIFIED`) — this matrix is a reconciliation of both, not a new or competing claim.

**Cross-reference:** this matrix draws its "Atlas-internal" rows from §33 GAP-RESOURCE and its "CaseFlow" rows from §29 above — see §33's own scope note for why these are two distinct `application` concepts (external connected applications vs. Atlas's own Fabric dispatch) that must not be aggregated together.

### 30.2 Application Inventory — Stage 1 Reconciliation (recorded 2026-09-29)

**Purpose:** before any Application-level AI usage/cost/savings claim can be graded (§30.1), this records exactly which Applications exist in the repository and their current evidence state. Evidence classification uses exactly these 9 states: `VERIFIED EMPIRICALLY` · `IMPLEMENTED + TESTED` · `CALCULABLE FROM REAL DATA` · `OBSERVED BUT NOT FULLY ATTRIBUTED` · `INFERRED FROM CODE` · `ESTIMATED` · `MISSING` · `BLOCKED` · `UNKNOWN`. Do not read absence of a found AI path as a defect — several rows below are intentional (e.g. Control Plane) or simply not yet reconciled (e.g. `@atlas/worker`'s declared-but-unconfirmed job kinds).

**A. Atlas's own internal apps (`apps/*`)**

| Application | AI execution path | Attribution | Usage | Cost | Outcome | Baseline |
| ----------- | ------------------ | ------------ | ----- | ---- | ------- | -------- |
| `@atlas/api` | `VERIFIED EMPIRICALLY` — `routes/agent-fabric.ts`, `services/llm-specialist-proposal.ts`, `providers/llm.ts` (dispatch/dedup/retry all exercised by existing tests, §33.8) | `VERIFIED EMPIRICALLY` for `ownerId`/`projectId` (unified audit); `taskId` `VERIFIED EMPIRICALLY` for the proposal-backed path only (§33.15.A) | `CALCULABLE FROM REAL DATA` when a real provider call occurs; `UNKNOWN` for any live call (no credentials this session) | Stub path: `VERIFIED EMPIRICALLY` (`$0`, code-level — no provider is ever called). Proposal-backed path: `IMPLEMENTED + TESTED` mechanism; live figure `MISSING` | `VERIFIED EMPIRICALLY` — `AgentRunResult.status` (COMPLETED/SKIPPED/NEEDS_EVIDENCE/FAILED) | `MISSING` (repo-wide, all Applications) |
| `@atlas/web` (Studio) | `MISSING` — confirmed client/HTTP-consumer only (`agents/page.tsx`, `ChatPanel.tsx` call into `@atlas/api`); no AI provider usage is claimed merely from its existence | N/A | N/A | N/A | N/A | N/A |
| `@atlas/admin` | `MISSING` — zero matches for agent-fabric/dispatch/llm/genius this session (confirmed absence, not unexamined) | N/A | N/A | N/A | N/A | N/A |
| `@atlas/control-plane` | `MISSING` — by explicit design (`fabric-projection.ts`: "NOT an execution registry"); Control is not the current implementation focus | N/A | N/A | N/A | N/A | N/A |
| `@atlas/worker` | `OBSERVED BUT NOT FULLY ATTRIBUTED` (**GAP-APP-02**) — `embeddings.generate`/`memory.extract` are declared `WorkerJobKind` values; `processor.ts` only implements `state.reconcile`, other kinds fall through to a generic `job_acknowledged` stub. Whether these kinds are planned-but-unwired or intentionally inert is **not resolved by existing source evidence** — recorded as unresolved, not claimed as dead code or as AI usage | N/A | N/A | N/A | N/A | N/A |

**B. External connected applications (`applicationId`-scoped, §4.1)**

| `applicationId` | AI execution (Atlas visibility) | Attribution | Usage | Cost | Outcome |
| ---------------- | -------------------------------- | ------------ | ----- | ---- | ------- |
| `def-000` (Atlas-self) | Same as `@atlas/api` row above | Same | Same | Same | Same |
| `caseflow` | `VERIFIED EMPIRICALLY` for exactly **one** hop (§29.B, LOCAL RUNTIME VERIFIED, n=1) — not generalized to all CaseFlow traffic | `VERIFIED EMPIRICALLY` for that one hop only | `MISSING` (fields are optional/supplied-only; not confirmed populated in the recorded hop) | `MISSING` (**GAP-APP-03** — `actualCost` not confirmed populated) | `VERIFIED EMPIRICALLY` — `execution: SUCCESS` for that one hop |
| `civio` | `INFERRED FROM CODE` (Gemini FAQ path referenced in §5/§6 G4) — preflight-level only | `IMPLEMENTED + TESTED` (schema) | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| `hotelos` | `INFERRED FROM CODE` (`agent.cio`) | `IMPLEMENTED + TESTED` (schema) | `BLOCKED` (connector env absent, R15) | `BLOCKED` | `BLOCKED` |
| `brokeros` | `INFERRED FROM CODE` (Gemini JSON) | `IMPLEMENTED + TESTED` (schema) | `BLOCKED` (vitest tooling absent, §16) | `BLOCKED` | `BLOCKED` |
| `lexstudy` | `UNKNOWN` | `UNKNOWN` | `BLOCKED` (repo NOT ACCESSIBLE) | `BLOCKED` | `BLOCKED` |
| `vantera` | `UNKNOWN` | `UNKNOWN` | `BLOCKED` (repo NOT ACCESSIBLE) | `BLOCKED` | `BLOCKED` |

**Evidence boundary (explicit, per the master protocol's correction in §7 of the requesting brief):** no valid baseline currently exists for any Application, therefore monetary savings cannot currently be quantified for any Application. This is not a claim that baseline design is impossible — only that it has not yet been done, and no further quantification work is justified until it is.

**Do not generalize:** CaseFlow's one verified hop does not prove any other Application. `@atlas/api`'s dedup/retry evidence does not prove any external Application's behavior. Neither direction of generalization is supported by evidence gathered in Stages 1–5 or this reconciliation.

### 30.3 MASTER EVIDENCE & AI SAVINGS WORK PROTOCOL — 10-Stage Ledger Closure (recorded 2026-09-29)

**Purpose:** §30.2 above is this protocol's own Stage 1 (Existing System Reconciliation). Stages 2–10 were executed in a separate, later reconciliation pass and reported in full at the time, but were never persisted into this document until now. This subsection is that persistence — a consolidated closure record, not a re-derivation. It reuses, and does not duplicate or contradict, the evidence already recorded in §29/§30/§30.1/§30.2/§33.

**Stage 2 — Actual AI Usage & Cost Proof.** `costUsd` computation (`computeCostUsd`, `llm.ts`) is `CALCULABLE FROM REAL DATA` whenever a real provider call occurs; no live provider call was exercised anywhere in this protocol (no credentials in this environment). No provider billing/invoice evidence exists anywhere in the repository. Mocked/fixture transport (all of RES-001's token/cost figures) is not production usage and is never presented as such. Attribution/usage gaps: `AgentRunResult` carries `costUsd`/`durationMs`/`status` but no `taskId`; the audit entry for the proposal-backed dispatch path (`agent-proposal.ts`) carries `taskId`/`projectId`/`agentId` but no `costUsd` — two separate records, no persisted join key. Production monetary savings are therefore not proven for any mechanism.

**Stage 3 — Application Attribution.** Chain evaluated: `Application → Project → Task/Request → Execution → Agent → Provider/Model → Usage → Cost → Outcome`. Internal (`@atlas/api`, proposal-backed): `projectId`/`taskId`/`agentId` verified on the audit entry; `executionId`/provider/model/usage/cost/outcome verified only on the separate `AgentRunResult` — **chain break confirmed between the audit entry and the cost-bearing result, no stored join key.** External (`applicationId`-scoped, e.g. CaseFlow): all fields (`applicationId`/`tenantId`/`projectId`/`decisionId`/`requestId`/`executionId`/optional provider/model/tokens/`modelCallCount`/`retries`/`actualCost`/`currency`/`executionStatus`) co-locate on **one** schema record (`applicationExecutionReportRequestSchema`) and this record is spread verbatim into the hash-chained audit payload when supplied — **structurally, the external chain does not break; evidentially, no application (including CaseFlow) is confirmed to have ever populated the optional usage/cost fields** (GAP-APP-03). CaseFlow's one hop (§29.B) itself could not be independently re-verified in this environment this session — its exact IDs match no fixture, and `.atlas/audit/audit.ndjson` is gitignored/absent from the working tree.

**Stage 4 — Baseline Definition.** No general production monetary baseline exists for any Application. Of the four candidate baseline methods evaluated (matched control, historical, deterministic replay, counterfactual calculation), only matched control (Candidate A) has real supporting evidence, and only within R2/R4's exact tested conditions — it does not generalize to any other request, task, or Application. Deterministic replay (the R2/R4 test fixtures themselves) is explicitly not production baseline evidence. No request/workload-comparability taxonomy exists (the `operationClass` enum that does exist classifies governance risk, not cost comparability — a distinct purpose). Production traffic variance is not represented anywhere in the evidence base. **Status: `INSUFFICIENT_EVIDENCE` for any general Application-level monetary baseline.**

**Stage 5 — Resource Savings Proof.**
- RES-001 (LLM dedup): **`VERIFIED`** — one provider call avoided in the exact tested repeated-request condition (§33.8 R2). The 50% test-case call reduction is not generalized to production traffic.
- RES-002/RES-003 (bounded retry): **`VERIFIED`** as a bounding/ceiling behavior (§33.8 R4) — not represented as proven monetary savings; no "unbounded retry" comparison was ever run (correctly, since that would require disabling a production safety mechanism).
- RES-007 (queue write amplification): **`VERIFIED`** as a measured cost (BENCH-QUEUE-001, §33.15.D — real, executed, single-machine/single-run) — not a saving, since no after-remediation design exists to compare against.
- RES-018 (prefix caching), RES-019 (model routing enforcement), RES-020 (progressive tool disclosure), RES-021 (duplicate retrieval): existing §33.13/§33.15 statuses preserved unchanged; resource behavior (where code-trace-confirmed) is kept explicitly separate from monetary savings evidence, which does not exist for any of the four.

**Stage 6 — Monetary Savings Proof.** **No mechanism and no Application has `VERIFIED` or `CALCULABLE FROM REAL DATA` monetary savings.** RES-001's $0.00105 figure is `ESTIMATED`, fixture-scale, worked-example only — not production spend. No live provider usage was recorded anywhere in this protocol. No provider billing/invoice evidence exists. No production monetary baseline exists (Stage 4). RES-002/003 remains bounded retry behavior, not proven avoided monetary cost. RES-007 remains a measured cost, not a saving. RES-018–021 remain `INSUFFICIENT_EVIDENCE` for monetary impact. The `ACTUAL` / `CALCULATED` / `ESTIMATED` / `MISSING` / `BLOCKED` / `INSUFFICIENT_EVIDENCE` distinction is preserved exactly, per mechanism, without weakening.

**Stage 7 — Successful Outcome Guardrail.** No automatic, code-enforced successful-outcome guardrail exists anywhere in the codebase — every guardrail check performed across this protocol was manual reconciliation by report authors, not a runtime gate. Outcome-relevant fields that do exist: `AgentRunResult.status` (`COMPLETED`/`SKIPPED`/`FAILED`/`NEEDS_EVIDENCE`), `executionStatus` (`SUCCESS`/`FAILURE`), and `ProposalVerificationVerdict` (`VERIFIED`/`FAILED`/`INCONCLUSIVE`, `verify-proposal.ts`) — a distinct axis from `epistemicState` (evidentiary confidence) and from terminal status (task completion). RES-001 has the strongest outcome evidence of any mechanism — a real output-equivalence check (cached-response `usage` deep-equal to the original), not merely a terminal-status check. No other mechanism has general output-equivalence evidence. **Classification: `OBSERVED BUT NOT FULLY ATTRIBUTED`.** No universal automated outcome guardrail is claimed.

**Stage 8 — Longitudinal Measurement.** A durable, append-only historical store exists (`.atlas/metrics/metrics.ndjson`, backing `atlasMetrics`) for a closed set of exactly 10 non-cost metric names (`agent_run_duration`, `tool_failure_rate`, `retrieval_hit_rate`, `memory_write_rate`, `web_verification_rate`, `citation_rate`, `hallucination_eval_rate`, `patch_apply_rate`, `github_webhook_rate`, `http_request_duration_ms`). It does **not** contain any cost, token, dedup-hit-rate, or queue-depth value — extending it to cover these would be an implementation change, not performed here. The in-process rolling ring buffer is not, and was not, treated as longitudinal history in any prior stage. **Cost/savings longitudinal measurement remains `MISSING`, for every mechanism and every Application.**

**Stage 9 — Reproducibility & Auditability.** R2/R4 (§33.8) are deterministic test fixtures, reproducible within their exact documented conditions — not production evidence. BENCH-QUEUE-001 (§33.15.D) remains single-machine/single-run evidence, not independently reproduced. Live provider credentials remain unavailable in this environment. RES-023/F3 (cross-file test isolation) remains an unresolved verification-infrastructure issue. The audit-log hash-chain (`verifyAuditLogChainAt`, `audit-log.ts`) and the metrics-durability mechanism (`metrics-log.ts`) were re-executed during final reconciliation of this protocol: `audit-log.test.ts` 15/15 PASS, `metrics-log.test.ts` 2/2 PASS, combined 17/17 PASS. **This is a verification upgrade to the evidentiary basis of an already-existing mechanism — it is not an implementation change, and no production-wide reproducibility is claimed.**

**Stage 10 — Customer-Claim Readiness.** No production monetary savings claim is currently supported, for any Application. No percentage or dollar savings figure is supported for customer-facing use. The evidence supports only two narrow, mechanism-scoped internal claims: exact-condition LLM-call deduplication (RES-001), and bounded retry behavior (RES-002/003) — neither may be broadened into a general customer savings claim, and no marketing language is derived from either here.

**Consolidated 10-stage status table:**

| Stage | Status | Core conclusion |
| ----- | -------- | ------------------ |
| 1 | `VERIFIED` | Existing system reconciled (§30.2) |
| 2 | COMPLETE / evidence-bounded | Usage/cost mechanism established; no live provider usage recorded |
| 3 | COMPLETE / evidence-bounded | Attribution chain mapped; internal chain-break and external population gap both identified |
| 4 | COMPLETE / `INSUFFICIENT_EVIDENCE` for general baseline | No production monetary baseline exists |
| 5 | COMPLETE | Narrow resource savings verified (RES-001/002/003/007); no monetary conversion |
| 6 | COMPLETE | No `VERIFIED`/`CALCULABLE` monetary savings for any mechanism or Application |
| 7 | COMPLETE / `OBSERVED BUT NOT FULLY ATTRIBUTED` | No automatic outcome guardrail exists |
| 8 | COMPLETE / `MISSING` for cost-savings longitudinal data | Historical metric mechanism exists; cost/savings history absent |
| 9 | COMPLETE / `VERIFIED` for the re-executed audit/metrics mechanism | 17/17 audit-log + metrics tests pass |
| 10 | COMPLETE / evidence-bounded | No customer-facing monetary savings claim is supported |

**Locked conclusions preserved unchanged by this closure (unchanged from Stages 1–6, reconfirmed, not re-argued):** no production monetary savings proven; RES-001's $0.00105 is fixture-scale `ESTIMATED` only; RES-002/003 is bounded retry, not proven monetary savings; RES-007 is measured cost, not proven saving; RES-018–021 have no proven monetary savings; Atlas-internal evidence is not generalized to external Applications; CaseFlow remains its own evidence scope; no live provider usage was recorded; no provider billing/invoice evidence exists; no production monetary baseline exists; deterministic test evidence is not production evidence; no customer-facing percentage/dollar savings claim is established.

**Protocol status:** `10-STAGE MASTER EVIDENCE & AI SAVINGS WORK PROTOCOL — LEDGER CLOSED.` This closure is a documentation record of already-completed, already-reported evidence work. It authorizes nothing further — no baseline implementation, no telemetry, no instrumentation, no remediation, no Stage 11.

### 30.4 GAP-APP-02 / GAP-APP-04 / GAP-APP-05 — Approved Technical Decisions + Minimum Implementation (recorded 2026-09-29)

**Purpose:** following the post-closure Implementation Readiness audit and Decision Gate (both chat-only, not persisted separately), the owner authorized the agent to resolve three specific technical/design ambiguities and implement the smallest additive foundation supporting them. This subsection records the three decisions and the resulting minimal implementation — it does not reopen or reweight any Stage 1–10 conclusion above.

**GAP-APP-05 (workload identity) — decided:** canonical workload identity = `(applicationId, projectId, operationLabel, provider, model)`, a derived tuple, not a new persisted field. `operationLabel` reuses the existing external `operation` string (external path) and the existing `routeLabel` (internal path, e.g. `"agent-fabric.dispatch.code-engineer"`) — no new field was added. Tool/retrieval/retry/cache-state remain explicitly excluded from the identity (post-hoc filters, not taxonomy components). **No taxonomy was implemented** — this is a derivation rule only.

**GAP-APP-04 (task→execution→cost→outcome join) — decided and implemented:** canonical measurement boundary = `executionId`. Implemented as one additive optional field:
- `executionId: uuidSchema.optional()` added to `agentRunResultSchema` (`packages/shared/src/schemas/agent-fabric.schema.ts`).
- `executionId?: string` added to `SubmitAgentProposalOptions` and threaded into the `dispatchAgentAction` audit `input` object (`apps/api/src/services/agent-proposal.ts`), alongside the existing `taskId`.
- `runProposalBackedSpecialist` (`apps/api/src/services/llm-specialist-run.ts`) mints one `executionId` (`crypto.randomUUID()`, the existing repository convention) per execution and carries it on all 5 `AgentRunResult` return paths and into the `submitAgentProposal` call on every path that reaches the gate.
- Join proof: `apps/api/src/services/code-engineer-dispatch.test.ts` — a new test asserts `AgentRunResult.executionId === auditEntry.input.executionId` for a real proposal-backed dispatch (real audit log, real gate, only `fetch` stubbed). **This proves only the structural execution join** — not real provider billing, monetary savings, a production baseline, or external-Application attribution. The external-application schema already had this join structurally (§30.2/§30.3) and required no change.

**GAP-APP-02 (`embeddings.generate`/`memory.extract`) — decided:** **Classification B — intentionally inert.** No embedding-generation or memory-extraction behavior was implemented; no caller was added. A code comment now marks both `WorkerJobKind` values and the generic fallthrough in `processJob()` (`apps/worker/src/jobs/processor.ts`) as deliberate, documented placeholders reserved for a possible future async entry point to the existing `packages/embeddings` / `MEMORY_EXTRACTION` capabilities — not a defect.

**Explicitly not implemented by this work (unchanged, per every locked conclusion above):** real provider usage, real billing, monetary savings calculation, production baseline collection, longitudinal cost storage, RES-023/F3, external Application changes, Control changes, new database tables/measurement entities, new telemetry architecture, model-routing implementation, prefix caching, or any change to `apps/worker/src/queue-persistence.ts` (pre-existing Stage 6.1 WIP, untouched).

---

## 31. Final status language

### IMPLEMENTED / DEMONSTRATED

Control mechanisms that have implementation and test evidence, including selected local runtime evidence: identity, preflight authorization, governance decisions, one CaseFlow execution correlation, failure representation, failure citation, and supplied cost attribution. R01–R03 are verified against real local Postgres. The current audit writer is fixed and tested.

### ENVIRONMENT / PRODUCTION LIMITATIONS

* Vercel + live Postgres end-to-end proof unavailable
* HotelOS genuine runtime unavailable
* repeated FAILURE runtime unavailable
* offsite DR unavailable
* production runtime evidence unavailable

Historical canonical audit remains a HISTORICAL INTEGRITY ISSUE (first break at index 605; verified prefix 0–604). Current writer remains FIXED + TESTED (`audit-log.test.ts` 15/15). The historical file is unchanged.

### BUSINESS OUTCOME STILL UNQUANTIFIED

* cost attribution exists
* execution/cost telemetry exists where supplied
* Control can record model calls, tokens, retries, and actualCost when the application supplies them
* a controlled cost-savings result has not yet been quantified

The unquantified savings result is an evidence boundary, not a new engineering gap.

---

---

## 32. GAP-PERSIST + GAP-GATE — Control Registration Durability and Authorization Gate

**Recorded:** 2026-09-29 | **Session:** `session_011uFzz6ugdabrSwHivkdfg6`

---

### GAP-PERSIST

**Objective:** Make Control Agent Registration (`ControlAgentRegistration`) durable across Control Plane restarts. Replace volatile in-process `Map` with SQLite persistence using Node 22 built-in `node:sqlite`.

**Status:** ✅ CLOSED / VERIFIED — `IMPLEMENTED + TESTED (local)`

**Implementation files:**

| File | Change |
| ---- | ------ |
| `apps/control-plane/src/services/registration-store.ts` | NEW — SQLite persistent store (singleton `DatabaseSync`; schema via `CREATE TABLE IF NOT EXISTS`; `INSERT OR IGNORE` idempotency; all failures throw) |
| `apps/control-plane/src/services/agent-registry.ts` | MODIFIED — `dynamicRegistrations` Map is cache only; SQLite = source of truth; `getAgentRegistration`/`listAgentRegistrations` read from SQLite; added `clearRegistrationCacheOnlyForTests()` |
| `apps/control-plane/src/server.ts` | MODIFIED — `initDynamicRegistrationCache()` before `server.listen()`; `closeRegistrationStore()` on SIGTERM/SIGINT |
| `apps/control-plane/src/__tests__/registration-persistence.test.ts` | NEW — 15 persistence + restart simulation + DB failure tests |
| `.gitignore` | MODIFIED — added `apps/control-plane/control-plane-registrations.db` (the runtime artifact created by registration persistence) |

**Authorization chain invariants (GAP-PERSIST):**

- SQLite written FIRST; in-process Map updated ONLY after successful persist.
- DB failure throws — never silently returns empty state.
- `initDynamicRegistrationCache()` hydrates Map from SQLite at startup; throws if DB cannot open.
- `getAgentRegistration` / `listAgentRegistrations` always read from SQLite.
- `CONTROL_PLANE_DB_PATH` env var controls DB location (production: persistent volume path).
- Default: `./control-plane-registrations.db` (relative to `process.cwd()`).

**DB artifact:** `apps/control-plane/control-plane-registrations.db` — added to `.gitignore` (2026-09-29). Never commit.

**Test evidence (local):**

```
Test Files: 29 passed (29)
Tests:      343 passed (343)
TypeScript: 0 errors
```

**Test evidence (Windows, independent verification):**

```
registration-persistence.test.ts: 15/15 PASS
Full Control Plane regression:     343/343 PASS
TSC:                                PASS
git diff --check:                   PASS
```

**Production verified:** NO — Control Plane (:3100) not running in cloud environment. ENVIRONMENT BLOCKER.

**Live verification:** NOT PERFORMED — see §32.3 (ENVIRONMENT BLOCKER).

---

### GAP-GATE

**Objective:** Convert `controlPlaneRegistered: false` from observational/fail-open telemetry to a hard authorization gate. An agent may be dispatched ONLY when its Control registration is valid. Fail-closed: Control unavailability = DENY.

**Status:** ✅ CLOSED / VERIFIED — `IMPLEMENTED + TESTED (local)` | Live verification: ENVIRONMENT BLOCKER

**Implementation files:**

| File | Change |
| ---- | ------ |
| `apps/api/src/routes/agent-fabric.ts` | MODIFIED — replaced fail-open try/catch block (lines ~339–353) with fail-closed gate; removed `controlNotRegisteredAgents` Set |
| `apps/api/src/routes/agent-fabric.test.ts` | MODIFIED — added `checkControlPlaneAgentRegistration` mock to `control-plane-bridge.js` vi.mock; added describe block "GAP-GATE: Control Registration Authorization Gate" (11 tests) |

**Authorization decision flow (post-GAP-GATE):**

```
POST /api/v1/agents/dispatch
  ↓
requireSignedInForWrite (session auth)
  ↓
authorizeEntityAction("CONFIGURATION", "EXECUTE") → 403 if denied
  ↓
dispatchAgentPlan → specialistOverride (SECURITY/LEGAL_MEDIA_COMMS/CODE_ENGINEER/RESEARCHER):
  1. getDurableAgentRuntimeStatus
  2. lookupControlPlaneAgentRuntimeStatus
  3. combineAgentRuntimeStatus
  4. *** GAP-GATE: checkControlPlaneAgentRegistration(agentId, user.id) ***
       configured: false           → SKIPPED (CONTROL_UNREACHABLE: URL not configured)
       catch (any error)           → SKIPPED (CONTROL_UNREACHABLE: Control check failed)
       status !== CONTROL_REGISTERED → SKIPPED (status name)
       status === CONTROL_REGISTERED → continue
  5. dispatchAgentAction (CASE.EXECUTE) — SKIPPED if denied (SECURITY/LEGAL only)
  6. run specialist
```

**Denial semantics:**

| Condition | Result |
| --------- | ------ |
| `CONTROL_REGISTERED` | ALLOW — dispatch continues |
| `CONTROL_NOT_REGISTERED` | DENY — SKIPPED(`CONTROL_NOT_REGISTERED`) |
| `CONTROL_REVOKED` | DENY — SKIPPED(`CONTROL_REVOKED`) |
| `CONTROL_UNREACHABLE` | DENY — SKIPPED(`CONTROL_UNREACHABLE`) |
| `configured: false` | DENY — SKIPPED(`CONTROL_UNREACHABLE: Control Plane URL not configured`) |
| `checkControlPlaneAgentRegistration` throws | DENY — SKIPPED(`CONTROL_UNREACHABLE: Control check failed`) |
| `isAgentEnabled` / durable runtime DISABLED | DENY — via existing `dispatchAgentAction` gate (fires after GAP-GATE) |
| Not in `FABRIC_AGENT_IDS` | DENY — 400 (existing gate, fires before GAP-GATE) |

**GAP-GATE tests added (11 cases):**

| # | Test | Asserts |
| - | ---- | ------- |
| 1 | registered + valid + enabled → ALLOW | `run.status === "COMPLETED"` (not SKIPPED) |
| 2 | unregistered → DENY | `run.status === "SKIPPED"`, `summary` matches `CONTROL_NOT_REGISTERED` |
| 3 | inactive/revoked → DENY | `run.status === "SKIPPED"`, `summary` matches `CONTROL_REVOKED` |
| 4 | Control unavailable (CONTROL_UNREACHABLE) → DENY | `run.status === "SKIPPED"`, `summary` matches `CONTROL_UNREACHABLE` |
| 5 | Control not configured → DENY | `run.status === "SKIPPED"`, `summary` matches `CONTROL_UNREACHABLE` |
| 6 | PSA owner matches → ALLOW | `run.status === "COMPLETED"`, called with `user.id` |
| 7 | PSA owner mismatch → DENY | `run.status === "SKIPPED"` |
| 8 | disabled Fabric + valid Control → DENY | `run.status === "SKIPPED"` (dispatchAgentAction DENIED) |
| 9 | unknown/non-Fabric agent → DENY | 400 or SKIPPED |
| 10 | Control throws → no fall-through | `run.status === "SKIPPED"`, specialist never called |
| 11 | existing CONFIGURATION.EXECUTE denial → 403 | 403 FORBIDDEN (pre-existing gate preserved) |

**Test evidence (local):**

```
Test Files: 1 passed (1)
Tests:      48 passed (48)  (37 pre-existing + 11 GAP-GATE)
TypeScript: 0 new errors in agent-fabric.ts / agent-fabric.test.ts
```

**Existing protections:**
- ✅ `FABRIC_AGENT_IDS` — not modified
- ✅ `isAgentEnabled` / durable runtime status — not modified
- ✅ `authorizeEntityAction` Policy Engine — not modified
- ✅ `dispatchAgentAction` (CASE.EXECUTE) — not modified
- ✅ GAP-PERSIST (343/343) — no regression

**Not committed / not pushed.** Uncommitted changes are expected and authorized per directive. Do not commit without separate authorization.

---

### 32.3 Live Control Verification

**Status:** ⛔ ENVIRONMENT BLOCKER

**Attempted:** 2026-09-29 from cloud container.

**Evidence:**

```
curl -sv --max-time 3 http://127.0.0.1:3100/api/v1/status
→ connect to 127.0.0.1 port 3100 failed: Connection refused

curl -sv --max-time 3 http://127.0.0.1:4000/api/v1/status
→ connect to 127.0.0.1 port 4000 failed: Connection refused

ps aux | grep node → no Control Plane or API processes running
```

**Classification:** ENVIRONMENT BLOCKER — Control Plane (:3100) and Atlas API (:4000) are not running in this cloud container. The live Windows environment is not reachable from here. Live verification requires running both servers locally on the Windows machine where `ATLAS_CONTROL_PLANE_URL=http://127.0.0.1:3100` is accessible.

**Live verification not performed:**

| Verification | Status |
| ------------ | ------ |
| Control Plane status endpoint | ⛔ ENVIRONMENT BLOCKER |
| `/api/v1/agents/:id/registration` API | ⛔ ENVIRONMENT BLOCKER |
| Positive dispatch (CONTROL_REGISTERED → allowed) | ⛔ ENVIRONMENT BLOCKER |
| Negative dispatch (unregistered → denied) | ⛔ ENVIRONMENT BLOCKER |
| Negative dispatch (Control unavailable → denied) | ⛔ ENVIRONMENT BLOCKER |
| Negative dispatch (owner mismatch → denied) | ⛔ ENVIRONMENT BLOCKER |

**Next action for live verification (separate authorization required):** Start Control Plane (`pnpm --filter @atlas/control-plane dev`) and API (`pnpm --filter @atlas/api dev`) on the Windows machine, register/unregister agents, then issue dispatch requests to prove positive and negative paths against the live gate.

---

## 33. GAP-RESOURCE — AI Resource Efficiency, Automation & Cost-Control Verification

**Recorded:** 2026-09-29

**Status:** 🔶 Per-stage status (kept explicitly separate — do not merge these into one claim):

| Stage | Status |
| ----- | ------ |
| Stage 1 — Repository/architecture audit | COMPLETE |
| Stage 2 — Telemetry/observability audit | COMPLETE |
| Stage 2.5 — Source-of-truth placement | COMPLETE |
| Stage 3 — Controlled baseline measurement | **BASELINE PARTIALLY VERIFIED** |
| Stage 4 — Gap/waste classification + deep research/benchmark | **DEEP RESEARCH + GAP ANALYSIS COMPLETE** (analysis only — this is not a production-efficiency proof; it does not upgrade Stage 3's status) |
| Stage 5 — Targeted benchmarks + evidence-driven remediation design | **TARGETED BENCHMARKS COMPLETE / REMEDIATION DESIGN ONLY** (one real executed benchmark — queue write amplification; remaining candidates code-trace-confirmed or explicitly BENCHMARK BLOCKED/NOT OBSERVABLE; no implementation) |
| Stage 6 — Implementation | **NOT STARTED** |

Do not read this section as a closed gap. Do not upgrade any of the above to VERIFIED / COMPLETE / CLOSED / PRODUCTION VERIFIED for the underlying resource-efficiency claim — R1 and R3 live-provider paths remain environment-blocked, R5 production-scale write amplification remains unmeasured, and Stage 4's research/gap-analysis completeness does not imply that ArletOS's production resource usage has been proven efficient.

### 33.1 Purpose

Evidence-first verification of whether Atlas/ArletOS uses AI, compute, database, network, and automation resources in a controlled, efficient, measurable way. The goal of this section is to prove or disprove efficiency with evidence — an agent claim (a cache exists, a limiter exists) is never accepted as verification on its own. Standard: `Implementation → Execution → Measurement → Evidence`.

### 33.2 Scope

AI/LLM invocations, agent orchestration/dispatch, automation (background workers, polling, scheduled jobs), caching and reuse, context size sent to agents, database access, network/API calls, compute/runtime lifecycle, cost controls, and failure amplification. Out of scope for this section: redesigning Atlas/Studio/Control, new product features, database migration, provider replacement, speculative caching, or optimizing for benchmark numbers alone.

**Scope note:** this document's own header states it is the authoritative Control remediation register, scoped to Control governance. GAP-RESOURCE spans Fabric agent dispatch, LLM providers, and the worker queue — areas broader than Control's declared ownership boundary. It is recorded here per explicit owner direction rather than as a Control-governance claim. **See also §29/§30** (Control Outcome / Cost Efficiency Evidence, 2026-09-23), which covers cost attribution for **external connected applications** (`applicationId`-scoped, e.g. CaseFlow) — a distinct data path from this section's Atlas-**internal** Fabric dispatch usage. §30.1's Evidence Matrix (2026-09-29) reconciles both.

### 33.3 Existing Controls (Stage 1 audit — read-only, no code modified)

| Mechanism | File | What it bounds |
| --------- | ---- | --------------- |
| LLM call dedup cache | `packages/agent-core/src/providers/llm.ts` | 45s TTL (`DEDUP_TTL_MS`), 200-entry cap (`MAX_DEDUP_CACHE_ENTRIES`), keyed on `(provider, model, normalized messages)` |
| Rolling per-model cost/latency/error tracker | `packages/agent-core/src/providers/llm.ts` | Fixed 20-call ring buffer per model id (`ROLLING_WINDOW_SIZE`), no persistence across restarts |
| Provider call retry/backoff | `packages/agent-core/src/providers/llm.ts` | `MAX_PROVIDER_CALL_ATTEMPTS=3`, `RETRY_DELAY_BASE_MS=50`, `RETRY_DELAY_CAP_MS=1000` |
| Worker job retry/backoff | `apps/worker/src/index.ts` | `MAX_JOB_ATTEMPTS=3`, exponential `backoffMs = 1000 * 2^(retryCount-1)` |
| Worker durable queue | `apps/worker/src/queue-persistence.ts` | Crash-recovery JSON file, atomic rename-based write; full-file rewrite on every job state change (see §33.6) |
| Kill switches (category circuit breaker) | `packages/agent-core/src/policies/kill-switches.ts`, `apps/api/src/services/kill-switch-runtime.ts` | `agentDispatch` / `payments` / `webhooksInbound` / `webhooksOutbound` / `aiWorkers`; env-baseline ∪ durable runtime override, checked before dispatch |
| Delegation hop cap | `packages/shared/src/constants/operating-cycle.ts` | `MAX_DELEGATION_HOP_COUNT=10` — bounds agent A→B→C recursion |
| Global HTTP rate limit | `apps/api/src/create-app.ts` | `@fastify/rate-limit`, 300 req/min |
| Auth-endpoint rate limit | `apps/api/src/services/auth-rate-limit.ts` | In-process sliding window per key; opportunistic cleanup at 5,000 buckets |
| Agent memory/plan budgets | `apps/api/src/routes/agent-fabric.ts` | `AGENT_MEMORY_BUDGET=12`; per-request `budgetUsd`/`maxAgents` on `planAgentWork` |
| In-process event bus dedup | `packages/agent-core/src/events/event-bus.ts` | `seenEventIds` prevents re-dispatch of the same `event.id` |
| Periodic CP→API audit sync | `apps/control-plane/src/services/audit-sync.ts` | 30s interval; errors swallowed, retried next tick only |
| Verified-knowledge refresh interval | `apps/api/src/services/verified-knowledge-refresh.ts` | 24h interval (`KNOWLEDGE_REFRESH_INTERVAL_MS`) |

### 33.4 Observable Metrics (measurable now, Stage 2 classification)

| Metric | Source | Notes |
| ------ | ------ | ----- |
| LLM call count / latency / rolling cost per model | `getModelRollingStats()` / `getAllModelRollingStats()` (`llm.ts`) | In-process only, 20-call window, resets on restart |
| HTTP request duration | `atlasMetrics` (`http_request_duration_ms`) | Ring buffer (cap 2000) + durable NDJSON tail; Prometheus-exported |
| Agent run duration | `atlasMetrics` (`agent_run_duration`) | Recorded at plan/dispatch call sites |
| Memory retrieval hit rate | `atlasMetrics` (`retrieval_hit_rate`) | Recorded at plan/dispatch call sites |

### 33.5 Partially Observable Metrics

| Metric | Limitation |
| ------ | ---------- |
| LLM dedup cache hit rate | `LlmCallResult.cacheHit` exists per call; nothing aggregates it into a hit-rate metric |
| Worker queue depth / age / retry history | `getQueueStats()` gives a point-in-time snapshot only; no historical time series |

### 33.6 Non-Observable Metrics (explicit gaps — never inferred as zero)

- Per-agent token consumption — **NOT OBSERVABLE**
- Per-project token consumption — **NOT OBSERVABLE**
- DB / file-store query count and latency (SQLite registration store, worker queue JSON file) — **NOT OBSERVABLE**
- Kill-switch activation history (frequency, duration over time) — **NOT OBSERVABLE**
- Cross-call retry/failure amplification (retry storms spanning multiple call sites) — **NOT OBSERVABLE**
- Live paid-provider (Anthropic/OpenAI/Gemini) network token/cost usage — **NOT OBSERVABLE** (ENVIRONMENT-BLOCKED: no provider credentials in this environment; not a product failure)
- Live LLM-backed specialist dispatch cost (Sentinel/CODE_ENGINEER/RESEARCHER via a real provider) — **NOT OBSERVABLE** (ENVIRONMENT-BLOCKED: requires a running API server + provider credentials, not exercised in Stage 3)
- Production-scale worker-queue write-amplification impact — **NOT OBSERVABLE this pass** (see §33.7 RES-CANDIDATE-1 — risk identified, not yet measured)
- Historical (time-series) queue depth/age — **NOT OBSERVABLE** (only point-in-time `getQueueStats()` snapshots exist)

### 33.7 Known Risks / Gaps (identified, not yet measured)

- **RES-CANDIDATE-1 — Worker queue full-file JSON rewrite:** `queue-persistence.ts` rewrites the entire queue file on every enqueue/state change. Classification: **RISK IDENTIFIED, NOT YET MEASURED** — do not claim inefficiency until Stage 3 measures it under a representative job volume.
- **RES-CANDIDATE-2 — No per-agent/per-project cost-budget enforcement:** `maxCostUsd` exists on the Fabric catalog definition and rolling cost stats exist per model, but no call site was found that denies dispatch for exceeding a cost budget. Classification: **NOT FOUND** (absence of enforcement, not a measured failure).

### 33.8 Stage 3 — Controlled Baseline Evidence (executed 2026-09-29)

Method: existing, unmodified test files exercised against the real production code paths (`packages/agent-core/src/providers/llm.test.ts`, `packages/agent-core/src/orchestrator/dispatch.test.ts`, `apps/worker/src/index.test.ts`, `apps/worker/src/queue-persistence.test.ts`). No source file, test file, or configuration was changed to produce this evidence. Where a genuine live/paid-provider call would be required, this is recorded as ENVIRONMENT-BLOCKED / NOT OBSERVABLE, never estimated.

**R1 — Simple LLM request — PARTIALLY VERIFIED**
Verified: `context-echo-free` genuine (non-mocked) execution; zero token/cost usage is genuine for this provider (never calls a billed API); no errors; 1–7ms harness timing; provider parsing/token-cost math independently verified through `AnthropicProvider`/`OpenAiCompatibleProvider`/`GeminiProvider` tests (mocked transport only).
Not verified: live paid-provider network execution; real production token consumption; real paid-provider cost.
Classification: **ENVIRONMENT-BLOCKED / NOT OBSERVABLE** — no provider credentials are available in the current environment. Not a product failure.

**R2 — Identical repeated request / dedup — VERIFIED**
Evidence: 2 logical calls → 1 actual provider call, 1 cache miss, 1 cache hit; identical result (`usage` deep-equal) returned from cache; a different message correctly bypasses dedup (2/2 provider calls); a different model correctly bypasses dedup (2/2 provider calls); TTL expiry (46s > 45s `DEDUP_TTL_MS`) correctly bypasses dedup (2/2 provider calls); a cache hit does not double-record rolling model cost statistics (`sampleSize === 1` after 2 identical calls).
Conclusion: **Deduplication is empirically verified under its designed conditions.**

**R3 — Agent dispatch — PARTIALLY VERIFIED**
Verified: dispatch executes (`dispatchAgentPlan`); the stub specialist path genuinely has zero provider cost (`costUsd === 0` for every run, no provider ever called); a supplied specialist cost (`0.0042`) is preserved unchanged through the run record; the disabled-agent gate (AD-1) prevents specialist execution while keeping audit claims/evidenceRefs present; all 8 `dispatch.test.ts` cases passed, including the Civio-scope knowledge-isolation path.
Not verified: live LLM-backed Sentinel/CODE_ENGINEER/RESEARCHER dispatch; real provider cost attribution through the live specialist path.
Classification: **ENVIRONMENT-BLOCKED / NOT OBSERVABLE** — requires a running API server + provider credentials, not exercised this pass. Do not call the live path broken.

**R4 — Controlled failure/retry — VERIFIED**
Provider layer: a transient `fetch failed` retries and succeeds (2 calls); a transient 503 retries and succeeds (2 calls); a 401 does not retry (1 call); `MAX_PROVIDER_CALL_ATTEMPTS=3` is the observed ceiling; the final error surfaces to the caller after exhaustion; `completeWithFreeFallback` falls through to the free provider instead of throwing; retry delay stays ≤1000ms even at attempt 10 with maximum jitter.
Worker layer: a transient job failure retries and succeeds (`processJobMock` called exactly 2 times, zero error logs); a permanently-failing job reaches `MAX_JOB_ATTEMPTS=3`, is dead-lettered, and is dropped from the queue (`queueLength()→0`, exactly 1 `error` log, exactly 2 `warn` logs) — verified in isolation (see F3).
Conclusion: **Retry behavior is empirically bounded at both provider and worker layers.**

**R5 — Queue behavior — PARTIALLY VERIFIED**
Verified: empty-queue state is genuinely zero (`getQueueStats()`); persistence to disk with atomic rename (zero leftover `.tmp` files); reload returns the persisted job; the same job id upserts instead of duplicating (exactly 1 row on disk after 2 persists with different `retryCount`); `RUNNING` jobs recover to `PENDING` after reload; `cleanupOldJobs` keeps active jobs + newest terminal jobs and discards the rest; a corrupt queue file fails safely to an empty queue rather than crashing.
Not yet measured: production-scale full-file rewrite / write-amplification impact under a representative job volume; historical (time-series) queue depth/age.
Classification: **RISK IDENTIFIED, NOT YET MEASURED** for the write-amplification question — do not describe the full-file rewrite as a confirmed performance defect.

**F3 — Cross-file test isolation (verification/test-infrastructure finding, separate from the R1–R5 results above)**
Observed: running `apps/worker/src/index.test.ts` together with the other 3 Stage-3 test files in one `vitest` invocation produced 2 failures (a timeout and a call-count mismatch); running `apps/worker/src/index.test.ts` alone reproduces 5/5 passes; the failure does not reproduce in isolation.
Classification: **VERIFICATION / TEST-INFRASTRUCTURE ISSUE.** Not a production defect — not fixed during Stage 3; no test, timer, retry, or timeout was modified to hide it. Recorded as a remediation candidate only (§33.10).

### 33.9 Verification Criteria

Evidence classes follow the same vocabulary already defined at the top of this document (`IMPLEMENTED + TESTED`, `VERIFIED LOCAL`, `ENVIRONMENT BLOCKED`, etc.). Per-scenario classification is recorded in §33.8 above: R2 and R4 are VERIFIED; R1, R3, and R5 are PARTIALLY VERIFIED (each with an explicit, named limitation, never inferred). GAP-RESOURCE as a whole remains **BASELINE PARTIALLY VERIFIED** — not VERIFIED, COMPLETE, CLOSED, or PRODUCTION VERIFIED.

### 33.10 Remediation Status

Not started. See §33.12 (Stage 4 Gap/Waste Register) for the classified candidate list. No item below has been implemented or authorized.

### 33.12 Stage 4 — Gap / Waste Register (analysis only, executed 2026-09-29)

Classification of every finding recorded in §33.3–§33.8, using only Stage 1–3 evidence already collected. No new measurement was performed for Stage 4. No finding already established (§33.8) is reclassified here — this register only sorts existing evidence into a waste/gap register per the audit's own §15 classification scheme.

| ID | Area | Current behavior | Evidence | Classification | Demonstrated impact | Missing evidence | Measurement required? | Remediation justified now? | Proposed next step |
| -- | ---- | ----------------- | -------- | -------------- | -------------------- | ----------------- | ---------------------- | ---------------------------- | -------------------- |
| RES-001 | AI/LLM | LLM call dedup cache serves a repeated identical call from cache instead of re-invoking the provider | R2 (§33.8): 2 logical calls → 1 provider call, 1 hit, 3 negative controls correct | VERIFIED / WORKING | Yes — 50% call reduction demonstrated for the exact repeated-call case | None | No | No — already working | None; no action |
| RES-002 | AI/LLM | Provider call retry stops after 3 attempts, backoff capped ≤1000ms, non-retryable 4xx fails fast | R4 (§33.8) | VERIFIED / WORKING | Yes — bounded retry demonstrated, no runaway | None | No | No | None; no action |
| RES-003 | Automation | Worker job retry stops after `MAX_JOB_ATTEMPTS=3`, permanently-failing jobs are dead-lettered and dropped | R4 (§33.8) | VERIFIED / WORKING | Yes — bounded retry demonstrated at the worker layer | None | No | No | None; no action |
| RES-004 | AI/Cost | Stub specialist path never calls a provider; `costUsd` is genuinely 0, not a placeholder | R3 (§33.8) | VERIFIED / WORKING | Yes | None | No | No | None; no action |
| RES-005 | AI/Cost | A real specialist's supplied cost is preserved unchanged through the dispatch run record | R3 (§33.8) | VERIFIED / WORKING | Yes | None | No | No | None; no action |
| RES-006 | Database/Persistence | Worker queue persists atomically, upserts by job id, recovers `RUNNING`→`PENDING`, cleans up terminal jobs, fails safe on a corrupt file | R5 (§33.8) | VERIFIED / WORKING | Yes | None | No | No | None; no action |
| RES-007 | Database/Persistence | `queue-persistence.ts` rewrites the entire queue file on every enqueue/state change | §33.3, §33.7 (RES-CANDIDATE-1) | RISK REQUIRING MEASUREMENT | Suspected only — no representative-volume timing collected | Write latency / CPU under realistic job counts (e.g. 1k/10k rows) | Yes | Not yet — no measured cost to justify a redesign | Run a representative-volume timing measurement before considering any persistence-strategy change |
| RES-008 | Cost Control / Governance | `maxCostUsd` exists per Fabric agent catalog entry and rolling per-model cost stats exist, but no call site denies dispatch for exceeding a cost budget | Stage 1 audit (§33.3, §33.7 RES-CANDIDATE-2) — absence confirmed by repository search, not a runtime test | REAL CONTROL / OBSERVABILITY GAP | Suspected only — no incident or overspend demonstrated; this is an absent control, not a proven failure | A concrete per-agent/per-project cost-attribution mechanism (RES-012) must exist before enforcement can be designed | Yes (needs RES-012 first) | Not yet — no attribution data exists to enforce against | Design cost attribution (RES-012) before any budget-enforcement work |
| RES-009 | AI/Cost | Live paid-provider (Anthropic/OpenAI/Gemini) network call was not exercised | R1 (§33.8) | ENVIRONMENT-BLOCKED | N/A — blocked, not measured | Provider credentials + network egress in a controlled low-cost environment | Yes, when credentials are available | No — cannot remediate an unmeasured environment gap | Schedule a controlled live-provider pass under RES-CANDIDATE-5 when authorized |
| RES-010 | AI/Agent Orchestration | Live LLM-backed specialist dispatch (Sentinel/CODE_ENGINEER/RESEARCHER) was not exercised | R3 (§33.8) | ENVIRONMENT-BLOCKED | N/A — blocked, not measured | Running API server + provider credentials | Yes, when environment is available | No | Schedule alongside RES-009 |
| RES-011 | Observability | Queue depth/age telemetry is a point-in-time snapshot only; no historical series exists | §33.5, R5 (§33.8) | REAL OBSERVABILITY GAP / NOT OBSERVABLE | Suspected only — no incident traced to this gap | A time-series store or periodic snapshot log for queue stats | Only if this becomes operationally needed | No — no demonstrated need yet | Defer; revisit if queue-related incidents occur |
| RES-012 | Observability / Cost | No per-agent or per-project token/cost attribution exists anywhere in the codebase | §33.6 | REAL OBSERVABILITY GAP / NOT OBSERVABLE | Suspected only — this blocks RES-008 but no cost incident is demonstrated | Token/cost tagging at the call site, threaded to agentId/projectId | Yes — prerequisite for RES-008 | No — instrumentation design work, not a code defect fix | Design instrumentation before any budget-enforcement work |
| RES-013 | Database | No query-count/latency instrumentation exists on the SQLite registration store or the worker queue JSON file | §33.6 | REAL OBSERVABILITY GAP / NOT OBSERVABLE | Suspected only — no slow-query incident demonstrated | Timing wrapper around file/DB I/O | Only if an incident or RES-007 measurement shows a need | No | Defer; consider only if RES-007 measurement shows a real bottleneck |
| RES-014 | Observability / Governance | Kill-switch activation is queryable as current state only; no time-series of activation history exists | §33.6 | REAL OBSERVABILITY GAP / NOT OBSERVABLE | Suspected only — minor, no incident demonstrated | Activation/deactivation event log | No — low priority | No | Defer |
| RES-015 | Automation / Reliability | No mechanism aggregates retries across call sites to detect cross-call retry/failure amplification (e.g. a provider retry storm compounding with a worker retry storm) | §33.6 | REAL OBSERVABILITY GAP / NOT OBSERVABLE | Suspected only — each layer's retry is individually bounded (RES-002/RES-003) and no cross-layer amplification incident is demonstrated | A correlated view across provider-call and job-retry logs | Only if a real incident suggests compounding retries | No | Defer; RES-002+RES-003 already bound each layer independently |
| RES-016 | Observability | `LlmCallResult.cacheHit` exists per call but nothing aggregates it into a hit-rate metric | §33.5 | REAL OBSERVABILITY GAP (minor) | No — dedup itself is already proven working (RES-001); this is a missing dashboard metric, not a functional gap | An aggregation of `cacheHit` into `atlasMetrics` | No — optional | No | Optional low-effort addition; not required for GAP-RESOURCE closure |
| RES-017 | Governance / Cost Control | Kill switches, global/auth rate limits, delegation hop cap, and agent memory/plan budgets are implemented and each has its own pre-existing test file (e.g. `kill-switches.test.ts`) | Stage 1 audit (§33.3) — code + existing test files; **not re-executed as part of the Stage 3 R1–R5 baseline** | NOT A PROBLEM / NO ACTION REQUIRED | Yes, per each mechanism's own existing test suite (not re-verified this session) | None for GAP-RESOURCE purposes | No | No | None; out of GAP-RESOURCE scope — these are pre-existing, independently tested controls |
| RES-F3 | Verification / Test Infrastructure | Running `apps/worker/src/index.test.ts` together with 3 other files in one `vitest` invocation produced 2 failures; the same file passes 5/5 in isolation | F3 (§33.8) | VERIFICATION / TEST-INFRASTRUCTURE ISSUE | Yes — reproducible test-isolation defect, but explicitly not a production defect | Root cause (likely module-level `queue` array or fake-timer state shared across files in the same vitest worker) | Yes — needs a root-cause investigation, not a guess-fix | Not yet — root cause not established | Investigate root cause under a dedicated test-infrastructure task, separate from any production remediation |

**Functional summary (per the audit's required questions):**
- **What does the system currently do?** — See "Current behavior" column per row; no finding above describes new system behavior beyond what §33.3/§33.8 already recorded.
- **What evidence proves it?** — See "Evidence" column; all evidence is Stage 1 (static code audit) or Stage 3 (real, unmodified test execution) — nothing in this register is inferred or estimated.
- **Is there measurable waste?** — Only RES-007 (queue full-file rewrite) is a candidate for waste, and it remains unmeasured — no row in this register claims demonstrated waste.
- **Category per row:** AI usage (RES-001, 002, 004, 005, 009, 010), automation (RES-003, 015), observability (RES-011–014, 016), governance/cost control (RES-008, 017), database (RES-006, 007, 013), verification (RES-F3).
- **Demonstrated vs. suspected impact:** RES-001–006 are demonstrated (VERIFIED). RES-007, 008, 011–016 are suspected only — explicitly not escalated to "confirmed waste" without measurement, per the audit's own rule against inferring impact from absent telemetry.
- **Fixable now vs. needs measurement first:** RES-001–006 need no fix (already correct). RES-007, 008, 012 explicitly require measurement/design work before any remediation is justified. RES-009/010 require an available environment, not a code fix. RES-F3 requires root-cause investigation before any test change.

### 33.13 Stage 4 Deep Research + Benchmark (executed 2026-09-29)

**Methodology limitation, stated up front:** this environment has no live web-search tool — only direct URL fetch. Two real, current (fetched 2026-09-29), stable vendor sources were retrieved in full for prompt/context caching (§33.13.A). The remaining 23 research topics in the requesting spec (semantic caching beyond exact-match, model routing literature, multi-agent coordination overhead, retrieval efficiency, etc.) were **not independently verified against a live external source this pass** — no arXiv ID or third-party benchmark URL was guessed or fabricated, per the "do not generate or guess URLs" safety rule. Where general software-engineering knowledge is used below without a fetched citation, it is explicitly labeled "engineering judgment, not a cited source" and is never presented as a measured external benchmark.

#### A. External research evidence — EXTERNAL / VENDOR DOCUMENTATION ONLY (not an ArletOS benchmark)

**Explicit discipline:** every number in the table below is a vendor-reported figure from the vendor's own documentation, fetched directly (no search engine, no third-party aggregator). These are **external reference points only**. No claim is made, implied, or should be inferred that ArletOS achieves, could achieve, or has been measured against, any percentage below. Any figure not directly present in the fetched page text is marked UNVERIFIED rather than restated from memory.

| # | Source | Date fetched | Mechanism | Vendor-reported measurement | Workload/context | Limitation | Relevance to ArletOS |
| - | ------ | ------------ | --------- | ------------------------------ | ------------------ | ----------- | ----------------------- |
| 1 | Anthropic, "Prompt caching" (platform.claude.com/docs) | 2026-09-29 | Cache prefix (tools→system→messages) written once, read on subsequent matching requests within a 5-min (or 1h) TTL | Cache reads billed at 0.1× base input price (0.025×–0.05× on some models); cache writes 1.25×–2× base | Vendor-documented pricing table, not an independent benchmark | Vendor-published, not third-party peer-reviewed; no ArletOS-specific measurement | ArletOS's own LLM dedup cache (`llm.ts`, 45s TTL) is a narrower, exact-match variant of the same idea — full prefix caching (partial-prefix reuse across non-identical prompts) does not exist in ArletOS |
| 2 | OpenAI, "Prompt caching" (developers.openai.com/api/docs) | 2026-09-29 | Implicit/explicit cache breakpoints on prompt prefix; KV-state reuse | Cache reads at 0.1× input rate; vendor examples report ~70% (single-turn judge) and >90% (multi-turn agent) token cache-hit rates in their own illustrative deployments | Vendor-documented examples, explicitly labeled "illustrative," not audited | Same caveat as above — vendor's own numbers, not independently reproduced | Confirms the pattern ("cache the growing/append-only prefix, not just exact repeats") is the more mature technique vendors report — ArletOS's dedup cache only catches byte-identical repeats, not growing-conversation reuse |

**Conclusion from A (external reference only — no ArletOS inference):** the *concept* of prompt/context caching is documented by two primary vendors with real, vendor-reported (not third-party-audited, not ArletOS-measured) numbers. ArletOS implements a materially narrower version of the same underlying idea (exact-match, short-TTL dedup, not prefix/KV caching). This is recorded as an architectural reference point only — see RES-018, classified as a **POTENTIAL SAVING**, not a proven one; ArletOS is not claimed to be capable of, or in need of, the vendor-reported percentages above.

#### B. Reference Efficiency Model (synthesis — Part B, no external citation required)

| Category | What should be measured | What should be controlled | Waste indicator | Healthy indicator | Evidence required |
| -------- | ------------------------ | --------------------------- | ----------------- | -------------------- | -------------------- |
| A. Token efficiency | tokens/request, tokens/successful task | max tokens/request, prefix reuse | repeated identical prefixes reprocessed every call | rising cache-hit ratio over time | token usage log with cache-hit flag |
| B. Context efficiency | context size sent to model/agent | context budget, truncation policy | context grows unbounded across turns | context size stable or bounded per turn | context-size metric per call |
| C. Tool efficiency | tool calls/task, duplicate tool calls | tool-call budget/session | same tool+args called >1x with no state change | tool calls monotonically necessary | tool-call log with args hash |
| D. Model efficiency | model tier chosen vs. task complexity | routing policy consulted at call time | cheap task on expensive model (or vice versa causing retries) | tier matches complexity; demotion on cost/error drift | routed model id logged alongside actual provider call |
| E. Agent orchestration efficiency | agent count/task, redundant specialist dispatch | max agents/plan, budget | 2 agents doing overlapping work with no distinct evidence requirement | each agent's evidenceRequirements are disjoint/complementary | plan diff across agents |
| F. Retrieval/memory efficiency | retrieval calls/task, hit rate | retrieval budget, embedding cache | same query embedded repeatedly | embeddings cached/reused across calls with unchanged corpus | embedding cache hit log |
| G. Queue/background efficiency | job count, retry count, queue age | max retries, backoff cap | jobs looping without termination | bounded retries, dead-letter on exhaustion | queue stats + retry log |
| H. Network efficiency | outbound calls/task, duplicate requests | timeout, dedup | identical request fired twice concurrently | single in-flight request per key | request log with dedup key |
| I. Database efficiency | queries/task, query latency | connection/query budget | N+1 query pattern | O(1) or O(log n) queries per task | query count instrumentation |
| J. Retry/failure efficiency | retries/task, backoff growth | max attempts, backoff cap | retries growing unbounded or retrying non-transient errors | bounded, error-class-aware retry | retry log with error classification |
| K. Cost attribution | cost/agent, cost/project, cost/user | attribution key present on every billed call | cost recorded with no owner | every billed call attributable to agent+project+user | billing record schema |
| L. Budget enforcement | requests denied for exceeding budget | budget check before dispatch | budget field exists but nothing reads it before executing | dispatch denied when budget exceeded, with audit entry | denial log referencing the budget check |
| M. Observability | token/cost/latency exposed via metrics/dashboard | persisted, queryable metrics | metrics exist only as fire-and-forget counters | metrics queryable historically, not just in-process | metrics store + query endpoint |
| N. Cost per successful outcome | cost ÷ successful completions | none directly — a derived ratio | numerator (cost) tracked, denominator (success) not correlated | cost and outcome joined on the same task id | task id present on both cost and outcome records |

#### C. Deep ArletOS Audit — corrections and additions to §33.3 (traced execution paths, not keyword search)

This subsection **corrects and extends** §33.3 based on deeper tracing this pass. Nothing in §33.1–§33.12 is invalidated; these are additions.

1. **Generic response cache — previously missed.** [apps/api/src/services/response-cache.ts](apps/api/src/services/response-cache.ts): a real LRU+TTL `ResponseCache` class with hit/miss/eviction stats, exposed via `readCache` singleton and a `cached()` helper. **On the production path:** confirmed consumer at [apps/api/src/routes/performance.ts](apps/api/src/routes/performance.ts) (`readCache.stats()`, `readCache.clear()`). §33.3 previously stated "no HTTP/DB response cache found elsewhere" — **that statement is corrected here**: a generic cache exists and is wired to at least the performance-stats route. Whether any *expensive read* route actually calls `cached()` to wrap its own query (as opposed to just exposing the cache's stats) was not separately traced this pass — **BENCHMARK REQUIRED** to confirm real hit traffic vs. an unused/idle cache instance.
2. **Model routing by task complexity — exists, tested, cost-aware, but NOT proven wired to actual model selection.** [packages/agent-core/src/router/genius.ts](packages/agent-core/src/router/genius.ts)'s `geniusRoute()` computes a real `modelHint` (`cheap`/`strong`/`vision`/`local`/`multi+human`) from the request text, and demotes `strong`→`cheap` using **real rolling cost/error stats** from `getAllModelRollingStats()` (not a hypothetical — `genius.test.ts` has 17 real assertions against injected stats). Call sites confirmed: `kernel/task-plan.ts`, `orchestrator/plan.ts`, `kernel/evaluation.ts`. **Gap:** grepping every use of `modelHint` across `apps/api/src` found only an unrelated field of the same name (`catalog.modelHint` in `routes/agent.ts`/`routes/conversation.ts`, a static per-catalog-entry model string for a different, marketplace-style feature) — **no call site was found that reads `AgentPlan.modelHint`/`TaskPlan.modelHint` (the genius.ts routing decision) and uses it to select which provider/model `llm.ts` actually calls** for a dispatched specialist. The routing decision is computed, tested, and returned to the API caller as metadata (`routerHints`) — but is **not demonstrated to be enforced** at the point where a real LLM call happens. This is exactly the audit's own warning: "has a router" ≠ "routes."
3. **Tool-call runtime — real timeout cancellation, no session-wide tool-call budget found.** [packages/agent-core/src/tools/runtime.ts](packages/agent-core/src/tools/runtime.ts)'s `executeTool()` enforces per-tool policy timeouts with a real `AbortController` (cancels in-flight work, not just the wait — confirmed by the function's own design-rule comment and `withTimeout()` implementation). **Not found:** any counter or budget limiting the *number* of tool calls within a single agent run/session — each call is independently policy-checked, but nothing aggregates or caps call count across a run. Classification: absence confirmed by trace, not merely by keyword miss.
4. **No progressive/conditional tool-schema disclosure found.** Every registered tool's schema (via `registerTool`/`getToolPolicy`) is a fixed, statically-defined policy; no mechanism was found that reduces which tool schemas are sent to a model based on task type — this differs from the vendor pattern documented in §33.13.A (OpenAI's `tools-tool-search` `defer_loading` progressive tool disclosure). Absence confirmed by trace of `packages/agent-core/src/policies/tool-policies.ts` and `runtime.ts`; not re-verified against every route.
5. **Duplicate-work detection exists for governed tool execution, not for agent dispatch.** [apps/api/src/services/governed-execution.ts](apps/api/src/services/governed-execution.ts) has real idempotency: same `idempotencyKey` + same `artifactHash` replays the prior durable outcome instead of re-executing (`claimDurableGovernedExecution`, `governedIdempotency` Map + durable file fallback). This is a genuine "duplicate work detection" control — but it is scoped to the governed **tool-execution** layer, not to agent **dispatch** (`dispatchAgentPlan`) or to specialist LLM calls beyond the exact-match dedup cache already documented in §33.3.
6. **Semantic (non-exact-match) caching: NOT FOUND.** No embedding-similarity-threshold cache was found outside the embeddings package's own per-document `embedding` field reuse in `hybrid-rag.ts` (which reuses a **document's own precomputed embedding** when dimensions match — a legitimate optimization, but it caches *document* embeddings, not *query results* or *LLM responses* by semantic similarity). No semantic response cache exists.

#### D. Resource Flow Traces (R1–R10)

Method: R1, R2, R4 reuse the exact Stage 3 evidence already recorded in §33.8 (re-traced here in the R1–R10 template only — not re-measured). R3, R5 extend §33.8 with the newly-found mechanisms above. R6–R10 are traced by code inspection this pass; where no test exercises them, they are marked `BENCHMARK REQUIRED` rather than measured.

| Scenario | Agent decision | Model/provider | Context assembled | Token usage | Tool calls | Retrieval calls | DB calls | Retries | Cache hit/miss | Agent count | Duration | Cost | Outcome | Duplicated work? | Evidence |
| -------- | ---------------- | ----------------- | -------------------- | -------------- | ------------ | ------------------ | ---------- | --------- | ------------------ | -------------- | ---------- | ------ | --------- | -------------------- | ---------- |
| R1 simple request | stub or free provider | `context-echo-free` | none beyond message list | 0 (genuine) | 0 | 0 | 0 | 0 | N/A | 1 | 1–7ms (harness) | $0 | COMPLETED | No | §33.8 R1 |
| R2 repeated identical | dedup cache | same as R1's provider under test | identical | NOT OBSERVABLE (real provider) | 0 | 0 | 0 | 0 | 1 hit / 1 miss | 1 | test-harness only | $0 (mocked) | COMPLETED (from cache) | **No — cache prevented it** | §33.8 R2 |
| R3 agent dispatch (stub) | `dispatchAgentPlan` | none (stub path) | plan + knowledge package (≤12 items, `AGENT_MEMORY_BUDGET`) | 0 (genuine, stub never calls a provider) | 0 | 1 (`loadKnowledge`/`buildEvidencePackageForAgent`) | NOT OBSERVABLE (in-memory osStore) | 0 | N/A | 2+ (Orchestrator+specialist(s)) | test-harness ms | $0 | COMPLETED/SKIPPED per gate | No | §33.8 R3, dispatch.test.ts |
| R4 retry/failure | provider retry / worker retry | mocked transport | same request replayed | NOT OBSERVABLE (mocked) | 0 | 0 | 0 | 1–2 (bounded at 3) | N/A | 1 | test-harness ms | $0 (mocked) | success-after-retry or dead-letter | No — bounded | §33.8 R4 |
| R5 multi-step engineering task | ORCHESTRATOR → specialists → JUDGE | mixed (stub + possible override) | per-specialist knowledge package, isolated per agent | NOT OBSERVABLE (would need live specialist) | NOT OBSERVABLE | 1 per specialist (isolated context, confirmed by `dispatch.ts`'s per-step `loadKnowledge` call) | NOT OBSERVABLE | 0 in stub path | N/A | up to `maxAgents` (default 5) | NOT OBSERVABLE (no live run this pass) | NOT OBSERVABLE | NOT OBSERVABLE | **BENCHMARK REQUIRED** — no live multi-specialist run executed this pass | code trace only, `dispatch.ts` |
| R6 tool-heavy task | agent calls multiple tools via `executeTool` | N/A (tool layer, not LLM) | N/A | N/A | NOT OBSERVABLE (no session-wide counter exists to read — see §33.13.C.3) | N/A | N/A | 0 per call (tool runtime has no its own retry) | N/A | 1+ | per-tool `timeoutMs` bound (policy-defined) | N/A | OK/DENIED/TIMEOUT/ERROR per call | **BENCHMARK REQUIRED** — no test exercises >1 tool call in one session to observe count | `runtime.ts` trace only |
| R7 failed task with retries | same as R4 | — | — | — | — | — | — | bounded at `MAX_PROVIDER_CALL_ATTEMPTS`/`MAX_JOB_ATTEMPTS` = 3 | — | — | — | — | success-after-retry or dead-letter, verified | No | §33.8 R4 (same mechanism, duplicate scenario per spec's own R4/R7 overlap) |
| R8 repeated task after prior success | dedup cache (LLM) / governed-execution idempotency (tool) | — | identical | — | — | — | — | 0 | hit (LLM dedup within 45s) or replay (governed-execution idempotency, no TTL bound — see §33.13.C.5) | — | — | — | replayed, not re-executed | **No — by design** | §33.8 R2 (LLM layer); `governed-execution.ts` (tool layer, code trace only, not re-executed this pass) |
| R9 retrieval/memory task | `buildMemoryContext` / `buildEvidencePackageForAgent` | N/A | memory items ≤ budget (12 default), knowledge hits ≤ `maxItems` (12 in `dispatch.ts`'s `loadKnowledge`) | N/A | 0 | 1+ (per specialist, no cross-specialist retrieval cache found) | NOT OBSERVABLE (osStore in-memory reads) | 0 | N/A (no semantic cache exists — §33.13.C.6) | N/A | NOT OBSERVABLE | N/A | items returned or `INSUFFICIENT_EVIDENCE` | **Possible** — each specialist in a multi-specialist dispatch re-runs its own `loadKnowledge` call over the same corpus with no shared-result cache across specialists in the same request (`dispatch.ts`'s per-step call) — **RISK, NOT YET MEASURED** | `dispatch.ts` trace |
| R10 background/queue execution | worker `runOnce` loop | N/A | N/A | N/A | N/A | N/A | file read/write per state change (`queue-persistence.ts`) | bounded at `MAX_JOB_ATTEMPTS`=3 | N/A | N/A | 2s poll interval (not event-driven) | N/A | COMPLETED/FAILED/dead-lettered | No | §33.8 R5 |

**Honesty note on R5–R6, R9:** these three rows contain real code-trace evidence (file:line level) but **no live/test execution this pass** — they are correctly marked `BENCHMARK REQUIRED`, not `VERIFIED`, per the audit's own rule against inferring measurement from static inspection alone.

#### E. Benchmark Results (deterministic, local, this pass)

Only R2 and R4 (§33.8) constitute real controlled benchmarks executed this pass — reused here, not re-run, per your instruction not to rerun the suite unnecessarily:

| Benchmark | With mechanism | Without mechanism | Real reduction |
| --------- | ---------------- | -------------------- | ----------------- |
| Repeated identical LLM call, cache vs. no cache (R2) | 1 provider call for 2 logical requests | 2 provider calls for 2 logical requests (negative-control tests: different message/model/expired TTL) | **50% call reduction demonstrated for the exact repeated-call case** — not extrapolated to other patterns |
| Transient failure, retry vs. no retry (R4) | Recovers on attempt 2/3, 1 final provider call avoided being a hard failure | N/A (retry is the only path tested; no "retry disabled" comparison run) | Retry converts a would-be hard failure into a success within 2 attempts — no comparison run without retry was performed (would require disabling a production safety mechanism, out of Stage 4 scope) |

The following requested comparisons were **not executed** this pass (all require either code paths not yet exercised in a benchmark harness, or a load-volume that this audit's boundary — "no config changes, no new instrumentation" — does not permit setting up from scratch):

| Requested benchmark | Status | Reason |
| ---------------------- | -------- | -------- |
| Different context sizes | BENCHMARK REQUIRED | No harness varies context size and measures token/latency deltas |
| Different tool counts | BENCHMARK REQUIRED | No session-wide tool-call counter exists to measure against (§33.13.C.3) |
| Queue at representative volumes | BENCHMARK REQUIRED | Same gap as §33.7 RES-007 — unchanged this pass |
| Repeated retrieval | BENCHMARK REQUIRED | No cross-specialist retrieval cache exists to benchmark (§33.13.D R9) |
| Agent count changes | BENCHMARK REQUIRED | No harness measures cost/duration vs. `maxAgents` |
| Context-heavy vs. minimal-context execution | BENCHMARK REQUIRED | Same as "different context sizes" |
| Repeated task after prior successful execution (tool layer) | BENCHMARK REQUIRED | `governed-execution.ts` idempotency replay exists in code (§33.13.C.5) but was not exercised in a fresh benchmark this pass |

#### F. Cost Per Successful Task — telemetry gap analysis

ArletOS **cannot currently compute** cost-per-successful-task, tokens-per-successful-task, tool-calls-per-successful-task, retries-per-successful-task, or time-per-successful-task **automatically**, because:
- `costUsd` is recorded per agent run (`AgentRunResult.costUsd`) but is not joined to a persisted "task id" that also carries a success/failure outcome across retries.
- `getModelRollingStats()` aggregates by model, not by task.
- `atlasMetrics` records `agent_run_duration` but not a task-outcome-correlated id.
- No table or log joins {cost, tokens, tool calls, retries, duration} to a single task id and its final success/failure state.

**Missing telemetry, precisely:** a per-task identifier propagated through dispatch → provider calls → tool calls → judge decision → final outcome, with cost/token/retry/duration accumulated against that one id and a boolean/enum success field recorded at the end. **Classification: NOT_OBSERVABLE.** This is an instrumentation design gap, not a defect — per your Part J boundary, no instrumentation is added in this stage.

**First-class future measurement target (not implemented now):** a mature resource-efficiency system should associate, where technically possible, a single `task_id` with: agent/project identity, tokens, provider/model, tool calls, retrieval calls, retries, duration, cost, and final outcome. The objective this enables, once real, is:

$$\text{Resource Consumed} \div \text{Successful Outcome}$$

This ratio is recorded here as a target definition only. It is not computed, estimated, or approximated anywhere in this document — doing so without the underlying join would be exactly the kind of fabricated evidence this audit exists to prevent.

#### G. Waste Detection Findings (Part G patterns, evidence-checked)

| Waste pattern | Found? | Evidence | Classification |
| --------------- | -------- | ---------- | ----------------- |
| Duplicate LLM calls | Prevented by dedup cache within 45s (§33.8 R2) | Real test evidence | VERIFIED_EFFICIENT (within TTL window only) |
| Duplicate tool calls | Not measured — no session-wide call counter exists | §33.13.C.3 | NOT_OBSERVABLE |
| Duplicate retrieval | Suspected — each specialist in one dispatch re-runs its own knowledge load over the same corpus | §33.13.D R9 | RISK_NOT_YET_MEASURED |
| Duplicate file reads | Not traced this pass | — | NOT_OBSERVABLE |
| Unnecessarily large context | Not measured — `AGENT_MEMORY_BUDGET`/`maxItems` caps exist (12 each) but nothing measures whether a smaller context would suffice | §33.3 | RISK_NOT_YET_MEASURED |
| Unnecessary history | Not traced (no multi-turn conversation flow exercised this pass) | — | NOT_OBSERVABLE |
| Unnecessary tool schemas | No progressive disclosure exists — every schema always sent | §33.13.C.4 | GAP_CONFIRMED (absence confirmed; cost impact not measured) |
| Unnecessary specialist agents | `geniusRoute` selects specialists by keyword match; over-triggering not measured | `genius.ts` | RISK_NOT_YET_MEASURED |
| Excessive orchestration | ORCHESTRATOR + JUDGE always wrap specialist dispatch — by design, not measured as waste | `plan.ts`/`dispatch.ts` | NOT_APPLICABLE (documented design, not a defect) |
| Retry storms | Bounded at both layers (§33.8 R4) | Real test evidence | VERIFIED_CONTROL |
| Repeated failed work | Dead-lettered after 3 attempts, not retried indefinitely | §33.8 R4 | VERIFIED_CONTROL |
| Lack of early stopping | Tool timeout cancels real work via AbortController (§33.13.C.3); no equivalent "stop the whole dispatch early" on judge rejection was traced | `runtime.ts`; dispatch flow not traced further | RISK_NOT_YET_MEASURED |
| Full-file persistence rewrites | Confirmed present (worker queue) | §33.7 RES-007 | RISK_NOT_YET_MEASURED (unchanged) |
| Unnecessary background polling | Worker polls every 2s regardless of queue emptiness (`worker_idle` log path exists, meaning empty-poll is a known, logged no-op, not a silent one) | `apps/worker/src/index.ts` | GAP_CONFIRMED (polling, not event-driven) — impact not measured (2s interval, low overhead suspected but not benchmarked) |
| Redundant network requests | Global rate limit (300/min) and auth sliding window exist; no evidence of actual redundant requests in production | §33.3 | NOT_APPLICABLE (control exists; no waste demonstrated) |
| Redundant DB reads | Not traced this pass beyond registration store (already N/A pattern, single-key reads) | GAP-PERSIST work (§32) | NOT_APPLICABLE for the traced subsystem |
| Unbounded resource growth | Dedup cache capped (200 entries); rolling stats capped (20/model); queue cleanup keeps bounded terminal set | §33.3 | VERIFIED_CONTROL |
| Missing budgets | No per-agent/per-project cost-budget enforcement (unchanged from §33.7 RES-008) | §33.7 | GAP_CONFIRMED |
| Missing attribution | No per-agent/per-project token/cost attribution (unchanged from §33.6) | §33.6 | GAP_CONFIRMED |
| Missing observability | No historical queue telemetry, no cache hit-rate aggregation (unchanged from §33.5/§33.6) | §33.5/§33.6 | GAP_CONFIRMED |
| Work repeated after prior successful result | Governed-execution idempotency replay exists in code (§33.13.C.5); dispatch-level (agent) equivalent does not | code trace | VERIFIED_CONTROL (tool layer) / GAP_CONFIRMED (dispatch layer) |

#### H. Stage 4 Deep Gap Register — RES-018 through RES-023 (final, complete fields; IDs continue from §33.12's RES-0xx)

Each entry below carries every required field. Saving type uses exactly one of: **PROVEN SAVING** (measured, before/after) · **POTENTIAL SAVING** (plausible, unmeasured) · **UNPROVEN / BENCHMARK REQUIRED** (specific benchmark identified, not yet run) · **NOT OBSERVABLE** (no instrumentation exists to measure it at all).

---

**RES-018 — Token/Context efficiency**
- Current ArletOS behavior: exact-match, short-TTL (45s) whole-prompt dedup cache only (`llm.ts`).
- Repository evidence: `packages/agent-core/src/providers/llm.ts` (`DEDUP_TTL_MS`, `MAX_DEDUP_CACHE_ENTRIES`); R2 (§33.8) proves the exact-match path works.
- External reference: §33.13.A rows 1–2 (Anthropic/OpenAI prompt-caching docs) — **EXTERNAL / VENDOR DOCUMENTATION, not an ArletOS measurement.**
- Measured evidence: R2 dedup behavior VERIFIED (§33.8). Prefix/KV-style caching itself is NOT implemented, so it has no ArletOS measurement.
- Classification: GAP_CONFIRMED (absence of prefix/KV caching, confirmed by code trace) — the existing exact-match cache remains VERIFIED_EFFICIENT within its own scope.
- Confidence: High (ArletOS code traced directly; vendor docs fetched directly).
- Demonstrated impact: None for prefix caching (not implemented). Exact-match cache impact is demonstrated separately under RES-001.
- Saving type: **POTENTIAL SAVING** — plausible if ArletOS's dispatch pattern included growing multi-turn conversations; ArletOS's current pattern is mostly single-turn per specialist call, so applicability itself is unconfirmed.
- Benchmark required?: Yes — first confirm whether any real ArletOS workload has a growing, reusable prefix before benchmarking a caching strategy for it.
- Observability limitation: No telemetry currently distinguishes single-turn vs. multi-turn specialist calls to even identify candidate workloads.
- Safety/correctness risk: Low — additive; would not change existing exact-match dedup behavior.
- Recommended next investigation: Determine whether any current specialist dispatch path sends multi-turn conversation history (not just single-turn requests) before evaluating prefix caching.
- Remediation candidate (Stage 5, not implemented): investigate prefix/context caching applicability.

---

**RES-019 — Model efficiency (routing decision vs. enforcement)**
- Current ArletOS behavior: `geniusRoute()` computes a cost-aware `cheap`/`strong`/`vision`/`local`/`multi+human` routing decision with real demotion logic driven by rolling cost/error stats.
- Repository evidence: `packages/agent-core/src/router/genius.ts`, `genius.test.ts` (17 real assertions), called from `kernel/task-plan.ts`, `orchestrator/plan.ts`, `kernel/evaluation.ts`. Exhaustive grep of `modelHint` usage across `apps/api/src` found **no call site that reads the genius.ts routing decision and uses it to select the actual provider/model** for a dispatched specialist (the only other `modelHint` usage found, `catalog.modelHint` in `routes/agent.ts`/`routes/conversation.ts`, is an unrelated marketplace-catalog field).
- External reference: none (routing-by-complexity is general engineering practice, not a cited source).
- Measured evidence: routing decision computed and unit-tested; **enforcement at the real model-selection call site is NOT observed to exist.**
- Classification: GAP_CONFIRMED — "decision exists" ≠ "decision controls runtime model selection." Kept as this exact distinction, per your instruction.
- Confidence: High (confirmed by exhaustive grep, not a sampled search).
- Demonstrated impact: None — a routing decision that is computed but never consulted at the call site saves nothing by construction.
- Saving type: **UNPROVEN / BENCHMARK REQUIRED** — wiring it would only produce a saving if "cheap" tier calls are in fact cheaper for the tasks currently routed to "strong," which has not been measured.
- Benchmark required?: Yes — confirm whether `security-sentinel-dispatch.ts`, `code-engineer-dispatch.ts`, or `research-analyst-dispatch.ts` read `modelHint` before calling `llm.ts` (not confirmed either way beyond the `apps/api/src` grep already performed).
- Observability limitation: No log currently records "routed model" vs. "actually invoked model" side by side, so even after wiring, verifying enforcement would need new instrumentation.
- Safety/correctness risk: Low — tracing the gap is read-only; wiring it later (Stage 5) would need care not to downgrade a specialist that requires "strong" for correctness (e.g., SECURITY), which `geniusRoute` already protects against via its `multi+human`/`vision`/`local` demotion exemptions.
- Recommended next investigation: Read the three specialist-dispatch files named above end-to-end to confirm whether they consume `modelHint` at all before calling `llm.ts`.
- Remediation candidate (Stage 5, not implemented): wire `modelHint` into specialist LLM provider selection, only after the investigation above confirms it is genuinely missing end-to-end.

---

**RES-020 — Tool efficiency (progressive disclosure)**
- Current ArletOS behavior: every registered tool's schema is static; no progressive/conditional disclosure based on task type.
- Repository evidence: `packages/agent-core/src/policies/tool-policies.ts`, `packages/agent-core/src/tools/runtime.ts` — absence confirmed by trace.
- External reference: §33.13.A context — OpenAI's `tools-tool-search` `defer_loading` feature is a real, vendor-documented progressive-disclosure mechanism (referenced during research; not separately fetched as a dedicated source this pass — treat as **UNVERIFIED** beyond the general existence of the feature name seen in the OpenAI prompt-caching page's cross-references).
- Measured evidence: absence confirmed by trace only; no benchmark run.
- Classification: GAP_CONFIRMED (absence confirmed) — impact not measured.
- Confidence: Medium — absence is confirmed, but ArletOS's current tool count is small relative to what motivates this vendor feature at scale, so relevance is uncertain.
- Demonstrated impact: None demonstrated.
- Saving type: **POTENTIAL SAVING** — likely small at ArletOS's current tool-catalog size; unquantified.
- Benchmark required?: Only if the tool catalog grows materially — no benchmark justified at current scale.
- Observability limitation: No metric tracks tool-schema token cost per request today.
- Safety/correctness risk: Low.
- Recommended next investigation: Re-assess only if the tool catalog size increases significantly.
- Remediation candidate (Stage 5, not implemented): none — low priority given current scale.

---

**RES-021 — Retrieval efficiency (duplicate per-specialist retrieval)**
- Current ArletOS behavior: each specialist in a multi-specialist dispatch independently calls `loadKnowledge` over the same corpus.
- Repository evidence: `packages/agent-core/src/orchestrator/dispatch.ts`'s per-step `loadKnowledge` call (one call per specialist, no shared result across specialists in the same request).
- External reference: none (engineering judgment, not a cited source).
- Measured evidence: **not measured** — code trace only, no live multi-specialist dispatch executed this pass.
- Classification: **RISK_NOT_YET_MEASURED / BENCHMARK_REQUIRED.** Must remain in this state unless actual measured duplication evidence exists — per your explicit instruction, this is not escalated to WASTE_CONFIRMED.
- Confidence: Medium — the code pattern (N specialists → N `loadKnowledge` calls) is confirmed by direct trace; whether this is measurably wasteful (vs. cheap in-memory lookups) is not confirmed.
- Demonstrated impact: None demonstrated.
- Saving type: **UNPROVEN / BENCHMARK REQUIRED.**
- Benchmark required?: Yes — run a real 3+ specialist dispatch and count/measure retrieval calls and their latency.
- Observability limitation: No per-dispatch retrieval-call counter exists to read without adding instrumentation.
- Safety/correctness risk: Low — sharing a read-only retrieval result across specialists in one dispatch would not change correctness if implemented carefully later.
- Recommended next investigation: Benchmark a 3+ specialist dispatch and count retrieval calls before any caching change.
- Remediation candidate (Stage 5, not implemented): cache the per-request knowledge package once per dispatch, reuse across specialists with identical query text — **only after the benchmark above, not before.**

---

**RES-022 — Automation efficiency (worker polling)**
- Current ArletOS behavior: worker polls every 2s unconditionally; logs `worker_idle` on an empty queue (a known, logged no-op, not silent).
- Repository evidence: `apps/worker/src/index.ts`.
- External reference: none (engineering judgment, not a cited source).
- Measured evidence: presence confirmed; CPU/wake overhead **not benchmarked**.
- Classification: GAP_CONFIRMED (polling rather than event-driven) — impact not measured.
- Confidence: Medium.
- Demonstrated impact: None demonstrated — low overhead is suspected (polling an in-memory array), not measured.
- Saving type: **NOT OBSERVABLE** for actual overhead (no CPU/wake measurement exists); replacing polling is explicitly **NOT recommended** without first measuring real waste, per your own instruction not to replace polling "simply because it sounds better."
- Benchmark required?: Only if CPU/wake overhead is shown to matter at representative idle time.
- Observability limitation: No CPU/wake-cycle metric exists for the worker process.
- Safety/correctness risk: Low to change, but replacing polling without measurement carries an unjustified-refactor risk per the audit's own boundary rules.
- Recommended next investigation: Measure CPU/wake overhead under representative idle time before considering any change.
- Remediation candidate (Stage 5, not implemented): none recommended at this time — explicitly classified as **E — no demonstrated benefit** in §33.13.I.

---

**RES-023 — Verification infrastructure (= RES-F3, §33.12, restated here for register completeness)**
- Current ArletOS behavior: `apps/worker/src/index.test.ts` passes 5/5 in isolation; the same file combined with 3 other Stage-3 test files in one `vitest` invocation produced 2 failures (a timeout and a call-count mismatch).
- Repository evidence: `apps/worker/src/index.test.ts` (test file itself; not modified).
- External reference: none.
- Measured evidence: real, reproduced twice (combined run vs. isolated run) this pass.
- Classification: **VERIFICATION_INFRASTRUCTURE** — explicitly not a production defect, not fixed this pass, no test/timer/retry/timeout modified to hide it.
- Confidence: High (directly reproduced).
- Demonstrated impact: Reproducible test-isolation defect; zero production-code impact (the underlying retry/backoff logic itself passed 5/5 in isolation).
- Saving type: **NOT APPLICABLE** (this is a verification-infrastructure finding, not a resource-efficiency finding).
- Benchmark required?: No — a root-cause investigation is needed, not a benchmark.
- Observability limitation: N/A.
- Safety/correctness risk: N/A for production; a real risk to *trusting CI results* if unresolved (a flaky suite can mask a real regression).
- Recommended next investigation: root-cause the module-level `queue` array / fake-timer interaction across files sharing a vitest worker.
- Remediation candidate (Stage 5, not implemented): investigate and fix test isolation, separate from any production remediation.

---

#### I. Prioritization by Evidence (Part I — not opinion-ranked)

- **A — measurable saving already demonstrated:** RES-001 (LLM dedup cache, R2), RES-002/RES-003 (bounded retry, R4). These are the only items with a real before/after measurement in this audit.
- **B — strong evidence of likely saving, benchmark still required:** RES-021 (duplicate per-specialist retrieval in one dispatch — code-trace confirmed, not yet benchmarked), RES-007 (queue full-file rewrite — confirmed present, impact unmeasured).
- **C — observability gap preventing measurement:** RES-012 (no per-agent/per-project token attribution), Part F (cost-per-successful-task unmeasurable), RES-011/013/014/015/016 (§33.12).
- **D — architectural possibility with insufficient evidence:** RES-018 (prefix/KV caching — real vendor mechanism, but ArletOS's mostly-single-turn dispatch pattern may not benefit; needs usage-pattern evidence before design), RES-019 (wiring `modelHint` to real model selection — plausible saving, but the actual cost delta of "cheap" vs. "strong" tier for ArletOS's real workloads is not measured), RES-020 (progressive tool disclosure — vendor-documented benefit at vendor's scale, ArletOS's tool count may be too small to matter).
- **E — no demonstrated benefit:** RES-022 (replacing polling with event-driven wake) — explicitly not recommended without first measuring whether the current 2s poll creates real, measurable waste, per your own instruction not to replace polling "simply because it sounds better."

#### K. Functional Savings View — where ArletOS can potentially save resources

Per-category classification, using exactly: **PROVEN** · **MEASURED BUT NOT SIGNIFICANT** · **POTENTIAL** · **NOT OBSERVABLE** · **NOT APPLICABLE**.

| Category | Classification | Basis |
| -------- | --------------- | ------ |
| LLM calls | **PROVEN** | Dedup cache demonstrably avoids 1 of 2 identical calls (R2, §33.8) |
| Input tokens | **NOT OBSERVABLE** | No token-level metric exists per call in this environment (no live provider); provider-level token math is verified only via mocked-transport tests |
| Repeated context processing | **POTENTIAL** | Prefix/KV caching (RES-018) is a real vendor mechanism ArletOS does not implement; applicability to ArletOS's mostly-single-turn pattern is unconfirmed |
| Tool calls | **NOT OBSERVABLE** | No session-wide tool-call counter exists (§33.13.C.3) |
| Retrieval work | **POTENTIAL** | RES-021 — duplicate per-specialist retrieval is code-trace-confirmed, not yet benchmarked |
| Specialist duplication | **NOT OBSERVABLE** | `geniusRoute` specialist-selection over-triggering was not measured this pass |
| Retries | **MEASURED BUT NOT SIGNIFICANT** | Both provider and worker retry are already bounded and verified (R4, §33.8) — no further saving identified beyond what already exists |
| Model cost | **POTENTIAL** | RES-019 — a cost-aware routing decision exists but is not proven wired to actual model selection; saving is conditional on that wiring and on real cost deltas, neither measured |
| Queue/background work | **POTENTIAL** | RES-007 — full-file rewrite confirmed present, production-scale impact unmeasured |
| DB operations | **NOT OBSERVABLE** | No query-count/latency instrumentation exists (RES-013, §33.12) |
| Network calls | **NOT APPLICABLE** | Rate limits and auth sliding window already bound this; no waste demonstrated to reduce further |
| Execution time | **NOT OBSERVABLE** | `agent_run_duration` exists but is not joined to a per-task outcome (Part F/§33.13.F) to identify where time is actually wasted vs. necessary |

#### L. Stage 5 Boundary — explicit, not started

**STAGE 5 — NOT STARTED.** The following are candidates only, listed for future authorization — none implemented, none authorized, none scheduled by this document:

1. Enforce the `modelHint` routing decision at the actual specialist model-selection call site (RES-019) — only after confirming end-to-end absence.
2. Benchmark duplicate per-specialist retrieval in a real multi-specialist dispatch (RES-021).
3. Benchmark queue full-file write amplification at representative job volume (RES-007).
4. Add task-level resource attribution (`task_id` joining cost/tokens/tool calls/retrieval/retries/duration/outcome) — prerequisite for Part F/§33.13.F's cost-per-successful-outcome target and for RES-008/RES-012 budget enforcement.
5. Add a session-wide tool-call budget/counter (currently absent, §33.13.C.3).
6. Investigate prefix/context caching applicability (RES-018) — only after confirming a real multi-turn workload pattern exists.
7. Improve aggregate dedup-cache hit-rate telemetry (RES-016, §33.12).
8. Investigate the F3/RES-023 cross-file test-isolation defect.

None of the above may begin without separate, explicit authorization for Stage 5.

#### J. Verification (Part L — complete, not deferred)

```
git status --short
 M docs/architecture/CONTROL_10_OF_10_MASTER_PLAN.md

git diff --check
(no output — clean)

git diff --stat
 docs/architecture/CONTROL_10_OF_10_MASTER_PLAN.md | 341 +++++++++++++++++++++-
 1 file changed, 332 insertions(+), 9 deletions(-)
```

- **Exact files changed:** `docs/architecture/CONTROL_10_OF_10_MASTER_PLAN.md` — the only file in the working tree (`git status --short` shows exactly one line).
- **Exact section changed:** `## 33. GAP-RESOURCE` only — every hunk in `git diff` falls inside this section (status line, §33.13.A, §33.13.H, new §33.13.K/L, §33.13.J itself). No other numbered section (1–32, 33.1–33.12 content, 34+) was touched.
- **Production code changed:** NO.
- **Test code changed:** NO.
- **Configuration changed:** NO.
- **Dependencies changed:** NO.
- **Anything staged:** NO.
- **Anything committed:** NO.
- **Anything pushed:** NO.
- **Scope confirmation:** the expected scope was documentation-only, confined to Section 33 — confirmed exactly that; nothing outside it changed.

### 33.15 Stage 5 — Targeted Benchmarks + Evidence-Driven Remediation Design (executed 2026-09-29)

**Method:** one real, executed, repeated-run benchmark (queue write amplification) using a temporary harness that imported the real, unmodified `apps/worker/src/queue-persistence.ts` module — the harness itself lived outside the repository (OS temp directory), was never staged, committed, or part of production/test scope, and was deleted after use. All other candidates below are either resolved by exhaustive code trace (deterministic, not requiring execution) or explicitly marked `BENCHMARK BLOCKED` / `NOT OBSERVABLE` where live execution would require a production change or unavailable credentials.

#### 33.15.A Corrected finding — task-level attribution is partially real (correction to §33.13.F)

Deeper trace this pass found that §33.13.F's blanket "cannot compute cost-per-task" statement was **incomplete** for one path. [apps/api/src/services/llm-specialist-proposal.ts](apps/api/src/services/llm-specialist-proposal.ts) and [apps/api/src/services/llm-specialist-run.ts](apps/api/src/services/llm-specialist-run.ts) (the real LLM-backed proposal path for `CODE_ENGINEER`/`RESEARCHER`) carry an optional `taskId` end-to-end and return the **real metered** `LlmUsage` (`costUsd`, token counts) for the call actually placed — not a placeholder. This is genuine, code-confirmed task-level cost attribution for that one path.

**What is still missing (unchanged from §33.13.F):** this `taskId` + cost pair is not joined, in one durable record, to tool calls, retrieval calls, retries, total duration, or the final judge/audit outcome. The correction narrows the gap; it does not close it. Classification: **OBSERVABILITY_GAP** (narrower than previously stated) rather than a blanket `NOT_OBSERVABLE` for this one path's cost/taskId pair specifically.

#### 33.15.B RES-019 — Model routing enforcement

- **Investigation performed:** exhaustive grep of `modelHint`/`LLM_PROVIDER`/`completeStrict`/`completeWithFreeFallback`/`createLlmProvider` across the three concrete specialist dispatch files: `apps/api/src/services/security-sentinel-dispatch.ts`, `code-engineer-dispatch.ts`, `research-analyst-dispatch.ts` — **zero matches in all three.**
- **Finding:** the real LLM-backed specialist path (via `llm-specialist-proposal.ts`) calls `completeWithFreeFallback` directly with a caller-supplied `env` (defaults to the free offline provider) — it does **not** consult `geniusRoute()`'s `modelHint` at all. This confirms, definitively rather than by absence-of-evidence, that `modelHint` does not control runtime model selection anywhere in the current dispatch path.
- **Scenario A (current runtime selection):** confirmed — provider/model is selected solely by `env`/`LlmEnv` (caller-supplied credentials/config), never by the computed routing decision.
- **Scenario B (routing decision actually enforced, isolated benchmark):** **BENCHMARK BLOCKED — PRODUCTION CHANGE REQUIRED.** Constructing a real A/B cost/latency/outcome comparison requires either (a) modifying production code to wire `modelHint` into provider selection (forbidden this stage) or (b) a live provider credential to run two real model tiers side by side (environment-blocked, unchanged from Stage 3/4). No fabricated numbers are substituted for this comparison.
- **Conclusion:** the question "is `modelHint` enforced?" is answered with certainty (**NO**). The question "would enforcing it save resources without correctness loss?" remains **BENCHMARK BLOCKED**, not answered, and not assumed.

#### 33.15.C RES-021 — Duplicate per-specialist retrieval

- **Investigation performed:** structural (not timing) analysis of `packages/agent-core/src/orchestrator/dispatch.ts`. The retrieval-call count for a dispatch selecting N specialists is **deterministic from the loop structure, not data-dependent**: exactly 1 combined call (`loadKnowledge` over all selected agents) plus exactly N per-specialist calls (`loadKnowledge` again, scoped to one agent) — **N+1 total calls to the same underlying `buildEvidencePackageForAgent` function over the same corpus**, for any dispatch selecting N specialists.
- **Repository evidence:** `dispatch.ts`'s top-level `loadKnowledge(input.request, selected.map(...))` call, followed by a per-step `loadKnowledge(input.request, [s.agentId], ...)` call inside the `for` loop.
- **Live timing benchmark:** **not executed this pass** (would require constructing a full Fabric catalog + knowledge corpus fixture — judged out of proportion to the value given the count is already deterministic from code structure, not uncertain).
- **Memory/governance guardrail check:** the proposed reuse (share the top-level combined result across specialists instead of re-querying per-specialist) does not touch `retrievalScope`/`requestingAgentIds` — per-specialist scoping is a parameter to the *query*, not a separate memory store, so sharing a result computed with the *same* scope parameters would not cross any tenant/personal-memory boundary. **No design below grants specialist agents access to personal/user memory they do not already have; it only proposes reusing an already-computed, already-scoped result.**
- **Classification:** count is **repository-evidence-confirmed (deterministic)**; resource *impact* remains **BENCHMARK REQUIRED** (in-memory corpus lookups may be cheap; not measured).

#### 33.15.D RES-007 — Queue write amplification (real, executed benchmark)

**Benchmark ID:** BENCH-QUEUE-001
**Objective:** determine whether `queue-persistence.ts`'s full-file rewrite creates measurable resource cost at realistic scale.
**Workload:** sequential `persistJob()` calls building up a queue from empty to N pending jobs, N ∈ {10, 100, 1,000, 5,000, 10,000}.
**Environment:** local Windows dev machine, Node v22.23.2, `tsx` v4.23.12, cold filesystem cache per run, single-threaded, no other load.
**Configuration:** real, unmodified `apps/worker/src/queue-persistence.ts` imported directly via dynamic `import()` from a temporary harness outside the repository; `setQueuePathForTests()` redirected each size to its own temp file.
**Input:** minimal `state.reconcile` job records (`payload: {}`), one unique `id` per index.
**Execution count:** 1 run per size (sequential, not parallelized) — repeated-run averaging across multiple trials was **not** performed this pass (time-boxed); the reported numbers are single-run wall-clock, explicitly not claimed as statistically stable across repeated trials.
**Control condition:** N=10 (smallest size, baseline per-write cost).
**Comparison condition:** N=100 / 1,000 / 5,000 / 10,000 (same code path, larger accumulated file).
**Metrics:** total duration, average ms/write, final file size, total writes, leftover `.tmp` files (atomicity check), `getQueueStats().total` (correctness check).

**Raw observations:**

| N | Total duration | Avg ms/write | Final file size | Leftover `.tmp` | Stats total (correctness) |
| - | --------------- | -------------- | ------------------ | ------------------ | ---------------------------- |
| 10 | 24.43 ms | 2.4429 ms | 2,179 bytes | 0 | 10 ✓ |
| 100 | 293.46 ms | 2.9346 ms | 21,169 bytes | 0 | 100 ✓ |
| 1,000 | 4,483.88 ms | 4.4839 ms | 211,969 bytes | 0 | 1,000 ✓ |
| 5,000 | 45,202.43 ms | 9.0405 ms | 1,063,969 bytes | 0 | 5,000 ✓ |
| 10,000 | 155,346.56 ms | 15.5347 ms | 2,128,969 bytes | 0 | 10,000 ✓ |

**Result:** average cost per write grows **6.4×** from N=10 to N=10,000 (2.44ms → 15.53ms), and total duration grows **~6,360×** for a 1,000× increase in N (24.43ms → 155,346.56ms) — far worse than linear scaling (which would predict ~24.4 seconds at N=10,000, not 155 seconds). This is consistent with the suspected O(n²) total-cost pattern from a full-file rewrite on every write (each of N writes re-serializes and re-writes all jobs accumulated so far). **Correctness and atomicity held at every size** — no leftover `.tmp` files, and `getQueueStats().total` matched the expected count exactly at every N.
**Limitations:** single run per size (no repeated-trial averaging/variance); local dev machine only (not representative of a production disk/filesystem); measures `persistJob` in isolation, not interleaved with real job processing (`runOnce`) or concurrent enqueue/dequeue traffic; does not measure CPU or memory directly (only wall-clock and file size).
**Conclusion:** the full-file rewrite pattern **is now a measured, real cost**, not merely a suspected one, **at queue depths of thousands of jobs** — this is a genuine escalation from `RISK_NOT_YET_MEASURED` to a **MEASURED SAVING OPPORTUNITY**, bounded by the limitations above (single-machine, single-run). At the depths ArletOS's worker currently expects (per its own `cleanupOldJobs(100)` default retention and 2-worker-job-kind catalog), sustained queue depths in the thousands may be uncommon — this benchmark does not establish that ArletOS *currently* reaches that depth in production, only that *if it does*, the cost is real and superlinear.

#### 33.15.E Context/token efficiency

- Per-call budgets (`AGENT_MEMORY_BUDGET=12`, `maxItems=12` in `dispatch.ts`'s `loadKnowledge`) are real, code-confirmed caps (§33.3) — re-confirmed, not re-benchmarked this pass.
- **New finding:** [packages/agent-core/src/security/prompt-layers.ts](packages/agent-core/src/security/prompt-layers.ts)'s `buildLayeredSystemPrompt()` emits its `instructions` argument "byte-for-byte, never wrapped or scanned." In `llm-specialist-proposal.ts`, `instructions` is built from the specialist's static catalog entry (`getFabricAgent(agentId)`) plus a fixed output contract — **both are constant for a given `agentId` across every call**, independent of the per-request `request` text (which goes into `untrustedBlocks` instead). This is a genuine, code-confirmed **repeated, identical prefix per specialist** — exactly the pattern the external vendor documentation (§33.13.A) describes prefix/KV caching as targeting.
- Real input/output token counts remain **NOT OBSERVABLE** without a live paid-provider call (unchanged, environment-blocked).
- **Effect on RES-018:** this finding upgrades RES-018 from "uncertain applicability" to **a confirmed repeated-prefix candidate** — see §33.15.G below.

#### 33.15.F Tool-call efficiency

Unchanged from Stage 4 (§33.13.C.3): no session-wide tool-call counter/budget exists; `executeTool()` has no built-in deduplication for an identical `(toolName, args)` pair called twice in the same session — each call is independently policy-checked and executed. **Not benchmarked this pass** (would require a live multi-tool-call session; judged lower priority than the queue benchmark given the time budget). Classification unchanged: `GAP_CONFIRMED` (absence), impact `NOT_OBSERVABLE`.

#### 33.15.G Prefix/KV caching — revised decision

Per §33.15.E's new finding, revise the Stage 4 (§33.13.H, RES-018) decision:
- **Repeated system context:** confirmed — per-specialist `instructions` block is identical across calls (code trace, this pass).
- **Repeated project/conversation context:** not confirmed — ArletOS's proposal-backed specialist calls appear to be single-turn per dispatch (no multi-turn message history construction was found in `llm-specialist-proposal.ts`).
- **Repeated tool definitions:** not separately traced this pass.
- **Decision: BENCHMARK REQUIRED** (upgraded from "architectural possibility with insufficient evidence" in Stage 4) — the repeated-prefix pattern is now code-confirmed for the specialist `instructions` block specifically; whether the actual size of that stable prefix is large enough, and called frequently enough, to justify prefix caching (which requires a live paid provider supporting it) remains unmeasured. Vendor-reported percentages (§33.13.A) are external reference only and are not transferred to ArletOS.

#### 33.15.H Failure amplification

Re-examined via code trace (not re-executed — Stage 3's R4 evidence already proved each layer is independently bounded): the provider-layer retry (`llm.ts`, ≤3 attempts) and the worker-layer retry (`index.ts`, ≤3 attempts) are **separate call stacks that do not call into each other** — a provider retry exhausting does not trigger a worker-level retry of the same unit of work, and vice versa, based on the traced code paths. No compounding/amplification path was found. **Classification: NO ACTION JUSTIFIED** — existing bounded-retry controls (RES-002/RES-003) are preserved unchanged, per your explicit instruction not to modify retry policy.

#### 33.15.I Savings summary — proven vs. potential vs. unproven

| Finding | Saving type | Basis |
| ------- | ------------ | ------- |
| RES-001 (LLM dedup) | **PROVEN SAVING** (unchanged from Stage 3/4) | R2, §33.8 |
| RES-002/RES-003 (bounded retry) | **MEASURED SAVING** (failure→success conversion, not a token/cost saving) | R4, §33.8 |
| RES-007 (queue write amplification) | **MEASURED SAVING OPPORTUNITY** (escalated this stage) | §33.15.D, real executed benchmark |
| RES-019 (model routing enforcement) | **SAVING NOT QUANTIFIED** — enforcement absence is proven; resulting saving is BENCHMARK BLOCKED | §33.15.B |
| RES-021 (duplicate retrieval) | **SAVING NOT QUANTIFIED** — call-count duplication is proven (N+1, deterministic); resource impact is BENCHMARK REQUIRED | §33.15.C |
| RES-018 (prefix caching) | **POTENTIAL SAVING** — repeated-prefix pattern now confirmed; magnitude BENCHMARK REQUIRED | §33.15.E/G |
| RES-020 (progressive tool disclosure) | **POTENTIAL SAVING**, low confidence at current scale (unchanged from Stage 4) | §33.13.H |

No production-wide percentage is claimed for any row above. Where a percentage exists (RES-007's per-write growth ratios), it is scoped explicitly to the benchmarked machine/run count and not extrapolated to production traffic.

#### 33.15.J Remediation Designs (proposals only — nothing implemented)

**Design 1 — Queue persistence: bounded append instead of full-file rewrite (addresses RES-007)**
- Problem: `persistJob()` rewrites the entire queue file on every call; measured cost grows superlinearly with pending-job count (§33.15.D).
- Evidence: BENCH-QUEUE-001 (this stage).
- Expected resource benefit: reduced write cost at high queue depth (magnitude depends on final design — e.g., append-only log + periodic compaction, or an indexed on-disk structure).
- Expected correctness impact: must preserve exact current guarantees — atomic durability, crash recovery (`loadPendingJobs`'s `RUNNING`→`PENDING` reset), upsert-by-id semantics, and `cleanupOldJobs`'s terminal-job retention.
- Security impact: none anticipated — same trust boundary (local file, single worker process).
- Memory-isolation impact: none — this is job-queue persistence, unrelated to agent/personal memory.
- Implementation boundary: `apps/worker/src/queue-persistence.ts` only; `apps/worker/src/index.ts` should not need behavioral changes if the public function signatures (`persistJob`, `loadPendingJobs`, `markJobRunning/Completed/Failed`, `updateJobRetry`, `getQueueStats`, `cleanupOldJobs`) are preserved.
- Affected files/modules: `apps/worker/src/queue-persistence.ts`, `apps/worker/src/queue-persistence.test.ts` (existing tests must continue to pass unmodified in behavior, only extended if new cases are needed).
- Tests required: all existing `queue-persistence.test.ts` cases (10, per Stage 3) must still pass; new cases for the append/compaction boundary; a repeated, multi-trial version of BENCH-QUEUE-001 to prove the new design's growth curve is materially better.
- Benchmark required after implementation: re-run BENCH-QUEUE-001 (multi-trial this time) and compare growth curves before/after.
- Rollback strategy: keep the current full-rewrite function available behind a flag/branch until the new design's multi-trial benchmark and full test suite are both green; revert is a single-file change.
- Observability required: none additional strictly required, though a write-duration metric would make future regressions visible.
- Success criteria: growth curve materially closer to linear than the measured ~6,360×/1,000× ratio; all existing tests green; no change to on-disk schema visible to other processes without a migration path.

**Design 2 — Task-level resource attribution (addresses Part F / §33.13.F / §33.15.A)**
- Problem: no single record joins task_id + agent/project + tokens + provider/model + tool calls + retrieval + retries + duration + cost + final outcome.
- Evidence: §33.15.A (taskId + cost already exist for one path; nothing joins the rest).
- Expected resource benefit: enables future cost-per-successful-outcome measurement (not a direct saving itself — an observability prerequisite).
- Expected correctness impact: none if purely additive (new field(s) on existing records).
- Security impact: must not leak cross-tenant data — any new join key must respect existing `ownerId`/`projectId` scoping already enforced elsewhere.
- Memory-isolation impact: none if scoped correctly.
- Implementation boundary: likely `apps/api/src/services/llm-specialist-run.ts`, `agent-proposal.ts`, `audit-log.ts`, and `atlasMetrics` — exact boundary needs its own design pass, not decided here.
- Affected files/modules: TBD at design time; out of scope to enumerate precisely without further investigation.
- Tests required: TBD.
- Benchmark required after implementation: verify a real task's full resource record can be reconstructed end-to-end.
- Rollback strategy: additive fields, revertible without data loss to existing consumers.
- Observability required: this design *is* the observability improvement.
- Success criteria: at least one real dispatch's cost/tokens/tool-calls/retries/duration/outcome can be joined on a single task_id.

#### 33.15.K Stage 5 Decision Register

| ID | Opportunity | Baseline | Evidence | Measured Saving | Quality Impact | Decision |
| -- | ------------ | ---------- | ---------- | ------------------ | ---------------- | ---------- |
| RES-007 | Queue write-amplification reduction | Full-file rewrite, O(n²)-consistent measured growth | BENCH-QUEUE-001 (real, executed) | Measured cost growth confirmed (6.4×/1,000× per-write, ~6,360×/1,000× total) — saving from a redesign not yet measured (no "after" design exists) | None expected if durability/atomicity/upsert semantics preserved (explicit design constraint) | **BENCHMARK MORE** — design proposed (§33.15.J Design 1); build + re-benchmark before implementation approval |
| RES-019 | Wire `modelHint` to real model selection | Confirmed NOT wired (3/3 dispatch files checked) | Exhaustive grep, this stage | Not quantifiable — Scenario B is BENCHMARK BLOCKED | Risk: could downgrade a specialist that needs "strong" tier for correctness if wired carelessly | **OBSERVABILITY REQUIRED** — need routed-vs-actual-model logging before any wiring change can be evaluated |
| RES-021 | Shared retrieval across specialists in one dispatch | N+1 calls confirmed (deterministic) for N specialists | Code trace, this stage | Not quantified — impact of in-memory corpus lookups unmeasured | None expected (read-only result reuse; same scope) | **BENCHMARK MORE** — measure real latency/count in a live multi-specialist dispatch before designing reuse |
| RES-018 | Prefix/KV caching for per-specialist stable instructions | Repeated identical prefix confirmed (code trace) | `prompt-layers.ts` + `llm-specialist-proposal.ts` trace, this stage | Not quantified — magnitude requires a live paid provider | None expected if implemented as a pure additive cache header | **BENCHMARK MORE** — needs a live-provider pass to quantify (ENVIRONMENT BLOCKED until credentials available) |
| RES-020 | Progressive tool-schema disclosure | Static, always-sent schemas | Code trace, Stage 4 | Not quantified; likely small at current tool count | None expected | **NO ACTION** — insufficient scale to justify investigation now |
| Task-level attribution | Join task_id+cost+tokens+tools+retrieval+retries+duration+outcome | Partial (taskId+cost exist for one path only) | §33.15.A, this stage | N/A — observability prerequisite, not a direct saving | None if additive | **OBSERVABILITY REQUIRED** — design proposed (§33.15.J Design 2) |
| RES-F3 / RES-023 | Fix cross-file test isolation | 5/5 pass isolated, 2/57 fail combined | §33.8/§33.12, unchanged | N/A (test infra, not resource) | Risk to CI trust if unresolved | **BENCHMARK MORE** — needs root-cause investigation, not a resource-efficiency decision |

#### 33.15.L Blocked measurements and limitations

- **BENCHMARK BLOCKED — PRODUCTION CHANGE REQUIRED:** RES-019 Scenario B (real routing-enforced A/B comparison) — would require either a production wiring change or live provider credentials, both out of Stage 5's boundary.
- **ENVIRONMENT BLOCKED:** RES-018's magnitude (needs a live paid provider supporting prefix caching); RES-009/RES-010 (unchanged from Stage 3/4, no provider credentials in this environment).
- **Not executed by choice (time-boxed, not blocked):** RES-021 live timing benchmark (count is already deterministic from code structure); RES-020 tool-schema token-cost measurement (judged low value at current scale).
- **Limitation on BENCH-QUEUE-001:** single run per size, one machine — a production capacity-planning decision should not rely on this benchmark alone without repeated-trial validation.

### 33.16 Stage 6 Boundary

**STAGE 6 — IMPLEMENTATION NOT STARTED.** Only the following are candidates, none implemented, none authorized:
1. Design 1 (§33.15.J) — queue persistence redesign — pending a repeated-trial "after" benchmark before approval, per the Decision Register's `BENCHMARK MORE` verdict.
2. Design 2 (§33.15.J) — task-level resource attribution — pending its own design pass (`OBSERVABILITY REQUIRED`).
3. Root-cause investigation of RES-F3/RES-023 test isolation.
4. RES-021 live multi-specialist retrieval benchmark (before any reuse design).
5. RES-018 live-provider prefix-caching magnitude benchmark (environment-blocked until credentials are available).
6. RES-019 routed-vs-actual-model observability logging (before any wiring decision).

No item above may begin without separate, explicit Stage 6 authorization.

### 33.17 Final Closure Criteria (renumbered from former §33.11 / §33.14)

GAP-RESOURCE may only be marked VERIFIED when every condition in the originating audit specification's own Definition of Done is met (repository audit complete, telemetry evaluated, representative workloads measured, confirmed resource behavior evidenced, known waste identified or reasonably ruled out, automation and runaway protections verified where applicable, required remediation completed, before/after measurements exist for claimed optimizations, regression tests pass, type checking passes, `git diff --check` passes, no unrelated scope introduced, this document reflects the verified state, remaining limitations explicitly recorded). This section is not that state today — it records Stage 1–5 audit, controlled-baseline, deep-research, and targeted-benchmark findings only. Current status: **BASELINE PARTIALLY VERIFIED** (Stage 3), **DEEP RESEARCH + GAP ANALYSIS COMPLETE** (Stage 4), **TARGETED BENCHMARKS COMPLETE / REMEDIATION DESIGN ONLY** (Stage 5) — not VERIFIED/COMPLETE/CLOSED/PRODUCTION VERIFIED as a whole.

---

*End of Master Plan. Update this file after every task, gap, correction, or blocker change.*
