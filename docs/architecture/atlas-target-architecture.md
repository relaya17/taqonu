# Atlas Target Architecture

**Status:** Approved direction — Phase 1 hierarchy and Phase 2 Control operational foundation implemented; later phases wait for approval
**Date:** 2026-09-02  
**Kind:** Authoritative target architecture (product model)  
**Baseline:** Current repository implementation  
**Rule:** Where an ADR conflicts with this target, amend the ADR. Do not preserve an obsolete restriction.

```
CURRENT IMPLEMENTATION  ≠  TARGET ARCHITECTURE  ≠  LEGACY / CONFLICTING DECISIONS
INTENDED                ≠  IMPLEMENTED          ≠  REACHABLE
```

---

## 1. Executive Summary

Atlas is one product with **three distinct surfaces**:

| Surface | Role | Must remain |
| --- | --- | --- |
| **Atlas Admin** | Highest-level administration and supervision of the Atlas platform, including Control and Studio | Not a duplicate Control dashboard |
| **Atlas Control** | Central supervisory/control application for connected applications, agents, processes, governance, and orchestration | Not Studio; not Admin |
| **Atlas Studio** | Developer workspace **already inside** the developer application | Upgrade in place; do not create, move, or merge |

Connected applications (CaseFlow, HotelOS, Civio, BrokerOS, LexStudy, Vantera, and later others) remain **independent runtimes**. Control supervises them through **explicit connectors**, not by embedding those applications.

A **Personal Supervising Agent** (one persistent agent per user) is a target Control capability. It does not exist in the current implementation.

Studio already exists at `apps/web` route `/[locale]/studio`. The target is to **upgrade that Studio**, not replace it.

**This document does not authorize code changes.** Implementation begins only after the Owner approves this target, including the open Studio write-policy decision (§5.4, §19).

---

## 2. Product Boundaries

### 2.1 What Atlas is

```
Atlas Admin     →  platform supervision (over Control, Studio, tenants, security)
Atlas Control   →  operational supervision (apps, agents, processes, governance)
Atlas Studio    →  developer workspace (code, patches, developer agents)
```

Atlas observes and governs **from the outside**. It is not “an AI wired into every app.” Workers (Cursor, Claude Code, CI) remain workers. Connected applications remain those applications.

### 2.2 What Atlas is not

- Not a new Studio application
- Not Studio moved into Control
- Not Admin merged with Control into one UI
- Not a host for sibling application runtimes
- Not an audit-log viewer pretending to be process monitoring
- Not a single agent registry that silently mixes platform, personal, application, and developer agents

### 2.3 Trust and deployment (current facts vs target)

**Current (ADR-021 amended 2026-09-02):** four surfaces plus tenant API:

| Origin | App | Default port |
| --- | --- | --- |
| Developer / user-plane UI (includes Studio) | `apps/web` | `:3000` |
| Tenant API | `apps/api` | `:4000` |
| Atlas Control | `apps/control-plane` | `:3100` |
| Atlas Admin | `apps/admin` | `:3200` |

Studio remains a route **inside** `apps/web`. Admin and Control remain separately deployable runtimes. Do not collapse them into one port or one Vercel project.

ADR-021 originally placed Admin and Control on one CONTROL plane. **Amended:** Admin is the parent platform supervisor. See the ADR amendment and §19 (historical conflict).

### 2.4 Naming of current “admin” surfaces (do not confuse)

1. `apps/admin` (`:3200`) — Atlas Admin. Hierarchy/overview contracts; supervises Control and Studio. Not a Control operational dashboard.
2. `apps/control-plane` (`:3100`) — Atlas Control operational APIs + dashboard.
3. `apps/web/app/admin` — tenant administration against `/api/v1/admin/*`. Customer `admin` is not Atlas Admin.

---

## 3. Admin Architecture

### 3.1 Target responsibility

Atlas Admin is the **highest** administration and supervision layer of the Atlas platform. It supervises:

- Atlas Control (as a managed platform component)
- Atlas Studio (as a managed developer surface — not by hosting the editor)
- users, tenants, roles, permissions
- agents (lifecycle and policy at platform level — not day-to-day process control)
- connected-application **registration** and integration contracts
- projects (platform catalog, not the developer workspace)
- Knowledge Fabric (corpus policy, allow-lists, isolation policy)
- Memory (retention, isolation, approval of memory types at platform level)
- governance **policy authoring** and SoD rules
- security, platform configuration, system health
- audit/evidence **oversight** (integrity, retention, access — not operational triage)

Admin **must not** become a second Control dashboard (live process feeds, agent run consoles, event timelines, in-app anomaly workbenches).

### 3.2 Target Admin owns

| Owns | Does not own |
| --- | --- |
| Who may operate Control / Studio | Live process state of CaseFlow/HotelOS/… |
| Platform RBAC and tenant lifecycle | Developer file tree and editor |
| Agent catalog **policy** (which classes exist, who may enable them) | Personal Supervising Agent’s minute-to-minute coordination |
| Knowledge/Memory isolation policy | Authoring application knowledge inside a connected app |
| Approving **platform-level** mutations (catalog changes, inheritance, Fabric mutation) | Routine operational approvals for a running process |
| System health of Atlas surfaces | Embedding sibling apps |

### 3.3 Current implementation (evidence)

| Claim | Evidence | Classification |
| --- | --- | --- |
| Atlas Admin exists on `:3200` | `apps/admin/src/server.ts` (`ADMIN_PORT` default `3200`) | IMPLEMENTED |
| Admin exposes hierarchy/overview contracts | `GET /api/v1/platform/hierarchy`, `GET /api/v1/platform/overview` | IMPLEMENTED |
| Admin no longer mirrors Control operational dumps | `composePlatformOverview` consumes Control `GET /api/v1/supervision` only | IMPLEMENTED |
| Admin supervises Studio without hosting it | Studio card + `GET /api/v1/platform/studio-supervision` on tenant API | PARTIAL (live counts require owner session on API) |
| Auth is browser session + Control token | `apps/admin/src/admin-auth.ts`, `browser-session.ts` | PARTIAL |
| Tenant `/admin` is a different surface | `apps/web/app/admin` labeled tenant admin | IMPLEMENTED |

### 3.4 Target Admin shape

