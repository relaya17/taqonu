# Atlas Control — 10/10 Supervision Master Plan

**Status:** WAVES 1–9 IMPLEMENTATION LANDED — this file is the post-Wave-9 owner reconciliation (documentation only)
**Created:** 2026-09-23
**Last updated:** 2026-09-23 (final owner reconciliation after Waves 1–9; no new implementation; no R21/R22; no new CTRL)
**Git HEAD:** `73462307767557257c4c8d9c3f15e816c3543d51` (`main`; message `control: close remaining Control remediations through Wave 9`; this documentation recon is the only working-tree change)
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
| CAD-011 | CTRL-001 (`400759a`) and CTRL-012 (`a363b57`) are VERIFIED and pushed. CTRL-013 is VERIFIED (`455b205`). CTRL-014 is VERIFIED (`28ef9f2`). CTRL-016 is VERIFIED (`c0ca916`) as declaration only. CTRL-017 is VERIFIED by LOCAL RUNTIME CaseFlow hop. CTRL-018 is PARTIAL / ENVIRONMENT BLOCKED (`bd1d2db`). CTRL-019 is IMPLEMENTED + TESTED (`ecdae7b`); repeated-FAILURE runtime ENVIRONMENT BLOCKED. CTRL-020/CTRL-021 are IMPLEMENTED + TESTED locally (not FinOps / not production SLOs). CTRL-022 is ENVIRONMENT BLOCKED. R01–R03 are VERIFIED AGAINST REAL LOCAL POSTGRES / PRODUCTION NOT VERIFIED. R04–R14 and R18–R20 are IMPLEMENTED + TESTED. R15–R17 remain ENVIRONMENT BLOCKED. Historical canonical audit is a HISTORICAL INTEGRITY ISSUE; current writer is FIXED + TESTED. HEAD `7346230`. Do not create R21 or CTRL-023. | Active |
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

*End of Master Plan. Update this file after every task, gap, correction, or blocker change.*
