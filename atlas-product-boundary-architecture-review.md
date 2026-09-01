# Atlas — Product Boundary & Architecture Review (pre-implementation)

Status: **Architecture review only — no code changed, moved, renamed, or refactored.** Per the owner's explicit instruction, this document stops at Current Architecture → Target Architecture → Gap Matrix → Conflict Check. No implementation plan.
Prepared: 2026-08-31, directly against the repository at `taqonu-main`.
Revision note: this version corrects one claim from the prior draft after deeper verification — see §C.

---

## Product Definition (owner decision, 2026-08-31 — authoritative target for this review)

This is a **product/business boundary decision, not a code-restructuring instruction.** The monorepo stays exactly as it is — `apps/web`, `apps/api`, `apps/admin`, `apps/control-plane` — no split, no new deployables, unless evidence below proves one is already structurally required (it doesn't).

> **Atlas Core is ONE monorepo/platform with TWO distinct product experiences:**
> 1. **Atlas Engineering** — the AI-native engineering workspace for software professionals: coding, debugging, QA, architecture, agents, research, evaluation and second-opinion workflows.
> 2. **Atlas Protection** — the external Truth, Governance and AI Supervision layer for customer-managed systems and their AI agents. Managed Systems (HotelOS, Vantera, CaseFlow, BrokerOS, LexStudy, Civio) remain external systems; Atlas observes, verifies, governs and controls permitted actions over them. This capability is not removed or weakened anywhere in this review.
>
> **Admin** is not a third product — it is the privileged Owner management application for the entire platform.
> **Control Plane** is not a third product — it is the enforcement layer for authorization, policy, risk gates, approvals, execution governance, verification and audit.
> **Memory, Knowledge, Evidence, State, Agents, Policies, Verification, Audit** are shared Atlas Core capabilities used by both products.

---

## A. Current architecture — apps

| App | Runs as | Confirmed responsibility |
|---|---|---|
| `apps/web` (`@atlas/web`) | Next.js 15, port 3000 | Single user-facing surface. Route tree mixes both products — full mapping in §B. |
| `apps/api` (`@atlas/api`) | Node/Fastify, port 4000 | Single shared backend, 55 route files. Runs `@atlas/agent-core` directly for most actions (both products). Forwards select domain events to Control Plane, one-way, fire-and-forget (§C). |
| `apps/admin` (`@atlas/admin`) | Separate Node server, port 3200 | Thin: `admin-auth.ts`, `browser-session.ts`, `owner-html.ts`, `server.ts` — auth + rendered owner HTML shell. No policy/provider/agent/knowledge management UI yet. |
| `apps/control-plane` (`@atlas/control-plane`) | Separate Node server, port 3100, "Sentinel" | Its own doc comment: serves *"a self-contained HTML page... a governance overview: agent registry, audit trail, policies, health, and risk metrics."* Read-only oversight dashboard + a one-way telemetry receiver + a fully-built-but-uncalled governed gateway — see §C, this is the corrected section. |
| `apps/worker` (`@atlas/worker`) | Background job processor | Confirmed real: `state.reconcile` job calls `@atlas/state`'s `reconcileProjectState`. Other declared job kinds (`github.initial_sync`, `github.webhook_ingest`, `embeddings.generate`, `memory.extract`) fall through to a generic `job_acknowledged` log with no processing shown in this file — likely stubs or implemented elsewhere; not independently verified in this pass. |

---

## B. Full route/service mapping — Engineering / Protection / Admin / Control Plane / Shared Core

### `apps/web/app/[locale]/*` (every route)

| Product bucket | Routes |
|---|---|
| **Atlas Engineering** | `agent`, `agents`, `chat`, `models`, `experts`, `artifacts`, `eval`, `qa`, `patches`, `studio`, `workbench`, `proof` |
| **Atlas Protection** | `systems`, `systems/[id]`, `truth`, `health`, `readiness`, `gates`, `sentinel`, `observer`, `process-audit`, `partners`, `contract`, `legal-media` |
| **Shared Core** | `memory`, `state`, `decisions`, `conflicts`, `integrations`, `ops`, `ops/metrics`, `projects`, `projects/[id]`, `plan`, `settings`, `settings/billing`, `auth/*`, `welcome`, `marketing`, `investors`, `[section]` (generic dynamic route, purpose not independently verified) |

### `apps/web/app/admin/*` (separate from `apps/admin` — see §F.1)

`layout.tsx`, `page.tsx`, `leads/page.tsx` (CRM-style lead list, calls `/api/v1/admin/leads`), `login/page.tsx`, `marketplace/page.tsx`, `oracle/page.tsx` (owner strategic-intel briefing — see §F.1), `users/page.tsx`. All owner-facing, none customer-facing.

### `apps/api/src/routes/*` (all 55 files, classified)

| Product bucket | Routes |
|---|---|
| **Atlas Engineering** | `agent.ts`, `agent-fabric.ts`, `agent-lifecycle.ts`, `artifacts.ts`, `code.ts`, `conversation.ts`, `engineering-audit.ts`, `engineering-loop.ts`, `eval.ts`, `eval-ci-gate.ts`, `exemplars.ts`, `experts.ts`, `kernel.ts`, `qa.ts`, `research.ts` |
| **Atlas Protection** | `gates.ts`, `github.ts`, `graph.ts`, `legal-media.ts`, `observer.ts`, `portfolio.ts`, `portfolio-governance.ts`, `readiness.ts`, `remediation.ts`, `security-sarif.ts`, `sentinel.ts`, `systems.ts` |
| **Admin** | `admin-ops.ts` |
| **Control-Plane-adjacent** (built to consume Control Plane gateway decisions; currently unreachable in practice — §C) | `gateway-fulfill.ts` |
| **Shared Core** | `ai-providers.ts`, `approvals.ts`, `audit.ts`, `auth.ts`, `billing.ts`, `byo-cloud.ts`, `commercial.ts`, `conflicts.ts`, `connections.ts`, `contact.ts`, `cost-intelligence.ts`, `db-feeds.ts`, `decisions.ts`, `deploy-feeds.ts`, `events.ts`, `evidence.ts`, `health.ts`, `integrations.ts`, `intelligence.ts`, `knowledge.ts`, `memory.ts`, `metrics.ts`, `performance.ts`, `plugins.ts`, `projects.ts`, `provider-adapters.ts`, `state.ts` |

**Bottom line**: the Product Definition's route-level boundary is fully confirmed across both apps, exhaustively, not just by sample. Roughly 15 Engineering + 12 Protection routes in `apps/web`; 15 Engineering + 12 Protection routes in `apps/api`; the rest genuinely shared.

---

## C. Managed System supervision flow, traced end-to-end — and a correction to the prior draft

**Correction first, because it matters**: the previous version of this document claimed Control Plane "already enforces both products," citing which `apps/api` services bridge into it. That claim does not survive a deeper check and is retracted here.

What actually happens, traced through the code:

1. **`apps/api/src/services/control-plane-bridge.ts`** subscribes to the internal domain event bus and forwards a small set of event types (`agent.run.started/completed`, `authorization.denied`, `secret.detected`, `evaluation.completed`) to Control Plane's `POST /api/v1/gateway/events` — **one-way, asynchronous, and explicitly fail-open**: *"Application → Control Plane... fail-open — tenant work must not break if :3100 is down."* This is telemetry, not a gate. Nothing waits for Control Plane's response.
2. **The actual governed decision endpoint, `POST /api/v1/gateway/ops`** (which runs the 13-stage Operating Cycle via `evaluateGatewayRequest`/`dispatchGatewayOperation`) **has no callers anywhere in the repository** — not from `apps/web`, not from `apps/api`. Confirmed by repo-wide grep: the only occurrences of the string are the route definition itself and one line of its own auth middleware.
3. **Its intended consumer, `POST /api/v1/gateway/fulfill`** (`apps/api/src/routes/gateway-fulfill.ts`, explicit comment: *"Operator-only hop: Control Plane ALLOW + handoff → executeGovernedAction"*) also has zero callers in `apps/web`.
4. **What actually governs real write actions today — for both products — is a different, separate mechanism entirely**: `packages/agent-core`'s `authorizeEntityAction` / `enforceEntityWrite` / risk-scoring / judge, called **directly from `apps/api` routes**, bypassing Control Plane completely. Confirmed for both products: `remediation.ts` (the Protection product's actual write action against a Managed System) calls `authorizeEntityAction` directly; `approvals.ts` (the human-approval decide endpoint, used across the platform) calls `enforceEntityWrite` directly, gated separately by `requireAdmin`.