```
Admin UI  (:3200, evolved — not a Control clone)
    │
    ├─ Admin API (new boundary; not Control GETs re-rendered)
    │     users / tenants / roles
    │     platform agent policy
    │     connected-app registration (contract, not live ops)
    │     Knowledge / Memory isolation policy
    │     governance policy authoring
    │     audit integrity / retention
    │     health of Admin + Control + Studio + API
    │
    └─ Supervises Control and Studio as platform components
         (status, config, access) — does not replace their UIs
```

Admin talks **to** Control for supervision data. It does not **be** Control.

---

## 4. Control Architecture

### 4.1 Target responsibility

Atlas Control is the **central supervisory and control application**.

```
User
  → Atlas Control
    → Personal Supervising Agent
      → specialized agents
        → connected application (via connector)
          → process
            → result / event
              → Control
```

Control is responsible for:

- connected applications and their integration contracts
- agents (orchestration, identity, pause/quarantine)
- Personal Supervising Agent (runtime home)
- process supervision and event monitoring
- anomaly / deviation detection
- operational governance, authorization, policy, risk
- approval of **operational** sensitive actions
- execution control (allow / block / escalate) **before** side effects on connected systems
- audit and evidence of Control decisions
- authorized knowledge access and memory for supervision
- escalation
- cross-application supervision

Control is **not** Atlas Studio. It does not host the developer editor, file tree, or human Save.

### 4.2 Target Control owns

| Owns | Does not own |
| --- | --- |
| Connector ingress / egress | Sibling app UI and domain workflows |
| Process state and event normalization | Studio textarea / workspace browser |
| Personal Supervising Agent | Fabric compile-time catalog edits (Admin + code change) |
| Operational allow/block/escalate | Silent tool execution inside Control |
| Cross-app correlation | Customer source code hosting |

### 4.3 Current implementation (evidence)

| Claim | Evidence | Classification |
| --- | --- | --- |
| Separate runtime `:3100` | `apps/control-plane/src/server.ts` (`CONTROL_PLANE_PORT`) | IMPLEMENTED |
| Application registry seeds **only** `def-000` | `apps/control-plane/src/services/application-registry.ts` (`ATLAS_SELF`, `ensureSeed`) | PARTIAL |
| Legacy 9-agent oversight list | `AGENT_DEFINITIONS` in `apps/control-plane/src/services/agent-registry.ts`; ADR-022 | LEGACY |
| Fabric projection (not executable) | `GET /api/v1/agents/fabric-projection` → `getFabricProjection()` | PARTIAL |
| Portfolio inventory (not live apps) | `GET /api/v1/portfolio-governance` → `getControlPlanePortfolioView()`; seed `packages/shared/src/portfolio/seed.ts` | PARTIAL (inventory) / MISSING (live) |
| Gateway evaluate ALLOW/DENY/REQUIRE_APPROVAL | `evaluateGatewayRequest`, `dispatchGatewayOperation` in `atlas-gateway.ts` | PARTIAL |
| Read ops = in-memory OBSERVATION | `fulfillAllow()` `executionKind: "OBSERVATION"` | PARTIAL |
| Write ops = handoff, **does not call** API fulfill | `fulfillAllow()` `executionKind: "HANDED_OFF_GOVERNED"`; comment cites `POST /api/v1/gateway/fulfill`; no HTTP call | CONFLICTING vs `remaining-work.md` “GATEWAY COMPLETION Wired” |
| Event ingest is in-process | `POST /api/v1/gateway/events` → `ingestGatewayEvent` | PARTIAL |
| API→CP bridge is fail-open telemetry, always `def-000` | `apps/api/src/services/control-plane-bridge.ts` | PARTIAL / CONFLICTING |
| CP audit sync exists, not started | `startPeriodicSync` in `audit-sync.ts`; **no** call from `server.ts` | MISSING (reachability) |
| Personal Supervising Agent | No symbol / route / registry entry in Atlas | MISSING |
| Live sibling process supervision | Not implemented; `/process-audit` is a **local workspace file scan** (`apps/web/app/[locale]/process-audit/page.tsx` → `POST /api/v1/qa/process-audit`) | MISSING |

### 4.4 Target Control shape

```
Control UI + Control API
    │
    ├─ Application registry (live connected apps, not only DEF-000)
    ├─ Connector gateway (events in, governed ops out)
    ├─ Agent directory (scoped — see §7; not one flat execution list)
    ├─ Personal Supervising Agent runtime (§8)
    ├─ Process / event store (§9)
    ├─ Policy / risk / approval (operational)
    ├─ Evidence pack + audit export to canonical trail
    └─ Knowledge / Memory retrieval under fail-closed permissions
```

Control **decides**. Execution against Atlas tools remains `executeGovernedAction` in `apps/api` (`apps/api/src/services/governed-execution.ts`). Execution against a connected application remains **inside that application**, after Control authorization. Control never silently runs sibling-app business logic.

---

## 5. Studio Architecture

### 5.1 Existing location (do not move)

| Item | Path / symbol |
| --- | --- |
| Sole Studio page | `apps/web/app/[locale]/studio/page.tsx` (`StudioPage`) |
| Route | `/[locale]/studio` (e.g. `/he/studio`) |
| Nav | `apps/web/components/layout/AppShell.tsx` `PATHS.studio = "/studio"` |
| Shared workspace linker | `apps/web/components/workspace/LinkWorkspaceRoot.tsx` |
| APIs | `apps/api/src/routes/code.ts` (`registerCodeRoutes`) |
| Workspace I/O | `packages/code-intelligence/src/workspace-browser.ts` |
| Agent propose | `packages/code-intelligence/src/patch-engine.ts` (`proposePatch`) |
| Write schema | `packages/shared/src/schemas/exemplar.schema.ts` (`studioWriteFileBodySchema`) |

**Related, not Studio:** `apps/web/app/[locale]/workbench/page.tsx` reuses `GET /studio/tree` and `GET /studio/file`.

**Target:** keep this page and this route. Upgrade in place. Do not create a second Studio. Do not move Studio into Control or Admin.

### 5.2 What Studio already implements

