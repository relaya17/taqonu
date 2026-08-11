# Gap analysis — Atlas Core / ArletOS vs Master Spec v1.0

Date: 2026-08-11  
Scope: what exists in this monorepo vs the pasted master technical specification (§0–107).

## Verdict

The repo is a **solid architectural scaffold + early MVP spine**, not a production Engineering Intelligence OS yet. Core theses (evidence, epistemic states, write-gate locked, shared Zod, monorepo) are encoded. Most pillars beyond state snapshots + agent context-echo are **contracts, stubs, or docs**.

---

## What is already aligned (keep)

| Spec theme | Status |
|---|---|
| Product identity (Atlas ≠ IDE/chatbot) | Encoded in docs + agent prompts |
| Five pillars (conceptual) | Architecture v1.0 + packages sketched |
| Shared Zod contracts | `packages/shared` — no duplicate API DTOs as primary path |
| Epistemic labels in UI | `EpistemicChip` + he/en/ar strings |
| Write gate locked by default | Agent WRITE blocked until approval/eval |
| RTL + he/en/ar locales | next-intl routing; RTL for he/ar |
| GitHub as primary code truth | Discover + sync routes; least-privilege intent |
| State reconciliation package | `@atlas/state` reconcile slices |
| Cost-first infra | No K8s/Kafka; free LLM path (Ollama/Groq/echo) |
| Provider-agnostic LLM interface | `createLlmProvider` / `completeWithFreeFallback` |
| Persistence store | `.atlas/store.json` + optional Supabase dual-write |
| Freemium cloud quota | ADR-011 — free 3 / pro 100 cloud projects; local unlimited |
| Artifacts + paid assists | ADR-013 — upload Evidence; credits; vision/assist providers |
| Conflicts center | `/conflicts` + resolve API |
| Editor context export | `/context-export` + ADR-008 |
| DB feeds as evidence (not primary store) | Supabase/Mongo feeds → DATABASE slice |

---

## Missing vs master spec (priority)

### P0 — needed for trustworthy “what is true now”

1. **Live GitHub App install + webhooks + incremental sync** — discover-by-paste is a bootstrap, not §27–28.
2. **AuthN/AuthZ + Supabase RLS enforced in production path** — schemas/migrations exist; session→API→RLS not end-to-end.
3. **Typed memory pipeline** (§12–14) — extract → classify → approve → persist; retrieval budget — mostly store lists today.
4. **Decisions as first-class UI + lifecycle** (§16–17) — schemas/ADR hooks; no full Decisions/ADR center.
5. **Conflict center UI** (§21, §60) — reconcile can emit conflicts; no dedicated Conflicts inbox/actions.
6. **Resume endpoint completeness** (§25) — partial/derived; needs last deploy/fail/tests/open tasks with provenance.
7. **Hybrid RAG + embeddings** (§36–37) — package stubs; pgvector not a working retrieval loop.
8. **Audit trail for every agent run** (§49) — in-memory runs array ≠ append-only audit.
9. **Evaluation harness gate** (§77–78) — contract/ADR only; no blocking eval suite.
10. **Secret redaction before LLM/embeddings/logs** (§46) — detector exists; not wired on every egress path.

### P1 — portfolio intelligence differentiation

11. Engineering **timeline** UI (§15)
12. **Engineering graph** queryable store + impact analysis (§22, §63)
13. Portfolio health diagnostics (evidence-backed, not vanity score) (§62)
14. Architecture drift across projects (§20)
15. Verified web research + source registry (§31–35) — deferred by design; OK for MVP, required for “external truth”
16. Playwright E2E + security test suite (§66–67)
17. Observability metrics listed in §50
18. Natural-language slash shortcuts (§86) as thin aliases over the same agent

### P2 — post-MVP (do not build now)

- Vercel/Render/Netlify/Google connectors (§29–30) — already correctly deferred
- Terminal sandbox / WRITE tools (§41–43)
- Team/SaaS multi-tenant full auth (§101 Phase 6) — freemium quota + stub owner exist (ADR-011); Stripe + real `auth.uid()` still later
- Autonomous audits/PR generation (§80)

---

## What is redundant / over-scoped (cut or freeze)

| Item | Recommendation |
|---|---|
| Scaffold packages for every future integration under `packages/integrations/*` | Keep **adapters as stubs/ADRs**; do not implement until a pillar needs evidence |
| Full nav of 15+ sections with empty pages | Collapse MVP nav to: Dashboard, Projects, Agent, Memory/Decisions, Conflicts, Settings/GitHub |
| Competing “chat product” UX | Keep agent as **READ/ANALYZE with evidence panel**, not a free-form chatbot home |
| Paid OpenAI as default | **Removed** — free path is default (`context-echo`, optional Ollama/Groq) |
| Mongo/Supabase as app primary DB | Correctly ADR’d as feeds only — do not regress |
| Benchmark/verified-knowledge full engine | Keep **contracts only** until research phase |

---

## What I would upgrade next (ordered)

1. **Free local LLM**: install [Ollama](https://ollama.com), `ollama pull llama3.2`, set `LLM_PROVIDER=ollama` + `OLLAMA_BASE_URL=http://127.0.0.1:11434`. Or free Groq key → `GROQ_API_KEY`. No paid OpenAI required.
2. **GitHub App read path**: install → select repos → webhook → idempotent jobs → reconcile.
3. **Memory + Decisions UX** with approval for permanent writes.
4. **Conflicts center** fed by reconcile + doc vs config mismatches.
5. **Wire secret detector** on agent outbound + store writes.
6. **Audit log persistence** + simple evaluation golden cases for “never invent FACT”.
7. **he/ar completeness** for remaining section shells (Memory, Decisions, Settings).

---

## Languages

- UI locales: **he / ar / en** with RTL for he+ar.
- Agent replies: language auto-detected from user text (Hebrew/Arabic/English); free echo provider answers in that language.
- Domain logic must stay locale-agnostic (already the rule).

---

## Free agent options (no paid OpenAI)

| Option | Cost | Setup |
|---|---|---|
| **context-echo** (default) | $0 | None — answers from retrieved Atlas context |
| **Ollama** local | $0 | Install Ollama + model; set `LLM_PROVIDER=ollama` |
| **Groq** free tier | $0 quota | `GROQ_API_KEY` + optional `LLM_PROVIDER=groq` |
| OpenAI | paid | Only if `LLM_PROVIDER=openai` + key |

Fallback chain: configured primary → Groq (if key) → context-echo.

---

## Definition of Done gap vs §100

Many §100 checkboxes are **partial**: monorepo builds, shared contracts, state reconcile, read agent, portfolio discover, write locked, epistemic UI. Still open for true MVP: Auth+RLS live, GitHub App sync, memory pipeline, conflicts UI, hybrid retrieval, audit, eval harness, E2E/security tests, production observability.
