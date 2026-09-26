# ADR-025 — ArletOS ↔ Control ↔ Atlas boundary (Stage 4 enforcement points)

**Status:** Accepted
**Date:** 2026-09-26
**Product:** ArletOS (Web + Studio)
**Decisions:** Stage 3 D10 and D3 (agent-authority part), approved by Arlet
2026-09-26, and Arlet's architecture clarification of 2026-09-26 (§1 below,
authoritative). Record: `docs/architecture/ARLETOS_MASTER_PROBLEM_REGISTER.md` §7.2, §7.7, §7.9, §10.
**Relates to:** ADR-021 (trust planes), ADR-023 (single live approval authority), ADR-024 (agent identity).

## 1. Architecture (authoritative clarification)

```text
Atlas    — shared knowledge, registered agents, evidence, governance context
  │
  ▼
Control  — separate application: oversight, control, governance,
  │        supervision, knowledge-agent services
  ▼
ArletOS  — independent application (Web + Studio)
```

- **ArletOS is an independent application** with its own users, application
  data, personal memory, projects, workspace, personal/user agent,
  application-owned agents, and application logic.
- **Control is a separate application.** It obtains applicable knowledge,
  registered-agent information, evidence, and governance context from Atlas,
  and provides applicable oversight / control / knowledge-agent services to
  ArletOS.
- Control is **not** a Studio subsystem, an internal ArletOS workflow or
  backend, the owner of ArletOS application data, or a shared application
  runtime for ArletOS, HotelOS, and CaseFlow, which remain separate
  applications.
- Control does **not** receive unrestricted ArletOS private application data.
- The relationship is `Atlas → Control → ArletOS` for applicable services.
  It is **not** `ArletOS Studio → Control backend → Apply`.

## 2. Decision (Stage 4 enforcement points inside ArletOS)

1. **Studio requests and presents.** Studio (`apps/web` `/[locale]/studio`
   and the ArletOS API routes it calls) creates proposals, shows evidence, and
   carries human decisions into ArletOS's own governed paths.
2. **ArletOS governs its own actions.** Policy checks, SoD, approvals
   (ADR-023), kill switches, and the dispatch guard for ArletOS actions are
   ArletOS application paths (`apps/api`). Stage 4 adds no new approval
   engine and no coupling from Studio to a Control backend.
3. **Agents never write files directly.** Agent changes go through
   proposal/patch. `PUT /api/v1/studio/file` is human-only: an agent-actor
   request is denied (403) before any write, at parity with move; the audit
   records `actorKind: "USER"` for the human write.
4. **Agents never run tools on a caller-selected identity.**
   `POST /api/v1/agents/tool-execute` denies (403, `blockedAt: IDENTITY`)
   because no trusted runtime agent identity exists on that route. The
   remaining governed tool path is `/api/v1/gateway/fulfill` in the ArletOS
   API, reachable only with an operator session or the Control Plane service
   token (`cp:service`); it is a service entry point, not a transfer of
   ArletOS data ownership.
5. **Tenant Web Admin ≠ Atlas Platform Admin** (ADR-021). The tenant `admin`
   role grants no agent/LLM access to other owners' memory (ADR-024).

## 3. Open (not decided here)

- Code-level mapping of which Control services ArletOS consumes, and which
  ArletOS data (if any) each service may receive. Not established by current
  evidence; not invented here.
- D3 overwrite/version protection and the full file-operation set (separate
  workstream).
- Tenant `admin` visibility of other owners' memory on human surfaces.

## Consequences

Studio features that need an agent to change files or run tools route
through proposal/patch or the governed gateway. A route that accepts an agent
id from the caller treats it as a target, never as an actor (ADR-024). No
ArletOS change may treat Control as its backend or give Control unrestricted
access to ArletOS private data.