| Capability | Current state | Evidence |
| --- | --- | --- |
| Project picker | IMPLEMENTED | `StudioPage` + `GET /api/v1/projects` |
| Link local workspace | IMPLEMENTED | `LinkWorkspaceRoot` → discovery + `PUT /projects/:id/workspace-root` |
| Source tree | IMPLEMENTED | `GET /api/v1/studio/tree` → `listWorkspaceTree` (skip `node_modules`/`.git`/…, max 2500 / depth 12) |
| File read | IMPLEMENTED | `GET /api/v1/studio/file` → `readWorkspaceFile` (text allow-list, 400k cap, path jail) |
| Human Save | IMPLEMENTED | `PUT /api/v1/studio/file` → `writeWorkspaceFile` + `osStore.appendAudit({ type: "studio.file.written" })` + `PROJECT_STATE` memory |
| Agent propose | PARTIAL | `POST /api/v1/studio/ask-agent` → `createProposal` → `proposePatch`; not Fabric dispatch |
| Modes | IMPLEMENTED | `fix \| generate \| implement \| refactor \| secure` |
| Intents | IMPLEMENTED | Propose / Remind / Summary (`POST /memory` for remind/summary) |
| Exemplar clone | IMPLEMENTED | `GET /exemplars`, `POST /exemplars/:id/clone` → Patch |
| AuthN | IMPLEMENTED | Default-deny; `apps/api/src/private-by-default.test.ts` 401 on tree |
| Tree/file AuthZ | IMPLEMENTED | `resolveStudioWorkspaceRoot` — owned project; raw `workspaceRoot` is Control Plane role only |
| Ask-agent AuthZ | PARTIAL | Body may supply raw `workspaceRoot` **without** `resolveStudioWorkspaceRoot` |
| Editor | PARTIAL | `<textarea>`; `languageHint` unused |
| Knowledge | MISSING | Studio does not call `searchKnowledgeFabric` |
| Approve/Apply in page | MISSING | Link to `/patches` only |
| Evidence on patches | MISSING | `createProposal` sets `evidenceIds: []` |
| UI tests | MISSING | No Studio page tests; API tests in `apps/api/src/routes/studio-write.test.ts` |

### 5.3 What must remain

- Studio inside `apps/web` at `/[locale]/studio`
- Project + linked `workspaceRoot` as the developer unit
- Path-jailed workspace I/O
- Agent path = **propose Patch**, not silent disk apply
- Separate from Control process supervision and Admin platform UI
- Human authentication and project ownership for tenant users

### 5.4 Open decision — human Save vs Patch-only (do not resolve in code now)

**Documented intent (CONFLICTING with live UI):**

> README.md: “Studio | Human view-only · agent proposes patches (Approve → Apply)”

**ADR-015** normative WRITE: AI proposes → evaluate → (experts) → human approves → apply → verify → rollback.

**Live Studio:** human `PUT /studio/file` writes disk immediately. UI chip is editable. Copy also says only the agent changes code (`askHelp` vs Save).

`workspace-browser.ts` still comments “read-only studio browser” while exporting `writeWorkspaceFile`.

Save note in `code.ts` claims “Personal agent recorded PROJECT_STATE” — **no Personal Supervising Agent exists**.

**Target requirement:** pick **exactly one** write policy during the Studio upgrade, then align README, ADR wording, UI copy, and enforcement:

| Option | Meaning |
| --- | --- |
| **A. Dual writer (documented)** | Human Save remains a first-class, audited, project-owned write. Agent writes remain Patch → Approve → Apply. Docs stop saying view-only. |
| **B. Patch-only (ADR-015 strict)** | Human edits become proposed Patches (or drafts) until Approve → Apply. `PUT /studio/file` is removed or reduced to unsaved buffer. |

This document **does not choose A or B**. Implementation must not start until the Owner chooses.

### 5.5 Target Studio integrations (after approval)

| Integrate with | How (target) | What Studio must not become |
| --- | --- | --- |
| Control | Optional: show Control-issued constraints / pause on the **current project**; never embed Control dashboard | Control UI |
| Developer agents | Fabric `CODE_ENGINEER` / `DEBUGGER` / `QA` **propose-only** via governed API | Personal Supervising Agent home |
| Knowledge Fabric | Read-only evidence pack for the current project/agent allow-list | Cross-tenant corpus browser |
| Memory | Keep remind/summary + inject authorized developer context | Platform memory admin |
| Approval / governance | Agent (and, if option B, human) writes go through Patch + approval authority | Operational process approvals |
| Audit / evidence | Human save and agent propose both bind evidence IDs onto the **canonical** audit trail | Control’s process event store |

Ask-agent AuthZ must use the same resolver as tree/file (`resolveStudioWorkspaceRoot`).

---

## 6. Connected Application Architecture

### 6.1 Target model

```
Independent application runtime
    │
    │  connector contract (events, health, governed ops, identity)
    ▼
Atlas Control
```

Initial connected applications: **CaseFlow, HotelOS, Civio, BrokerOS, LexStudy, Vantera**. The same contract must accept later applications.

Rules:

- Do not embed the sibling runtime in Atlas.
- Do not inherit sibling WRITE, secrets, or permissions (`atlasInheritance: NONE` remains the default until an explicit Admin-approved contract says otherwise).
- Seed inventory is **not** a live connection.
- Runtime default until probed under policy: `UNKNOWN` / `NOT_PROBED` (current ADR-022 lock). Target Control **may** probe only through the connector, never by starting the sibling process from Atlas.

### 6.2 Current implementation (evidence)

| Claim | Evidence | Classification |
| --- | --- | --- |
| Six siblings exist as **portfolio seed** | `packages/shared/src/portfolio/seed.ts` (`APP.vantera` … `APP.civio`, commit pins e.g. Civio `0f79e86…`) | IMPLEMENTED (inventory) |
| Runtime `UNKNOWN` / `NOT_PROBED` | `RUNTIME_UNKNOWN` in `seed.ts`; ADR-022 | IMPLEMENTED (as inventory policy) |
| `atlasInheritance: NONE` | `seed.ts` source permission records | IMPLEMENTED (inventory) |
| CP application registry includes siblings | Only `def-000` in `application-registry.ts` | MISSING |
| Live connectors to those apps | No runtime connector; GitHub/local in `apps/web/app/[locale]/integrations/page.tsx` are **developer** integrations | MISSING |
| Civio knowledge snapshot | `packages/knowledge/src/fabric/civio-rights.snapshot.ts`; fail-closed `allowedAgentIds`: `RESEARCHER`, `LEGAL_MEDIA_COMMS` | PARTIAL (knowledge only) |
| CaseFlow “office personal agent” | Seed path `apps/server/src/services/jurisdiction/personalAgentService.js` — **CaseFlow source**, “No Atlas equivalent” | NOT an Atlas agent |

