# Atlas — AI Supervision/Governance Capability: Integration Gap Analysis (v2)

Status: DRAFT — awaiting architectural review & approval before implementation
Prepared: 2026-08-31 · Revised: 2026-08-31 (v2 — corrected scope per owner decision below)
Scope rule followed: **EXISTING ATLAS + NEW CAPABILITY**, not a redesign.

## Owner's scope decision (binding constraint for this revision and any implementation)

> Keep the existing Atlas architecture intact. Do not create ArletOS as a separate layer. Do not redesign Atlas. Treat AI Supervision / Context-Aware Agent Direction as a new cross-cutting capability integrated into the existing Truth, Evidence, Governance, Intelligence, Memory, State, Audit, and Agent infrastructure.

This revision replaces the framing of v1, not its evidence. v1's code citations (what's implemented/partial/missing) are unchanged and still cited below; what changes is how the target capability is defined and where it's judged to fit.

---

## 0. Corrected target architecture

```
TAQONU
Portfolio / ecosystem (this repo + 6 sibling Managed Systems — see the
Taqonu/ArletOS/Atlas map doc for the full inventory)
        │
        ▼
ATLAS CORE  (= this repo, taqonu-main; personally named "ArletOS" — an
             instance name, not a separate architectural layer — see below)
Truth + Evidence + Governance + Intelligence + Automation Control
        │
        ├── Memory                    (packages/shared — 13-state epistemic memory)
        ├── Knowledge                 (packages/knowledge — RAG/verified-knowledge corpus)
        ├── Project/System State      (packages/state — ProjectStateSnapshot)
        ├── Agent Infrastructure      (packages/agent-core — router/dispatch/providers)
        ├── Verification / Judge      (packages/agent-core/judge)
        ├── Policies / Risk           (packages/agent-core/policies)
        ├── Audit                     (apps/api audit-log, hash-chained)
        ├── Control Plane             (apps/control-plane — "Sentinel")
        │
        └── AI SUPERVISION  ← the new cross-cutting capability this document scopes
                │
                ├── understands user intent
                ├── observes agent actions
                ├── remembers what already happened
                ├── evaluates proposals
                ├── considers permissions + risk
                ├── checks evidence
                ├── directs the next step
                ├── requests second opinion
                └── escalates when necessary
        │
        ▼
MANAGED SYSTEMS
Vantera · HotelOS · CaseFlow · BrokerOS · LexStudy · Civio
```

**On ArletOS**: per `package.json` (`"description": "Atlas Core — engineering memory platform (ArletOS personal instance)"`) and `packages/shared/src/portfolio/seed.ts` (this repo registered as one application, `"Atlas / ArletOS"`), ArletOS is the personal name of this instance of Atlas Core — not a separate layer. Per the owner's decision above, **this stays as-is**. If ArletOS is later intended to become a distinct architecture, that is a new, separate decision — out of scope here.

AI Supervision is drawn as hanging off Atlas Core, not as a sibling of Memory/Knowledge/etc., because it isn't a new store or a new subsystem — it is a capability that *reads* every existing subsystem (Memory, Knowledge, State, Agent Infrastructure, Policies, Audit) and adds one thing none of them currently do on their own: turning "what's true and what's allowed" into "what should happen next, right now, given everything already tried."

---

## 1. Current architecture (unchanged from v1 — apps/packages inventory)

**Apps** (`apps/`): `web`, `api`, `admin`, `control-plane` (Sentinel), `worker`.

**Core packages** (`packages/`): `agent-core` (kernel, orchestrator, policies, providers, router, judge, tools), `code-intelligence`, `config`, `database`, `embeddings`, `engineering-loop`, `experts`, `knowledge`, `observability`, `observer`, `qa-core`, `shared`, `state`, `system-model`.

**Integrations** (`packages/integrations/*`): cloudflare, github, google, local, mongodb, netlify, render, supabase, vercel.

---

## 2. What already exists toward AI supervision (unchanged evidence from v1)

