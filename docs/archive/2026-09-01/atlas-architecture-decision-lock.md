# ATLAS — Architecture Decision Lock & Implementation Boundary Review

**Status: MANDATORY ARCHITECTURE REVIEW — NO CODE CHANGES AUTHORIZED.** Nothing in the repository has been modified, moved, renamed, deleted, or duplicated to produce this document. This is documentation only, prepared against `taqonu-main` as it exists on disk and in production on 2026-09-01.

This document supersedes nothing already true in the repository — it locks interpretation, it does not redesign. Where this document restates something from `atlas-product-boundary-architecture-review.md` or `atlas-control-plane-architecture-decision-report.md`, it is because that finding is still current; both documents remain valid background detail behind this one.

---

## 1. Executive Decision

The repository already contains substantial, real governance infrastructure: an Operating Cycle, a Control Plane, a policy/risk/audit gate, an evidence system, a 13-state epistemic memory system, a knowledge corpus, a 16-agent Fabric catalog with cognitive roles, and a Managed-Systems portfolio registry. **None of this needs to be rebuilt.** The problem this review documents is not missing architecture — it is that several already-built pieces are disconnected, incomplete, duplicated, or sitting in the wrong trust boundary.

Per the Owner's direction (§6 of this document), the locked target for Control Plane is: **it remains the central live enforcement boundary for governed operations across both products.** Its current incompleteness is not evidence that this target is wrong — it is the gap this document exists to describe.

Four gaps are identified, none yet fixed, none yet started:

| ID | Gap | Priority |
|---|---|---|
| G1 | Control Plane is not the live enforcement path | P0 |
| G2 | Internal AI second-opinion / adversarial review is missing | P1 |
| G3 | Managed-System AI supervision is missing | P1 |
| G4 | Admin boundary is scattered across two surfaces | P1 |

