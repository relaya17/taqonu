# Atlas / ArletOS Architecture

**Canonical document:** [Architecture v1.0](./v1.0.md)

ArletOS is an **Engineering Intelligence OS**, not an AI agent product and not an IDE.

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
