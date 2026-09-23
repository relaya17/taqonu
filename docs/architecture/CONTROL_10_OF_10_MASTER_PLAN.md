# Atlas Control — 10/10 Supervision Master Plan

**Status:** WAVE 0 BASELINE — living source of truth
**Created:** 2026-09-23
**Last updated:** 2026-09-23 (CTRL-019 documentation reconciliation; implementation `ecdae7b`; PARTIAL — code/tests proven; repeated-FAILURE runtime unproven)
**Git HEAD:** `ecdae7b1facbbb44dfef5e9a7e82956db51995ff` (`main`; this documentation recon is uncommitted)
**CTRL-001 commit:** `400759ac3b0ce1c4a32c8f46c13fda18ad228572`
**CTRL-012 commit:** `a363b5764f19612616d923a4baf214126303996a`
**CTRL-013 commit:** `455b205b07dd507ddeb0407da9abaac5e8b17232`
**CTRL-014 commit:** `28ef9f20177dcdfa62719073182bc32104ecc7b2`
**CTRL-016 commit:** `c0ca916ed28f4147587675aa8fa0a3070fd211ac` (parent `e53681c7f0225b3b62ae3c1de9c110f4a87209f2`)
**CTRL-017 commit:** none — VERIFIED by LOCAL RUNTIME proof; implementation and this recon are uncommitted
**CTRL-018 commit:** `bd1d2db2fe46e19d54b50332d2aede62cf1597bd` (PARTIAL — implementation + tests; runtime EXPECTED/UNEXPECTED not proven)
**CTRL-019 commit:** `ecdae7b1facbbb44dfef5e9a7e82956db51995ff` (PARTIAL — implementation + tests; repeated-FAILURE runtime unproven)
**Prior baseline HEAD:** `d596564f50cc9481631af203cf61bf2ff5dac898`
**Classification rule:** INTENT ≠ IMPLEMENTATION ≠ REACHABILITY ≠ ENFORCEMENT ≠ TEST COVERAGE ≠ PRODUCTION PROOF

This document is the only authoritative Control-progress register. Remaining-work 01–19 stay historical closure. Gap-analysis stays a separate roadmap. Do not implement from conversation claims.

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
| AI FinOps (98% unused spend claims) | Accountable spend | Who/operation can be attributed once `agentId` present | No tokens/cost/outcome fields | EXTERNAL / OPTIONAL | CTRL-020 attribution fields only after outcome contract |
| Agent observability | Reconstruct activity | Gateway ingest + aliases `ai.gateway.invoke`→`agent.completed`, `autonomy.act`→`tool.executed` | HITL/domain events rejected; invoke not on HotelOS live emit | CONTROL SUPPORTING | Taxonomy closed for known rejects; do not invent emits |
| Memory quality / poisoning | Isolation + revocation | Owner-scoped ACTIVE/SUPERSEDED; `retrieveMemories` statements | HotelOS `actorId` ≠ Atlas `ownerId` — no join | ATLAS CORE | Memory-based necessity = NOT AVAILABLE |
| Provenance / grounding | Evidence ≠ authorization | Atlas-self evidence sufficiency CONTINUE/HALT/INCONCLUSIVE | Sibling hops have no result verification | APPLICATION + CORE | Do not force NLI |
| HITL | Human gate | Atlas REQUIRE_APPROVAL + SoD | Application HITL stays application-owned | CORE | No merge |
| Kill / intervention | Enforceable stop | Category kill + Fabric quarantine | Global categories, not per-app/per-Agent | CORE | Do not fake per-Agent kill for siblings |
| Agent lifecycle | Known / observed / retired | Fabric catalog only | Application Agents are not lifecycle-managed by Control | APPLICATION | Observe only |
| Unnecessary inference | Avoid paid path | Two preflight points exist | UNNECESSARY decision = not implementable without cheap-path proof | APPLICATION then path-authz | Model C only; no Model B |
| Cost/outcome attribution | Who spent, what resulted | Audit has applicationId/agentId/actorId/operation; one local CaseFlow hop correlated `executionId`↔preflight | Not production; not all siblings; no FinOps | CORE SUPPORTING | CTRL-017 LOCAL RUNTIME only; CTRL-020 still deferred |

---

## 6. Capability Matrix