This document ends with a list of decisions that genuinely require Owner approval before any implementation begins. Everything else is either already decided (by the Product Definition and by this document locking Control Plane's target role) or is analysis with no decision pending.

---

## 2. Product Definition (locked)

Atlas Core is **one platform, one monorepo**, containing **two products**:

**Product A — Atlas Engineering.** For software engineers and technical users: code understanding, repository analysis, architecture, debugging, QA, security, accessibility, testing, research, AI-assisted engineering, expert/agent collaboration, adversarial review, evidence-based verification, engineering workflow supervision. Works on the user's own software projects. Not a chatbot — engineering intelligence plus supervised AI execution.

**Product B — Atlas Protection.** The governance/protection layer over external Managed Systems — their own applications, agents, third-party or internal AI systems, workflows, business processes, databases, integrations, automated actions. Confirmed Managed Systems in the repository's own portfolio data: Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy, Civio/Michtavia. **These systems are not Atlas.** An external agent is never treated as an Atlas agent merely because it shares a name (this matters concretely — see §13, Vantera).

**Admin is not a third product.** It is a privileged Owner-management surface shared by both products, covering (as applicable): policies, governance configuration, AI providers, agent configuration, permissions, Managed Systems, integrations, knowledge boundaries, verification configuration, audit/governance state, system health, operational controls. The existence of `apps/admin` does not mean everything needed already lives there — confirmed false; see §5.

**Control Plane is not a third product.** It is shared enforcement/governance serving both products — decides/governs/enforces the boundary; does not itself execute. Execution stays in `apps/api`/`apps/worker`. See §6.

---

## 3. Current architecture — verified against code

| App | Runs as | Confirmed responsibility |
|---|---|---|
| `apps/web` (`@atlas/web`) | Next.js 15, port 3000 | Single user-facing surface; route tree mixes both products (full classification in §12) |
| `apps/api` (`@atlas/api`) | Node/Fastify, port 4000 | Shared backend, 55 route files. Runs `packages/agent-core` directly for authorization on most actions, for both products. Forwards select domain events to Control Plane, one-way, fire-and-forget. |
| `apps/admin` (`@atlas/admin`) | Separate Node server, port 3200 | Thin: `admin-auth.ts`, `browser-session.ts`, `owner-html.ts`, `server.ts` — auth + rendered HTML shell only. Its own `package.json` describes it as "separate trust boundary from apps/web." |
| `apps/control-plane` (`@atlas/control-plane`) | Separate Node server, port 3100, "Atlas Sentinel" | Own doc comment: a self-contained HTML governance overview — agent registry, audit trail, policies, health, risk metrics. Also hosts the built-but-unused governed gateway (§6). Deployed live at `taqonu-control-plane.vercel.app`, confirmed reachable in production. |
| `apps/worker` (`@atlas/worker`) | Background job processor | `state.reconcile` confirmed real (calls `packages/state`'s `reconcileProjectState`). Other declared job kinds (`github.initial_sync`, `github.webhook_ingest`, `embeddings.generate`, `memory.extract`) fall through to a generic acknowledged-log with no processing shown in this file — not independently verified as implemented elsewhere in this pass. |

**Which flows currently enter the Operating Cycle, and which bypass it (§5's required determination):**

The 13-stage Operating Cycle (`REQUEST → IDENTITY → AUTHORIZATION → POLICY → RISK → DECISION → APPROVAL → PLAN → EXECUTE → EVIDENCE → VERIFY → REGRESSION → AUDIT → MEMORY`) is implemented in `apps/control-plane/src/services/operating-cycle.ts` and mirrored in `packages/shared/src/constants/operating-cycle.ts`. It is invoked by `evaluateGatewayRequest`/`dispatchGatewayOperation` in `atlas-gateway.ts`, reachable at `POST /api/v1/gateway/ops`.

Verified by repository-wide search: **`gateway/ops` has zero callers anywhere in the repo** — not from `apps/web`, not from `apps/api`. Every real production flow — for both Atlas Engineering and Atlas Protection — currently bypasses the Operating Cycle entirely and is instead authorized by `packages/agent-core`'s `authorizeEntityAction`/`enforceEntityWrite`, called directly from `apps/api` routes (`remediation.ts`, `approvals.ts`). This bypass is **not intentional design** — the gateway code, its forbidden-self-mutation list, and its operator-only fulfill hop (`apps/api/src/routes/gateway-fulfill.ts`) are built specifically to be that live path and are simply not wired to it. This is the exact substance of Gap G1.

---

## 4. Product boundary (conceptual — not a deployment split)

```
                         TAQONU
                            │
                            ▼
                       ATLAS CORE
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
   ATLAS ENGINEERING   ATLAS PROTECTION   SHARED CORE
          │                 │                 │
     Engineers /        Managed Systems      Memory
     Developers         & their agents      Knowledge
     Code / AI                              State
     QA / Security                          Evidence
     Agents                                 Policies
     Verification                           Verification
                                            Audit
                                            AI Supervision
                            │
                            ▼
                     CONTROL PLANE
                     Shared Enforcement
                            │
                            ▼
                         EXECUTION
                            │
                            ▼
                         AUDIT
                            │
                            ▼
                         MEMORY
                            ▲
                            │
                         ADMIN
                   Owner Management
                 shared across both
                      products
```

The monorepo stays one monorepo. No repository split, no second Atlas repo, no separate ArletOS platform, no second orchestration platform, no duplicated shared infrastructure, no physical separation of the two products — none of this is authorized by this document.

---

## 5. Admin boundary

Two surfaces exist today, confirmed by direct inspection, and they are an architectural conflict, not a duplication to silently resolve:

| Surface | What's actually there |
|---|---|
| `apps/admin` (port 3200, declared separate trust boundary) | `admin-auth.ts`, `browser-session.ts`, `owner-html.ts`, `server.ts` — auth and an HTML shell. No policy, provider, agent, or knowledge management UI. |
| `apps/web/app/admin/*` (inside the customer-facing app) | `layout.tsx`, `page.tsx`, `leads/page.tsx` (CRM-style lead list, calls `/api/v1/admin/leads`), `login/page.tsx`, `marketplace/page.tsx`, `oracle/page.tsx`, `users/page.tsx` — real React pages with real data. |

Per-route classification against the questions in the review mandate:

| Route | Owner-only? | Operational admin? | Product functionality? | Privileged trust required? | Classification |
|---|---|---|---|---|---|
| `leads/page.tsx` | Yes | Yes (CRM) | No | Yes | Admin — currently in wrong surface |
| `login/page.tsx` | Yes (admin login) | Yes | No | Yes | Admin — currently in wrong surface |
| `marketplace/page.tsx` | Ambiguous — needs direct confirmation whether this is the owner-facing AI-provider marketplace config or a customer-facing feature; not fully disambiguated in this pass | — | Possibly | Possibly | Flagged ambiguous — see below |
| `oracle/page.tsx` | Yes | Yes | No | Yes | Admin — currently in wrong surface, see detail below |
| `users/page.tsx` | Yes | Yes | No | Yes | Admin — currently in wrong surface |

**`oracle` — classified in detail, per the review mandate's specific instruction, not moved.** It is a real, working owner-only security-intelligence feature: a codename/mission/gates/roadmap/allowlist/daily-brief UI, backed by `apps/api/src/services/admin-oracle-intel.ts` and `admin-oracle-queue.ts`, which consume `packages/observer`'s `DEFENSIVE_ADVISORIES` and `isVersionBelow` to surface version-instability and advisory-match findings from allowlisted catalogs only. It is not a placeholder. It is owner-only, governance-adjacent, and currently protected only by whatever auth gate exists inside `apps/web`'s own routing — not by the dedicated, separately-deployed trust boundary `apps/admin` exists specifically to provide. **Recommended boundary: this belongs in `apps/admin`'s trust boundary.** Whether `apps/web`'s current auth gate is actually equivalent to `apps/admin`'s in practice has not been independently verified in this pass and should be confirmed before treating the current placement as either urgent or benign.

**`marketplace` — flagged ambiguous, per the review mandate's explicit instruction to flag rather than guess.** Not disambiguated in this pass whether this is owner configuration of the AI-provider marketplace (`AI_PROVIDER_CATALOG`, `apps/api/src/routes/ai-providers.ts`) or a user-facing feature that happens to live under `/admin` by convention. Needs a direct read of the component before classification.

No file has been moved, merged, or rewritten to produce this table.

---

## 6. Control Plane boundary — locked target and current gap

**Locked target, per Owner direction:** Control Plane remains the central live enforcement boundary for governed operations, for both products. It decides/governs/enforces; it does not execute. Execution stays in `apps/api`/`apps/worker`.

```
USER / AGENT / SYSTEM REQUEST
              │
              ▼
        ATLAS API / ENTRY
              │
              ▼
        CONTROL PLANE
              │
              ├── Identity
              ├── Authorization
              ├── Policy
              ├── Risk
              ├── Decision
              ├── Approval
              └── Plan
              │
              ▼
          EXECUTION
              │
              ▼
          EVIDENCE
              │
              ▼
         VERIFICATION
              │
              ▼
         REGRESSION
              │
              ▼
            AUDIT
              │
              ▼
           MEMORY
```

**Current reality, verified against code and against production:**

- `apps/control-plane/src/services/atlas-gateway.ts` implements exactly this cycle (`evaluateGatewayRequest`, `dispatchGatewayOperation`), reachable at `POST /api/v1/gateway/ops`, with an operator-only handoff at `POST /api/v1/gateway/fulfill` (`apps/api/src/routes/gateway-fulfill.ts`). **Neither has any caller in the repository.** The gateway is built, tested, and unreached.
- The only live wire between `apps/api` and Control Plane is `apps/api/src/services/control-plane-bridge.ts`: one-way, asynchronous, explicitly fail-open ("tenant work must not break if :3100 is down"), forwarding a small set of event types to `POST /api/v1/gateway/events`. This is telemetry, not a gate — nothing waits for a response.
- **Confirmed live in production, 2026-09-01**: the `applicationId` this bridge sends is hardcoded to `"def-000"` — Atlas itself. `apps/control-plane/src/services/application-registry.ts`'s in-memory registry is seeded only with Atlas; nothing else has ever been registered, because the only code path that would register something else (`upsertRegisteredApplication`, called only from the same unused `atlas-gateway.ts`) is never reached. The live dashboard at `taqonu-control-plane.vercel.app` states "0 נקודות עיוורות" (0 blind spots) and shows the legacy 9-agent registry — both are not accurate descriptions of what Control Plane can actually see.
- What is actually authorizing every real write action today, for both products: `packages/agent-core`'s `authorizeEntityAction`/`enforceEntityWrite`, called directly from `apps/api` routes (`remediation.ts`, `approvals.ts`). Fail-open telemetry is not equivalent to this, and must not be described as a blocking governance gateway.

**This is Gap G1** — full breakdown, including the implementation-boundary framework required by §21 of the review mandate, is in §14–15.

---

## 7. Shared Core

Five capabilities, each with an existing, distinct architectural responsibility. None are to be merged for convenience:

| Capability | Responsibility | Package/location | Status |
|---|---|---|---|
| Memory | Historical/epistemic information — what Atlas knows, observed, decided, learned | `packages/shared` — 13-state epistemic memory (`FACT, CONFIRMED, VERIFIED, OBSERVED, INFERRED, ASSUMED, PROPOSED, UNVERIFIED, CONTRADICTED, STALE, UNKNOWN, CONFLICTED, INSUFFICIENT_EVIDENCE`) | Live |
| Knowledge | Verified/retrievable domain knowledge, RAG corpus | `packages/knowledge` | Live |
| State | Current project/system operational state | `packages/state` (`ProjectStateSnapshot`) | Live |
| Evidence | Support for a specific decision, action, verification, or claim | `packages/agent-core` evidence-bus, evidence-sufficiency | Live |
| Audit | Historical record of governed operations and decisions | `apps/api/audit-log.ts`, hash-chained | Live |

Additional Shared Core infrastructure: Agents (`packages/agent-core` Fabric catalog, 16 agents — §10), Policies (`authorizeEntityAction`/`enforceEntityWrite` — the mechanism actually enforcing both products today), Verification (`packages/agent-core/judge/evaluate.ts`, rule-based, no second-opinion input yet), and AI Supervision (§8 — the one capability that is net-new, not yet built).

---

## 8. AI Supervision

AI Supervision is not a fifth product, not a new database, not a replacement for the Operating Cycle. It is a cross-cutting capability inside Shared Core that consumes existing Atlas context — intent, operational history, current state, evidence, permissions, policies, prior actions/approvals/rejections/outcomes, agent state, memory, verified knowledge, audit history, regression results — and provides contextual intelligence to the existing governance and agent infrastructure. It must not become a parallel governance universe alongside the Operating Cycle; it feeds the Operating Cycle (once G1 connects it) or feeds `authorizeEntityAction` directly (today, while G1 is unresolved in practice).

AI Supervision has two genuinely distinct instances, not one:

- **Internal** (Atlas Engineering) — second-opinion/adversarial review of Atlas's own agents (§10).
- **External** (Atlas Protection) — supervision of Managed Systems' own agents (§11).

These are different capabilities with different code boundaries and must not be built as one undifferentiated "supervision engine."

---

## 9. AI Provider Fabric

External AI models are workers, not authorities. Confirmed live and real: `apps/api/src/routes/ai-providers.ts`'s `AI_PROVIDER_CATALOG` (from `packages/shared`), with per-provider availability computed from actual env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`) and a credit/pricing model. One default free agent is explicitly named **"ArletOS Agent"** (`"arletos-included"`) — confirming again that "ArletOS" denotes a specific default agent persona in this product, not an architecture layer (see §16).

What Atlas must retain control over, per the locked model: which provider/model is used and why, what context and permissions and evidence it receives, what it's allowed to do, how its output is evaluated, whether another specialist must review it, whether the result is sufficiently verified, whether execution may proceed. **None of this routing-by-risk logic exists yet** — today, provider choice is a user-facing marketplace pick, not a supervision-driven decision. This is part of Gap G2, not a separate gap — the cognitive roles that would make this decision (`ADVERSARY`, `EVIDENCE_JUDGE`, `FINAL_VERIFIER`, `AUDITOR`, `CHALLENGER`) already exist in the Fabric catalog and must be reused, not duplicated.

---

## 10. Internal Agent Supervision (Atlas Engineering second-opinion)

**Existing architecture that must be reused, not duplicated:** `packages/shared/src/constants/agents.ts` defines `FABRIC_AGENT_CATALOG` — 16 agents (`ORCHESTRATOR, ARCHITECT, CODE_ENGINEER, DEBUGGER, QA, TEST_ENGINEER, SECURITY, ACCESSIBILITY, UI_UX, DEVOPS, RESEARCHER, OMISSION_DETECTOR, LEGAL_MEDIA_COMMS, JUDGE, ADVERSARY, DATABASE`) — and `COGNITIVE_ROLE_CATALOG` (`INVESTIGATOR/DIAGNOSTICIAN/BUILDER/ADVERSARY/AUDITOR/CHALLENGER/ARCHITECT/EVIDENCE_JUDGE/FINAL_VERIFIER/PLANNER/RESEARCHER`), plus a per-agent `cannotSelfValidate` flag.

**Conceptually, how this should work** (the flow the review mandate specifies, mapped onto existing catalog names — no new framework):
```
Agent A produces result
        ↓
Independent Agent / Cognitive Role (ADVERSARY / EVIDENCE_JUDGE / FINAL_VERIFIER) reviews result
        ↓
Evidence / contradiction analysis  (packages/agent-core evidence-bus)
        ↓
Verification  (packages/agent-core judge/evaluate.ts)
        ↓
Decision  (ALLOW / MODIFY / INVESTIGATE / SECOND_OPINION / REQUIRE_APPROVAL / BLOCK / ESCALATE)
```

**Current reality, verified:** `runSpecialistStub` (`packages/agent-core/src/orchestrator/dispatch.ts`) is the default execution path for every Fabric agent except SECURITY and LEGAL_MEDIA_COMMS — no real model call happens for the other 14. `router/genius.ts`'s `geniusRoute` sets `modelHint: "multi+human"` on some routes; repository-wide search finds **zero consumers** of that hint. `ADVERSARY` appears exactly once outside its own catalog definition — a static marketplace category label in `agent-marketplace.ts`, never an invocation. `cannotSelfValidate` is a checked-in, real flag with **no enforcement behind it** — an agent flagged unable to self-validate is, today, self-validating by default, because no alternative path exists. This is a genuine, confirmed implementation gap, not a missing architecture — the catalog, the roles, and the flag are all real; only the behavior is missing.

This is **Gap G2** — full breakdown in §14–15.

---

## 11. Managed-System Supervision (Atlas Protection)

This is a separate capability from §10, not a variant of it — the difference is who produced the result being reviewed (Atlas's own agent vs. an external system's own agent) and what trust level applies.

```
Managed System
      │
      └── External Agent
              │
              ▼
        Proposed / Actual Action
              │
              ▼
        Atlas Protection
              │
              ├── Identity
              ├── Policy
              ├── Risk
              ├── Evidence
              ├── Verification
              ├── History
              └── Decision
```

**Current reality, verified:** Atlas's only relationship with the six Managed Systems (Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy, Civio) is a static portfolio record (`packages/shared/src/portfolio/seed.ts`, pinned to specific commit hashes, seeded 2026-08-28 to 2026-08-30) plus five owner-approved, one-time, knowledge-only ingestion events, explicitly recorded under `IMPORT_KNOWLEDGE_ONLY`, `sourceExecutionPerformed: false`, `permissionsInherited: false`, `atlasAgentsCreated: 0`. **Confirmed live in production, 2026-09-01**: all six systems are independently deployed and running right now (`hotel-os-ai-api-eight.vercel.app`, `broker-os-web-henna.vercel.app`, `civioapps.vercel.app`, `case-flow-veridict.vercel.app`, and others, all visible in the Owner's own Vercel account) — and none of them send any live event, webhook, or API call to Atlas. Importing knowledge from a system's repository once, with owner approval, is not continuous supervision of that system's running agents — these are different capabilities, and the repository correctly has not conflated them; it simply hasn't built the second one yet.

This is **Gap G3** — full breakdown in §14–15.

---

## 12. Complete Route/Service Classification

Every route classified into `ATLAS_ENGINEERING`, `ATLAS_PROTECTION`, `ADMIN`, `CONTROL_PLANE_ENFORCEMENT`, or `SHARED_CORE`, based on route implementation, imports, authorization, data access, execution path, Control Plane interaction, UI purpose, and trust boundary — not filename alone.

### `apps/web/app/[locale]/*`

| Bucket | Routes |
|---|---|
| ATLAS_ENGINEERING | `agent`, `agents`, `chat`, `models`, `experts`, `artifacts`, `eval`, `qa`, `patches`, `studio`, `workbench`, `proof` |
| ATLAS_PROTECTION | `systems`, `systems/[id]`, `truth`, `health`, `readiness`, `gates`, `sentinel`, `observer`, `process-audit`, `partners`, `contract`, `legal-media` |
| SHARED_CORE | `memory`, `state`, `decisions`, `conflicts`, `integrations`, `ops`, `ops/metrics`, `projects`, `projects/[id]`, `plan`, `settings`, `settings/billing`, `auth/*`, `welcome`, `marketing`, `investors` |
| Ambiguous | `[section]` — generic dynamic route; purpose not independently confirmed by reading its implementation in this pass |

### `apps/web/app/admin/*`

| Bucket | Routes |
|---|---|
| ADMIN | `layout.tsx`, `page.tsx`, `leads/page.tsx`, `login/page.tsx`, `oracle/page.tsx`, `users/page.tsx` |
| Ambiguous | `marketplace/page.tsx` — see §5 |

### `apps/admin/*`

| Bucket | Files |
|---|---|
| ADMIN | `admin-auth.ts`, `browser-session.ts`, `owner-html.ts`, `server.ts` |

### `apps/api/src/routes/*` (55 files)

| Bucket | Routes |
|---|---|
| ATLAS_ENGINEERING | `agent.ts`, `agent-fabric.ts`, `agent-lifecycle.ts`, `artifacts.ts`, `code.ts`, `conversation.ts`, `engineering-audit.ts`, `engineering-loop.ts`, `eval.ts`, `eval-ci-gate.ts`, `exemplars.ts`, `experts.ts`, `kernel.ts`, `qa.ts`, `research.ts` |
| ATLAS_PROTECTION | `gates.ts`, `github.ts`, `graph.ts`, `legal-media.ts`, `observer.ts`, `portfolio.ts`, `portfolio-governance.ts`, `readiness.ts`, `remediation.ts`, `security-sarif.ts`, `sentinel.ts`, `systems.ts` |
| ADMIN | `admin-ops.ts` |
| CONTROL_PLANE_ENFORCEMENT | `gateway-fulfill.ts` — built specifically to consume Control Plane's `ALLOW` decision; currently unreachable in practice because nothing calls `gateway/ops` upstream of it (§6) |
| SHARED_CORE | `ai-providers.ts`, `approvals.ts`, `audit.ts`, `auth.ts`, `billing.ts`, `byo-cloud.ts`, `commercial.ts`, `conflicts.ts`, `connections.ts`, `contact.ts`, `cost-intelligence.ts`, `db-feeds.ts`, `decisions.ts`, `deploy-feeds.ts`, `events.ts`, `evidence.ts`, `health.ts`, `integrations.ts`, `intelligence.ts`, `knowledge.ts`, `memory.ts`, `metrics.ts`, `performance.ts`, `plugins.ts`, `projects.ts`, `provider-adapters.ts`, `state.ts` |

### `apps/control-plane/src/*`

| Bucket | Files | Note |
|---|---|---|
| CONTROL_PLANE_ENFORCEMENT | `atlas-gateway.ts`, `routes/api.ts` (`gateway/ops`, `gateway/events`, `gateway/fulfill` contract) | Designed enforcement path; only `gateway/events` is actually reached, and only for `applicationId: "def-000"` |
| CONTROL_PLANE_ENFORCEMENT (oversight, not enforcement, despite the bucket name) | `routes/dashboard.ts`, `agent-registry.ts`, `application-registry.ts`, `self-audit.ts`, `portfolio-governance-view.ts` | Read-only display of whatever telemetry has arrived |

**Route-level totals** (unchanged from the prior review, restated for completeness): roughly 15 Engineering + 12 Protection routes in `apps/web`; 15 Engineering + 12 Protection routes in `apps/api`; the remainder genuinely shared.

---

## 13. Conflict Check

1. **Two Admin surfaces** — `apps/admin` (thin, declared separate trust boundary, underbuilt) vs. `apps/web/app/admin/*` (real features, including a genuine owner-only security-intelligence feature, `oracle`, currently relying on `apps/web`'s own auth rather than the dedicated boundary built for this purpose). Neither has been moved, merged, or rewritten. See §5.
2. **Two agent registries** — Control Plane's `agent-registry.ts` (9 legacy oversight labels, explicitly commented in the code itself: *"NOT the Atlas execution registry and MUST NOT become one"*) vs. `FABRIC_AGENT_CATALOG` (16 real agents, the actual execution architecture). Per §19 of the review mandate and the repository's own comment, these are intentionally distinct and must not be merged. `FABRIC_AGENT_CATALOG` is the relevant execution architecture; the legacy registry is oversight-only and should stay that way, or be explicitly retired — not silently merged.
3. **Control Plane's governed gateway is fully built and completely unreached** — confirmed in code and, as of 2026-09-01, confirmed live in production (the dashboard's own "0 blind spots" claim does not hold up against what it can actually see). This is Gap G1.
4. **The Fabric catalog's adversarial/cannot-self-validate design has zero running instances** — confirmed by exhaustive repository-wide search, not a spot check. This is Gap G2.
5. **The Vantera "Atlas" naming collision remains open** — the portfolio's own governance data records an unresolved `ESCALATE` decision (`decidedBy: null`, `decidedAt: null`, status `PROPOSED`): *"CONFLICTING: Vantera uses 'Atlas' as product name. This is NOT taqonu Atlas. Requires explicit Owner resolution before any action."* This must be resolved before any live connection to Vantera specifically (see §11, §20).
6. **README documents only Atlas Protection**, not Atlas Engineering — a documentation completeness gap, not a code gap; noted for completeness, not treated as one of the four priority gaps.
7. **No code path specifically supervises a Managed System's own AI agent's live output** — what exists is one-time knowledge ingestion, not ongoing supervision. This is Gap G3, distinct from Gap G2.

Nothing above has been changed, fixed, merged, or worked around — flagged only, per the review mandate.

---

## 14. Gap Matrix

| ID | Gap | Current Reality | Intended Reality | Exact Code Boundary | Minimum Change | Risk | Priority |
|---|---|---|---|---|---|---|---|
| G1 | Control Plane not live enforcement path | Every real write action is authorized directly by `packages/agent-core`'s `authorizeEntityAction`/`enforceEntityWrite`, called from `apps/api` routes (`remediation.ts`, `approvals.ts`). Control Plane receives one-way, fail-open telemetry only, and only for `applicationId: "def-000"` (Atlas itself). `gateway/ops`/`gateway/fulfill` have zero callers, confirmed in code and in production. | Per the locked target (§6): Control Plane is the live enforcement boundary — Identity/Authorization/Policy/Risk/Decision/Approval/Plan all resolve there before `apps/api` executes. | `apps/control-plane/src/services/atlas-gateway.ts` (`evaluateGatewayRequest`, `dispatchGatewayOperation`); `apps/control-plane/src/routes/api.ts` (`gateway/ops`, `gateway/fulfill`); `apps/api/src/routes/gateway-fulfill.ts`; `apps/api/src/services/control-plane-bridge.ts`; the call sites currently calling `authorizeEntityAction`/`enforceEntityWrite` directly (`apps/api/src/routes/remediation.ts`, `approvals.ts`) | Route `apps/api`'s authorization calls through `gateway/ops` → `gateway/fulfill` instead of calling `packages/agent-core` directly, so the existing Operating Cycle becomes the actual gate for both products | Every authorized write action in both products depends on this path; a non-identical handoff semantics is a regression risk across the whole platform; reintroduces a hard runtime dependency on `:3100` being up, which the current fail-open design deliberately avoids — this trade-off needs explicit Owner sign-off (§20) | P0 |
| G2 | Internal AI second-opinion missing | `runSpecialistStub` is the default path for 14 of 16 Fabric agents (all except SECURITY, LEGAL_MEDIA_COMMS) — no real model call. `modelHint: "multi+human"` is set but has zero consumers. `cannotSelfValidate` is a real flag with no enforcement. | `ADVERSARY`/`EVIDENCE_JUDGE`/`FINAL_VERIFIER` cognitive roles actually review another agent's output before a decision (ALLOW/MODIFY/INVESTIGATE/SECOND_OPINION/REQUIRE_APPROVAL/BLOCK/ESCALATE) is reached, using existing catalog names, no new framework | `packages/shared/src/constants/agents.ts` (`FABRIC_AGENT_CATALOG`, `COGNITIVE_ROLE_CATALOG`, `cannotSelfValidate`); `packages/agent-core/src/router/genius.ts` (`modelHint`); `packages/agent-core/src/orchestrator/dispatch.ts` (`runSpecialistStub`); `packages/agent-core/src/judge/evaluate.ts` | Wire `modelHint: "multi+human"` to an actual second model call on the routes that already set it (additive, hint already exists); feed operational history into `judge/evaluate.ts` as an added input, not a replacement | Real model calls add cost and latency to currently-instant stubbed paths — needs a plan for which agents go first, not all 16 at once; judge-logic changes touch a path other code may assume is deterministic | P1 |
| G3 | Managed-System AI supervision missing | Only a static portfolio snapshot (`packages/shared/src/portfolio/seed.ts`) plus five one-time, owner-approved, knowledge-only ingestions. Confirmed live in production: zero webhook/API/event traffic from any of the six Managed Systems' own (independently, currently live) deployments into Atlas. | Atlas Protection observes proposed/actual actions from Managed Systems' own agents and runs them through Identity/Policy/Risk/Evidence/Verification/History/Decision, per §11's diagram | `packages/shared/src/portfolio/seed.ts`; `apps/api/src/routes/systems.ts`, `portfolio.ts`, `portfolio-governance.ts`, `sentinel.ts`; `apps/control-plane/src/services/application-registry.ts` | Not yet definable — requires an Owner decision on connector shape (push/webhook vs. pull/poll vs. GitHub-only observation, matching the existing pattern) before a minimum change can be scoped | Six independently-deployed, independently-evolving external products is real ongoing integration surface; the open Vantera naming collision must be resolved before connecting Vantera specifically, to avoid conflating Atlas's own "Atlas" with Vantera's unrelated feature of the same name | P1 |
| G4 | Admin boundary scattered | `apps/admin` (declared separate trust boundary) is thin/underbuilt; the real features (`leads`, `oracle`, `users`, and ambiguously `marketplace`) live inside `apps/web/app/admin/*`, protected by `apps/web`'s own auth rather than the dedicated boundary | One privileged Admin surface, in `apps/admin`'s trust boundary, for all owner-management functionality across both products | `apps/web/app/admin/*` (all files); `apps/admin/*` (all files); `apps/api/src/services/admin-oracle-intel.ts`, `admin-oracle-queue.ts` | Move the real pages and their auth gate into `apps/admin`'s deployment and trust boundary — or, as a lighter first step, independently verify and document that `apps/web`'s current auth on these routes is equivalent, before deciding whether a full move is urgent | A full move touches routing, auth, and any URLs the Owner currently uses directly; the lighter alternative leaves the trust-boundary split in place with more confidence it isn't currently exploitable | P1 |

No additional gaps are added beyond these four — nothing else in this pass produced repository evidence rising to the same level of confirmed, concrete gap.

---

## 15. Implementation Boundary (per gap, not yet authorized)

### G1 — Control Plane live enforcement

- **MUST CHANGE**: `apps/api` route call sites for authorization (`remediation.ts`, `approvals.ts`, and any other direct `authorizeEntityAction`/`enforceEntityWrite` callers) — to route through `gateway/ops`/`gateway/fulfill` instead.
- **MUST NOT CHANGE**: `authorizeEntityAction`/`enforceEntityWrite`'s own internal logic and invariants — this document does not propose touching them; it proposes changing what calls them, or replacing the call site with a call to Control Plane, which internally still needs to reach equivalent logic.
- **MUST NOT DUPLICATE**: the 13-stage Operating Cycle, the forbidden-self-mutations list, the idempotency handling already built in `atlas-gateway.ts` — reuse, do not rebuild a second version inside `apps/api`.
- **SECURITY BOUNDARY**: policy/risk/authorization decisions remain server-side, inside Control Plane once wired; `apps/api` must not make its own authorization decision once this is live — it requests one.
- **DATA BOUNDARY**: request context (identity, intent, target resource) crosses from `apps/api` to Control Plane on every governed call; this is new production traffic volume through `:3100` that does not exist today.
- **EXECUTION BOUNDARY**: `apps/api`/`apps/worker` remain the only components that execute — Control Plane decides, never executes, per the locked model in §6.
- **GOVERNANCE BOUNDARY**: Control Plane's `gateway/ops` → `gateway/fulfill` becomes the component that decides whether an operation may proceed, once wired.

### G2 — Internal second-opinion

- **MUST CHANGE**: `router/genius.ts` (consume `modelHint`), `orchestrator/dispatch.ts` (real execution path for agents beyond SECURITY/LEGAL_MEDIA_COMMS, starting with a defined subset), `judge/evaluate.ts` (accept operational-history input).
- **MUST NOT CHANGE**: the existing rule-based `judge/evaluate.ts` path for agents/flows not yet given real execution — this is additive, not a replacement.
- **MUST NOT DUPLICATE**: `FABRIC_AGENT_CATALOG`, `COGNITIVE_ROLE_CATALOG`, `cannotSelfValidate` — use these exactly as they exist; do not create a second agent-role system.
- **SECURITY BOUNDARY**: an agent flagged `cannotSelfValidate` must not be treated as verified without an independent reviewing agent's pass, once implemented.
- **DATA BOUNDARY**: operational history (prior actions/approvals/rejections/outcomes) becomes an input to `judge/evaluate.ts` — this is internal to Atlas Engineering, no cross-product or cross-system data movement.
- **EXECUTION BOUNDARY**: real model calls happen inside `packages/agent-core`, same as today's SECURITY/LEGAL_MEDIA_COMMS path — no new execution component.
- **GOVERNANCE BOUNDARY**: `judge/evaluate.ts`, extended, decides the verdict; whether that verdict is enforced by Control Plane or by `packages/agent-core` directly depends on G1's resolution.

### G3 — Managed-System supervision

- **MUST CHANGE**: not yet definable — no minimum change until a connector shape is decided (Owner decision, §20).
- **MUST NOT CHANGE**: the portfolio's own existing invariants — `IMPORT_KNOWLEDGE_ONLY`, `sourceExecutionPerformed: false`, `permissionsInherited: false`, `atlasAgentsCreated: 0` — even once live supervision exists, these must continue to hold for anything beyond observation and judgment.
- **MUST NOT DUPLICATE**: `packages/observer`'s existing behavior-diff/security-scan machinery, already used for Atlas's own connected repos — reuse for Managed Systems where the shape fits, rather than building a parallel observer.
- **SECURITY BOUNDARY**: Atlas must never inherit execution authority, credentials, or permissions from a Managed System — an external agent's output is evidence/input, never automatic truth.
- **DATA BOUNDARY**: only knowledge/evidence crosses from a Managed System into Atlas, under existing governance rules and explicit ownership/permission boundaries — never code, credentials, or execution logic.
- **EXECUTION BOUNDARY**: Atlas never executes on behalf of a Managed System; it only evaluates.
- **GOVERNANCE BOUNDARY**: whichever mechanism G1 resolves to (Control Plane or `packages/agent-core`) becomes where a Managed-System-sourced proposed action is judged.

### G4 — Admin boundary

- **MUST CHANGE**: `apps/web/app/admin/leads`, `login`, `oracle`, `users` (and `marketplace`, once disambiguated) — moved into `apps/admin`'s deployment, or their auth gate independently verified as equivalent if not moved yet.
- **MUST NOT CHANGE**: the actual functionality of `leads`, `oracle`, `marketplace`, `users` — this is a boundary/trust move, not a feature rewrite.
- **MUST NOT DUPLICATE**: `admin-oracle-intel.ts`/`admin-oracle-queue.ts` — reused as-is regardless of which surface calls them.
- **SECURITY BOUNDARY**: owner-only functionality must be gated by `apps/admin`'s dedicated trust boundary, not by `apps/web`'s general auth, once moved.
- **DATA BOUNDARY**: no new data boundary crossed — this is a relocation of an existing UI/auth surface, not a new data flow.
- **EXECUTION BOUNDARY**: unchanged — `admin-oracle-intel.ts`/`admin-oracle-queue.ts` continue to execute the same way regardless of which app calls them.
- **GOVERNANCE BOUNDARY**: unchanged by this gap specifically — this is a trust-boundary and routing question, not a policy-decision question.

---

## 16. Security Boundaries (platform-wide, restated from the gaps above)

- Policy/risk/authorization decisions must remain server-side and, per the locked target, ultimately resolve through Control Plane — `apps/api` must not become a second place that makes authorization decisions once G1 is resolved.
- `cannotSelfValidate` must gate actual behavior once G2 is implemented — today it does not, which is a real, currently-live gap, not merely a future one.
- Atlas must never inherit permissions, credentials, execution authority, agent identity, trust, policies, or runtime behavior from a Managed System (G3) — knowledge import only, under existing governance rules.
- Owner-privileged functionality (`oracle`, `leads`, `users`, admin login) must sit inside `apps/admin`'s dedicated trust boundary, not inside `apps/web`'s general auth (G4).
- The Vantera naming collision (§13.5) is a security/trust boundary question, not merely a branding one — connecting Vantera without resolving it risks Atlas treating Vantera's unrelated "Atlas" feature as itself.

## 17. Data / Knowledge Boundaries

- Knowledge is not execution. External knowledge (from Managed Systems, or from any future ingestion) may only be imported per existing governance rules, and must not carry permissions, credentials, execution authority, agent identity, trust, policies, or runtime behavior with it.
- An external agent's output is evidence/input to Atlas's own judgment — never automatically treated as truth.
- Memory, Knowledge, State, Evidence, and Audit (§7) remain architecturally distinct; AI Supervision may read from all of them but does not replace or merge them.
- Cross-product data movement (Atlas Engineering ↔ Atlas Protection) has not been separately audited in this pass — both currently share the same policy/risk/audit mechanism (`packages/agent-core`), which is appropriate for Shared Core capabilities, but no boundary violation specific to product-to-product data leakage was investigated here and none should be assumed absent.

## 18. Dependencies

```
G1 (P0, Control Plane wiring)
   │
   ├──▶ G2 (P1, internal AI supervision)
   │        — also blocked on retiring runSpecialistStub for the agents chosen first
   │        — can start its prerequisite (real model execution for a defined subset) in parallel with G1
   │
   └──▶ G3 (P1, external AI supervision)
            — also blocked on an Owner decision on connector shape (§20)
            — also blocked on resolving the Vantera naming collision before connecting Vantera specifically

G4 (P1, admin boundary) — independent, no dependency on G1–G3; the auth-gate verification step can start immediately
```

## 19. Explicit Non-Goals

This document does not authorize, and this pass did not perform, any of the following: modifying source code, routes, database schemas, or authentication; moving files; deleting anything that looks like a duplicate; renaming Atlas or ArletOS; creating new agents, pipelines, or governance engines; connecting any external agent; enabling any new model execution; merging the two agent registries; merging the two admin surfaces; resolving the Vantera naming collision; deciding the G3 connector shape. All of these remain either explicitly deferred to Owner decision (§20) or simply not started.

## 20. Owner Decisions Required

These are analysis conclusions, not decisions — each genuinely needs your input before implementation of the relevant gap can begin:

1. **G1 scope and sequencing.** The target (Control Plane as live enforcement) is locked by this document per your direction in §6. What's not yet decided: do all `apps/api` authorization call sites move to route through `gateway/ops`/`gateway/fulfill` at once, or incrementally (e.g., `remediation.ts` first, `approvals.ts` second)? Incremental reduces regression blast radius but leaves the platform in a mixed state longer.
2. **G3 connector shape.** Push (Managed Systems send webhooks to Atlas), pull (Atlas polls their APIs), or GitHub-only (Atlas observes only what it can already see via repository connectors, the same pattern used for Atlas's own state)? This has different security, cost, and Managed-System-cooperation implications and has not been decided anywhere in the codebase.
3. **Vantera naming collision.** The portfolio's own `ESCALATE` decision has sat unresolved (`decidedBy: null`) since before this review began. Needs explicit resolution before any G3 work touches Vantera specifically.
4. **G4 approach.** Full move of `apps/web/app/admin/*` into `apps/admin` now, or verify-and-document the current auth as a faster interim step? A full move touches routing/auth and any URLs you currently use directly as Owner.
5. **`marketplace/page.tsx` classification.** Needs a direct read before it can be classified — is this owner configuration or a customer-facing feature living under `/admin` by convention?
6. **G2 rollout scope.** Real model calls cost money and add latency. Which agents get real execution first, once `runSpecialistStub` starts being retired for this purpose? This wasn't decided in this pass and shouldn't default to "all 16 at once."
7. **Legacy Control Plane agent registry (9 agents).** Explicitly retire it (with a migration note), or keep it as a permanently separate oversight-only list, clearly labeled as such wherever it's displayed (including fixing the live dashboard's current "0 blind spots" / agent-count copy, which is not accurate today)?

---

# OWNER APPROVAL REQUIRED

Only the decisions above genuinely require your approval before implementation proceeds. Restated as a simple approval list:

- [ ] Approve starting G1 implementation (Control Plane wiring), and choose all-at-once vs. incremental rollout
- [ ] Decide G3 connector shape (push / pull / GitHub-only) before any G3 implementation starts
- [ ] Resolve the Vantera naming collision before any G3 work touches Vantera
- [ ] Choose G4 approach (full move vs. verify-and-document interim step)
- [ ] Confirm `marketplace/page.tsx`'s actual purpose so it can be classified
- [ ] Approve which agents get real model execution first under G2, and confirm the cost/latency trade-off is acceptable
- [ ] Decide the fate of the legacy 9-agent Control Plane registry (retire vs. keep as clearly-labeled oversight-only) and approve fixing the live dashboard's inaccurate "0 blind spots" copy

Nothing else in this document is pending a decision — the product definition, the Control Plane target, the five-bucket classification, and the four-gap matrix are the locked basis for whichever of the above you approve first.

**STOP. No implementation has begun. Wait for explicit approval on the items above before starting any of G1–G4.**
