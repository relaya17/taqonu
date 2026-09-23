# Atlas / ArletOS Architecture

Architecture sources by role (there is no single canonical architecture file):

- [`v1.0.md`](./v1.0.md) — dated normative MVP contract (2026-08-11)
- [`docs/adr/`](../adr/) — canonical architectural decisions (ADR-001–ADR-023)
- [`CONTROL_10_OF_10_MASTER_PLAN.md`](./CONTROL_10_OF_10_MASTER_PLAN.md) — authoritative Control remediation register (G1–G28, CTRL, R01–R20). Do not create a second one.
- [`remaining-work.md`](./remaining-work.md) — historical 01–19 closure plus the current non-Control remainder. It is not the Control register.
- [`remaining-external-dependencies.md`](./remaining-external-dependencies.md) — remaining credentials, infrastructure, partners, and product decisions that local implementation cannot close
- [`gap-matrix.md`](./gap-matrix.md) — current G1–G7 gap classification

ArletOS is an **Engineering Intelligence OS**, not an AI agent product and not an IDE.  
Managed System abstraction: [managed-system.md](./managed-system.md).

Trust planes (ADR-021, amended 2026-09-02): **PUBLIC** / **USER PLANE** (`apps/web` + tenant API, including Studio and tenant `/admin`) / **CONTROL** (`apps/control-plane` :3100) / **ADMIN** (`apps/admin` :3200).
Atlas Admin supervises Control and Studio; it is not a Control dashboard clone. Tenant `/admin` is customer administration, not Atlas Admin.
Target hierarchy: [atlas-target-architecture.md](./atlas-target-architecture.md).
Integration with managed apps/agents goes through the **Atlas Gateway** (`POST /api/v1/gateway/events` and `/ops`) — not direct database or filesystem access.
Canonical authority graph (`evaluateOperatingCycle`): IDENTITY → AUTHORIZATION → POLICY → RISK → DECISION → APPROVAL → PLAN → EXECUTE → EVIDENCE → VERIFY → REGRESSION → AUDIT → MEMORY.
Control operational lifecycle: Application → Process → Event → Control → Policy → Risk → Decision → Approval → Execution → Verification → Evidence → Audit — see `GET /api/v1/operational-foundation`. Phase 3 Civio path is IMPLEMENTED (Civio legal-query → HMAC → Control evaluateOperatingCycle). One CaseFlow execution-report hop is LOCAL RUNTIME VERIFIED. Durable nonce, preflight decision, and audit binding on the live path are VERIFIED AGAINST REAL LOCAL POSTGRES and are not production-verified. HotelOS runtime, repeated FAILURE runtime, and offsite disaster recovery remain ENVIRONMENT BLOCKED. General sibling execution reporting is not proven.
Agents and tools must not implement a second authorization path. A successful command is not a successful repair: mutation requires a verification plan. Agent-to-agent delegation cannot inherit unlimited authority. Pause/quarantine is checked at dispatch time, not only at run start.
Principles: private-by-default, controlled egress, separate Control Plane, self-governance with human approval. Atlas-self is **DEF-000**.

```
Evidence + Current State
        ↓
Engineering Graph
        ↓
Historical Memory
        ↓
Portfolio Intelligence
        ↓
AI Agent (executor)
```

MVP center: GitHub + Supabase + Memory + Evidence + Project State + Agent (READ/ANALYZE/PLAN) + Eval gate.  
Connectors beyond GitHub are backlog feeds — not the product center.

**Implemented now:** [State Reconciliation](./state-reconciliation.md) via `@atlas/state` + `POST /api/v1/github/sync` → Current State.
