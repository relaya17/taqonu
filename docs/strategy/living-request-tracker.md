# Atlas · Living Request Tracker

**Status:** Living — update this file as work lands  
**Last updated:** 2026-08-11  
**Owner:** product + engineering (ArletOS / Atlas Core)  
**Companion ADRs:** ADR-005 · ADR-009 · ADR-014–020 (Constitution Accepted)

> מטרת המסמך: רשימה אחת של **מה שביקשת** · **מה בוצע** · **מה נשאר**.  
> כל בקשה חדשה נכנסת ל־§Remaining / Change log. סטטוסים מתעדכנים תוך כדי ביצוע.

---

## How to update (agents + humans)

1. Add new asks under **§Remaining** (or a new numbered theme).  
2. When shipped: move/mark `DONE` / `PARTIAL` and add a one-line note + path.  
3. Append a row to **§Change log**.  
4. Do **not** delete historical asks — only change status.

Status legend: `DONE` · `PARTIAL` · `OPEN` · `DEFERRED` · `WONT`

---

## Locked product definition

| Concept | Definition |
| --- | --- |
| Atlas / Atlas Core | Evidence-driven engineering governance + adaptive QA layer for portfolios |
| ArletOS | Personal / first Atlas instance |
| Not | IDE clone · free-form coding chatbot · “Atlas for Elementor” |
| Moat | Engineering Evidence Graph + historical memory — not the LLM |
| Pillars | **Understand** · **Detect** · **Remediate** |
| Sell | Continuous AI Engineering Audit / Engineering Truth Layer |
| WRITE | Controlled, auditable, reversible, **approval-gated** (not permanently disabled) |
| Identity | **AI Engineering Guardian & Partner** — from idea → production → lifetime |

---

## A. What you asked for (themes)