### 6.3 Target connector contract

Each connected application exposes (or is adapted by) a connector that can:

1. **Identify** — applicationId, environment, version, tenant mapping  
2. **Authenticate** — mutual credential; Atlas does not use the app’s user session as Control authority  
3. **Emit events** — process, agent, health, finding, security (normalized — §9)  
4. **Accept governed operations** — inspect / retrieve / request_agent_run / … only after Control decision  
5. **Refuse** — unknown ops, inherited authority, Atlas acting as the app  

Atlas Control stores **observation and decision**. The application stores **its own business state**.

---

## 7. Agent Architecture

### 7.1 Target agent classes (do not collapse)

| Class | Home | Purpose | Execution registry |
| --- | --- | --- | --- |
| **1. Atlas platform agents** | Fabric catalog | Specialists that run **inside Atlas** (code, QA, research, judge, …) | `FABRIC_AGENT_CATALOG` |
| **2. Personal Supervising Agent** | Control, one per user | Persistent supervisor for that user | Separate identity class `PSA` — not a Fabric specialist row reused as “the user” |
| **3. Specialized agents** | Fabric or approved extension | Domain specialists coordinated by Orchestrator or PSA | Fabric (or Admin-approved catalog change) |
| **4. Application-specific agents** | Connected application | Agents that live **in** CaseFlow/HotelOS/… | Application registry + portfolio source agents — **not** auto-copied into Fabric |
| **5. Developer agents (Studio)** | User plane + Fabric propose path | Assist Studio: generate, fix, refactor, review | Fabric engineering IDs (`CODE_ENGINEER`, `DEBUGGER`, …) invoked from Studio **propose-only** |

A **unified directory** is allowed only if it is a **projection** with mandatory fields:

- `agentClass` (one of the five)
- `tenantId`, `applicationId` (nullable for platform-global)
- `projectId` (nullable)
- `capabilities`, `permissions`, `knowledgeAllowList`
- `lifecycle` (ACTIVE / PAUSED / QUARANTINED / REVOKED)
- `riskClass`, `escalationPolicy`
- `auditIdentity` (stable, never reused after revoke)

Unscoped “list all agents and run any of them” is forbidden.

### 7.2 Required agent attributes (target)

Every executable or supervisable agent has: identity, tenant scope, application scope, project scope where applicable, capabilities, permissions, lifecycle, context, memory bindings, knowledge permissions, policy constraints, risk classification, escalation behavior, audit identity.

### 7.3 Current implementation (evidence)

| Registry | Count / role | Evidence | Classification |
| --- | --- | --- | --- |
| `FABRIC_AGENT_CATALOG` | 16 IDs (`ORCHESTRATOR` … `DATABASE`) | `packages/shared/src/constants/agents.ts` | IMPLEMENTED (platform catalog) |
| CP `AGENT_DEFINITIONS` | 9 legacy labels | `agent-registry.ts`; ADR-022: not execution | LEGACY |
| Portfolio SOURCE agents | Inventory only | `seed.ts` | PARTIAL |
| Studio ask-agent | Heuristic `proposePatch`, memory `requestingAgentId: "CODE_ENGINEER"` | `code.ts` `createProposal` | PARTIAL |
| `executeGovernedAction` | Real pre-exec gate for **Atlas tools** | `apps/api/src/services/governed-execution.ts`; tests `governed-execution.test.ts` | IMPLEMENTED (Atlas tools) |
| Personal Supervising Agent | — | Absent | MISSING |
| Application agents live in Control | — | Not registered in `application-registry` | MISSING |

ADR-017 (“One Brain + Many Specialists + One Judge”) remains a **platform-agent** pattern. It is not the Personal Supervising Agent and not application-specific agents.

---

## 8. Personal Supervising Agent

### 8.1 Target definition

One **persistent** Personal Supervising Agent (PSA) **per user**.

It can, **only within that user’s authorized permissions**:

- understand authorized user context
- remember relevant decisions / history
- observe authorized applications and processes
- receive events
- identify anomalies
- explain findings
- recommend actions
- coordinate specialized agents
- escalate uncertainty
- request approval
- maintain auditable activity

It **cannot**: inherit another user’s scope; execute sibling-app writes without Control governance; become Studio’s file writer; silently weaken policy; delete audit.

### 8.2 Target attributes

| Attribute | Target |
| --- | --- |
| Identity | Stable `psa:<userId>` (or equivalent), distinct from Fabric IDs |
| Lifecycle | Created at first eligible login; PAUSED / QUARANTINED / REVOKED by Admin or user policy; never silently re-created with a new audit identity after revoke |
| Persistence | Durable record in Control (not only in-memory CP maps) |
| Memory | User-scoped typed memory (ADR-004 types); no automatic cross-tenant promotion |
| Context | Authorized apps, processes, recent events, open approvals |
| Permissions | Intersection of user RBAC ∩ app bindings ∩ tool allow-list |
| Application bindings | Explicit list; empty means observe nothing |
| Event subscriptions | Normalized events for bound apps only |
| Escalation | Uncertainty / conflict / stale evidence → human or Admin-defined authority |
| Approval | PSA **requests**; it does not self-approve HIGH/production |
| Audit | Every observe/recommend/dispatch/escalate as WHO/WHAT/WHEN/WHY |
| Failure | Fail-closed on authz/policy; fail-open only for **non-gating** telemetry |

### 8.3 Current implementation

**MISSING.** Closest (not equivalent):

- User-plane companion bar (`AiCompanionBar`) — app-wide chat, not a PSA
- Memory + decisions + patches in `apps/web`
- CaseFlow seed “office personal agent” — CaseFlow-specific, explicitly “No Atlas equivalent” (`seed.ts`)
- Studio save copy referring to a “Personal agent” — false label

---

