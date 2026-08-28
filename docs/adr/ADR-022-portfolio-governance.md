# ADR-022 — Portfolio Governance (observability over sibling applications)

**Status:** Accepted  
**Date:** 2026-08-28  
**Product:** Atlas / ArletOS

## Context

Atlas should inspect and govern a portfolio of sibling applications and their
agents (Vantera, HotelOS, CaseFlow, BrokerOS, LexStudy) without becoming a
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

## Consequences

- Owner inspects the portfolio from Control Plane / Admin without turning Atlas
  into a warehouse of those apps.
- Recording a decision is not execution, ingest, or catalog mutation.
- Breaking `GET /api/v1/agents` length-9 compatibility requires an explicit
  later approval.
