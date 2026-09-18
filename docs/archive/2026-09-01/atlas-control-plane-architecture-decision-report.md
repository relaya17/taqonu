# Atlas — Control Plane & AI Supervision: Boundary Matrix + Architecture Decision Report

Status: **Analysis only. No code changed, moved, renamed, refactored, or created.** This document extends `atlas-product-boundary-architecture-review.md` with (1) a single consolidated Boundary Matrix across the five buckets you named, and (2) a full Architecture Decision Report for the four gaps already identified, at the depth you asked for: current behavior, intended behavior, exact code entry points, data/control flow, security/permission/failure-mode implications, dependencies, what must not change, minimal required change, risks, priority. It ends with a recommended target architecture, the Control Plane decision framed as an explicit choice for you, a dependency graph, and a recommended implementation order.

Prepared: 2026-09-01, against `taqonu-main`, including one finding confirmed live in production today (not just in code) — see Gap 1 and Gap 3.

---

## 0. What changed since the last review (2026-08-31 → 2026-09-01)

Two things happened between the two documents, both operational, neither architectural — but one of them produced a piece of evidence that belongs in this report:

1. Local `.env` was created (dev environment fix, unrelated to this report).
2. Vercel production was inspected directly (you asked "did this deploy wrong"). Finding: `taqonu-api`, `taqonu-web`, `taqonu-admin`, `taqonu-control-plane` are all live and individually healthy. But inspecting `apps/api/src/services/control-plane-bridge.ts` against the live `taqonu-control-plane.vercel.app` dashboard confirmed, **in production, not just in source**: the `applicationId` this bridge sends is hardcoded to `"def-000"` (Atlas itself). The live Control Plane dashboard's own copy — "9 סוכנים רשומים" (9 agents registered), "0 נקודות עיוורות" (0 blind spots) — is the same legacy 9-agent registry already flagged in the prior review as explicitly commented `NOT the Atlas execution registry`, now confirmed to be the number actually shown to anyone who visits the live site. This upgrades Gap 1 and Gap 3 below from "confirmed in code" to "confirmed in code and in production."

---

## 1. Boundary Matrix — every route/service, five buckets

Buckets, exactly as you defined them: **ATLAS ENGINEERING** · **ATLAS PROTECTION** · **ADMIN — OWNER MANAGEMENT** · **CONTROL PLANE — ENFORCEMENT** · **SHARED ATLAS CORE**.

The route-level classification below is the same exhaustive pass as the prior review's §B, reorganized into your five buckets (the prior review used four; "Control-Plane-adjacent" is now its own bucket, and Admin is separated out explicitly).

### `apps/web/app/[locale]/*`

| Bucket | Routes |
|---|---|
| Atlas Engineering | `agent`, `agents`, `chat`, `models`, `experts`, `artifacts`, `eval`, `qa`, `patches`, `studio`, `workbench`, `proof` |
| Atlas Protection | `systems`, `systems/[id]`, `truth`, `health`, `readiness`, `gates`, `sentinel`, `observer`, `process-audit`, `partners`, `contract`, `legal-media` |
| Shared Atlas Core | `memory`, `state`, `decisions`, `conflicts`, `integrations`, `ops`, `ops/metrics`, `projects`, `projects/[id]`, `plan`, `settings`, `settings/billing`, `auth/*`, `welcome`, `marketing`, `investors`, `[section]` |

### `apps/web/app/admin/*` (separate surface from `apps/admin` — this split is Gap 4)

| Bucket | Routes |
|---|---|
| Admin — Owner Management | `layout.tsx`, `page.tsx`, `leads/page.tsx`, `login/page.tsx`, `marketplace/page.tsx`, `oracle/page.tsx`, `users/page.tsx` |

### `apps/admin/*` (the other admin surface)

| Bucket | Files |
|---|---|
| Admin — Owner Management | `admin-auth.ts`, `browser-session.ts`, `owner-html.ts`, `server.ts` |

### `apps/api/src/routes/*` (all 55 files)