| Piece | Status | Where |
|---|---|---|
| Multi-provider AI routing (Claude/Gemini/OpenAI-compatible) | **Implemented** | `packages/agent-core/src/providers/llm.ts` — real `AnthropicProvider`, `GeminiProvider`, `OpenAiCompatibleProvider` (OpenAI/Groq/DeepSeek/Ollama), free `ContextEchoProvider`, real cost accounting. |
| Task/specialist router | **Implemented (tier-based)** | `packages/agent-core/src/router/genius.ts::geniusRoute` — keyword-driven routing + `modelHint` of `cheap\|strong\|vision\|local\|multi+human`. |
| Evidence/claim evaluator ("Judge") | **Implemented, narrow** | `packages/agent-core/src/judge/evaluate.ts` — heuristic/regex-based `APPROVE / REQUEST_MORE_EVIDENCE / REJECT / ESCALATE_HUMAN`. |
| Policy / risk / audit gate | **Implemented, enforced** | `packages/agent-core/src/policies/*` + `apps/api/src/services/risk-audit.ts::enforceEntityWrite` (32+ routes), risk score → `AUTO / AUTO_LOG / APPROVAL / HUMAN_ONLY`. |
| Decision vocabulary in code | **Implemented, different names** | `ALLOW/DENY/REQUIRE_APPROVAL` (gateway), `ESCALATE_HUMAN`, `REQUEST_MORE_EVIDENCE`, `INSUFFICIENT_EVIDENCE` (kernel). No `MODIFY`, `INVESTIGATE`, or `SECOND_OPINION` literal exists anywhere (repo-wide grep confirmed). |
| Unified audit log | **Implemented** | `apps/api/src/services/audit-log.ts` — hash-chained. |
| Memory / epistemic truth-states | **Implemented, 13 states** | `packages/shared/src/constants/epistemic.ts`. |
| Project "current state" model | **Implemented, repo/project-scoped** | `packages/state/src/reconcile/*` — `ProjectStateSnapshot`, 12 slices, real conflict detection. |
| Multi-agent execution actually invoking models | **Partial — repo's own identified core gap** | `packages/agent-core/src/orchestrator/dispatch.ts::runSpecialistStub` is the default path for every specialist; only SECURITY and LEGAL_MEDIA_COMMS have real overrides. |
| Sandboxed/controlled tool execution | **Missing** | No sandboxed code-execution or general tool-calling primitive exists. |

---

## 3. The corrected AI Supervision requirement

v1 framed the missing piece narrowly, as: *"a live operational-state model… prevents Atlas repeating stale advice."* That's true but too small. The actual requirement, as scoped by the owner:

> **Atlas must continuously supervise AI-driven work using the user's current intent, operational history, system state, evidence, permissions, policies, previous agent actions, and outcomes — and use that context to determine or constrain what the agent should do next.**

This reframes what were called `currentGoal`, `completedActions`, `pendingActions`, `failedActions`, `approvedActions`, `rejectedActions` in v1 — those aren't generic "session state." They are **Operational Context for AI Supervision**: the specific inputs Atlas's supervision capability needs to turn verification (is this claim true?) into direction (what should happen now?).

### The shift this implies

**Today** (manual, human-mediated):
```
You → Claude → "I want to do X" → You → "wait, let me ask Atlas" → Atlas
  [what's the actual goal? what happened already? what did Claude try?
   what succeeded/failed? what was approved/rejected? what does the repo
   contain? what evidence exists? what policies apply? what next?]
  → Direction → You → Claude
```

**Target** (automated, Atlas-mediated):
```
You → Claude → Atlas Supervision
  [observe · understand · remember · verify · reason · evaluate · direct · gate · escalate]
  → Claude → System
```

The point of AI Supervision is not "catch AI in a lie." It's **holding the context and the control of an AI-driven workflow** so the human doesn't have to manually re-inject it every time — that is the specific automation being asked for, distinct from "another chat model" or "another coding agent" or "a truth-checker."

### What already exists to build this on (reuse, don't duplicate)

- **Evidence substrate**: `packages/state` (project truth), `packages/shared` epistemic memory (13 states, provenance fields), the audit log (`input/output/reason/correlationId/causationId`). All three already carry enough to answer "what happened, what's true, what's uncertain" — Operational Context is the missing *aggregation and reasoning layer* on top, not a new store.
- **Gating substrate**: policies/risk-score/`enforceEntityWrite`, judge's `APPROVE/REQUEST_MORE_EVIDENCE/REJECT/ESCALATE_HUMAN`. This already does "evaluate + gate + escalate." What's missing is feeding it *operational history* (what was already tried/approved/rejected), not just the current claim in isolation.
- **What's genuinely net-new**: the aggregation layer itself — something that reads `ProjectStateSnapshot` + audit log + memory and produces a compact, current `currentGoal / completedActions / pendingActions / failedActions / approvedActions / rejectedActions / openQuestions` view that the judge/policy/router layers can consult before acting. This is the one new piece of state-shaped work implied by the requirement; everything else is wiring existing subsystems together differently.

---

## 4. AI provider fabric — models as workers, Atlas as the authority

The owner's direction on multi-provider AI, stated precisely: **the model is not the authority.** Claude, Gemini, OpenAI-compatible providers, an internal agent — all of these are *workers*. Atlas is the supervision layer that decides how they're used, not one of them.

```
Task
 ↓
Which agent?
 ↓
Which model/provider?
 ↓
One model or multiple?
 ↓
Does this require independent review?
 ↓
Compare outputs
 ↓
Evidence + policy + operational context
 ↓
Directive
```