## 9. Process / Event Architecture

### 9.1 Target pipeline

```
Connected Application
  → Connector
  → Event ingestion
  → Event normalization
  → Bind Application / Tenant / User / Agent identity
  → Process state
  → Policy evaluation
  → Risk evaluation
  → Anomaly / deviation detection
  → Decision
  → Approval if required
  → Allow / block / escalate
  → Execution / result (in the application or governed Atlas tool)
  → Evidence
  → Audit
```

### 9.2 Distinctions (normative)

| Mode | When | Effect |
| --- | --- | --- |
| **Observation** | Event stored; no decision required | Control can display state |
| **Monitoring** | Continuous / subscribed process watch | Alerts, PSA notices |
| **Governance** | Policy + risk + authority applied | Decision record |
| **Real-time enforcement** | Sensitive action **before** execution | Allow / block / escalate |
| **Post-event audit** | After the fact | Integrity, forensics, compliance |

**An audit log is not process monitoring.** Hash-chained NDJSON without process state, identity binding, and deviation detection is audit only.

### 9.3 Current implementation (evidence)

| Piece | Evidence | Classification |
| --- | --- | --- |
| In-process domain bus | `packages/agent-core/src/events/event-bus.ts`; `domainEventBus` | PARTIAL (Atlas-internal) |
| Automation on that bus | `apps/api/src/services/automation-engine.ts` | PARTIAL |
| CP gateway event types | `APPLICATION_EVENT_TYPES` in `atlas-gateway.ts` | PARTIAL (schema) |
| Live sibling events | None; registry is `def-000` | MISSING |
| Fail-open API→CP map | `control-plane-bridge.ts` (5 event types, `applicationId: "def-000"`) | PARTIAL — telemetry, not enforcement |
| `/process-audit` | Local repo QA scan, not live process events | LEGACY name / MISSING vs this section |
| Anomaly module | `packages/agent-core/src/intelligence/anomaly-detection.ts` (comments cite audit/event counts) | PARTIAL / unproven as process supervision |

---

## 10. Knowledge Fabric Architecture

### 10.1 Target pipeline

```
Application / Agent knowledge
  → ingestion (explicit, approved)
  → provenance
  → authority evaluation
  → freshness
  → permissions
  → tenant isolation
  → Knowledge Fabric
  → authorized retrieval
  → agent context (evidence pack)
```

Supports: application-specific knowledge, shared Atlas knowledge, authoritative external sources, provenance, freshness, source/version pinning, agent allow-lists, tenant isolation, project isolation, **fail-closed** retrieval, offline use of **already stored trusted** knowledge, uncertainty escalation when evidence is insufficient.

**Never** assume one application’s customer evidence automatically becomes another application’s knowledge.

### 10.2 Current implementation (evidence)

| Claim | Evidence | Classification |
| --- | --- | --- |
| Fabric search + allow-lists | `packages/knowledge/src/fabric/search.ts` `searchKnowledgeFabric` | IMPLEMENTED (library) |
| Civio snapshot, fail-closed agents | `civio-rights.snapshot.ts`; tests in `persisted-store.test.ts` | PARTIAL |
| Hybrid RAG wrapper | `apps/api/src/services/hybrid-rag.ts` | PARTIAL |
| Studio uses Fabric | No call from Studio / ask-agent | MISSING |
| Cross-app customer evidence isolation at ingest | ADR-022: no knowledge ingest this phase for siblings; BrokerOS/LexStudy `ingestEnabled: false` in seed | PARTIAL (policy in seed) |
| Tenant/project partition of knowledge | `managed-system.md`: “Knowledge/memory tenant partition is a separate isolation track” | MISSING / deferred in current docs |

---

## 11. Memory Architecture

### 11.1 Target

Typed memory (ADR-004): FACT, DECISION, PREFERENCE, TASK, PROJECT_STATE, … with source, confidence, status, evidence, temporality, `superseded_by`.

Scopes:

| Scope | Owner | Used by |
| --- | --- | --- |
| User / PSA | User | Personal Supervising Agent |
| Project / Studio | Project owner | Developer agents, Studio intents |
| Application | Tenant ∩ application | Control + app-bound agents |
| Platform | Admin | Shared operational lessons — never customer evidence |

Retrieval is need-based and permissioned. Memory is not a dump into every agent.

### 11.2 Current implementation (evidence)

| Claim | Evidence | Classification |
| --- | --- | --- |
| Typed memory API | `apps/api/src/routes/memory.ts` `registerMemoryRoutes` | IMPLEMENTED |
| Owner scoping | `scopeMemoriesToCaller`; `cross-tenant-isolation.test.ts` | IMPLEMENTED |
| Studio remind/summary | `StudioPage` → `POST /api/v1/memory` | IMPLEMENTED |
| Studio ask-agent injects CODE_ENGINEER context | `buildMemoryContext` in `createProposal` | PARTIAL |
| Human save → PROJECT_STATE | `code.ts` PUT handler | IMPLEMENTED (local osStore) |
| PSA memory | — | MISSING |
| Durable vs process-local | Mix of osStore + optional Supabase (`tryPersistMemoryToSupabase`) | PARTIAL |

---

## 12. Governance Architecture

Sensitive actions are governed **before** execution.

### 12.1 Target stage order (normative)

1. Authentication  
2. RBAC  
3. Entity authorization  
4. Tool authorization  
5. Policy  
6. Risk  
7. Approval (if required) — authority, SoD, expiration, revocation  
8. Idempotency  
9. Execution authorization  
10. Execution  
11. Execution receipt  
12. Evidence  
13. Audit  

Deny and failure default **closed** for enforcement paths. Telemetry may fail open only if it cannot change the decision.

### 12.2 Layer ownership (target)