| # | Theme | Ask (short) | Status |
| ---: | --- | --- | --- |
| 1 | Engineering OS | ArletOS = Engineering Intelligence OS (not “just an agent”); evidence categories never silently merged | `PARTIAL` |
| 2 | Positioning | Not compete with Cursor as IDE; Atlas sits under workers as truth/QA/governance | `DONE` |
| 3 | Current State | Project State center (code/git/arch/deps/db/env/deploy/…) | `PARTIAL` |
| 4 | Portfolio discovery | Access machines / all built apps; not only partial list | `PARTIAL` |
| 5 | DB observation | Mongo + Supabase as **feeds/evidence**, not primary app DB | `PARTIAL` |
| 6 | Conversation | Talk to Atlas (agent) with evidence discipline | `PARTIAL` |
| 7 | Gap vs world-class | Compare vs best-in-class; university/design/SEO/security sources | `OPEN` |
| 8 | Editor bridges | Claude / Cursor context export & integration (not replace them) | `PARTIAL` |
| 9 | Master Spec v1.0 | Align to pasted Architecture / Master Spec | `PARTIAL` |
| 10 | i18n | Hebrew + Arabic (+ English); RTL | `DONE` |
| 11 | Cost | Free / cheap LLM path; don’t burn money by default | `DONE` |
| 12 | Gap audit | What’s missing / redundant / upgrade | `DONE` *(docs)* |
| 13 | BYO import | Anyone: local disk · GitHub · any remote repo | `DONE` |
| 14 | Fonts / UI bugs | Fix broken fonts, Integrations page errors | `DONE` |
| 15 | QA Intelligence OS | Functional/API/UI/Security/DB/Integration/E2E/Perf/AI/Deploy/Architecture/Portfolio QA + LEARN loop | `PARTIAL` |
| 16 | Lab vs product | BrokerOS = lab/demo only; don’t confuse folder/product | `DONE` |
| 17 | Experts | UI/UX, design, Photoshop-class knowledge as expert lanes | `PARTIAL` |
| 18 | IDE-like workspace | VS-like terminal/editor **or** bridge to Cursor — debated | `DEFERRED` *(bridge yes; full IDE no)* |
| 19 | Freemium cloud | External DB; free slots; paid for more cloud projects | `PARTIAL` |
| 20 | Expert categories UI | Pick a specialist category → get results | `PARTIAL` |
| 21 | A11y + responsive | High bar accessibility + full responsive | `PARTIAL` |
| 22 | Auth / Admin | Separate admin; register; Google/GitHub | `PARTIAL` |
| 23 | Artifacts / paid assists | Upload images/docs; paid external AI assists | `PARTIAL` |
| 24 | Marketing surfaces | README + investor landing + site copy current | `PARTIAL` |
| 25 | Persistence | Don’t lose state on restart (store/DB) | `PARTIAL` |
| 26 | Model marketplace | Agents with price/strengths/weaknesses (not Cursor-clone branding) | `PARTIAL` → refined |
| 27 | Memory moat | Put agent memory in DB; accumulate portfolio intelligence | `PARTIAL` |
| 28 | Product rewrite | Truth layer for AI-native teams; Evidence Graph as moat | `DONE` |
| 29 | WRITE policy | Approval under governance (analyze→patch→test→approve→apply→verify) | `PARTIAL` |
| 30 | Atlas 1.1 Proof | End-to-end Engineering Loop + golden scenario | `PARTIAL` |
| 31 | Commercial wedge | Design Partners · Verdict · Case Study · BYO storage story | `PARTIAL` |
| 32 | Elementor | Research adapter only — not brand as Elementor product | `DONE` *(spec)* |
| 33 | Multi-agent fabric | One Orchestrator + specialists + Evidence Bus + Judge | `DONE` *(foundation)* |
| 34 | Agent OS / Kernel | Identities, perms, memory, evidence, tools, budget, eval, improve | `DONE` *(Phases 1–10 foundation)* |
| 35 | Engineering Intelligence Engine | Continuous System Audit; Issue contract; System Health; drift; remediation guardrails | `DONE` *(v1)* |
| 36 | **Engineering Constitution** | Overlay checklist (domains 1–23) + **Omission Detector** — build vs full-system checklist, not only user prompt | `DONE` *(v1)* |
| 37 | This tracker | Living doc of asks / done / remaining | `DONE` *(this file)* |

---

## B. Already executed (shipped / usable)

### Core spine
- Monorepo Atlas/ArletOS identity, Zod shared contracts, write-gate philosophy  
- Evidence / epistemic states in UI (`EpistemicChip`, he/en/ar)  
- State reconciliation package, GitHub discover/sync bootstrap  
- Agent READ/ANALYZE path; free LLM fallback (echo/Ollama/Groq)  
- `.atlas/store.json` + optional Supabase dual-write path  

### Product & commercial
- README pitch: Truth Layer · BYO · three pillars · Design Partner pause on feature sprawl  
- `docs/strategy/*` — validation, partners, case-study template, why-customers-pay, byo-storage  
- Release Verdict · Readiness Certificate · Evidence report APIs/UI  
- Partners import: local / GitHub / remote + storage policy  
- Case Study #001 BrokerOS (lab)  
- Elementor research spec (adapter only)  

### QA / experts / loop
- ADR-009 Engineering + QA Intelligence OS  
- `qa-core`, expert council foundations, gates, eval surfaces  
- Engineering Loop / Proof 1.1 scaffolding (ADR-016)  
- Code intelligence: analyze · impact · patch approve/apply/rollback paths  

### Multi-agent + Kernel
- ADR-017 Fabric · ADR-018 Kernel  
- Registry, plan, run, knowledge search/ingest, eval, memory lessons, improve APIs  
- Hard rule: **INSUFFICIENT_EVIDENCE** over thin-prompt approve  

### Continuous audit (Intelligence Engine)
- ADR-019 · schemas Issue/Health/Drift/Remediation  
- `POST /api/v1/audit-engine/run` · reports · default Architecture Contract  
- UI `/he/health` · nav + i18n  
- Remediation: LOW auto · MEDIUM PR · HIGH recommend · CRITICAL human  