**What already exists toward this**: the provider abstraction (`llm.ts`) and the router (`genius.ts`) already implement most of the "which agent / which model" steps — this is real, working code, not a plan. What's missing is the back half: "does this need independent review," "compare outputs," and turning that into a directive. Concretely, this is the same gap already identified in v1 as `SECOND_OPINION`: `genius.ts` already *sets* `modelHint: "multi+human"` for cases that plausibly need multi-model review, but **nothing in the codebase consumes that hint** — no branch anywhere invokes a second model/agent when it's set. Wiring that hint into an actual second invocation + a comparison/reconciliation step is the concrete, scoped piece of "AI provider fabric" work — it is not a new subsystem, it's completing a signal the router already emits.

This also means the fabric doesn't require picking a winner among providers or committing to any one model as privileged — Atlas's existing policy/risk/judge layer is already provider-agnostic (it evaluates claims and actions, not which LLM produced them), so it's a reasonable home for "does this need independent review" without new architecture.

---

## 5. Prior roadmap conclusions already on record (unchanged from v1 — still authoritative)

From `atlas-gap-analysis-staged-roadmap.md` (dated through 2026-08-24):

- **Track split (§25)**: Track A (build now — real agent execution, tool runtime, evaluation) is closeable by code; Track B (enterprise hardening) is mostly code-closeable but audit-gated; Track C (customers/capital/team) is not a code gap.
- **Staged build order (§16)**: Phase 1 "Agent Reality" (retire `runSpecialistStub`) → Phase 2 "Controlled Tool Runtime" → Phase 2.5 reliability → Phase 3 Confidence Calibration → Phase 4 External Intelligence → Phase 5 Diagnosis/Prediction → Phase 6 Self-Healing (gated on 1+2).
- **§27 conclusion**: "the gap is concentrated, not diffuse — almost entirely Agent Reality + Tool Runtime."

**Implication for AI Supervision + the provider fabric**: both still sit *after* Phase 1 in dependency order for the same reason as v1 — supervising and directing specialists that don't yet call real models (`runSpecialistStub`) produces no value. The `SECOND_OPINION`/fabric wiring specifically only matters once there are two real model calls to compare.

---

## 6. Revised gap matrix

| Capability | Status | Notes |
|---|---|---|
| Decision engine vocabulary (ALLOW/MODIFY/INVESTIGATE/BLOCK/SECOND_OPINION/ESCALATE) | **Partial** | Real mechanisms exist under different names; `SECOND_OPINION` is the one concretely missing and scoped (§4). |
| Authority/permission boundaries | **Implemented** | Unchanged from v1 — reuse as-is. |
| AI Supervision — continuous, context-aware direction (this document's corrected scope) | **Missing — the aggregation layer specifically, not the substrate** | Evidence/gating substrate already exists (§3); the "Operational Context" aggregation + judge/policy consultation of it is net-new. |
| AI provider fabric (task → agent → model(s) → review? → directive) | **Partial** | Routing + provider abstraction implemented; independent-review consumption of `modelHint: "multi+human"` missing (§4). |
| Verifying AI claims against evidence | **Partial** | `judge/evaluate.ts` real but heuristic; no unified `verify(proposal)` primitive (per repo's own §8 in `02-ATLAS_AGENT_GOVERNANCE_SPEC.md`). |
| Memory truth-states | **Implemented, richer than the ask** | 13 states, superset of any smaller vocabulary. |
| Human-in-the-loop escalation | **Implemented** | Unchanged from v1. |
| Audit trail / governance logging | **Implemented** | Unchanged from v1. |
| Multi-agent execution actually calling real models | **Partial — the true prerequisite for everything above** | `runSpecialistStub` gap, unchanged from v1. |

---

## 7. Recommended sequencing (pending approval — unchanged priority order, reframed rationale)

1. Confirm git/commit state of the recent hardening work (flagged in the README update — separate, small item).
2. Phase 1 "Agent Reality" (retire `runSpecialistStub`) — prerequisite for both AI Supervision and the provider fabric to do anything real.
3. Build the Operational Context aggregation layer (§3) over existing `packages/state` + audit log + memory — read-only composition, no new store.
4. Wire `modelHint: "multi+human"` into an actual second-model/agent invocation + reconciliation (§4) — completes the provider fabric's "independent review" step and is the concrete home for `SECOND_OPINION`.
5. Feed the Operational Context layer (3) into the judge/policy path so decisions consider history, not just the current claim in isolation — this is what turns "verification" into "direction."
6. Only after 3–5 land, revisit whether `MODIFY` / `INVESTIGATE` need to become first-class decision outcomes.

This remains a recommendation, not an implementation. It integrates into the existing Truth, Evidence, Governance, Intelligence, Memory, State, Audit, and Agent infrastructure per the owner's scope decision — no new layer, no ArletOS split, no redesign.
