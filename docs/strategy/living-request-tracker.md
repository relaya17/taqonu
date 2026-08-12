# Atlas · Living Request Tracker

**Status:** Living — update this file as work lands  
**Last updated:** 2026-08-12  
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
| 1 | Engineering OS | ArletOS = Engineering Intelligence OS (not “just an agent”); evidence categories never silently merged | `DONE` *(MVP)* |
| 2 | Positioning | Not compete with Cursor as IDE; Atlas sits under workers as truth/QA/governance | `DONE` |
| 3 | Current State | Project State center (code/git/arch/deps/db/env/deploy/…) | `DONE` *(MVP)* |
| 4 | Portfolio discovery | Access machines / all built apps; not only partial list | `DONE` *(MVP)* |
| 5 | DB observation | Mongo + Supabase as **feeds/evidence**, not primary app DB | `DONE` *(MVP)* |
| 6 | Conversation | Talk to Atlas (agent) with evidence discipline | `DONE` *(MVP)* |
| 7 | Gap vs world-class | Compare vs best-in-class; university/design/SEO/security sources | `DONE` *(docs)* |
| 8 | Editor bridges | Claude / Cursor context export & integration (not replace them) | `DONE` *(MVP)* |
| 9 | Master Spec v1.0 | Align to pasted Architecture / Master Spec | `PARTIAL` → **STRONGER** |
| 10 | i18n | Hebrew + Arabic (+ English); RTL | `DONE` |
| 11 | Cost | Free / cheap LLM path; don’t burn money by default | `DONE` |
| 12 | Gap audit | What’s missing / redundant / upgrade | `DONE` *(docs)* |
| 13 | BYO import | Anyone: local disk · GitHub · any remote repo | `DONE` |
| 14 | Fonts / UI bugs | Fix broken fonts, Integrations page errors | `DONE` |
| 15 | QA Intelligence OS | Functional/API/UI/Security/DB/Integration/E2E/Perf/AI/Deploy/Architecture/Portfolio QA + LEARN loop | `DONE` *(LEARN MVP)* |
| 16 | Lab vs product | BrokerOS = lab/demo only; don’t confuse folder/product | `DONE` |
| 17 | Experts | UI/UX, design, Photoshop-class knowledge as expert lanes | `DONE` *(MVP lanes + LEGAL_MEDIA)* |
| 18 | IDE-like workspace | VS-like terminal/editor **or** bridge to Cursor — debated | `DEFERRED` *(bridge yes; full IDE no)* |
| 19 | Freemium cloud | External DB; free slots; paid for more cloud projects | `DONE` *(tenant Stripe MVP)* |
| 20 | Expert categories UI | Pick a specialist category → get results | `DONE` *(MVP)* |
| 21 | A11y + responsive | High bar accessibility + full responsive | `DONE` *(MVP pass)* |
| 22 | Auth / Admin | Separate admin; register; Google/GitHub | `DONE` *(SaaS Auth-first)* |
| 23 | Artifacts / paid assists | Upload images/docs; paid external AI assists | `DONE` *(MVP)* |
| 24 | Marketing surfaces | README + investor landing + site copy current | `DONE` *(MVP deepen)* |
| 25 | Persistence | Don’t lose state on restart (store/DB) | `PARTIAL` → **STRONGER** (atomic store + dual-write + hydrate MVP) |
| 26 | Model marketplace | Agents with price/strengths/weaknesses (not Cursor-clone branding) | `DONE` *(MVP polish)* |
| 27 | Memory moat | Put agent memory in DB; accumulate portfolio intelligence | `PARTIAL` → **STRONGER** |
| 28 | Product rewrite | Truth layer for AI-native teams; Evidence Graph as moat | `DONE` |
| 29 | WRITE policy | Approval under governance (analyze→patch→test→approve→apply→verify) | `DONE` *(MVP)* |
| 30 | Atlas 1.1 Proof | End-to-end Engineering Loop + golden scenario | `DONE` *(MVP)* |
| 31 | Commercial wedge | Design Partners · Verdict · Case Study · BYO storage story | `DONE` *(playbooks+runbook READY; human runs)* |
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
- **Evidence categories never silently merged (theme #1 DONE MVP)** — typed `category` on evidence (= Current State slices); rollups expose `evidenceByCategory`; Verdict inventory + `/state` UI keep CODE/GIT/SECURITY/… distinct  
- State reconciliation package, GitHub discover/sync bootstrap  
- **Current State center (MVP)** — `GET/POST .../projects/:id/state` evidence rollup; UI `/state` + `/projects/[id]/state`  
- Agent READ/ANALYZE path; free LLM fallback (echo/Ollama/Groq)  
- `.atlas/store.json` + optional Supabase dual-write path  

### Product & commercial
- README pitch: Truth Layer · BYO · three pillars · Design Partner pause on feature sprawl  
- `docs/strategy/*` — validation, partners playbook (EN+HE outreach), **1-week audit runbook**, execution checklist, tracker stub A–E, case-study template + `_partner-fill-in`, why-customers-pay, byo-storage  
- Release Verdict · Readiness Certificate · Evidence report APIs/UI  
- Partners import: local / GitHub / remote + storage policy + Design Partner mode notes on `/partners`  
- Case Study #001 BrokerOS (lab)  
- Elementor research spec (adapter only)  

### QA / experts / loop
- ADR-009 Engineering + QA Intelligence OS  
- `qa-core`, expert council foundations, gates, eval surfaces  
- Engineering Loop / Proof 1.1 golden (`pnpm proof:run` · `POST /api/v1/proof/run` · gates A–F · fixture fallback)  
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
- **A11y + responsive MVP (theme #21 DONE)** — skip-link→focus main, landmarks, mobile drawer keyboard, focus-visible, ≥44px targets, reduced-motion, overflow-safe shell + primary pages; `e2e/a11y.spec.ts`  
- Admin surfaces, auth stubs/routes, freemium quota (ADR-011)  
- Artifacts / paid assists contracts (ADR-013)  
- Conflicts / decisions / memory pages (varying depth)  

---

## C. Partial (exists but not production-complete)

| Item | Gap |
| --- | --- |
| Live GitHub App + webhooks + incremental sync | **DONE** — App JWT + install token exchange, signed install-state redirect/callback, installation persistence, integrations UI all shipped and verified 2026-08-12 (`packages/integrations/github`, `apps/api/src/routes/github.ts`, `apps/web/.../integrations/page.tsx`) |
| AuthN/AuthZ + RLS end-to-end | **DONE (SaaS path, 2026-08-12)** — when Supabase is live, identity + roles come from Auth JWT (`app_metadata.atlas_role` + mirrored `profiles.role`); local `atlas_session` is offline/stub fallback only (`resolve-identity.ts`). OAuth id reconcile + per-user RLS cloud writes remain. See `packages/database/AUTH_RLS.md`. Residual: rare cloud-down orphan rekey. |
| Observability metrics | **DONE (durable MVP)** — ring + Prometheus + `.atlas/metrics/metrics.ndjson` |
| Portfolio-wide drift / health | **DONE (deepen MVP)** — verdictSpread · constitutionPassRate · missingWorkspaceRoot |
| System Health detectors | Constitution domains 1–23 + scanner/metrics/deploy-feed detectors; richer per-bullet still polish |
| Typed memory pipeline | **PARTIAL→STRONGER** — classify + approve + retrieve + Supabase dual-write + **`/memory/moat`** |
| Append-only audit for every agent run | Durable NDJSON under `.atlas/audit/audit.ndjson` (+ metrics NDJSON) |
| Decisions lifecycle UI | **DONE (MVP ADR center, 2026-08-12)** — list/filter + propose + detail; status transitions PROPOSED→ACTIVE/REJECTED/SUPERSEDED via `POST /api/v1/decisions/:id/transition`; project + evidence refs + optional ADR path; he/en/ar; nav `/decisions` |
| Hybrid RAG / embeddings | **DONE (MVP closed loop, verified 2026-08-12)** — file corpus always; pgvector dual-write+hybrid when live Supabase; local embed fallback; INSUFFICIENT_EVIDENCE on empty; corpus GET on `/knowledge` + `/kernel` |
| Secret redaction on every egress | **DONE** — logger + LLM/assist/contact paths |
| QA engines LEARN loop | **DONE (MVP)** — extract→persist→retrieve portfolio patterns; feed into QA/agent memoryContext; explicit LEARN API |
| Expert lanes (UI/UX/design) | **DONE (MVP, 2026-08-12)** — enriched Expert Council (+CONTENT/MOTION, style lanes, fabricAgentIds, evidence/budget); `/experts` shows policy + style lanes + link to plan/dispatch; fabric `/agents` browse by category → role/tools/budget/evidence → plan/dispatch |
| Model marketplace UX | **DONE (MVP polish, 2026-08-12)** — `/models` marketplace framing (not Cursor clone); he/en/ar strengths/weaknesses/cost; Arabic overlay; link to specialist lanes |
| Freemium billing | **DONE (tenant MVP)** — Stripe Checkout + webhook keyed by owner_id; tenantSubscriptions in osStore; stub when unset |
| Persistence durability | **PARTIAL→STRONGER (2026-08-12)** — atomic `.atlas/store.json` write + `.bak` recovery + optional heartbeat backups; dual-write projects/memories/knowledge/decisions/`account_plans`; startup hydrate when local empty + cloud live. Not multi-region HA SaaS. |

---

## D. Remaining (prioritized work queue)

### P0 — Constitution overlay
**Status: DONE (v1 + 23-domain detector MVP)** — ADR-020 Accepted · checklist · runner · Omission Detector · `/he/health` · APIs · detectors for all domains 1–23.

Richer per-bullet detectors / per-customer applicability editors → remaining P2 polish.

### P1 — Trust / commercial
- Design Partner runs — **READY (playbooks + runbook complete, 2026-08-12)** — awaiting human execution. Pack: `design-partner-playbook.md` (outreach EN+HE) · `design-partner-audit-runbook.md` (1-week · Verdict/Readiness/Health/import URLs+APIs) · `design-partner-execution-checklist.md` · `design-partner-tracker.md` (empty A–E) · `case-studies/_partner-fill-in.md` · light Design Partner mode notes on `/partners`. Product cannot send email or run champion calls.  
- Harden Verdict Evidence report for partner demos — **DONE (locale HE/AR/EN)**  
- GitHub App production path — **DONE** (App JWT signing + installation token exchange w/ cache: `packages/integrations/github/src/app-auth.ts`; signed install-state + redirect + callback persisting installation: `install-state.ts`, `apps/api/src/routes/github.ts` `GET /install`, `GET /install/callback`; installations store: `os-store.ts`; "Connect GitHub App" button + installations list in `apps/web/app/[locale]/integrations/page.tsx`; 29/29 tests green, typecheck clean). Remaining: full marketplace listing polish (icons/screenshots) is a GitHub-side asset task, not code.  
- Secret redaction on all LLM/log egress — **DONE**  

### P2 — Depth on existing engines
- Full QA LEARN loop + portfolio pattern memory — **DONE (MVP)** extract durable patterns after QA → persist portfolio-scope → budgeted retrieve into next QA run + memoryContext; GET `/qa/patterns` filters; vitest cross-project loop  
- Architecture Contract editor per customer — **DONE (MVP)** `/he/contract` + PUT `/audit-engine/contract`  
- Auto-remediation pipeline beyond policy labels — **DONE (MVP)** (closed loop: Constitution/audit LOW→AUTO_FIX draft → optional gated auto-apply via `ATLAS_AUTO_APPLY_LOW` or `autoApplyLow` + WRITE session → apply under workspaceRoot → smoke verify + evidence; HIGH/CRITICAL human-gated; note-file safe applies under `.atlas/remediation/`)  
- Observability metrics (ADR / master spec §50) — **DONE (durable MVP)** (JSON + Prometheus `/metrics`; ring buffer; **append-only `.atlas/metrics/metrics.ndjson`**; `/ops/metrics` UI)  
- E2E Playwright + security suites — **PARTIAL→STRONGER** (`e2e/critical-path` + `product-surfaces` + `security` + expanded `a11y` memory/investors; vitest auth-guards + webhook signature; CI runs critical then product+security; **blocking `eval/ci-gate`** in `.github/workflows/ci.yml`)  
- Hybrid RAG closed loop — **DONE (MVP, verified 2026-08-12)** file corpus + ingest/search; pgvector dual-write + hybrid retrieve when live `SUPABASE_*`/`DATABASE_URL` (`knowledge_chunks` + `match_knowledge_chunks`); local-hash embeddings fallback; INSUFFICIENT_EVIDENCE on empty; `GET /api/v1/knowledge/corpus` parity with kernel  
- Freemium Stripe — **DONE (tenant MVP)** (live Checkout when `STRIPE_SECRET_KEY`; signed webhook upgrades tenant plan/slots; `customer.subscription.updated/deleted`; stub if unset; `/plan` + `/settings/billing`)  
- Portfolio-wide health — **DONE (deepen MVP, 2026-08-12)** (`POST`/`GET /api/v1/portfolio/health`: per-project System Health + Constitution + Verdict hint; aggregate worst-of / open criticals / shared patterns / weakest dimensions / **verdictSpread · constitutionPassRate · missingWorkspaceRoot**; last snapshot in `osStore` meta; rollup UI on `/he/projects`)  
- Per-project workspace roots — **DONE (MVP)** `PUT /api/v1/projects/:id/workspace-root` + store persistence  
- Portfolio discovery — **DONE (MVP, 2026-08-12)** unified `GET/POST /api/v1/portfolio/discovery` (+ `/refresh`, `/link`): local reposRoot scan auto-links `workspaceRoot`; GitHub PAT + App installation repos → register projects; surfaces unlinked / unregistered candidates; UI on `/projects` + `/integrations` (he/en/ar). Never scrapes outside configured roots / App permissions.  
- Auth session + RLS — **DONE (SaaS Auth-first, 2026-08-12)**: live Supabase JWT preferred for identity + roles (`app_metadata.atlas_role` / `profiles.role`); local session offline/dev fallback; register/login/OAuth sync role into Auth; WRITE/admin guards Auth-first; OAuth id-mismatch reconcile + RLS user-scoped cloud writes. Residual: rare cloud-down orphan rows — see `AUTH_RLS.md`.  
- Constitution deepen — **DONE (MVP+)** (23-domain detector coverage + **sec_scanner_sarif · obs_metrics_export · deploy_provider_feed**; omission = domain 24)  
- GitHub App production path — **DONE** (moved from P2 depth item to shipped; see §P1 row above — JWT/install/callback/UI all landed, verified 2026-08-12)  
- Memory → agent context — **PARTIAL→STRONGER** (`memoryContext` on plan/dispatch; QA LEARN portfolio patterns → INFERRED lessons; **`GET /api/v1/memory/moat`** rollup; richer retrieve ranking)  
- Scanner SARIF → SECURITY evidence — **DONE** `POST /api/v1/security/sarif`  
- Deploy feeds Vercel/Render — **DONE (MVP)** `POST /api/v1/providers/vercel|render/observe` → DEPLOYMENT evidence  
- Demo seed — **DONE** `pnpm demo:seed`  
- Investors product visual — **DONE (MVP)** Evidence Graph SVG on `/investors` (he/en/ar)
### P3 — Deferred by design
- Full in-product IDE / Visual Studio clone → **WONT** (bridge only)  
- Unofficial Elementor scrape → **WONT**  
- “100 chatting agents” → **WONT** (Kernel + specialists only)  
- Newest dependency always → **WONT** (Constitution §13)

---

## E. Atlas Engineering Constitution (DONE v1 — 23-domain detector MVP)

**Shipped:** checklist catalog · `runEngineeringConstitution` · Omission Detector ·
`OMISSION_DETECTOR` fabric agent · APIs · `/he/health` scorecard · wired into audit ·
**23-domain heuristic detectors** (domains 1–23 + omission = 24).

**Still deepen (P2):** richer per-bullet detectors beyond MVP heuristics, customer
Architecture Contract editor polish. Auto-remediation for LOW Constitution fails → **DONE (MVP)** (closed loop with gated auto-apply + verify).

### Domains (checklist inventory — 23-domain detector MVP shipped)

```
User request
     +
Engineering Constitution (domains 1–23)
     +
Omission Detector (“what did nobody think of?”)
     ↓
Understand → Detect → Remediate
```

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
| 2026-08-12 | **10-item high-bar engineering batch DONE:** SARIF→SECURITY (`POST /api/v1/security/sarif`); blocking CI eval gate (`GET/POST /api/v1/eval/ci-gate` + `.github/workflows/ci.yml`); durable metrics NDJSON (`.atlas/metrics/metrics.ndjson`); Constitution +3 detectors (scanner/metrics/deploy-feed); portfolio health deepen (verdictSpread/passRate/missingWorkspaceRoot); memory moat (`GET /api/v1/memory/moat`); a11y expand (memory+investors); Vercel+Render deploy observe→DEPLOYMENT; investors Evidence Graph visual; `pnpm demo:seed` |
| 2026-08-12 | **10/10 polish pass:** EN/AR System Health i18n complete (domain/severity/policy/profile/category); agents.category.legal he/en/ar; investors landing + AR; research API cites allow-listed gov/university only (INSUFFICIENT_EVIDENCE on miss); append-only audit + partner audit-spine + nav trim already wired |
| 2026-08-12 | **Marketing landing deepen (theme #24 DONE):** `/investors` rebuilt — brand-first hero, problem/solution/moat/Design Partner sections, contact; alias `/marketing`; README link |
| 2026-08-12 | **Legal Media & Communications specialist:** expert `LEGAL_MEDIA` + fabric `LEGAL_MEDIA_COMMS`; verified gov/university source allow-list; `POST /api/v1/legal-media/review` → READY_FOR_COUNSEL / NEEDS_FIXES / INSUFFICIENT_EVIDENCE; UI `/legal-media` with hard NOT LEGAL ADVICE disclaimer; docs `legal-media-comms.md` |
| 2026-08-12 | **Theme #5 DB observation DONE (MVP):** customer Mongo/Supabase feeds as DATABASE evidence (not Atlas primary DB); `/integrations` UI record feeds (metadata only, no secrets); `POST /feeds/supabase|mongodb` uses cloud identity; Current State DATABASE via `@atlas/state` reconcile; feed unit tests |
| 2026-08-12 | **Themes #23/#27/#29:** artifacts page MVP → DONE; memory overview pipeline doc → STRONGER; `write-policy.md` closes WRITE governance theme → DONE (MVP) |
| 2026-08-12 | **Themes #7/#8/#9:** gap-vs-world-class.md (DONE docs); editor bridge UI “Copy for Cursor/Claude” on Current State + ADR-008; gap-vs-master-spec refreshed → Master Spec PARTIAL→STRONGER |
| 2026-08-12 | **Theme #1 Engineering OS evidence categories DONE (MVP):** typed `EVIDENCE_CATEGORIES` (= Current State slices) on evidence records; `parseEvidenceRecord` / infer; `groupEvidenceByCategory` + `assertCategoriesPreserved` guards; Current State rollup + `GET /evidence` + Verdict inventory keep CODE/GIT/SECURITY/… distinct; UI category chips on `/state`; `evidence-model.md` never-merge rule; tests in shared + current-state-rollup |
| 2026-08-12 | **Conversation with Atlas DONE (MVP):** `POST /api/v1/conversation/message` + hardened `POST /api/v1/agent/runs` — empty evidence → `INSUFFICIENT_EVIDENCE` (no hallucination); answer + `evidenceRefs` + epistemic label; `/[locale]/chat` thread UI; agent surface cites memory/evidence; he/en/ar + nav; free echo path |
| 2026-08-12 | **Portfolio discovery DONE (MVP):** unified discovery status/refresh/link APIs; local scan auto-links `workspaceRoot`; GitHub App installation repos via installation token; unlinked + unregistered surfaces on `/projects` + refresh on `/integrations`; theme #4 → DONE MVP |
| 2026-08-12 | **Persistence durability PARTIAL→STRONGER (Theme #25):** atomic osStore flush (`store-io.ts` temp→rename + `.bak`); optional `ATLAS_STORE_BACKUP_INTERVAL_MS` heartbeats; dual-write **decisions** + **account_plans**/tenantSubscriptions when Supabase live; startup cloud hydrate when local empty (`cloud-hydrate` + `store-hydrate`); AUTH_RLS durability section; residual = multi-region HA SaaS |
| 2026-08-12 | **Current State center DONE (MVP):** enriched `GET`/`POST /api/v1/projects/:id/state` with full-slice pad + evidence rollup (`current-state-rollup.ts`); UI `/[locale]/state` + `/[locale]/projects/[id]/state` with EpistemicChip + evidence links; nav + projects deep-link; he/en/ar; env/deploy stay UNKNOWN; CI under TESTS; theme #3 → DONE (MVP) |
| 2026-08-12 | **Auth full as source of truth (SaaS path) DONE:** when Supabase is live, prefer Auth JWT for identity + roles (`app_metadata.atlas_role` + `profiles.role`); local `atlas_session` offline/stub fallback only; `resolve-identity.ts` + role sync on register/login/oauth; tracker #22 → DONE; tests in `resolve-identity.test.ts` |
| 2026-08-12 | **Atlas 1.1 Proof golden DONE (MVP):** `runAtlasProof` + gates A–F checklist; `POST /api/v1/proof/run` · `GET /api/v1/proof/status`; `pnpm proof:run`; golden root env→BrokerOS→`fixtures/golden-brokeros`; `/proof` UI status; vitest; theme #30 → DONE |
| 2026-08-12 | **A11y + responsive MVP DONE:** AppShell/AdminShell skip-link focus, landmarks, mobile drawer focus restore, lang aria-labels; theme overflow-x + reduced-motion + chip focus; keyboard-expandable health findings; labeled agent request; form submit on login/register/decisions; responsive grids on projects; `e2e/a11y.spec.ts` smoke (skip/main/menu/overflow/login); tracker #21 → DONE (MVP pass) |
| 2026-08-12 | **Expert lanes + model marketplace MVP:** enriched `FABRIC_AGENT_CATALOG` (strengths/weaknesses/cost/he·en·ar) + `EXPERT_CATALOG` (+CONTENT/MOTION, style lanes, fabricAgentIds); `/agents` plan/dispatch UI; `/experts` evidence policy + style lanes; `/models` marketplace polish + Arabic overlay; forced `agentIds` on plan/dispatch; tracker #17/#20/#26 → DONE MVP |
| 2026-08-12 | **Auto-remediation closed loop DONE (MVP):** Constitution + audit LOW AUTO_FIX → draft (`.atlas/remediation/*.md`) → optional auto-approve/apply when `ATLAS_AUTO_APPLY_LOW` or `autoApplyLow` + WRITE session → smoke verify + evidence/`VERIFIED`; HIGH/CRITICAL stay human-gated; APIs `POST /remediation/drafts/:id/verify`, `POST /remediation/auto-apply-low`; patches UI verify chip; vitest in code-intelligence + api pipeline |
| 2026-08-12 | **Portfolio-wide health PARTIAL→STRONGER:** enriched `POST /api/v1/portfolio/health` with per-project scores + aggregate (worst-of, constitution, open blockers, shared issue/drift patterns, weakest dimensions, portfolio verdict hint); `GET` returns last snapshot from `osStore` meta; projects UI rollup (he/en/ar); vitest rollup coverage |
| 2026-08-12 | **Auth/RLS OAuth id-mismatch reconcile DONE:** local users who later link GitHub/Google adopt the Supabase OAuth `sub` (`upsertOAuthUser`); `identity-reconcile.ts` rekeys `tenantSubscriptions` + best-effort cloud `owner_id` migration + stale Auth user cleanup; login-time drift repair via JWT `sub`; tests in `identity-reconcile.test.ts`; `AUTH_RLS.md` updated with residual edge cases |
| 2026-08-12 | **Decisions lifecycle UI DONE (MVP):** `GET/POST /api/v1/decisions` + `GET /:id` + `POST /:id/transition` (PROPOSED→ACTIVE/REJECTED/SUPERSEDED); osStore `list/get/updateDecision`; `/[locale]/decisions` list/detail/create with evidence chips + project link; he/en/ar; transition schema tests |
| 2026-08-12 | **Design Partner pack READY (playbook-complete):** outreach EN+HE; 1-week audit runbook mapped to Verdict/Readiness/Health/import APIs+UI; success metrics checklist; partner tracker stub (empty A–E); case-study fill-in linked to BrokerOS lab template; `/partners` Design Partner mode notes; theme #31 → DONE (human execution remaining) |
| 2026-08-12 | **Memory approve UI + DB persistence DONE:** durable Supabase dual-write (`packages/database/src/repositories/memories.ts` + `memory-persist.ts`, migration `20260812010000_memories_created_by.sql`) reusing the per-user RLS identity from the auth increment above; real Approve UI on `/memory` — pending queue (`GET /api/v1/memory/pending`), Approve button, cloud-synced badge, he/en/ar strings; 1 new repository test, typecheck clean |
| 2026-08-12 | **QA LEARN full portfolio memory DONE (MVP):** extract durable patterns after QA → persist at portfolio scope (cross-project accumulate) → budgeted retrieve into next QA run + `memoryContext`; GET `/api/v1/qa/patterns?projectId&portfolioOnly`; UI pattern count; vitest extract→persist→retrieve across two projects |
| 2026-08-12 | **Verified/hardened Hybrid RAG closed loop:** re-audit confirmed dual-write + `match_knowledge_chunks` wiring; added `GET /api/v1/knowledge/corpus` parity with kernel; hybrid score merge aligns with SQL 0.7/0.3 + keyword floor; `hybrid-rag.test.ts` covers offline/local + live empty/pgvector paths |
| 2026-08-12 | **Freemium Stripe tenant MVP DONE:** checkout/webhook keyed by `owner_id`; `tenantSubscriptions` in osStore; GET plan/usage tenant-scoped; slot quota uses tenant tier; `/plan` + `/settings/billing` upgrade CTA (he/en/ar); stub when `STRIPE_*` unset |
| 2026-08-12 | **Hybrid RAG closed loop MVP:** pgvector `knowledge_chunks` + `match_knowledge_chunks`; dual-write on ingest; hybrid search prefers pgvector when live else local-hash + `.atlas/knowledge/corpus.json`; wired `/api/v1/knowledge/*` + `/api/v1/kernel/knowledge/*`; INSUFFICIENT_EVIDENCE on empty |
| 2026-08-12 | **Constitution deepen → DONE (MVP):** full 23-domain detector coverage — +12 heuristics for thin domains (nav/footer/responsive/UI/UX/perf/DB/ext/deps/hyg/i18n/legal); checklist+`CONSTITUTION_DETECTOR_KEYS` coverage tests; omission remains domain 24 |
| 2026-08-12 | **E2E + security suites:** `e2e/product-surfaces.spec.ts` (home/verdict, readiness, health, partners, projects, ops/metrics) + `e2e/security.spec.ts` (WRITE auth, admin authz, webhook rejection, eval redaction smoke); vitest `auth-guards.test.ts` + GitHub webhook missing-header cases; CI runs critical then product+security with dummy `GITHUB_WEBHOOK_SECRET` |
| 2026-08-12 | **Auth/RLS real multi-tenant increment:** register/login mirror into Supabase Auth (same id) + mint real access tokens; OAuth forwards the browser's own Supabase session; new `cloud-identity.ts`/`supabase-session.ts` resolve per-request owner id + token; project/evidence cloud writes route through a user-scoped RLS-constrained client instead of service-role bypass when available; 14 new tests, typecheck clean |
| 2026-08-12 | **Verified:** GitHub App production path re-audited against code — App JWT signing, installation token exchange+cache, signed install-state redirect/callback, installation persistence, and integrations UI were already fully implemented (not just "PARTIAL"); moved P1 row to **DONE**, 29/29 tests green + clean typecheck confirmed live |
| 2026-08-12 | **P2 slice 2:** QA LEARN explicit+persist; GitHub App status/webhook deepen; Prometheus+ops metrics UI; memoryContext on agents + QA pattern seeds |
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
| Design partner 1-week audit | `docs/strategy/design-partner-audit-runbook.md` |
| Design partner execution checklist | `docs/strategy/design-partner-execution-checklist.md` |
| Design partner tracker (A–E) | `docs/strategy/design-partner-tracker.md` |
| Partner case-study fill-in | `docs/case-studies/_partner-fill-in.md` |
| BYO storage | `docs/strategy/byo-storage.md` |
| Gap vs master spec | `docs/architecture/gap-vs-master-spec.md` |
| Intelligence Engine | `docs/adr/ADR-019-engineering-intelligence-engine.md` |
| Kernel | `docs/adr/ADR-018-intelligence-kernel-v1.md` |
| QA OS | `docs/adr/ADR-009-engineering-qa-os.md` |