### Platform UX (selected)
- Locales he/en/ar + RTL  
- Admin surfaces, auth stubs/routes, freemium quota (ADR-011)  
- Artifacts / paid assists contracts (ADR-013)  
- Conflicts / decisions / memory pages (varying depth)  

---

## C. Partial (exists but not production-complete)

| Item | Gap |
| --- | --- |
| Live GitHub App + webhooks + incremental sync | App env status + webhook→sync when project matches; full marketplace install UX later |
| AuthN/AuthZ + RLS end-to-end | **Local session enforced** on admin + WRITE approve/apply; RLS ready when Supabase live |
| Typed memory pipeline | **MVP:** classify + approve + retrieve budget wired |
| Decisions lifecycle UI | Not full ADR center |
| Hybrid RAG / embeddings | Stubs; not closed retrieval loop |
| Append-only audit for every agent run | In-memory / soft audit |
| Secret redaction on every egress | **DONE** — logger + LLM/assist/contact paths |
| QA engines LEARN loop | **MVP:** static executor + persisted learned pattern keys |
| Expert lanes (UI/UX/design) | Catalog partial vs “all styles on the web” |
| Model marketplace UX | Refined away from Cursor clone; polish TBD |
| Freemium billing | Quotas; Stripe/real tenant later |
| System Health detectors | Heuristic v1 — not full Constitution coverage |
| Portfolio-wide drift / health | Single-repo audit stronger than cross-portfolio |
| Persistence durability | Store + optional cloud; not HA SaaS yet |

---

## D. Remaining (prioritized work queue)

### P0 — Constitution overlay
**Status: DONE (v1)** — ADR-020 Accepted · checklist · runner · Omission Detector · `/he/health` · APIs.

Deepening detectors / per-customer applicability editors → P2.

### P1 — Trust / commercial
- Design Partner runs (human process; product pause on sprawl)  
- Harden Verdict Evidence report for partner demos — **DONE (locale HE/AR/EN)**  
- GitHub App production path — **PARTIAL** (status + webhook sync MVP)  
- Secret redaction on all LLM/log egress — **DONE**  

### P2 — Depth on existing engines
- Full QA LEARN loop + portfolio pattern memory — **PARTIAL** (static executor + key persistence)  
- Architecture Contract editor per customer — **DONE (MVP)** `/he/contract` + PUT `/audit-engine/contract`  
- Auto-remediation pipeline beyond policy labels — **PARTIAL→STRONGER** (AUTO_FIX drafts → approve → apply to `workspaceRoot`; note-file safe applies)  
- Observability metrics (ADR / master spec §50) — **PARTIAL** (`GET/POST /api/v1/metrics` + wired agent/knowledge/memory + `patch_apply_rate`)  
- E2E Playwright + security suites — **PARTIAL** (critical-path smoke + `.github/workflows/e2e-critical-path.yml`)  
- Hybrid RAG closed loop — **PARTIAL→STRONGER** (file-backed corpus `.atlas/knowledge/corpus.json` + ingest API + hybrid search)  
- Freemium Stripe — **PARTIAL→STRONGER** (live Checkout when `STRIPE_SECRET_KEY`; signed webhook; stub if unset)  
- Portfolio-wide health — **PARTIAL** (`POST /api/v1/portfolio/health` uses per-project `workspaceRoot`; UI on `/he/projects`)  
- Per-project workspace roots — **DONE (MVP)** `PUT /api/v1/projects/:id/workspace-root` + store persistence  
- Auth session + RLS — **PARTIAL→STRONGER** (WRITE guards; `GET /auth/session`; Supabase RLS migration ready)  
- Constitution deepen — **PARTIAL→STRONGER** (+8 detectors: pagination, correlation, rollback, critical-path tests, circuit breaker, tracing, shutdown, env validation)  

