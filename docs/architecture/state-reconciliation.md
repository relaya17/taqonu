# State Reconciliation

Normative engine for Architecture v1.0 pillar ①.

```
GitHub observation (FACT)
   + Evidence
   + Decisions / Memory
        ↓
@atlas/state reconcileProjectState()
        ↓
project_state_snapshots (12 slices)
        ↓
WHAT IS TRUE NOW?
```

## Rules

- Never invent FACT from PROPOSED
- Overall epistemic state = weakest slice (or CONFLICTED)
- Deployment/Database/Environment stay UNKNOWN until connectors exist
- Conflicts are retained, never silently merged

## API path

1. `POST /api/v1/github/sync` — ingest observed repo FACT + evidence  
2. `POST /api/v1/projects/:id/state/reconcile` — run engine  
3. `GET /api/v1/projects/:id/state` — Current State  
4. `GET /api/v1/projects/:id/resume` — derived from snapshot  