Status vocabulary: `PROVEN` | `PARTIAL` | `MISSING` | `ENVIRONMENT BLOCKED` | `NOT APPLICABLE` | `DUPLICATED / REDUNDANT` | `INCORRECT IMPLEMENTATION` | `ARCHITECTURALLY UNCLEAR`.

| ID | Capability | Current implementation | Evidence | Status | Risk if missing | Dependency | Proposed action |
| -- | ---------- | ---------------------- | -------- | ------ | --------------- | ---------- | --------------- |
| G1 | Identity | `applicationId` required; `agentId` optional nullable; `actorId`/`tenantId`/`projectId`/`operation` on preflight; `idempotencyKey`; response echoes `agentId`. `applicationOwnedAgentId()` never invents. HotelOS CIO sends `agent.cio`; embed sends `null`. CaseFlow/BrokerOS send `null`. Civio letter=`LEGAL_LETTER_AGENT`, housing=`HOUSING_AGENT`, others `null`. | `packages/shared/src/platform/application-preflight.ts`; `apps/api/src/services/application-preflight.ts` `finish()`; HotelOS `packages/ai-gateway/src/gateway.ts`; tests `application-preflight-identity.test.ts` | PARTIAL | Wrong attribution | Wave 1 commit | CTRL-001; do not invent IDs for CaseFlow |
| G2 | Intent / purpose | `operation` + `operationClass` (GOVERNED_DECISION / INFORMATIONAL / HIGH_RISK / TOOL_ACTION). No purpose/intent class/expected outcome fields. Full prompts not sent (correct). | `application-preflight.ts` schema | PARTIAL | Cannot distinguish why two GOVERNED_DECISION differ | G1 | Optional purpose class later — do not send prompts |
| G3 | Authorization | HMAC, tenant/project binding, nonce, denyImpersonation, kill, destructive DENY, HIGH/TOOL approval. Decisions ALLOW/DENY/REQUIRE_APPROVAL/KILLED/INVALID/OUT_OF_SCOPE. | `evaluateAuthorized()`; `apps/api/src/routes/application-preflight.test.ts` | PROVEN (unit + route) | Bypass if client ignores ALLOW-only or secret unset fail-open | — | Do not redesign. Document fail-open. |
| G4 | Necessity | No `UNNECESSARY` / `proposedPath` / `knowledgeSufficient`. Semantic Conclusion C: cannot infer from availability. HotelOS pack is LLM context, not an answer. CaseFlow cache is a real cheap path **before** preflight. Civio FAQ can skip Gemini **after** preflight. CTRL-016 adds optional `declaredCompletionPath` (`LOCAL_COMPLETION_PATH` / `MODEL_PATH`) so the app can attest a path. Control does not infer sufficiency from that declaration. | HotelOS gateway; CaseFlow wrap; Civio `ai.ts`; `c0ca916` preflight contract | MISSING (correctly) | Fake savings / false DENY | Proven cheap path + attestation | Necessity engine still must not be built. CTRL-016 is declaration only. Execution/outcome is CTRL-017. |
| G5 | Knowledge sufficiency | Atlas-self `CONTINUE/HALT/INCONCLUSIVE` in `packages/shared/src/constants/evidence-sufficiency.ts`. Not used as sibling knowledge judgment. Document count ≠ sufficiency. | evidence-sufficiency.ts | MISSING as Control domain engine (correct) | False domain judgment | Application attestation | Control must not own |
| G6 | Memory | Owner-scoped ACTIVE/SUPERSEDED; `allowedAgents`; retrieve returns statements. HotelOS actorId ≠ Atlas ownerId → no join. Control must not own user memory. | Atlas memory services; HotelOS actor | PARTIAL | Poisoning / cross-user leak if joined wrongly | Identity join (does not exist) | Memory-based necessity = NOT AVAILABLE |
| G7 | Retrieval / tool necessity | HotelOS embed INFORMATIONAL preflight is the cheap-hop gate. Tools/HIGH require approval. Retrieval may already have happened before Control if app skips preflight. | HotelOS `atlas-preflight.ts`; evaluateAuthorized TOOL_ACTION | PARTIAL | Spend after the fact | App calls preflight first | Keep two-point model; do not add a third invented gate |
| G8 | AI necessity | No Control “does this need AI?” engine. CaseFlow cache and Civio FAQ are application-owned skips. Model choice stays application-owned. | CaseFlow cache; Civio FAQ | MISSING (Control) | Unnecessary inference | G4 Model C | Do not build a model router |
| G9 | Cost / resource | No estimated/actual tokens or cost fields. Attribution possible via applicationId+agentId+operation once committed. | audit input in application-preflight.ts | MISSING | Unaccountable spend | G1, G16 | Attribution only; FinOps stays external |
| G10 | Risk | HIGH/CRITICAL via operation class + body `riskLevel` on telemetry. Global kill categories. Not Agent-specific. | evaluateAuthorized; atlas-gateway preserve riskLevel | PARTIAL | Under-gated destructive work | G3 | Keep operation-class risk; do not invent Agent risk scores |
| G11 | Human approval / SoD | Atlas approvals: `decidedBy !== requestedBy`, DB-enforced. Approval context may include optional agentId. HotelOS `ai.approval.approved` is **rejected** at gateway (not Atlas SoD). | approvals path; `atlas-gateway.test.ts` reject HITL | PROVEN (Atlas SoD) | Silent cross-action approval | G3 | Do not map HotelOS HITL |
| G12 | Runtime authority | Next-hop only: `aiWorkers`/`agentDispatch` → preflight `KILLED` + `executed:false`. `payments`/`webhooksInbound`/`webhooksOutbound` do not kill application preflight. Fabric pause/quarantine is `def-000` registered Agents only; `agent.cio` is not found. No abort API. In-flight sibling work is not Control-stopped (G12-E NOT A DEFECT). G12-F fail-open/cache bypass stays out of this task. | `application-preflight.test.ts` G12-A/B/D; `atlas-self-agent-control.test.ts` G12-C/D | PARTIAL | In-flight sibling continues after kill | G3 | Do not add live-abort or per-Agent sibling kill |
| G13 | Execution observability | authorized via preflight audit. CaseFlow reports `executionStatus` via `atlas.application-execution-report.v1` (CTRL-017). Other siblings do not report executed/failed/skipped. Telemetry is observational, not a gate (`atlas-gateway.test.ts`). | finish() audit; CTRL-017 report hop; gateway | PARTIAL | Cannot prove execution where siblings do not report | Outcome contract | Wave 4 |
| G14 | Evidence / provenance | Canonical audit + Atlas-self evidence. Authorization ≠ grounding. | unified-audit-entry.schema.ts; evidence-sufficiency | PARTIAL | Ungrounded claims look authorized | G3, G15 | Do not assume authz = evidence |
| G15 | Result verification | Atlas-self ALLOW writes verify on fulfill hop. Sibling hops: application-owned, not federated. | control-operations execution notes | MISSING (siblings) | False “success” | Application report-back | Do not force NLI |
| G16 | Outcome | Generic `atlas.application-execution-report.v1` exists: application-owned `executionId` + `executionStatus` SUCCESS\|FAILURE correlated to a preceding ALLOW. ALLOW is not SUCCESS. One local CaseFlow hop proven (CTRL-017). General sibling coverage remains unproven. `actualCost` remains G9 / CTRL-020, not this contract. | CTRL-017 LOCAL RUNTIME: `decisionId` `f3a2539c-8499-462e-b600-8a9b9bf1a0bc` ↔ `executionId` `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO`; `application.execution.reported` | PARTIAL | Allowed ≠ completed where siblings do not report | G1, G13 | Wave 4 contract exists; general sibling coverage unproven |
| G17 | Portfolio | `portfolio-governance-view.ts` `notAnAgentRegistry: true`. Supervision snapshot observational. Registry seeded Atlas-self; Civio after HMAC event. | portfolio-governance-view.ts; supervision-snapshot.ts | PARTIAL | Operator inspects source instead | Telemetry identity | No arbitrary scores |
| G18 | Unknown / shadow Agents | Application-owned Expected set (`ATLAS_{APP}_EXPECTED_AGENT_IDS`); observed `agentId` classified EXPECTED / UNKNOWN / UNEXPECTED on existing `application.preflight.evaluated` / `application.execution.reported`. Null, missing Expected, or empty Expected = UNKNOWN. Reserved `psa:*` / `cp:*` / Fabric stay CTRL-014, not UNEXPECTED. UNEXPECTED does not change ALLOW/DENY. | Commit `bd1d2db`; `application-agent-observation.ts`; CP `notAnAgentRegistry: true` | PARTIAL | Shadow activity still not runtime-proven | G1, G22 | Runtime EXPECTED/UNEXPECTED blocked on HotelOS connector env. CaseFlow has no legitimate non-null preflight Agent ID. No Fabric registry. |
| G19 | Multi-hop / delegation | No originAgent / delegatingAgent fields. Identity may drop on hop. | schema has single optional agentId | MISSING | Accountability break | Real hop evidence | Add fields only when a hop exists |
| G20 | Audit integrity | Canonical NDJSON / unified audit; append-oriented. Hash-chain / offsite DR not proven here. | unified-audit-entry.schema.ts | PARTIAL | Tamper / loss | G1 | Wave 8; env blockers separate |
| G21 | Feedback / learning | Observe→proposal→authenticated-human-decision→audit exists (`atlas.application-learning-proposal.v1`, Alt 2). Citations must be unified-audit `application.execution.reported` with `executionStatus === FAILURE`, scoped to the same applicationId+tenantId+projectId+operation. Literals `autoApply/executes/mutatesGovernance/mutatesMemory/mutatesKnowledge: false`. No ApprovalRequest and no execution authority. `requestedBy=cp:service`; `decidedBy` is requireAdmin `user.id`; SoD rejects `cp:service` as decider. Stops at audit — no policy/memory/knowledge apply. | Commit `ecdae7b`; `application-learning-proposal.ts` | PARTIAL | No real repeated-FAILURE runtime; no production or autonomous learning | G16 | Wave 7 proposals only; autoApply false; not VERIFIED |
| G22 | Telemetry contract | Aliases: `ai.gateway.invoke`→`agent.completed`, `autonomy.act`→`tool.executed`. Reject: `ai.approval.approved`, `payment.intent.created`, `hr.document.*`. HotelOS live emit uses X-Atlas-Reason + top-level agentId (uncommitted sibling). `ai.gateway.invoke` is HotelOS local onAudit only — **not** on live emit. | atlas-gateway.ts; HotelOS alert-on-sensitive-audit.ts SENSITIVE_ACTIONS | PARTIAL | Rejected legitimate / wrong channel | G1 | Taxonomy closed for known types; do not invent invoke emit |
| G23 | Security / isolation | HMAC, tenant/project, denyImpersonation, owner memory. Fail-open GOVERNED/INFORMATIONAL. | evaluateAuthorized | PARTIAL | Cross-app authority if binding skipped | G3 | Security review on each CORE close |
| G24 | Failure / recovery | Fail-open vs fail-closed by the four existing operation classes. Duplicate/retry via nonce/idempotency. Atlas secret unset: API 401 INVALID; client skip only if FAIL_OPEN. | evaluateAuthorized comments; `unavailablePolicyForClass`; CTRL-013 tests | PARTIAL | Silent skip of governed hops remains a client FAIL_OPEN path | CTRL-013 docs + tests | Do not globally fail-closed |
| G25 | Performance | No measured preflight/audit/telemetry budgets in this reconciliation. | — | MISSING | Control becomes the expensive path | Measure first | Wave 8 measure, do not optimize blindly |
| G26 | Operator experience | Admin :3200 + Control :3100 surfaces exist. Every widget must bind real data. Portfolio is not a live connector. | apps/admin; apps/control-plane | PARTIAL | Decorative dashboards | Real fields only | No decorative work in this program |
| G27 | Incident / investigation | Reconstructable when audit has applicationId+agentId+actorId+operation+decision. One local CaseFlow hop has execution/outcome (CTRL-017). Other siblings still missing execution/outcome. | audit input; CTRL-017 hop | PARTIAL | Incomplete incident story | G13, G16 | Wave 4+6 |
| G28 | DR / audit preservation | Production DR / offsite / AWS / Supabase classified as environment. | remaining-external-dependencies.md G-P1-06–09 | ENVIRONMENT BLOCKED | Audit loss | External | Do not hide as “not implemented” |