**So, precisely**: Control Plane today is (a) a one-way, fail-open telemetry sink, (b) a read-only oversight dashboard reading that telemetry back out (its own doc comment: *"agent registry, audit trail, policies, health, and risk metrics"*), and (c) a fully-built, tested, but **completely disconnected** governed-gateway subsystem (`gateway/ops` → `gateway/fulfill`) that could enforce real actions but is not wired into any live user-facing flow for either product. The Product Definition's framing of Control Plane as "the enforcement layer... for the entire platform" is the evident *design intent* (the 13-stage cycle, the forbidden-self-mutations list, the operator-only fulfill hop are all real, careful work) — but as *currently wired*, the actual enforcement happening on every real request is `packages/agent-core`'s policy/risk/judge path inside `apps/api`, for both Engineering and Protection alike, not Control Plane's Operating Cycle.

**The Managed System supervision flow, as it actually runs today**:
```
apps/worker (state.reconcile job)
   → @atlas/state reconcileProjectState()          [Truth]
        ↓
apps/api services: observe-cycle.ts, observe-system-facets.ts
   → @atlas/observer (behavior diff, security scan, graph build, P1 signals)
        ↓
apps/api routes: systems.ts, portfolio.ts, sentinel.ts, graph.ts, observer.ts
   → surfaced to apps/web routes: systems, truth, health, sentinel, observer
        ↓
apps/api routes/remediation.ts  (propose a fix)
   → authorizeEntityAction() [packages/agent-core]   [Policy/Risk gate — NOT Control Plane]
        ↓
apps/api routes/approvals.ts  (human decides)
   → enforceEntityWrite() + requireAdmin()            [Approval — NOT Control Plane]
        ↓
apps/api audit-log.ts  (hash-chained record)           [Audit]
```
Control Plane observes this flow after the fact (fire-and-forget events) and displays it on its dashboard; it does not currently sit in the flow's critical path.