| Bucket | Routes |
|---|---|
| Atlas Engineering | `agent.ts`, `agent-fabric.ts`, `agent-lifecycle.ts`, `artifacts.ts`, `code.ts`, `conversation.ts`, `engineering-audit.ts`, `engineering-loop.ts`, `eval.ts`, `eval-ci-gate.ts`, `exemplars.ts`, `experts.ts`, `kernel.ts`, `qa.ts`, `research.ts` |
| Atlas Protection | `gates.ts`, `github.ts`, `graph.ts`, `legal-media.ts`, `observer.ts`, `portfolio.ts`, `portfolio-governance.ts`, `readiness.ts`, `remediation.ts`, `security-sarif.ts`, `sentinel.ts`, `systems.ts` |
| Admin — Owner Management | `admin-ops.ts` |
| Control Plane — Enforcement (built for this; not reached live — Gap 1) | `gateway-fulfill.ts` |
| Shared Atlas Core | `ai-providers.ts`, `approvals.ts`, `audit.ts`, `auth.ts`, `billing.ts`, `byo-cloud.ts`, `commercial.ts`, `conflicts.ts`, `connections.ts`, `contact.ts`, `cost-intelligence.ts`, `db-feeds.ts`, `decisions.ts`, `deploy-feeds.ts`, `events.ts`, `evidence.ts`, `health.ts`, `integrations.ts`, `intelligence.ts`, `knowledge.ts`, `memory.ts`, `metrics.ts`, `performance.ts`, `plugins.ts`, `projects.ts`, `provider-adapters.ts`, `state.ts` |

### `apps/control-plane/src/*`