| Concern | Admin | Control | Agent | Connected app | Studio |
| --- | --- | --- | --- | --- | --- |
| Authentication | Platform IdP / owner bootstrap | Operator session | Agent identity issued by platform | App’s own users | User session |
| RBAC | **Owns** role model | Enforces operator + app bindings | Bound capabilities | App RBAC (not inherited) | Project membership |
| Entity authorization | Policy catalog | **Owns** operational entity-action | Must not bypass | Own entities | Project/file entity |
| Tool authorization | Catalog policy | Pause/quarantine | `allowedTools` | App tools | Developer tools via Fabric |
| Policy / risk | Author | **Evaluate** operational | Request | May have local policy | Code-risk on patches |
| Approval authority | Platform / SoD rules | Operational approvals | Cannot self-approve HIGH | App-native approvals stay in-app unless contracted | Patch approve (developer) |
| Execution | Never runs sibling apps | Authorizes; does not run sibling logic | Atlas tools via API gate | **Runs** its own actions | Disk write per chosen policy |
| Evidence / audit | Integrity & access | Decision evidence | Agent audit identity | App-origin events | Studio write/propose evidence |

### 12.3 Current implementation (evidence)

| Piece | Evidence | Classification |
| --- | --- | --- |
| Private-by-default API | ADR-021; `isPublicAtlasRoute`; `private-by-default.test.ts` | IMPLEMENTED |
| `executeGovernedAction` 6-stage gate | `governed-execution.ts` | IMPLEMENTED (Atlas tools) |
| CP `evaluateOperatingCycle` | `apps/control-plane/src/services/operating-cycle.ts` | PARTIAL (CP in-memory) |
| Human Studio save bypasses Patch | `PUT /studio/file` | CONFLICTING vs ADR-015 wording |
| CP write handoff unwired | `fulfillAllow` | CONFLICTING |

---

## 13. Approval Architecture

### 13.1 Target

Approvals are **bound to an artifact** (hash), have **authority**, **expiration**, **revocation**, **SoD** (requester ≠ sole HIGH approver where required), and are **consumed once** (idempotent replay returns the same receipt, does not re-execute).

Classes:

| Class | Surface | Example |
| --- | --- | --- |
| Platform | Admin | Fabric catalog mutation, inheritance change |
| Operational | Control | Allow a connected-app write / agent run |
| Developer | Studio / user-plane patches | Approve → Apply patch |
| Memory | User plane | `POST /memory/:id/approve` |

### 13.2 Current implementation (evidence)

| Piece | Evidence | Classification |
| --- | --- | --- |
| API approval store | `apps/api/src/services/approvals.ts` (in-memory `Map`; artifactHash / expires / REVOKED) | PARTIAL (not multi-process durable) |
| Patch approve/apply | `POST /api/v1/code/patches/:id/approve` and apply in `code.ts` | IMPLEMENTED |
| CP approval list | `GET /api/v1/approvals` → `listApprovalRecords` in `governance-state.ts` | PARTIAL (separate in-memory plane) |
| Studio in-page approve | Link only | MISSING |
| CP REQUIRE_APPROVAL → API consume → fulfill | Comment in `atlas-gateway.ts`; not a live hop | MISSING |

---

## 14. Audit / Evidence Architecture

### 14.1 Target

- **Canonical audit:** API hash-chained NDJSON (`apps/api/src/services/audit-log.ts` — `appendUnifiedAuditEntry`, `.atlas/audit/audit.ndjson`).  
- Control and Studio **append** to that authority (or import with verified chain). They do not become a second source of truth.  
- Evidence records have provenance, authority, freshness, and may be bound to patches (`evidenceIds`) and receipts.  
- Observation ≠ verified claim (ADR-014).

### 14.2 Current implementation (evidence)

| Piece | Evidence | Classification |
| --- | --- | --- |
| Canonical NDJSON | `audit-log.ts` | IMPLEMENTED |
| `osStore.appendAudit` (Studio save, many routes) | `code.ts` `studio.file.written`; not necessarily unified NDJSON | PARTIAL / CONFLICTING planes |
| CP in-memory hash chain | `governance-state.ts` | PARTIAL (observational; `remaining-work.md` stage 05) |
| `audit-sync.ts` | Defined; `startPeriodicSync` **never called** from `server.ts` | MISSING (reachability) |
| Patch `evidenceIds: []` | `createProposal` in `code.ts` | MISSING |
| Evidence model docs | `docs/architecture/evidence-model.md`, ADR-014 | INTENDED, not proof of Studio/Control binding |

---

## 15. Integration Architecture

### 15.1 Target

```
Connected app  ←→  Connector  ←→  Control Gateway
Developer GitHub / local folder  ←→  User-plane integrations  ←→  Studio workspace
Atlas API tools  ←→  executeGovernedAction
```

Two integration families, not one:

1. **Supervisory connectors** (Control) — CaseFlow, HotelOS, Civio, BrokerOS, LexStudy, Vantera, future apps.  
2. **Developer workspace integrations** (Studio / user plane) — GitHub App, local repos root (`apps/web/app/[locale]/integrations/page.tsx`).

Do not treat GitHub-linked folders as “HotelOS is connected to Control.”

### 15.2 Current implementation (evidence)

| Family | Evidence | Classification |
| --- | --- | --- |
| GitHub / local | `integrations/page.tsx`; ADR-003 GitHub App | PARTIAL (developer) |
| Portfolio seed | `seed.ts` | Inventory only |
| Gateway events/ops | `atlas-gateway.ts` + `POST /api/v1/gateway/*` on **Control** | PARTIAL, Atlas-self only |
| Managed System DEF-000 | `docs/architecture/managed-system.md`; `GET /api/v1/systems`; CP `def-000` | PARTIAL (Atlas-self) |

---

## 16. Admin vs Control vs Studio Responsibility Matrix

Legend: **O** = owns · **S** = supervises / policy · **U** = uses · **—** = must not own

| Capability | Admin | Control | Studio |
| --- | --- | --- | --- |
| Platform administration | **O** | — | — |
| User administration | **O** (platform / tenant lifecycle) | U (operator identities) | U (signed-in developer) |
| Agent administration | **S** (catalog policy, enablement) | **O** (operational lifecycle, PSA) | U (developer agents only) |
| Connected applications | **S** (registration policy) | **O** (live supervision) | — (may open a **local folder** that happens to be a sibling checkout — observation only) |
| Process supervision | S (that Control is healthy) | **O** | — |
| Personal Supervising Agent | S (policy, revoke) | **O** | — |
| Governance | **O** policy authoring | **O** operational evaluation | U (code-change governance) |
| Approvals | Platform / SoD | Operational | Developer patches (and human Save if option A) |
| Audit | Integrity, retention, access | Decision/event audit | Workspace write / propose audit |
| Evidence | Isolation policy | Process/decision evidence | Patch / review evidence |
| Knowledge | Corpus & isolation policy | Authorized retrieval for supervision | Authorized retrieval for development |
| Memory | Retention / isolation policy | PSA + operational memory | Developer / project memory |
| Developer workspace | S (that Studio exists and is safe) | — | **O** |
| Code editing | — | — | **O** |
| Code generation | — | — | **O** (via developer agents) |
| Agent-assisted development | — | — | **O** |
| System health | **O** (platform) | **O** (connected apps + Control) | U (local workspace reachability) |
| Security | **O** platform security | **O** operational enforcement | U (project AuthZ, path jail) |
| Integrations | S (which connectors are allowed) | **O** supervisory connectors | **O** developer Git/local |