---

## D. Atlas Engineering AI vs. Atlas Protection AI Supervision — distinguished, with evidence

**Atlas Engineering AI** = the Fabric catalog, `packages/shared/src/constants/agents.ts`, `FABRIC_AGENT_CATALOG`: 16 agents (`ORCHESTRATOR, ARCHITECT, CODE_ENGINEER, DEBUGGER, QA, TEST_ENGINEER, SECURITY, ACCESSIBILITY, UI_UX, DEVOPS, RESEARCHER, OMISSION_DETECTOR, LEGAL_MEDIA_COMMS, JUDGE, ADVERSARY, DATABASE`), each with a cognitive role (`COGNITIVE_ROLE_CATALOG`: INVESTIGATOR/DIAGNOSTICIAN/BUILDER/ADVERSARY/AUDITOR/CHALLENGER/ARCHITECT/EVIDENCE_JUDGE/FINAL_VERIFIER/PLANNER/RESEARCHER) and a `cannotSelfValidate` flag. This is what a developer using `workbench`/`studio`/`chat` invokes.

**Verified: the adversarial/second-opinion design is real as data, not yet as behavior.** Repo-wide grep for "second opinion," "multi+human," and every specific consumer of `modelHint: "multi+human"` (from `router/genius.ts`) returns **nothing** except two unrelated healthcare-knowledge record IDs inside Civio's ingested data (`civio_health.second-opinion` — a title string in imported knowledge, not code). `ADVERSARY` appears exactly once outside its own catalog definition, in `agent-marketplace.ts`, as a static category grouping (`"security": ["SECURITY", "ADVERSARY", "JUDGE"]`) — a marketplace listing, not an invocation. Combined with the already-known `runSpecialistStub` default path (only SECURITY and LEGAL_MEDIA_COMMS call a real model), this confirms with certainty: **no agent anywhere currently invokes a second/adversarial model to review another agent's output.** The cognitive-role design is a genuine, well-thought-out blueprint; none of it runs yet.

