# ADR-024 — Agent identity, memory authorization, and attribution

**Status:** Accepted
**Date:** 2026-09-26
**Product:** Atlas / ArletOS (Web + Studio)
**Decisions:** Stage 3 D8, New Decisions A and B; Stage 4 D-A, D-B, D-C
(approved by Arlet 2026-09-26). Record: `docs/architecture/ARLETOS_MASTER_PROBLEM_REGISTER.md` §7.2, §7.6, §7.7.

## Context

Before Stage 4 the API treated agent identity as optional and, in places,
caller-chosen:

- Memory reads with no requesting agent id, or with an id that had no
  governance profile, were open ("default-open").
- `/agent/runs` and `/conversation/message` read memory with no agent
  identity. A tenant `admin` (the first registered user) read every owner's
  memory, and that memory entered the LLM prompt.
- Reconciled project snapshots copied TASK/GOAL/BUG memory statements into
  agent context, bypassing `allowedAgents`.
- `POST /agents/tool-execute` ran a tool as a caller-selected `fabricAgentId`.
- `PUT /studio/file` had no agent-actor denial.
- Several audit records wrote a human user id as `agentId`.

## Decision

### 1. Only server-derived identities are authoritative

| Identity | How it is derived | Authority |
| --- | --- | --- |
| Human user | Authenticated session | Human actions on their own resources |
| PSA `psa:<userId>` | `personalSupervisingAgentId(session user)` on the server | Personal memory of that owner only; coordinates, requests; never approves or applies |
| CODE_ENGINEER | Constant set by the server route (`/code/patch`, `/studio/ask-agent`) | Proposes patches (heuristic); Fabric profile, no memory read |
| Fabric specialist | Registry id, selected by the server planner or named as a **target** | Fabric profile; no memory read until record-level scope exists |
| Control Plane service | `cp:service` bearer | Control-plane operations |
| Application | HMAC | Authenticates the application, not an agent in it |
| Companion | UI model/provider preference (`/api/v1/ai/providers`) | Not an agent identity; no authority (INFERRED from source) |

A caller-supplied agent id (body, query, `x-atlas-*` header) is never an
authenticated actor. It is at most a **requested target**. Headers may deny;
they never grant. Missing, null, empty, unknown, unregistered, mismatched,
and spoofed ids fail closed. No parallel identity system is introduced.

### 2. `/agent/runs` and `/conversation/message` act as `psa:<session user>`

The identity comes from `assistantRunIdentity(session owner)`
(`apps/api/src/services/agent-context-authorization.ts`). Memory is read with
`ownerId = session user` and `requestingAgentId = psa:<session user>`. The
tenant `admin` role never widens an agent/LLM context. CODE_ENGINEER is not
this identity.

### 3. Memory authorization is fail-closed

`memoryIsVisibleToAgent` (`memory-pipeline.ts`):

- No requester id → visible **only** when the call declares
  `humanSurface: true` (a human-facing read that is not sent to an agent).
- Every supplied id must be a non-empty string with a governance profile
  that allows the read; mixed ids are combined with AND.
- A PSA id is valid only as `psa:<memory.ownerId>`; the class id and the bare
  `psa:` prefix are denied.
- A non-empty `allowedAgents` further restricts to the listed ids.
- Fabric profiles deny all memory reads (unchanged).

### 4. Snapshots cannot bypass memory authorization

Before a snapshot enters agent context, `authorizeSnapshotForAgentContext`
removes each TASK/GOAL/BUG-derived statement the acting identity may not read.
Non-memory content is kept. The stored snapshot is not modified.

### 5. Attribution: USER REQUEST + AGENT ACTOR + TARGET + CORRELATION

Existing unified-audit fields only:

- Human requester: `onBehalfOfUserId` / `ownerId`; a human action has
  `actorKind: "USER"` and `agentId: null`.
- Acting agent: `actorKind: "AGENT"`, `actorId`/`agentId` = the agent
  (for PSA requests, `psa:<owner>`).
- Specialist: `input.targetAgentId` (never `actorId`).
- `psa.request` and its dispatch share one `correlationId`;
  `delegationHopCount: 1`.
- A human user id is never written as `agentId`.

## Consequences

- Agent paths that do not pass an identity now receive no memory. This is
  intended; the fix is to pass the server-derived identity, never to reopen
  the default.
- `tool-execute` is denied (403, `blockedAt: IDENTITY`) until a trusted
  runtime agent identity exists. Governed tool execution remains available
  through `gateway/fulfill` (operator / Control Plane).
- Fabric professional memory stays closed. Opening it needs record-level
  memory scope, legacy-record reconciliation, and professional-memory
  authorization (later stage).
- A tenant `admin` still sees all owners on human memory list/retrieve
  surfaces (`memory.ts`); whether that stays is a separate human decision.
