# ADR-017 — Atlas 1.2 Multi-Agent Intelligence Fabric

**Status:** Accepted (foundation)  
**Date:** 2026-08-11  
**Product:** Atlas / ArletOS

## Context

Atlas must feel like a “collective mind” without becoming a chat room of
unbounded agents. Commercial Validation remains the go-to-market wedge; this
ADR locks the **engineering architecture** for multi-specialist intelligence.

## Decision

**One Brain + Many Specialists + One Judge**

```
User → Orchestrator → (Planner / Researcher / Memory)
                 → Specialist Pool (parallel, isolated context)
                 → Evidence Bus
                 → Judge / Council
                 → Quality Gates → Human Approval → Patch/Action → Verify → Memory
```

### Hard rules

1. **Agent ≠ Model.** An agent is role + tools + permissions + schemas +
   evidence policy + budget + risk + eval suite.
2. **No free-form agent-to-agent chat.** Handoffs are typed envelopes on an
   Evidence Bus.
3. **Context isolation.** Each specialist receives an Evidence Package, not
   the entire corpus.
4. **Retrieval is need-based.** Planner declares required evidence →
   Knowledge Fabric retrieves → Authority + Freshness + Relevance filters.
5. **Judge does not write code.** Outcomes: APPROVE | REJECT |
   REQUEST_MORE_EVIDENCE | ESCALATE_HUMAN.
6. **WRITE stays approval-gated** (ADR-015).
7. **Self-audit:** the agent fleet is evaluated like a product (DEF-000 class).

### Initial specialist pool (12)

| Agent | Duty |
| --- | --- |
| ORCHESTRATOR | Decompose, dispatch, budgets |
| ARCHITECT | Structure, boundaries, debt |
| CODE_ENGINEER | Patches only |
| DEBUGGER | Reproduce → isolate → patch → verify |
| QA | What must be tested |
| TEST_ENGINEER | Author tests |
| SECURITY | AuthZ, secrets, supply chain |
| ACCESSIBILITY | WCAG / RTL / focus |
| UI_UX | Flows / IA / usability |
| DEVOPS | CI/CD, cloud, observability |
| RESEARCHER | External authorized sources → Evidence |
| JUDGE | Belief / contradictions / escalation |

Existing Expert Council (`EXPERT_CATALOG`) remains a **review lens**; Fabric
Agents are the **runtime roles**. Mapping is many-to-one where useful.

### Knowledge Fabric

```
Your Data | External Web | Live Systems
            → Normalize → Evidence Graph → Atlas Mind
```

Cross-project sharing only for **general lessons / patterns**, never raw
customer project evidence (no data leakage).

### Source Authority (web / external)

Complement ADR-014 internal ranks with confidence scores for external sources
(official docs, standards, advisories, articles, forums, LLM inference).

### Genius Router

Route by **task fit**, not “best LLM”: cheap classification vs strong
reasoning vs vision vs local confidential vs multi-agent+human for critical
production changes.

### Non-goals (this ADR foundation)

- Autonomously looping agents without Judge
- Unofficial scraping presented as partnership
- Replacing Design Partner / Verdict commercial wedge
- Shipping all 12 specialists with full LLM bodies on day one

## Consequences

- New contracts in `@atlas/shared`
- Registry + plan/dispatch/judge in `@atlas/agent-core`
- Fabric search stubs in `@atlas/knowledge`
- API under `/api/v1/agents/*`, `/api/v1/knowledge/*`, `/api/v1/judge/*`
- Specialists grow behind eval suites; Orchestrator selects by proven metrics

## Related

ADR-014 Evidence Governance · ADR-015 Governed Code · ADR-016 Proof & Autonomy