### 6.1 Ownership class per capability

| ID | Class |
| -- | ----- |
| G1, G3, G11, G12 (Fabric + next-hop), G20, G23 | CORE CONTROL |
| G2, G10, G13, G17, G18, G22, G24, G26, G27 | CONTROL SUPPORTING |
| G4 cheap-path existence, G5 sufficiency, G8 model choice, G15 sibling verify, G16 facts | APPLICATION RESPONSIBILITY |
| G6 store, G14 Atlas-self evidence | ATLAS CORE RESPONSIBILITY |
| G9 FinOps product, G28 offsite DR, OTel backends | EXTERNAL INTEGRATION |
| G4 Model C declaration (CTRL-016 VERIFIED), G8 router, G9 tokens, G19 hop fields, G21 learning | OPTIONAL FUTURE except CTRL-016 declaration; remaining items wait for outcome attestation (CTRL-017+) |
| Fabric promotion, Control-owned app knowledge, fake UNNECESSARY, NLI everywhere | NOT NEEDED |

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
   WAVE 5  resource attribution fields (G9) after outcome
   WAVE 7  human-governed learning proposals (G21) — CTRL-019 PARTIAL (`ecdae7b`); runtime unproven
   ↓
AFTER CORRELATION EXISTS
   WAVE 6  portfolio / shadow Agents / incidents (G17/G18/G27)
   ↓
