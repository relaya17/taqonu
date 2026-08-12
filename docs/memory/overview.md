# Memory

Typed memories with provenance and temporal validity. Never dump all knowledge into one undifferentiated table.

## Pipeline (MVP)

1. **Classify** — `classifyMemoryType` on create  
2. **Persist** — local `osStore` (source of truth) + dual-write to Supabase `memories` when live  
3. **Approve** — `POST /api/v1/memory/:id/approve` + pending queue UI  
4. **Retrieve** — budgeted `GET /api/v1/memory?mode=retrieve&query=`  
5. **Agent context** — `memoryContext` on plan/dispatch; QA LEARN portfolio patterns → INFERRED lessons  

## Portfolio intelligence

QA LEARN extracts durable cross-project patterns (`GET /api/v1/qa/patterns`) and seeds memory for later retrieve. Patterns are INFERRED until human-approved as FACT.

## Rules

- Epistemic labels always visible  
- Secrets never in memory statements  
- Prefer INSUFFICIENT_EVIDENCE over invented portfolio “truth”