### P3 — Deferred by design
- Full in-product IDE / Visual Studio clone → **WONT** (bridge only)  
- Unofficial Elementor scrape → **WONT**  
- “100 chatting agents” → **WONT** (Kernel + specialists only)  
- Newest dependency always → **WONT** (Constitution §13)

---

## E. Atlas Engineering Constitution (DONE v1 — deepen later)

**Shipped:** checklist catalog · `runEngineeringConstitution` · Omission Detector ·
`OMISSION_DETECTOR` fabric agent · APIs · `/he/health` scorecard · wired into audit.

**Still deepen (P2):** richer detectors per checklist bullet, customer Architecture
Contract editor, auto-remediation for LOW Constitution fails.

### Domains (checklist inventory — implement incrementally)

```
User request
     +
Engineering Constitution (domains 1–23)
     +
Omission Detector (“what did nobody think of?”)
     ↓
Understand → Detect → Remediate
```

### Domains (checklist inventory — implement incrementally)

| Dom | Domain | Key checks (summary) |
| ---: | --- | --- |
| 1 | Architecture | Structure, SoC, boundaries, cycles, coupling, scale, naming, giant modules, duplication, debt |
| 2 | Security | AuthN/Z, RBAC/ABAC, sessions/JWT, CSRF/XSS/injection/SSRF, CORS/CSP/headers, rate limits, secrets, hashing, uploads, webhooks, tenant isolation, no sensitive leaks in logs/errors |
| 3 | Navigation | Header/nav/sidebar/breadcrumbs/footer/mobile/back/404/401/403/loading/empty — can users reach what they need? |
| 4 | Footer | Contact/About/Help/Privacy/Terms/A11y/Cookies/Legal/Social/Copyright — **only if product-relevant** |
| 5 | Accessibility | WCAG 2.2 AA, keyboard, focus, SR, semantics, contrast, touch, zoom, reduced motion, RTL/Hebrew, a11y tree |
| 6 | Responsive | Mobile→large desktop; overflow, grids, tables, dialogs, type, forms |
| 7 | UI Consistency | Type/spacing/color/buttons/inputs/tables/dialogs/icons/states — no one-off controls per page |
| 8 | UX | Onboarding, empty/loading/error/success, undo, search/filter/sort/page, destructive confirms |
| 9 | Performance | FE bundle/split/lazy; BE latency/N+1/pools; network payload/CDN/cache headers |
| 10 | Database | Schema, indexes, constraints, migrations, tx, backups/restore, retention, tenant isolation |
| 11 | API | Schema, validation, authz, errors, pagination, versioning, idempotency, OpenAPI, compat |
| 12 | Testing | Unit/Integration/API/E2E/Regression/A11y/Security/Perf + critical-path coverage |
| 13 | Dependencies | Version/support/security/compat/maintenance/license/breaking — **not “newest = best”** |
| 14 | Configuration | env/prod/staging, secrets, flags, CORS, logging — prevent config drift |
| 15 | Deployment | Build/migrate/health/secrets/rollback/monitoring; mid-deploy failure story |
| 16 | Observability | Logs/metrics/traces/health/alerts/request+correlation IDs/audit logs |
| 17 | Reliability | Retries/backoff/timeouts/circuit breakers/degradation/idempotency/queues/webhooks |
| 18 | External APIs | Still supported? docs/version/auth/limits/deprecation/failure modes |
| 19 | Documentation | README/arch/API/setup/deploy/migrations/ADRs/troubleshooting — high signal only |
| 20 | Code Hygiene | any/TODO/FIXME/console/dead code/dupes/giants/magic/hardcoded secrets — don’t fake-clean TODOs |
| 21 | i18n | he/en/ar + RTL/LTR truly wired — not only a language dropdown |
| 22 | Legal / Privacy | Privacy/Terms/cookies/consent/retention/deletion/export/access/audit — by product & jurisdiction |
| 23 | AI Safety | Prompt injection, tool authz, isolation, output validation, evidence, fallback, cost limits, human approval for high risk |
| 24 | **Omission Detector** | Specialist: find critical gaps **nobody requested** (e.g. payments without webhook signature verify) |

