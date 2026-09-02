# Atlas / ArletOS Architecture

**Canonical document:** [Architecture v1.0](./v1.0.md)

ArletOS is an **Engineering Intelligence OS**, not an AI agent product and not an IDE.  
Managed System abstraction: [managed-system.md](./managed-system.md).

Trust planes (ADR-021, amended 2026-09-02): **PUBLIC** / **USER PLANE** (`apps/web` + tenant API, including Studio and tenant `/admin`) / **CONTROL** (`apps/control-plane` :3100) / **ADMIN** (`apps/admin` :3200).
Atlas Admin supervises Control and Studio; it is not a Control dashboard clone. Tenant `/admin` is customer administration, not Atlas Admin.
Target hierarchy: [atlas-target-architecture.md](./atlas-target-architecture.md).
Integration with managed apps/agents goes through the **Atlas Gateway** (`POST /api/v1/gateway/events` and `/ops`) — not direct database or filesystem access.
Canonical authority graph (`evaluateOperatingCycle`): IDENTITY → AUTHORIZATION → POLICY → RISK → DECISION → APPROVAL → PLAN → EXECUTE → EVIDENCE → VERIFY → REGRESSION → AUDIT → MEMORY.
Control operational lifecycle: Application → Process → Event → Control → Policy → Risk → Decision → Approval → Execution → Verification → Evidence → Audit — see `GET /api/v1/operational-foundation`. Phase 3 Civio HMAC ingress is IMPLEMENTED on Atlas Control; Civio-repo wiring and execution are NOT IMPLEMENTED. Other siblings stay observe-only (ADR-022).
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