| Bucket | Files | Live status |
|---|---|---|
| Control Plane — Enforcement (design intent) | `atlas-gateway.ts` (`evaluateGatewayRequest`, `dispatchGatewayOperation`, `ingestGatewayEvent`) | Built, tested, **zero live callers** for the decision path (`gateway/ops`/`gateway/fulfill`) |
| Control Plane — Enforcement (what's actually live) | `routes/api.ts` → `POST /api/v1/gateway/events` | Live, but only ever receives events for `applicationId: "def-000"` (Atlas itself) — confirmed today in production |
| Control Plane — Enforcement (dashboard) | `routes/dashboard.ts`, `agent-registry.ts`, `application-registry.ts`, `self-audit.ts`, `portfolio-governance-view.ts` | Live, read-only, displays the legacy 9-agent registry and an application map seeded with Atlas only |

### `packages/*` (Shared Atlas Core — the mechanism that actually enforces both products today)

| Capability | Package | Notes |
|---|---|---|
| Truth | `packages/state` (`ProjectStateSnapshot`) | Live |
| Evidence | `packages/agent-core` evidence-bus, evidence-sufficiency | Live |
| Memory | `packages/shared` epistemic memory (13 states) | Live |
| Knowledge | `packages/knowledge` | Live |
| Agents | `packages/agent-core` Fabric catalog (16 agents) | Live registry; most agents run through `runSpecialistStub` (no real model) — Gap 2 |
| Policies | `packages/agent-core` `authorizeEntityAction`/`enforceEntityWrite` | **This, not Control Plane, is the live enforcement gate for both products** |
| Verification | `packages/agent-core` `judge/evaluate.ts` | Live, rule-based; no second-opinion input — Gap 2 |
| Audit | `apps/api` `audit-log.ts` | Live, hash-chained |

**Bottom line of the matrix**: four of the five buckets are real and live. The fifth — **Control Plane — Enforcement** — exists as code and as a live telemetry/dashboard surface, but its actual enforcement function (the thing its name promises) has never executed a single real decision. That is Gap 1, and it is the reason Gaps 2 and 3 don't have an obvious place to plug into yet.

---

## 2. Architecture Decision Report — four gaps

### Gap 1 (P0) — Control Plane disconnected from live enforcement

**Current behavior.** Control Plane runs three unrelated things under one roof: (a) a dashboard that reads back whatever telemetry it has received, (b) a telemetry receiver (`POST /api/v1/gateway/events`) that only ever hears from Atlas itself (`applicationId: "def-000"`, hardcoded in `control-plane-bridge.ts`), fed one-way and fail-open by `apps/api`'s domain event bus, and (c) a fully implemented governed-decision gateway (`evaluateGatewayRequest` → 13-stage Operating Cycle → `dispatchGatewayOperation`, exposed at `POST /api/v1/gateway/ops`, meant to hand off to `POST /api/v1/gateway/fulfill`) that has zero callers anywhere in the repository or in production. Every real write action today — for both Atlas Engineering and Atlas Protection — is authorized by `packages/agent-core`'s `authorizeEntityAction`/`enforceEntityWrite`, called directly from `apps/api` routes (`remediation.ts`, `approvals.ts`), never touching Control Plane. Confirmed live today: the public dashboard at `taqonu-control-plane.vercel.app` states "0 blind spots" while structurally unable to see any decision `apps/api` makes unless `apps/api` chooses to tell it, after the fact, best-effort.

**Intended behavior** (per the Product Definition you approved): "Control Plane is the enforcement layer for authorization, policy, risk gates, approvals, execution governance, verification and audit" for the entire platform — both products.

**Exact code entry points.**
- `apps/control-plane/src/services/atlas-gateway.ts` — `evaluateGatewayRequest`, `dispatchGatewayOperation`, `ingestGatewayEvent`, `FORBIDDEN_SELF_MUTATIONS`
- `apps/control-plane/src/routes/api.ts` — `POST /api/v1/gateway/ops` (line ~267), `POST /api/v1/gateway/events` (line 233), `POST /api/v1/gateway/fulfill` consumer contract
- `apps/api/src/routes/gateway-fulfill.ts` — the operator-only hop meant to call back into Control Plane's ALLOW decision; currently unreached
- `apps/api/src/services/control-plane-bridge.ts` — the only live wire, one-way, fail-open, hardcoded `applicationId: "def-000"`
- `packages/agent-core` — `authorizeEntityAction`, `enforceEntityWrite` — the mechanism actually doing the job Control Plane was built to do

**Data/control flow (as it runs today).**
```
apps/api route (e.g. remediation.ts)
   → authorizeEntityAction() [packages/agent-core]   ← real decision happens HERE
   → apps/api routes/approvals.ts → enforceEntityWrite()
   → apps/api audit-log.ts (hash-chained)
        ⋮ (fire-and-forget, after the fact, fail-open)
   → control-plane-bridge.ts → POST /api/v1/gateway/events (applicationId="def-000" only)
   → Control Plane ingestGatewayEvent() → dashboard display only
```
`gateway/ops` → `dispatchGatewayOperation` → `gateway/fulfill` is a complete, parallel, unused path with no arrows connecting it to the diagram above.

**Security/permission/failure-mode implications.** None of the "forbidden self-mutation" protections in `atlas-gateway.ts` (`weaken_auth`, `grant_privilege`, `delete_audit`, `modify_operator`, `disable_verification` — never ALLOWed) are actually protecting anything in production, because nothing routes through the code that checks them. The real gate (`authorizeEntityAction`) may or may not enforce equivalent protections — that would need a separate check, since it's a different codebase with different invariants. The dashboard's "0 blind spots" claim is actively misleading to anyone (including you, later, under time pressure) who trusts it as a real signal.

**Dependencies.** Any fix here changes what "the enforcement layer" means for Gaps 2 and 3 below — both currently have no natural home to plug new supervision logic into until this is decided.

**What must not change.** `authorizeEntityAction`/`enforceEntityWrite` must keep working exactly as they do today throughout any transition — this is live, load-bearing code for both products; nothing here proposes touching it without a separate, explicit review of its own invariants.

**Minimal required change (two real options, not a recommendation):**
- **Option A — Wire it live.** Route `apps/api`'s real authorization calls through `gateway/ops` → `gateway/fulfill` instead of calling `packages/agent-core` directly, so Control Plane's Operating Cycle becomes the actual gate. Matches the Product Definition as written. Larger, riskier change — touches the live request path for every write action in both products.
- **Option B — Redefine the role.** Formally document Control Plane as an oversight/telemetry/audit-trail surface, not a live enforcement gate; update the Product Definition's own wording ("enforcement layer" → "oversight and audit layer"); fix the dashboard copy so it stops claiming "0 blind spots" and instead reports what it actually observes. Smaller change, no touch to the live request path, but is a real product-definition change, not just documentation.

**Risks.** Option A: regression risk to every authorized write action in the platform if the handoff isn't semantically identical to what `authorizeEntityAction` does today; also reintroduces a hard dependency on `:3100` being up, undoing the explicit "fail-open" design choice already in the code. Option B: the governed gateway's real engineering work (13-stage cycle, forbidden-mutations list, idempotency handling) becomes permanently unused unless revisited later; "Control Plane" as a name stops matching what it does, which needs to be communicated clearly (to you, to any future engineer, to the docs).

**Priority: P0.** Every other AI-supervision gap below depends on this decision being made first.

---

### Gap 2 (P1) — Internal Engineering AI Supervision (second opinion / adversarial review) missing

**Current behavior.** `packages/shared/src/constants/agents.ts` defines 16 Fabric agents with real cognitive roles (`INVESTIGATOR/DIAGNOSTICIAN/BUILDER/ADVERSARY/AUDITOR/CHALLENGER/ARCHITECT/EVIDENCE_JUDGE/FINAL_VERIFIER/PLANNER/RESEARCHER`) and a `cannotSelfValidate` flag per agent. In practice, `runSpecialistStub` (`packages/agent-core/src/orchestrator/dispatch.ts`) is the default execution path for every agent except SECURITY and LEGAL_MEDIA_COMMS — no real model call happens. `router/genius.ts`'s `geniusRoute` sets `modelHint: "multi+human"` on some routes, but repo-wide search finds zero consumers of that hint. `ADVERSARY` appears exactly once outside its own catalog definition, as a static marketplace category label, never as an actual invocation.

**Intended behavior** (per your clarifications): Atlas gives contextual direction using current intent, full operational history, system state, evidence, and policy — producing decisions like ALLOW/MODIFY/INVESTIGATE/SECOND_OPINION/REQUIRE_APPROVAL/BLOCK/ESCALATE, with real multi-model or multi-agent adversarial review backing the SECOND_OPINION path, and multiple LLM providers usable as interchangeable "workers" under Atlas's authority (never the authority themselves).

**Exact code entry points.**
- `packages/shared/src/constants/agents.ts` — `FABRIC_AGENT_CATALOG`, `COGNITIVE_ROLE_CATALOG`, `cannotSelfValidate`
- `packages/agent-core/src/router/genius.ts` — `geniusRoute`, `modelHint: "multi+human"` (set but never read)
- `packages/agent-core/src/orchestrator/dispatch.ts` — `runSpecialistStub` (the default no-op path)
- `packages/agent-core/src/judge/evaluate.ts` — the existing rule-based verdict engine (no second-opinion input today)
- `apps/api/src/routes/ai-providers.ts` — the real, live multi-provider catalog (Anthropic/OpenAI/Gemini/Groq/DeepSeek) — the "workers" already exist; nothing routes supervision decisions through them yet

**Data/control flow (today).** A request reaches an agent → `runSpecialistStub` returns a stub response for 14 of 16 agents → `judge/evaluate.ts` evaluates against fixed rules → no second model, no adversarial pass, no operational-history input anywhere in this chain.

**Security/permission/failure-mode implications.** Because `cannotSelfValidate` is a real, checked-in flag with no enforcement behind it, any agent flagged as unable to self-validate is, today, self-validating by default (there is no alternative path). This is a silent gap between declared intent and actual behavior — worth flagging on its own even outside the broader supervision project.

**Dependencies.** This gap cannot be meaningfully closed before `runSpecialistStub` is retired for the agents that matter to a given supervision decision — governing an agent that doesn't do anything yet produces governance of nothing. This was already the staged-roadmap's own conclusion (Phase 1 "Agent Reality" before governance). It also depends on Gap 1's resolution: if Option A is chosen, SECOND_OPINION decisions should route through Control Plane's Operating Cycle; if Option B, they route through `packages/agent-core` directly, alongside `authorizeEntityAction`.

**What must not change.** The existing rule-based `judge/evaluate.ts` path should keep functioning for agents/flows that don't yet have real model execution behind them — this isn't a replace-everything change, it's an addition for the paths that need it.

**Minimal required change.** (1) Wire `modelHint: "multi+human"` to an actual second model call for the routes that already set it — the hint exists and is unused, so this is additive, not a new design. (2) Feed operational history (what was tried/approved/rejected/failed, not just current state) into `judge/evaluate.ts` as an input, not a replacement of its existing logic. (3) Decide, per Gap 1, where the resulting ALLOW/MODIFY/INVESTIGATE/SECOND_OPINION/REQUIRE_APPROVAL/BLOCK/ESCALATE decision gets enforced.

**Risks.** Real model calls cost money and add latency to paths that are currently instant stubs — needs a plan for which agents/routes get real execution first, not all 16 at once. Judge logic changes touch a verification path other code may already assume is deterministic/rule-based.

**Priority: P1.** Blocked on Phase 1 "Agent Reality" (retiring stubs) and on the Gap 1 decision, but not blocked on external systems — this is entirely internal to Atlas Engineering.

---

### Gap 3 (P1) — External Managed-System AI Supervision missing

**Current behavior.** Atlas's only relationship with the six Managed Systems (Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy, Civio) is a static portfolio record (`packages/shared/src/portfolio/seed.ts`, pinned to specific commit hashes, last seeded 2026-08-28 to 2026-08-30) plus five owner-approved, one-time, knowledge-only ingestion events (patterns copied once under `IMPORT_KNOWLEDGE_ONLY`, `sourceExecutionPerformed: false`). **Confirmed live today**: none of the six systems' own deployments (which are real and running — `hotel-os-ai-api-eight.vercel.app`, `broker-os-web-henna.vercel.app`, `civioapps.vercel.app`, `case-flow-veridict.vercel.app`, etc., all visible in your own Vercel account) send any live event, webhook, or API call to Atlas. `application-registry.ts`'s in-memory application map is seeded with exactly one entry — Atlas itself (`def-000`) — and is only ever written to by the same unused `atlas-gateway.ts` code path from Gap 1.

**Intended behavior.** Per Atlas Protection's definition: Atlas observes Managed Systems from outside, through connectors, and flags what's proven, what changed, what's risky, and what's permitted next — including supervision of those systems' *own* AI agents' live output (e.g., evaluating a claim Vantera's V-One made), not just one-time ingestion of their design patterns.

**Exact code entry points.**
- `packages/shared/src/portfolio/seed.ts` — the static registry (applications, conflicts, audit, knowledgeRecords)
- `apps/api/src/routes/systems.ts`, `portfolio.ts`, `portfolio-governance.ts`, `sentinel.ts` — read/serve this static data today
- `apps/control-plane/src/services/application-registry.ts` — the live (but Atlas-only) application map
- `apps/worker` `state.reconcile` job, `apps/api` `observe-cycle.ts`/`observe-system-facets.ts`, `packages/observer` — this is the machinery that *does* reconcile live state, but only for repos Atlas has direct connector access to (via GitHub etc.), not a live feed from the Managed Systems' own running agents

**Data/control flow (today).** No live flow exists between any Managed System's runtime and Atlas. The only flow is: owner manually reviews a pattern from a Managed System's repo → owner approves → pattern copied into Atlas's knowledge store, once, with `fabricCatalogMutated: false` and `atlasAgentsCreated: 0`. That's a one-time human-mediated knowledge transfer, not supervision.

**Security/permission/failure-mode implications.** This is actually the *safest* of the four gaps as it stands — because nothing is connected, there's no live trust boundary being silently crossed. The risk is the opposite of Gaps 1 and 2: not "something unsafe is happening invisibly," but "the Product Definition's Atlas Protection promise — live governance of Managed Systems' own agents — has no code behind it at all yet," which is a scope/expectations risk, not a security one, until work starts here.

**Dependencies.** Needs a defined connector/ingestion contract before any live supervision is possible: does a Managed System push events to Atlas (webhook), or does Atlas pull (poll their API/repo), or does Atlas only ever observe via GitHub the way it already does for its own repos? This is a real design decision, not yet made anywhere in the codebase. It also depends on Gap 1: whatever mechanism ends up being "the enforcement layer" is where a Managed System's proposed action would need to be evaluated.

**What must not change.** The portfolio's own existing invariants are worth preserving explicitly: `IMPORT_KNOWLEDGE_ONLY`, `sourceExecutionPerformed: false`, `permissionsInherited: false`, `atlasAgentsCreated: 0` for any future ingestion — i.e., even live supervision should not mean Atlas starts executing or inheriting permissions from Managed Systems' code, only observing and judging it, matching the Product Definition's "Managed Systems remain external, never absorbed."

**Minimal required change.** None recommended yet — this gap needs a design decision (push vs. pull vs. GitHub-only observation) before "minimal change" can be defined, and that decision should probably wait until Gap 1 is resolved, since it determines where a Managed-System-sourced request would be judged.

**Risks.** Building a live connector to six external, independently-deployed products (themselves under active development — several have same-day commits) is nontrivial ongoing surface area, and the open Vantera "Atlas" naming collision (still `ESCALATE`, undecided) should be resolved before any live integration with Vantera specifically, to avoid Atlas conflating its own "Atlas" concept with Vantera's unrelated feature of the same name.

**Priority: P1.** Real, but not blocking Gap 1 or Gap 2 — can proceed in parallel once a connector design exists, though sequencing it after Gap 1's decision avoids building a connector into a gateway that gets redefined shortly after.

---

### Gap 4 (P1) — Admin boundary split

**Current behavior.** Two separate, non-overlapping admin surfaces exist: `apps/admin` (its own `package.json` describes it as "separate trust boundary from apps/web" — but it's thin: only `admin-auth.ts`, `browser-session.ts`, `owner-html.ts`, `server.ts`, no real feature UI) and `apps/web/app/admin/*` (a full set of React pages — `leads`, `login`, `marketplace`, `oracle`, `users` — with real backing services, notably `oracle/page.tsx`, a genuine owner-only security-intelligence feature backed by `admin-oracle-intel.ts`/`admin-oracle-queue.ts`, itself built on `packages/observer`'s `DEFENSIVE_ADVISORIES`).

**Intended behavior.** Per the Product Definition: Admin is one privileged Owner management application for the entire platform, not split across two trust boundaries.

**Exact code entry points.**
- `apps/admin/*` — the intended privileged surface, currently underbuilt
- `apps/web/app/admin/*` — where the real features actually live today, inside the customer-facing app's own deployment
- `apps/api/src/services/admin-oracle-intel.ts`, `admin-oracle-queue.ts` — the real backing logic for the most sensitive feature (`oracle`), currently served to a route inside `apps/web`

**Data/control flow.** `apps/web/app/admin/oracle` → calls `apps/api` routes → `admin-oracle-intel.ts`/`admin-oracle-queue.ts` → `packages/observer`'s advisory data. Whatever auth gate protects this route today lives inside `apps/web`'s own routing/middleware, not in the separately-declared trust boundary of `apps/admin`.

**Security/permission/failure-mode implications.** This is the clearest concrete instance of "owner-level controls exposed in the normal user plane" in the whole review. It isn't a placeholder — `oracle` is working code, with real advisory-matching logic, sitting inside the same deployable and the same route namespace as the customer-facing product, relying on `apps/web`'s own auth rather than the dedicated, separately-deployed trust boundary `apps/admin` exists specifically to provide. Whether this is actually exploitable depends on exactly how `apps/web`'s auth gates that route — worth a dedicated check before treating this as either urgent or benign.

**Dependencies.** None on Gaps 1–3 — this is independent and could be resolved on its own schedule.

**What must not change.** Whatever real functionality exists in `leads`, `oracle`, `marketplace`, `users` must keep working through the migration — this is a move-the-surface change, not a rewrite-the-feature change.

**Minimal required change.** Move `apps/web/app/admin/*`'s real pages and their auth gate into `apps/admin`'s own deployment and trust boundary, or, at minimum, explicitly re-verify and document that `apps/web`'s auth on these routes is equivalent to what `apps/admin` would provide, if a full move isn't done immediately.

**Risks.** A move touches routing, auth, and possibly URLs bookmarked/used by you as owner today; a "verify and document" alternative is faster but leaves the actual trust-boundary split in place, just with more confidence it's not currently exploitable.

**Priority: P1.** Independent of the other three; worth prioritizing by actual exposure risk once the auth-gate check above is done, not by architectural tidiness alone.

---

## 3. Recommended target architecture (synthesis, not yet a decision on Gap 1)

```
ATLAS CORE (taqonu-main / "ArletOS")
   │
   ├── Atlas Engineering ── Fabric catalog (16 agents) ── judge/evaluate.ts + [Gap 2: real second-opinion]
   │
   ├── Atlas Protection ── Managed Systems (6, external, unchanged) ── [Gap 3: live connector, TBD design]
   │
   ├── Admin ── ONE privileged surface ── [Gap 4: consolidate apps/web/app/admin/* into apps/admin]
   │
   ├── Control Plane ── [Gap 1: EITHER live enforcement gateway OR oversight/audit-only —
   │                      your decision below determines the shape of everything downstream]
   │
   └── Shared Core ── Truth / Evidence / Memory / Knowledge / Agents / Policies / Verification / Audit
         (unchanged — this is the part that already works, for both products, today)
```

## 4. The Control Plane decision (yours to make — laid out, not resolved)

This is the single fork every other gap bends around:

- **If Option A (wire it live):** Gap 2's SECOND_OPINION decisions and Gap 3's future Managed-System supervision decisions should both be designed to flow through `gateway/ops` → `gateway/fulfill` from the start, so you only build the real enforcement path once.
- **If Option B (redefine as oversight-only):** Gap 2 and Gap 3 should both be designed to flow through `packages/agent-core`'s `authorizeEntityAction`/`enforceEntityWrite`, extended as needed — and Control Plane's role becomes: receive events from *all* real activity (not just `def-000`), display them accurately, and stop describing itself as an enforcement layer.

Neither option is free. Option A is a bigger, riskier engineering change now; Option B is a smaller change now but means the 13-stage Operating Cycle's real engineering work stays dormant unless revisited later.

## 5. Dependency graph

```
Gap 1 (P0, Control Plane decision)
   │
   ├──▶ Gap 2 (P1, internal AI supervision)
   │        — also blocked on retiring runSpecialistStub (separate, already-known prerequisite)
   │
   └──▶ Gap 3 (P1, external AI supervision)
            — also blocked on a connector design decision (push/pull/GitHub-only)
            — also blocked on resolving the Vantera naming collision before Vantera specifically

Gap 4 (P1, admin boundary) — independent, no dependency on 1–3
```

## 6. Recommended implementation order (sequencing only — not authorization to start)

1. **Decide Gap 1** (Option A vs. B) — everything else's design depends on this.
2. **Gap 4** can start in parallel immediately — it's independent, and the auth-gate verification step is cheap and worth doing regardless of what else is prioritized.
3. **Gap 2's prerequisite** (retiring `runSpecialistStub` for the agents that matter first) can also start in parallel — it's valuable with or without the supervision layer on top, and was already the staged roadmap's own Phase 1.
4. **Gap 2 proper** (wiring `modelHint`, feeding operational history into `judge/evaluate.ts`) — after Gap 1's decision and after enough of Gap 2's prerequisite is done to matter.
5. **Gap 3** (connector design, then implementation) — after Gap 1's decision; resolve the Vantera naming collision before connecting Vantera specifically.

---

Nothing in this document has been implemented. It's ready for your decision on Gap 1, and for you to tell me which of Gaps 2–4 (if any) to start on once that decision is made.