ENVIRONMENT
   WAVE 8  G25 measure, G28 DR — G-P1-06–09 remain BLOCKED
```

**Parallelizable now:** documentation of fail modes, kill semantics, security regression tests — after CTRL-001.

**Must not parallelize with Wave 1:** necessity, knowledge sufficiency, FinOps, Fabric registries, outcome schema.

---

## 8. Implementation Waves

| Wave | Name | Verdict from source |
| ---- | ---- | ------------------- |
| 0 | Baseline and Evidence | **VERIFIED** as living baseline (CTRL-000 / CTRL-015). This document remains the source of truth. Not CLOSED. |
| 1 | Identity and Contract Closure | CTRL-001 **VERIFIED** and committed (`400759a`). Not CLOSED (CORE still 0). |
| 2 | Decision Engine (necessity / path) | Path **declaration** CTRL-016 **VERIFIED** (`c0ca916`). Necessity/UNNECESSARY engine still not built (G4 remains MISSING, correctly). Execution/outcome is CTRL-017 **VERIFIED** (LOCAL RUNTIME, one CaseFlow hop). |
| 3 | Runtime Governance | Fabric already pause/quarantine; sibling live-stop **not** claimed |
| 4 | Evidence and Verification | CTRL-017 **VERIFIED** for one local CaseFlow OpenAI hop. Not production. G16 is **PARTIAL** (generic contract exists; general sibling coverage remains unproven). G15 remains separate and **MISSING**. |
| 5 | Resource and Cost | Attribution later; FinOps external |
| 6 | Portfolio Supervision | Projection exists; no scores |
| 7 | Learning | CTRL-019 **PARTIAL** (`ecdae7b`). Human proposals + decide exist. Repeated-FAILURE runtime unproven. Not VERIFIED. |
| 8 | Resilience | Measure + env blockers |

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
| CTRL-017 | 4 | Outcome / execution correlation contract | VERIFIED | 2026-09-23 | 2026-09-23 | CTRL-001; app report-back design | Schema + one sibling hop proving executionId↔preflight | LOCAL RUNTIME CaseFlow wrap (not tests, not production). `atlas.application-execution-report.v1` POST `/api/v1/governance/application-execution-report`. Hop: preflight ALLOW `decisionId` `f3a2539c-8499-462e-b600-8a9b9bf1a0bc` · `requestId` `2fb06f9a-c1c2-4622-bde4-79423bff0ed2` · operation `caseflow.openai.chat` · provider `executionId` `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO` · `executionStatus` SUCCESS · Atlas `accepted=true` · audit `application.preflight.evaluated` + `application.execution.reported`. Implementation uncommitted (working tree). Not a second OpenAI call. Initial audit miss was reader-path (`row.input` vs canonical `payload.input`), not a correlation failure. HMAC replay only confirmed already-accepted report. | LOCAL RUNTIME only. Not Vercel/production. Not HotelOS/Civio/BrokerOS. In-memory `decisionId` index is process-local. Do not start CTRL-018. |
| CTRL-018 | 6 | Observed vs expected application Agent IDs (no Fabric registry) | PARTIAL | 2026-09-23 | 2026-09-23 | CTRL-001 | Surface unexpected agentId; `notAnAgentRegistry` remains true | Commit `bd1d2db` (6 Atlas files). Expected is application-owned (`ATLAS_{APP}_EXPECTED_AGENT_IDS`). Classifier EXPECTED/UNKNOWN/UNEXPECTED is observational only. Tests: shared observation 8/8; API observation+identity 12/12; CP 58/58 (`notAnAgentRegistry` true; `agent.cio` not a Fabric target). No registry, Fabric promotion, or authorization change. | NOT VERIFIED. HotelOS `agent.cio` is a legitimate application-owned identity in repository evidence; HotelOS connector env is ABSENT — no real HotelOS→Atlas hop. CaseFlow verified hop is `agentId=null` → UNKNOWN; CaseFlow has no legitimate non-null Agent ID on the Atlas preflight path. EXPECTED and UNEXPECTED runtime observations remain unproven. Not an Atlas implementation defect. Not production. |
| CTRL-019 | 7 | Human-governed learning proposals from repeated failures | PARTIAL | 2026-09-23 | 2026-09-23 | CTRL-017 | Proposals only; `autoApply: false` | Commit `ecdae7b` (8 Atlas files). Alt 2 non-redeemable human learning decision. Contract `atlas.application-learning-proposal.v1`. Audit-grounded FAILURE citations; same applicationId+tenantId+projectId+operation. Tests: shared 9/9; API 14/14; regression 160/160. requireAdmin + SoD (`requestedBy=cp:service`, `decidedBy=user.id`). Decision ACCEPT/REJECT on unified audit (`approval: NOT_REQUIRED`). | NOT VERIFIED. No real repeated `application.execution.reported` FAILURE in authoritative local runtime. Not production. No ApprovalRequest. No execution authority. |
| CTRL-020 | 5 | Resource attribution fields (not FinOps) | DEFERRED | — | 2027-01-20 | CTRL-017 | Who/Agent/operation/resource/outcome refs | — | Outcome missing |
| CTRL-021 | 8 | Performance budgets for preflight/audit/telemetry | DEFERRED | — | 2027-02-17 | CTRL-001 | Measured numbers in this plan | — | Measure env |
| CTRL-022 | 8 | Production DR / audit offsite | BLOCKED | — | — | G-P1-06–09 | External restore | remaining-external-dependencies.md | AWS / Supabase / secrets |

IDs CTRL-002–CTRL-011 reserved unused (never reuse). Next unused ID remains CTRL-023. **Do not create CTRL-023.** Gate 1 (Knowledge Integration Audit) found no new Control knowledge gap.

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
| Duplicate / retry | Nonce + idempotency | Replay resistance |
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

---

## 17. Current Progress

Counts are **capability rows in §6**, not scores.

```text
Total gated capabilities:     28
PROVEN:                       2   (G3 Authorization, G11 Atlas SoD)
PARTIAL:                      18
MISSING:                      7   (G4, G5, G8, G9, G15, G19, G25)
ENVIRONMENT BLOCKED:          1   (G28)
NOT APPLICABLE:               0
INCORRECT IMPLEMENTATION:     0
```

G5/G8 are MISSING **as Control engines** and correctly APPLICATION-owned — they do not count as Control defects.

```text
CORE CONTROL rows:            G1, G3, G11, G12, G20, G23
CORE closed (10/10 ten-point): 0
CORE remaining:               6 (G3/G11 PROVEN but not 10/10-closed — no security-review + runtime + plan evidence block yet)
CONTROL SUPPORTING remaining: see §6
OPTIONAL / DEFERRED:          CTRL-019 runtime proof; CTRL-020–CTRL-022
Environment blockers:         6 rows in §16
```

Identity/telemetry is **committed** (`400759a`) and CTRL-001 is VERIFIED, not CORE-closed. CTRL-012 is VERIFIED and pushed (`a363b57`). CTRL-013 is VERIFIED and committed (`455b205`). CTRL-014 is VERIFIED and committed (`28ef9f2`). CTRL-016 is VERIFIED and committed (`c0ca916`) as a **declaration** contract, not execution proof. CTRL-017 is VERIFIED by one LOCAL RUNTIME CaseFlow OpenAI hop (implementation uncommitted; this file is docs recon only). CTRL-018 is PARTIAL (`bd1d2db`): implementation and tests committed; runtime EXPECTED/UNEXPECTED not proven. G16 is PARTIAL (generic contract + one hop; general sibling coverage unproven). G21 is PARTIAL (proposal/decision/audit loop exists; no production learning). G15 remains MISSING. G4 remains MISSING (correctly — no necessity engine). G12 remains PARTIAL. G18 is PARTIAL (not PROVEN). G24 remains PARTIAL. CTRL-019 is PARTIAL (`ecdae7b`) — do **not** mark VERIFIED. CORE closed remains 0.

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
| CTRL-017 VERIFIED | 2026-09-23 | none yet (implementation + this recon uncommitted) | this file is docs recon only; Gate 3B contract remains in the working tree | existing Gate 3B tests are not the VERIFIED proof | LOCAL RUNTIME: CaseFlow `caseflow.openai.chat` cache-miss wrap → real `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO` → HMAC report accepted → `application.execution.reported` | DoD met by one sibling hop. Not production. Reader-path miss (`row.input` vs `payload.input`) was query error, not a failed hop. Replay was HMAC-only. Do not start CTRL-018. |
| CTRL-018 PARTIAL | 2026-09-23 | `bd1d2db2fe46e19d54b50332d2aede62cf1597bd` | 6 Atlas files in that commit (this file is docs recon only) | shared observation 8/8; API observation+identity 12/12; CP 58/58 | No HotelOS→Atlas hop. CaseFlow hop remains `agentId=null` → UNKNOWN | NOT VERIFIED. Expected is application-owned. Classification observational only. `notAnAgentRegistry` remains true. No Fabric registry. HotelOS connector env absent — not an Atlas implementation defect. Not production. |
| CTRL-019 PARTIAL | 2026-09-23 | `ecdae7b1facbbb44dfef5e9a7e82956db51995ff` | 8 Atlas files in that commit (this file is docs recon only) | shared 9/9; API 14/14; regression 160/160 | No real repeated `application.execution.reported` FAILURE | NOT VERIFIED. Alt 2 only. No ApprovalRequest. No execution authority. No policy/memory/knowledge mutation. Not production. |

**Not CORE-closed:** identity/telemetry does not satisfy the ten-point CORE definition (no security-review close, HotelOS ai-gateway runtime blocked, no closed CORE evidence block). Counts remain 28 / 2 / 18 / 7 / 1 / CORE 0.

---

## 19. Remaining Work

1. CTRL-013 is VERIFIED and committed (`455b205`; local, not pushed). G24 remains PARTIAL.
2. CTRL-014 is VERIFIED and committed (`28ef9f2`; local, not pushed).
3. CTRL-016 is VERIFIED and committed (`c0ca916`; local, not pushed) as path **declaration**. It is not execution, outcome, cost, or sufficiency proof.
4. CTRL-017 is VERIFIED by one LOCAL RUNTIME CaseFlow OpenAI hop (`decisionId` `f3a2539c-8499-462e-b600-8a9b9bf1a0bc` ↔ `executionId` `chatcmpl-ERG9FKN5Bmxjqxw17Ih5tw4IIjsQO`). CTRL-018 is PARTIAL (`bd1d2db`) — do **not** mark VERIFIED. G16 is PARTIAL (generic contract + one hop; general sibling coverage unproven). G15 remains MISSING. CTRL-019 is PARTIAL (`ecdae7b`) — do **not** mark VERIFIED. Do not create CTRL-023.
5. Do **not** implement UNNECESSARY, proposedPath, knowledgeSufficient, FinOps, Fabric app-Agent registry, or a new Knowledge Authority.
6. Keep G-P1-06–09 blocked.
7. LexStudy / Vantera remain NOT ACCESSIBLE.

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
| CAD-011 | CTRL-001 (`400759a`) and CTRL-012 (`a363b57`) are VERIFIED and pushed. CTRL-013 is VERIFIED (`455b205`, local, not pushed). CTRL-014 is VERIFIED (`28ef9f2`, local, not pushed). CTRL-016 is VERIFIED (`c0ca916`, local, not pushed) as declaration only. CTRL-017 is VERIFIED by LOCAL RUNTIME CaseFlow hop (implementation uncommitted). CTRL-018 is PARTIAL (`bd1d2db`): implementation+tests committed; runtime EXPECTED/UNEXPECTED not proven. CTRL-019 is PARTIAL (`ecdae7b`): implementation+tests committed; repeated-FAILURE runtime unproven. Local HEAD `ecdae7b` | Active |
| CAD-012 | Sibling live-abort is not a Control capability. Kill = next preflight. Fabric pause = registered `def-000` Agents only | Active |

If a task is wrong: mark `ARCHITECTURE REVIEW`, record evidence, propose replacement, update this graph, keep history in §23.

---

## 21. Deferred Work

- CTRL-018 runtime EXPECTED/UNEXPECTED hop (HotelOS connector env absent; not an Atlas implementation defect)
- CTRL-019 repeated-FAILURE runtime proof (implementation `ecdae7b` committed; not VERIFIED)
- Cost attribution fields (CTRL-020)
- Performance budgets (CTRL-021)
- Production DR (CTRL-022)
- Purpose/intent class on preflight
- Delegation hop fields
- LexStudy / Vantera runtime wiring

---

## 22. Non-Goals

- FinOps product, OTel vendor, model marketplace, model router, RAG, NLI everywhere
- Memory database owned by Control
- Application Agent runtime or Fabric promotion
- Fake Agent IDs, fake cost savings, fake verification, fake scores
- Decorative Control dashboards
- Merging HotelOS HITL into Atlas SoD
- Global fail-closed
- Cleaning sibling dirty trees
- Implementing gap-analysis as this program
- Investor-doc edits unless separately asked

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

---

## Answers to architectural questions (source)

1. **Last safe point before a paid/resource-consuming operation:** the application’s HMAC call to `POST /api/v1/governance/application-preflight` immediately before the model/tool hop (HotelOS CIO / CaseFlow wrap / Civio Gemini / BrokerOS Gemini). HotelOS embed is an earlier INFORMATIONAL gate before retrieval expansion.
2. **Where Control can still prevent it:** only that Atlas API evaluateAuthorized path, and only if the client uses ALLOW-only. Control Plane `:3100` cannot stop sibling execution.
3. **Cheaper path without owning knowledge:** only if the application already has a proven cheap **completion** (CaseFlow cache before preflight; Civio FAQ after preflight). HotelOS pack is not a completion. Control cannot infer sufficiency. CTRL-016 lets the app declare `LOCAL_COMPLETION_PATH` or `MODEL_PATH`; omit/null is legacy. That declaration is not proof the path ran.
4. **Control vs application:** Control = identity, authz, risk class, approval/SoD, next-hop authority, audit. Application = cheap path, sufficiency, model choice, result, outcome facts.
5. **Signals that may cross the boundary:** applicationId, agentId (or null), actorId, tenantId, projectId, request/idempotency, operation, operationClass, riskLevel, decision, evidence refs, optional `declaredCompletionPath` — not prompts, not memory contents, not domain documents. The path field is a declaration, not execution evidence.
6. **Request → Agent → execution → result:** PARTIAL. Identity on preflight/audit after CTRL-001. One LOCAL RUNTIME CaseFlow hop reported (`CTRL-017` VERIFIED). Other siblings and production are not proven.
7. **Stop an Agent:** Fabric/Atlas-self at Control eval. Application Agent: record kill / deny next preflight — not a live abort.
8. **Continue after authorization expires:** yes until the next evaluateAuthorized; no mid-flight sibling revoke.
9. **Bypass:** fail-open skip, CaseFlow cache (intentional cheap path), unconfigured secret, any hop that never calls preflight, CP ingest (not a gate).
10. **Why a decision was made:** PARTIAL — audit has decision + policy/operation class; no purpose/necessity explanation.
11. **What actually happened:** PARTIAL — authorized is recorded; one local CaseFlow OpenAI hop has correlated `executionId` (CTRL-017). Other sibling executions remain unreported.
12. **Outcome acceptable:** MISSING for siblings; Atlas-self fulfill only.
13. **Learn without autonomous policy change:** PARTIAL — CTRL-019 (`ecdae7b`) proposal/decision/audit exists; `autoApply: false`. Repeated-FAILURE runtime unproven. No autonomous policy mutation.
14. **2026 research core vs optional:** see §5. Core = identity, pre-exec authz, SoD, kill honesty, audit, plane separation. Optional/external = FinOps product, router, NLI, OTel, portable hop fields until a hop exists.
15. **Smallest architecture:** Identity → Authorization → Approval → next-hop authority → Audit, plus observational telemetry/portfolio. Everything else waits for truthful application attestation.

---

*End of Master Plan. Update this file after every task, gap, correction, or blocker change.*