### Omission Detector contract (target)

```
Input:  user intent + Constitution applicability profile + repo evidence
Output: omitted[] { item, whyCritical, domain, evidenceGap, suggestedCheck }
Rule:   never confuse “not requested” with “not required”
```

### Implementation notes (when building)
- Reuse **Engineering Issue** schema (ADR-019): category/severity/evidence/rootCause/fix/policy  
- Scores must cite Evidence — no “AI said 91”  
- Applicability matrix by product type (marketing site ≠ payments SaaS ≠ internal admin)  
- Constitution feeds System Health dimensions; Critical omissions can BLOCK Verdict  

---

## F. Explicit non-goals (keep reminding)

- Replacing Cursor / Claude Code / Codex as the daily editor  
- Branding around competitor agent names as the product  
- Unofficial scraping / fake partnerships  
- Autonomous production mutation without approval  
- Vanity health % without Evidence  

---

## Change log

| Date | Change |
| --- | --- |
| 2026-08-12 | **Multi-agent build:** Stripe live Checkout+webhook; remediation approve/apply; auth WRITE guards+session+RLS migration; Constitution +8 detectors; durable hybrid RAG corpus+ingest |
| 2026-08-12 | **Continue post-P2:** per-project `workspaceRoot` store+API; portfolio health uses linked roots; metrics wired into agents/knowledge/memory; Playwright CI workflow; portfolio health UI on `/projects` |
| 2026-08-11 | **P2 slice shipped:** Constitution deepen (sec/a11y/cfg/ai); Architecture Contract editor; metrics API; portfolio health rollup; AUTO_FIX draft patches; hybrid RAG (local embeddings); Stripe checkout stub; Playwright critical-path skeleton |
| 2026-08-11 | **Admin Necessity rule:** Constitution detectors `sec.admin_*` + `admin-necessity.ts` — Atlas detects whether/which admin is needed; never auto-scaffolds Admin; server AuthZ required if Admin exists (`docs/strategy/admin-necessity.md`) |
| 2026-08-11 | **Two-agent P1/P2 slice:** log+LLM secret redaction; Verdict/Evidence locale (he/ar/en); QueryClient+turbopack perf; auth WRITE/admin guards; GitHub App status+webhook sync; memory classify/approve/retrieve; QA static executor + LEARN keys |
| 2026-08-11 | **Stabilize:** typecheck API/web green; false Frontend→DB on supabase auth fixed; single API on :4000 under `pnpm dev`; health workspaceRoot fix |
| 2026-08-11 | **Constitution v1 shipped** — ADR-020 Accepted; checklist+runner+omissions; APIs; health UI; theme #36 → DONE |
| 2026-08-11 | Created living tracker from full conversation asks; marked Engine/Kernel/Fabric/BYO/Verdict as done/partial; added Constitution §E as OPEN P0 |
| 2026-08-11 | Continuous System Audit v1 shipped earlier same day (ADR-019, `/he/health`) |

---

## Quick links

| Doc | Path |
| --- | --- |
| This tracker | `docs/strategy/living-request-tracker.md` |
| Admin necessity | `docs/strategy/admin-necessity.md` |
| Why customers pay | `docs/strategy/why-customers-pay.md` |
| Design partners | `docs/strategy/design-partner-playbook.md` |
| BYO storage | `docs/strategy/byo-storage.md` |
| Gap vs master spec | `docs/architecture/gap-vs-master-spec.md` |
| Intelligence Engine | `docs/adr/ADR-019-engineering-intelligence-engine.md` |
| Kernel | `docs/adr/ADR-018-intelligence-kernel-v1.md` |
| QA OS | `docs/adr/ADR-009-engineering-qa-os.md` |