---

## 17. Current Repository Baseline

Inspected read-only. Documentation is **not** treated as implementation.

### 17.1 Surfaces

| Surface | Implementation | Port |
| --- | --- | --- |
| Studio + rest of developer UI | `apps/web` | 3000 |
| Tenant API, Fabric execution, Studio APIs, memory, patches | `apps/api` | 4000 |
| Control | `apps/control-plane` | 3100 |
| Atlas Admin (platform supervisor) | `apps/admin` | 3200 |
| Tenant Oracle | `apps/web/app/admin` | 3000 |

### 17.2 Packages (relevant)

| Package | Role |
| --- | --- |
| `packages/shared` | Fabric catalog, portfolio seed, schemas, gateway constants |
| `packages/agent-core` | Tools, event bus, catalog helpers, automation |
| `packages/code-intelligence` | Workspace browser, `proposePatch` |
| `packages/knowledge` | Fabric search, Civio snapshot |
| `@atlas/system-model` | Managed System abstraction (docs + API) |

### 17.3 ADRs (prior decisions — not automatically this target)

| ADR | Still useful for | Conflicts with this target |
| --- | --- | --- |
| ADR-004 Memory | Typed memory | — |
| ADR-014 Evidence | Epistemic ranks | Product defined as engineering OS, not 3-surface Admin/Control/Studio |
| ADR-015 Governed WRITE | Patch pipeline | Human Studio Save; README view-only |
| ADR-017 Fabric | Platform specialists + Judge | Not PSA; not app agents |
| ADR-021 Trust planes | Private-by-default; separate CP runtime | Admin+Control same CONTROL plane; Studio as user-plane is aligned |
| ADR-022 Portfolio | Observe without execute; no silent Fabric ingest | Locks live connect/probe; target Control **will** need an approved later phase to go beyond inventory |

### 17.4 Tests that prove current Studio/Control slices

| Test | What it proves |
| --- | --- |
| `apps/api/src/routes/studio-write.test.ts` | PUT file + tree AuthZ / path escape |
| `packages/code-intelligence` workspace-browser tests | Path jail, skip dirs, size caps |
| `apps/api/src/private-by-default.test.ts` / `public-routes.test.ts` | Studio tree not public |
| `apps/api/src/services/governed-execution.test.ts` | Atlas tool gate |
| `apps/api/src/routes/gateway-fulfill.test.ts` | Fulfill exists **on API** when called |
| `apps/control-plane/src/__tests__/atlas-gateway.test.ts` | CP evaluate + handoff object; not live HTTP fulfill |
| `apps/control-plane/src/__tests__/control-plane-alignment.test.ts` | Portfolio does not mutate Fabric (16 agents) |
| `packages/knowledge/src/fabric/persisted-store.test.ts` | Civio allow-list fail-closed |
| **Absent** | Studio UI e2e; ask-agent AuthZ; PSA; live sibling connector |

---

## 18. Target Architecture Gap Matrix

| Area | Current State | Target State | Gap | Classification |
| --- | --- | --- | --- | --- |
| Admin | Hierarchy + supervision contracts; no longer a Control operational mirror | Highest platform supervisor over Control + Studio; not a Control clone | Broader Admin API (users, policy authoring) still later | PARTIAL |
| Control | `:3100` oversight of Atlas-self (`def-000`); gateway evaluate without live fulfill; fail-open telemetry | Supervisory control of connected apps, PSA, processes, enforcement | Live apps, PSA, wired enforcement, process store | PARTIAL |
| Studio | Single page in `apps/web`; tree/file/save/ask-agent; textarea | Upgraded developer workspace; one write policy; Fabric propose; evidence | Editor, AuthZ hole, knowledge, in-page governance UX | PARTIAL |
| Connected Apps | Portfolio seed; runtime UNKNOWN; CP registry = Atlas only | Independent apps via connectors | No live connectors | MISSING |
| Agents | 16 Fabric + 9 CP legacy + source inventory | Five classes with scopes; safe projection only | Collapse risk; no PSA class; Studio not Fabric | CONFLICTING |
| Personal Agent | Missing (companion ≠ PSA; CaseFlow seed ≠ Atlas) | One PSA per user in Control | Build new class | MISSING |
| Process Supervision | QA file scan named process-audit | Live process state from connectors | Different product | MISSING |
| Events | Internal `domainEventBus` + CP ingest for `def-000` | Normalized multi-app events | Identity, process bind, enforcement | PARTIAL |
| Knowledge | Library + Civio snapshot; Studio unused | Cross-app fabric with isolation | Tenant/project partition; Studio/Control retrieval policy | PARTIAL |
| Memory | Typed API + Studio notes; in-memory approvals | Scoped user/project/app/platform | PSA memory; durability | PARTIAL |
| Governance | Strong Atlas-tool gate; Studio human save bypass; CP handoff unwired | Before-exec on all sensitive paths | Unify planes; close bypasses | CONFLICTING |
| Approval | Patches + in-memory API store + CP list | Artifact-bound, durable, SoD, three classes | Durability; CP↔API hop | PARTIAL |
| Audit | Canonical NDJSON + osStore + unsynced CP chain | One SoR; Studio/Control append | Sync not started; Studio osStore-only | PARTIAL |
| Evidence | Model + some records; Studio patches empty IDs | Bound to decisions and patches | Studio/Control binding | PARTIAL |
| Integrations | GitHub/local (developer); gateway (Atlas-self) | Two families: developer vs supervisory | Supervisory connectors | MISSING |

