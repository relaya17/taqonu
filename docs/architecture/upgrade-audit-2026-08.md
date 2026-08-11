# Project audit — ArletOS / Atlas Core

Date: 2026-08-11  
Scope: honest capability review + upgrade recommendations (incl. multimodal feeds + paid AI assists).

## Verdict

ArletOS is a **strong scaffold + early product spine**, not yet a trustworthy production Engineering Intelligence OS.

| Layer | Maturity |
| --- | --- |
| Product identity / ADRs / Zod contracts | Strong |
| Local OS store + discover/reconcile + agent READ | Early MVP |
| Experts / QA planner / freemium / auth+admin / a11y shell | Early MVP |
| Graph, RAG, audit, eval gate, research, deploy feeds | Scaffold / stub |
| Multimodal (images/docs) → paid AI marketplace | **Missing** |

---

## What is solid (keep)

1. Clear non-goals: not IDE, not ChatGPT clone, WRITE locked.
2. Epistemic discipline in UI + agent prompts.
3. Monorepo + shared Zod as single contract source.
4. Expert Council (UI/UX, Design, QA…) with review API.
5. Freemium cloud quota (ADR-011) + external Postgres intent.
6. Auth + separate `/admin` (ADR-012) — local email; OAuth when Supabase live.
7. Free LLM path (echo → Ollama/Groq).

---

## Where it is weak

### Trust / “what is true now”
- GitHub path is discover/token, not full App + webhooks + incremental sync.
- State reconcile exists; **Conflicts center** missing as a product surface.
- Resume / evidence often INFERRED without hard provenance UX.
- Secret detector not enforced on every LLM/egress path.

### Intelligence depth
- Default LLM is **context-echo** (template over context) — weak “smart” feel without Ollama/Groq.
- No hybrid RAG / embeddings loop (`@atlas/embeddings` stub).
- Engineering **graph** returns empty nodes.
- Verified web research is scaffold text only.
- QA plans risks; executor / Playwright / real scanners not wired.

### Persistence & tenancy
- Runtime truth is still **`.atlas/store.json`**; cloud dual-write optional.
- Auth session is local cookie; **API→RLS with real `auth.uid()`** not end-to-end.
- Stripe billing not connected (plan tier is env/store).

### Ops / quality
- Audit API returns empty stub.
- Eval harness always fails (correctly blocks WRITE) but has no real golden cases.
- Thin automated test coverage vs surface area.
- Many integration packages are empty scaffolds (freeze, don’t expand).

### Product UX
- Dashboard still conceptual cards; weak “continue where we left off” loop.
- No Conflicts inbox, Timeline, or evidence viewer with attachments.
- No upload of screenshots/PDFs into the evidence graph.

---

## Missing high-value capabilities (prioritized)

### P0 — make the OS trustworthy
1. Conflicts center (list + resolve + memory of resolution)
2. Wire secret redaction on agent/LLM egress
3. Persist audit log for agent/QA/expert runs
4. Minimal eval golden suite (never invent FACT)
5. GitHub App webhook sync (or harden PAT sync + jobs)
6. Auth session → owner_id on all mutating routes (drop stub owner)

### P1 — differentiation
7. Hybrid retrieval (pgvector + keyword) over memories/decisions/evidence
8. Engineering graph populate from GitHub + decisions
9. Portfolio health from evidence (not vanity)
10. QA executor hooks (CI status, basic HTTP checks)
11. Stripe for Pro plan + usage meters

### P2 — paid AI assists + multimodal (user request)
12. **Artifact Feed** — upload images/docs → Evidence records
13. **AI Assist Marketplace** — call paid external models for help; bill usage
14. Keep free path for core OS; paid only for “assist boosts”

---

## Proposal: Artifact Feed + Paid AI Assists

**Do not** turn ArletOS into a general chatbot. Keep assists as **evidence-producing tools** under expert/QA lenses.

```
Upload (image | PDF | markdown | zip-spec)
    → virus/size/mime gate + secret scan
    → EvidenceRecord (epistemic: FACT for bytes hash; INFERRED for AI captions)
    → optional Paid Assist job
         primary expert (UI_UX | VISUAL_DESIGN | QA | …)
         provider (OpenAI vision / Claude / Gemini / …)  [PAID]
         result → findings + citations to artifact ids
         usage → billing ledger (tokens + $)
```

| Piece | Free | Paid |
| --- | --- | --- |
| Local store, experts checklist review, echo/Ollama | Yes | — |
| Cloud project slots | Free ≤3 | Pro |
| Upload artifacts (quota) | Small (e.g. 20 MB / mo) | Higher |
| Vision / doc AI assist | No (or 1 trial) | Per-run or credits |
| Premium model routing | No | Yes |

API sketch (future ADR-013):

- `POST /api/v1/artifacts` — multipart upload → evidence
- `POST /api/v1/assists/runs` — `{ artifactIds, expertId, provider, userRequest }`
- `GET /api/v1/billing/usage` — tokens, $ estimate, remaining credits
- Admin: provider keys, margins, disable providers

Hard rules:
- WRITE still gated; assists propose only.
- AI output = INFERRED/PROPOSED never silent FACT.
- User pays for external model calls; Atlas takes margin later.

---

## What I would build next (ordered, practical)

1. Conflicts UI + wire secret detector  
2. Artifact upload → Evidence (images/PDFs) — even before paid AI  
3. Paid assist adapter (one vision provider) + usage meter + credits  
4. Stripe: Pro plan + credit packs  
5. Real eval golden cases + audit persistence  
6. GitHub App / stronger sync  
7. Embeddings retrieval loop  

---

## Explicitly do **not** add now

- Visual Studio / embedded IDE / terminal sandbox  
- Photoshop/Figma editors inside the app  
- Fifteen more empty nav sections  
- Autonomous PR generation without eval gate  

---

## Scorecard (honest)

| Area | Score /10 |
| --- | --- |
| Architecture clarity | 8 |
| Contract discipline | 8 |
| Trustworthy current-state loop | 4 |
| Agent usefulness (default free) | 3–5* |
| QA intelligence | 4 |
| Experts as product surface | 6 |
| Auth / admin | 5 |
| Cloud freemium | 5 |
| Multimodal + paid AI | 0 |
| Production readiness | 3 |

\*5 if Ollama/Groq configured; ~3 on echo alone.