**Atlas Protection AI Supervision** = observation and governance of *other systems'* agents (Vantera's `V-One`/`Ventos`, BrokerOS's `MEDIATOR_AGENT` and others, LexStudy's exam-validator, Civio's knowledge) — Atlas does not execute these agents; it only knows about them via the portfolio registry (`packages/shared/src/portfolio/seed.ts`) and governs the same way it governs its own remediation proposals: `authorizeEntityAction` in `apps/api`, not a separate "external AI supervision" code path. **There is currently no code that specifically supervises an external system's own AI agent's live output** (e.g. evaluating a claim Vantera's V-One made) — what exists is knowledge *ingestion* from these systems (already-approved, static, one-time), not live supervision of their running agents. This is a genuine, specific gap distinct from the Engineering-side second-opinion gap.

---

## E. AI provider governance — what's real

`apps/api/src/routes/ai-providers.ts` confirms a real, live provider catalog: `AI_PROVIDER_CATALOG` from `@atlas/shared`, availability computed per-provider from actual env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`), a credit/pricing model (`billing: "included" | credits`), and one default free agent explicitly named **"ArletOS Agent"** (`"arletos-included"`, note: *"Only ArletOS Agent is free"*) — a further, more specific confirmation (beyond the earlier package.json/portfolio findings) that "ArletOS" in this codebase denotes a specific default AI persona/agent offered to end users, not an architecture layer. Consistent with the owner's decision not to make ArletOS a separate layer.

What's not yet built: any policy that decides *which* provider/model to use for a given task based on risk or required independence (the "AI provider fabric" concept from the earlier gap analysis) — today provider choice is a user-facing marketplace pick, not a supervision-driven routing decision.

---

## F. Conflict Check — updated

1. **Two "admin" surfaces, not one** (unchanged from prior draft): `apps/admin` (separate server, thin — auth + HTML shell) vs. `apps/web/app/admin/*` (`leads`, `login`, `marketplace`, `oracle`, `users` — full React pages with real data fetching). Deeper read of `apps/web/app/admin/oracle`: a real feature — codename/mission/gates/roadmap/allowlist/daily-brief UI, backed by `apps/api/src/services/admin-oracle-intel.ts` and `admin-oracle-queue.ts`, which use `@atlas/observer`'s `DEFENSIVE_ADVISORIES`/`isVersionBelow` to surface version-instability and advisory-match findings from **allowlisted catalogs only** — a real, owner-only security-intelligence feature, currently living in the customer-facing web app's `/admin` namespace rather than in `apps/admin`. This is the clearest concrete instance of "owner-level controls exposed in the normal user plane" — it's not a placeholder, it's working code in the wrong surface per the Product Definition.
2. **Two agent registries** (unchanged): Control Plane's `agent-registry.ts` (9 legacy oversight labels, explicitly marked "MUST NOT" merge with Fabric) vs. `FABRIC_AGENT_CATALOG` (16 real agents).
3. **Control Plane's governed gateway is fully built and completely unused** (new finding, §C) — this is now the single most important gap for the Product Definition's "Control Plane = enforcement of BOTH" claim: it's true by design intent and by the code that exists, but not true by what's actually wired into either product's live request path today.
4. **The Fabric catalog's adversarial/cannot-self-validate design has zero running instances** (confirmed, §D) — same underlying gap as the earlier AI-Governance analysis's `SECOND_OPINION`, now confirmed with an exhaustive grep rather than a spot check.
5. **The Vantera "Atlas" naming collision remains open** (`ESCALATE`, `decidedBy: null`) — unchanged, repeated for completeness.
6. **README documents only Atlas Protection**, not Atlas Engineering — unchanged from prior draft.
7. **No code path specifically supervises a Managed System's own AI agent's live output** (new, §D) — what exists is one-time knowledge ingestion from those systems, not ongoing supervision of their running agents. Distinct from, and in addition to, the Engineering-side second-opinion gap.

Nothing above has been changed, fixed, or worked around — flagged only.

---

## G. Target architecture (unchanged product shape, corrected enforcement description)

```
TAQONU (portfolio/ecosystem)
        │
        ▼
ATLAS CORE  =  taqonu-main  (personally named "ArletOS" — also the name of the default
               free AI agent in the provider marketplace, §E; not a separate layer either way)
        │
        ├── PRODUCT 1 — Atlas Engineering            (§B: 15 web + 15 api routes)
        │     Fabric catalog (16 agents, cognitive roles) — mostly stubbed except
        │     SECURITY/LEGAL_MEDIA_COMMS; adversarial/second-opinion roles are
        │     data-only (§D)
        │
        ├── PRODUCT 2 — Atlas Protection              (§B: 12 web + 12 api routes)
        │     governs Managed Systems (Vantera/HotelOS/CaseFlow/BrokerOS/LexStudy/Civio)
        │     via the SAME shared policy path as Engineering (§C) — not via Control Plane
        │
        ├── ADMIN — owner management, INTENDED for both, ACTUALLY split across two
        │           surfaces today (§F.1) — apps/admin (thin) + apps/web/app/admin
        │           (real features: leads, marketplace, oracle security-intel, users)
        │
        ├── CONTROL PLANE — DESIGNED as enforcement of both; ACTUALLY today a one-way
        │                    telemetry sink + read-only dashboard + a fully-built,
        │                    zero-caller governed gateway (§C) — the single largest
        │                    gap between the Product Definition and the live system
        │
        └── SHARED CORE — the mechanism that actually enforces both products today
              ├── Truth            → packages/state (ProjectStateSnapshot)
              ├── Evidence          → packages/agent-core evidence-bus, evidence-sufficiency
              ├── Memory            → packages/shared epistemic memory (13 states)
              ├── Knowledge         → packages/knowledge (RAG/verified-knowledge corpus)
              ├── Agents            → packages/agent-core Fabric catalog (16 agents)
              ├── Policies          → packages/agent-core authorizeEntityAction/enforceEntityWrite
              │                       (THE live gate for both products, confirmed §C)
              ├── Verification      → packages/agent-core judge/evaluate.ts
              ├── Audit             → apps/api audit-log (hash-chained)
              └── AI Supervision    → NET NEW: (a) operational-history awareness feeding
                                      judge/policies, (b) real model calls behind the Fabric
                                      catalog's adversarial roles, (c) either wiring Control
                                      Plane's existing governed gateway into the live path
                                      or consciously deciding not to and documenting why,
                                      (d) live supervision of Managed Systems' own running
                                      agents, not just one-time knowledge ingestion from them
        │
        ▼
MANAGED SYSTEMS (SOURCE, separate repos — unchanged)
Vantera · HotelOS · CaseFlow · BrokerOS · LexStudy · Civio
```

---

## H. What this review deliberately does not include

No implementation plan, no code changes, no renames, no moves. The single most consequential open question this review surfaces for your decision: **Control Plane's governed gateway (13-stage Operating Cycle, `gateway/ops` → `gateway/fulfill`) is real, tested, and completely unused.** Before any AI-Supervision implementation work, that needs an explicit decision — wire it into the live path as the actual enforcement layer (matching the Product Definition as written), or formally treat `packages/agent-core`'s policy path as the real enforcement layer and redefine Control Plane's role as oversight/dashboard only (a smaller change to the Product Definition, not to the code). Either is legitimate; leaving it undecided means the two descriptions of "what enforces Atlas" keep diverging.
