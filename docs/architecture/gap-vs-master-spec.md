# Gap analysis — Atlas Core / ArletOS vs Master Spec v1.0

Date: 2026-08-12 (refresh) · original 2026-08-11  
Scope: what exists in this monorepo vs the pasted master technical specification (§0–107).

## Verdict

**MVP spine is shippable for Design Partners.** Evidence OS, Constitution, Kernel/Fabric, Verdict/Readiness, BYO, Auth-first SaaS path, RAG, Stripe tenant, Proof 1.1 golden, and portfolio discovery are in place. Remaining gaps are deepen/polish and commercial validation — not empty scaffold.

See also: [`docs/strategy/gap-vs-world-class.md`](../strategy/gap-vs-world-class.md) · [`living-request-tracker.md`](../strategy/living-request-tracker.md).

---

## What is already aligned (keep)

| Spec theme | Status |
|---|---|
| Product identity (Atlas ≠ IDE/chatbot) | Encoded in docs + agent prompts |
| Shared Zod contracts | `packages/shared` |
| Epistemic labels in UI | `EpistemicChip` + he/en/ar |
| Write gate locked by default | Approval/eval before apply |
| RTL + he/en/ar | next-intl |
| GitHub as code truth | App JWT + webhooks + PAT/BYO |
| State reconciliation | `@atlas/state` + Current State UI |
| Free LLM path | Ollama/Groq/echo |
| Persistence | Atomic store + dual-write + hydrate |
| Freemium + Stripe | Tenant MVP |
| Artifacts + paid assists | `/artifacts` + credits |
| Conflicts center | `/conflicts` |
| Editor context export | `/context-export` + UI copy for Cursor/Claude |
| DB feeds (not primary store) | Mongo/Supabase → DATABASE |
| Constitution + Omission | ADR-020 · 23 domains |
| Hybrid RAG | Corpus + pgvector when live |
| Proof 1.1 | `pnpm proof:run` · `/proof` |

---

## Still open vs master spec (honest)

### Deepen (not blocking Design Partner)

1. Append-only audit for every agent run (soft audit today)
2. Always-on eval harness as CI gate beyond Proof golden
3. Runtime/deploy connectors as evidence feeds
4. Multi-region HA SaaS (dual-write MVP only)
5. Richer Constitution per-bullet detectors

### Correctly deferred / WONT

- Full in-product IDE · Unofficial Elementor scrape · 100 chatting agents · Newest dependency always

---

## Next (ordered)

1. **Run Design Partners** (human) — playbooks READY  
2. Scanner/runtime evidence adapters  
3. Eval gate in customer CI  
4. Marketing/investor landing polish  

Theme **#9 Master Spec** alignment: **PARTIAL→STRONGER** — core spine shipped; residual = deepen list above.