---

## 19. Architecture Conflicts

These are **real conflicts**. They are not automatically bugs to “fix” in this document.

1. **Three-surface product model vs ADR-021** — ADR-021 puts Owner Admin and Control on one CONTROL trust plane. Target Admin **supervises** Control as a higher surface.
2. **`apps/admin` vs target Admin** — current Owner UI is a Control readout (`owner-html.ts` / `server.ts` fetches). Target forbids Admin being a duplicate Control dashboard.
3. **Three things named Admin** — `apps/admin`, `apps/control-plane`, `apps/web/app/admin`.
4. **README / ADR-015 view-only + Patch vs live `PUT /studio/file`.** Owner must choose option A or B (§5.4).
5. **Studio UI copy** — “only the agent changes code” vs Save file.
6. **`workspace-browser.ts` “read-only” comment vs `writeWorkspaceFile`.**
7. **Ask-agent raw `workspaceRoot` vs tree/file ownership resolver.**
8. **Two agent lists** — Fabric 16 vs CP 9. ADR-022 already says CP list is not execution; still confusing for Admin/Control UIs.
9. **`remaining-work.md` “GATEWAY COMPLETION Wired” vs `fulfillAllow` not calling `POST /api/v1/gateway/fulfill`.**
10. **`control-plane-bridge.ts` fail-open + hardcoded `def-000`** vs target fail-closed enforcement and multi-app identity.
11. **Audit planes** — NDJSON vs `osStore.appendAudit` vs CP in-memory; `startPeriodicSync` unreachable.
12. **ADR-022 observe-without-execute lock** vs target Control that must eventually supervise live processes. That requires an **explicit later phase**, not silent override of ADR-022.
13. **`/process-audit` name** vs process supervision (it is a local QA scan).
14. **Studio save “Personal agent recorded”** vs PSA MISSING.
15. **Managed-system “do not embed / ACT last”** is aligned with this target; **portfolio seed presented in UIs as if connected** is not a live integration.

---

## 20. Migration Principles

1. **Do not rebuild Atlas from scratch.** Upgrade existing Studio, Control, and Admin in place.  
2. **Do not create a new Studio.** Do not move Studio into Control. Do not merge Studio with Admin.  
3. **Do not collapse the three surfaces.**  
4. **Do not embed sibling runtimes.**  
5. **Do not treat seed, README, or ADR text as live behavior.**  
6. **Do not present an audit log as process monitoring.**  
7. **Do not merge agent classes** into one executable list without `agentClass` + scopes.  
8. **Do not implement** until this document (and §5.4 write policy) is approved.  
9. **Preserve** `executeGovernedAction` as the Atlas-tool gate; do not add a second silent executor.  
10. **Preserve** Fabric as the only Atlas **execution** catalog; CP 9-list stays oversight until explicitly retired.  
11. **Fail closed** on enforcement; fail open only on non-gating telemetry.  
12. **Customer evidence never auto-promotes** across applications.  
13. **Canonical audit** stays API NDJSON; other trails import or die.  
14. **ADR-022** remains in force until a dated phase explicitly supersedes “no probe / no ingest.”  
15. **No drive-by refactors**, renames, or deletions as part of “architecture cleanup.”

---

## 21. Implementation Phases

**Owner implementation sequence (separate from the planning table below):**

| Owner phase | Status |
| --- | --- |
| Phase 1 — platform hierarchy | Implemented 2026-09-02 |
| Phase 2 — Control operational foundation | Implemented 2026-09-02. Contracts only; no live sibling connectors |
| Phase 3+ | Not started |

**Planning table (do not treat as automatically authorized):**

| Phase | Intent | Depends on |
| --- | --- | --- |
| **P0 — Approval** | Owner approves this target + Studio write policy A or B | This document |
| **P1 — Bound the surfaces** | **Implemented 2026-09-02.** Admin ≠ Control ≠ tenant admin ≠ Studio. Admin supervises Control and Studio via contracts. | P0 |
| **P2 — Studio AuthZ + honesty** | Ask-agent uses `resolveStudioWorkspaceRoot`. Align README/copy/comments with chosen write policy. Tests for ask-agent ownership. **No new Studio app.** | P0 |
| **P3 — Audit SoR** | Studio writes and CP decisions reach `appendUnifiedAuditEntry`. Start or replace `audit-sync` with a reachable path. | P1 |
| **P4 — Studio upgrade (in place)** | Editor quality, evidenceIds on proposals, optional in-page patch status, Fabric propose-only for developer agents, optional Knowledge retrieval with allow-lists. | P0, P2, P3 |
| **P5 — Admin purpose split** | Admin API for platform concerns; Admin UI stops cloning Control operational dashboards. Health of Control/Studio as **components**. | P1 |
| **P6 — Control enforcement hop** | Wire CP ALLOW/APPROVAL to API `gateway/fulfill` **fail-closed**, without turning CP into a tool runner. Still Atlas-self first. | P3 |
| **P7 — Connector contract** | Specify and implement the first supervisory connector against **one** sibling, observe-only, ADR-022 constraints until explicitly lifted. | P5, P6, explicit Owner lift of ADR-022 probe rules |
| **P8 — Process / events** | Normalization, process state, monitoring ≠ audit. | P7 |
| **P9 — Personal Supervising Agent** | Identity, persistence, bindings, subscriptions, escalate/approve. | P6, P8, memory scopes |
| **P10 — Remaining siblings** | Same connector model for HotelOS, Civio, BrokerOS, LexStudy, Vantera, then others. | P7–P9 |

Out of scope for all phases unless the Owner reopens this document:

- New Studio application  
- Studio hosted inside Control or Admin  
- Embedding CaseFlow/HotelOS/Civio/BrokerOS/LexStudy/Vantera  
- Silent Fabric catalog mutation from portfolio  
- Treating tenant Oracle as Atlas Admin  

---

## Document control

| Field | Value |
| --- | --- |
| Path | `docs/architecture/atlas-target-architecture.md` |
| Supersedes as *target* | Informal three-surface discussions; does **not** auto-void ADR-014–022 |
| Implementation authorized | Phase 1 and Phase 2 |
| Next step | Owner approval before Phase 3 |
