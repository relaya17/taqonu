# ADR-018 — ATLAS Intelligence Kernel v1

**Status:** Accepted (Phase 1–3 foundation)  
**Date:** 2026-08-11  
**Product:** Atlas / ArletOS · Agent Operating System

## Context

ADR-017 introduced Fabric Agents. Atlas must now become an **Agent OS**: a
Kernel that manages identities, permissions, memory, evidence, tools, budget,
tracing, evaluation, and model swappability — not a chat room of agents.

## Decision

### Seven Kernel layers (full vision)

1. Orchestrator  
2. Agent Registry  
3. Knowledge Fabric  
4. Evidence Graph / Bus  
5. Tool Fabric  
6. Judge + Council  
7. Learning / Memory  

### Build order (mandatory)

```
P1 Registry → P2 Orchestrator → P3 Evidence Bus
→ P4 Knowledge Fabric → P5 Specialists → P6 Judge
→ P7 Engineering Loop → P8 Evaluation → P9 Memory → P10 Self-Improvement
```

**This ADR ships Phase 1–10 as a production-grade foundation** (contracts +
deterministic runtime + evaluation + memory + self-improvement hooks).
Specialist LLM bodies deepen behind eval metrics without changing the Kernel.

### Critical epistemic rule

If evidence is insufficient:

```
INSUFFICIENT_EVIDENCE
```

Never:

```
CONFIDENT_HALLUCINATION
```

Judge outcomes include `INSUFFICIENT_EVIDENCE` (distinct from
`REQUEST_MORE_EVIDENCE` when retrieval cannot satisfy requirements).

### Simulation before production mutation

```
Task → Plan → Simulation → Specialists → Judge → Risk
→ Approval → Patch → Tests → Verify → Deploy
```

Dangerous actions: agent **cannot execute**; produces proposed action → second
review → policy → human if required.

### Portfolio Engineering Memory

Share only verified **patterns/lessons**, never raw business data across
projects (BrokerOS / HotelOS / …).

## Phase 1–3 contracts

| Phase | Artifact |
| --- | --- |
| 1 | `RegisteredAgent` — version, capabilities, tools, permissions, I/O schemas, evidencePolicy, budgets, eval suite, status |
| 2 | `TaskPlan` — objective, subtasks, dependencies, agents, evidence, risk, budget, successCriteria, simulationRequired |
| 3 | `EvidenceBusEvent` — claim-linked evidence envelopes published by agents |

## Non-goals (now)

- 20 new specialist LLM bodies  
- Full RAG corpus ingestion  
- Uncontrolled agent-to-agent chat  
- Autonomous production writes  

## Related

ADR-014 · ADR-015 · ADR-016 · ADR-017
