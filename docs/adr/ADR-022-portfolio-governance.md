# ADR-022 — Portfolio Governance (observability over sibling applications)

**Status:** Accepted — amended 2026-09-02 (Phase 3 Civio connector)
**Date:** 2026-08-28  
**Product:** Atlas / ArletOS

## Amendment 2026-09-02 — Civio connector (Phase 3)

Phase 3 authorizes **one** sibling path:

`Civio runtime → HMAC connector client → POST /api/v1/connectors/civio/events → evaluateOperatingCycle`

This amendment **supersedes observe-only for that Civio ingress only**.

- Application identity is `civio`, never `def-000`.
- Authentication is a deployment-configured HMAC secret (`ATLAS_CIVIO_CONNECTOR_SECRET`) bound to `ATLAS_CIVIO_TENANT_ID` and `ATLAS_CIVIO_PROJECT_ID`. Fail closed if any are missing.
- Control evaluates Event → Policy → Risk → Decision. It does **not** execute Civio or Atlas tools on ingest.
- Civio is not in this monorepo. The Civio runtime (`github.com/relaya17/civio`) emits from authenticated `POST /api/ai/legal-query` via `emitCivioEventToControl`. Deploy `ATLAS_CIVIO_*` on both runtimes.
- CaseFlow, HotelOS, BrokerOS, LexStudy, and Vantera stay observe-only / not connected.
- Portfolio seed remains inventory. Knowledge snapshot rules are unchanged.
- Atlas-to-Civio inbound actions are not implemented.

## Amendment 2026-09-02 — Control operational contracts (Phase 2)

Atlas Control now publishes an **operational foundation**
(`GET /api/v1/operational-foundation`) and an empty process contract
(`GET /api/v1/processes`).

**This amendment does not lift observe-only / no-probe / no-ingest.**

- Contracts are not live connectors.
- Portfolio seed remains inventory, not a runtime connection.
- CaseFlow, HotelOS, Civio, BrokerOS, LexStudy, and Vantera are not connected.
- A later phase must explicitly authorize the first sibling connector.

The Control operational lifecycle is:

`Application → Process → Event → Control → Policy → Risk → Decision → Approval → Execution → Verification → Evidence → Audit`

It sits beside the existing per-request operating cycle. It does not replace
`evaluateOperatingCycle` or `FABRIC_AGENT_CATALOG`.

## Context

Atlas should inspect and govern a portfolio of sibling applications and their
agents (Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy, Civio) without becoming a
duplicate of those applications and without executing them.

`FABRIC_AGENT_CATALOG` is the sole source of truth for agents that actually
execute inside Atlas. Control Plane `AGENT_DEFINITIONS` (9 legacy labels) is an
oversight snapshot. It must not become a competing execution registry.

## Decision

Three planes remain separate:

1. **Fabric runtime** — `FABRIC_AGENT_CATALOG` → identity → `executeGovernedAction`.
2. **Control Plane oversight** — legacy `GET /api/v1/agents` (9 items) unchanged;
   add a **fabric projection** that is not executable.
3. **Portfolio Governance inventory** — static, provenance-complete records of
   source applications, agents, capabilities, dedup/conflicts, and owner
   decisions. Persistence is overlay-only (decisions + audit). Seed inventory
   is code.

Non-negotiable:

- No sibling repository modification, start, or probe.
- Source runtime defaults to `UNKNOWN` / `NOT_PROBED`. Verification ≠ runtime.
- No knowledge ingest in this phase.
- No automatic Atlas specialist creation; no automatic `FABRIC_AGENT_CATALOG`
  mutation.
- Source WRITE, secrets, external authority, and permissions are never inherited
  (`atlasInheritance: NONE`). Source permissions and Atlas permissions are
  separate collections.
- `CREATE_NEW_ATLAS_SPECIALIST` and `ADAPT_INTO_EXISTING_ATLAS_CAPABILITY`
  require Owner approval and a **separate** Fabric catalog code change
  (`APPROVED_PENDING_FABRIC_CHANGE`). `ADAPT_INTO_EXISTING` is a legacy alias.
- Distinct planes: source code, knowledge, source agent, source capability,
  canonical Atlas capability, provenance, evidence, runtime, source
  permissions, Atlas permissions, governance decision, audit, Fabric agent ref.
  A value in one plane is never silently another plane.
- Dedup and conflict classification occur before any proposed ingest.
- Canonical audit for decisions is API NDJSON.

## Civio onboarding

Civio is a SOURCE application pinned to an inspected commit. Its runtime,
authentication, Gemini calls, and write authority remain inside Civio and are
not inherited by Atlas.

The approved knowledge snapshot contains Civio `RIGHTS_ITEMS` and
`LEGAL_FOUNDATIONS` only. Corpus access is fail-closed and restricted to the
`RESEARCHER` and `LEGAL_MEDIA_COMMS` Fabric agents. Every document retains its
official source URL; the snapshot generator records the Civio source commit.

## Consequences

- Owner inspects the portfolio from Control Plane / Admin without turning Atlas
  into a warehouse of those apps.
- Recording a decision is not execution, ingest, or catalog mutation.
- Breaking `GET /api/v1/agents` length-9 compatibility requires an explicit
  later approval.
