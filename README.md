# Atlas Core · ArletOS

> **The Engineering Truth Layer for AI-Native Software Teams**  
> Know what your software actually does. Know what is verified. Know what is
> risky. And let AI fix it — safely.

| Layer | Name |
| --- | --- |
| Product | **Atlas** / **Atlas Core** |
| This instance | **ArletOS** |

---

## The problem

Teams now use GitHub, AI coding agents, CI/CD, cloud, observability, security
scanners, and multiple LLMs — but none reliably answer:

**What is actually true about this software right now?**

## The solution

Atlas builds a continuously reconciled **Evidence Graph**:

```
code → tests → infrastructure → deployments → decisions → risks → readiness
```

Workers stay where they are:

```
Cursor · Claude Code · VS Code · Copilot
                 ↓
               ATLAS
                 ↓
     Truth / QA / Governance
```

Atlas does **not** replace the developer or the IDE. It understands, evaluates,
modifies, tests, and verifies software under **explicit governance and human
approval**.

### Import any repo (BYO)

BrokerOS and other lab names are **demos only**. Customers import from:

- local disk  
- GitHub (`owner/repo` after PAT connect)  
- any remote git URL (metadata link)

Atlas stores the **Evidence Graph** (freemium cloud slots for metadata). Full
source stays with the customer / their git host — they pay that vendor, not Atlas,
for code hosting. See [`docs/strategy/byo-storage.md`](docs/strategy/byo-storage.md).

## The outcome

Instead of *“We think we’re ready.”*

Atlas gives: **what is verified, what isn’t, what’s dangerous — and the Evidence.**

### Killer workflow — *Is this release actually safe?*

```
DISCOVER → RECONCILE → CLAIMS → EVIDENCE → RISK → QA → SECURITY
  → EXPERT COUNCIL → QUALITY GATES → RELEASE VERDICT
```

Product surfaces:

| Surface | URL / API |
| --- | --- |
| Release Verdict (home) | `/he` · `GET /api/v1/projects/:id/verdict` |
| Production Readiness Certificate | `/he/readiness` |
| Evidence report | `GET /api/v1/projects/:id/report` |
| Partners | `/he/partners` · `POST /api/v1/onboarding/import` · `GET …/storage-policy` |
| System Health (Continuous Audit) | `/he/health` · `POST /api/v1/audit-engine/run` |
| Engineering Constitution | `GET/POST /api/v1/constitution/*` · Omission Detector agent |
| BrokerOS Case #001 (lab) | `GET /api/v1/case-studies/brokeros-001` |

### Three product pillars

1. **Understand** — structure, deps, APIs, architecture contracts  
2. **Detect** — Continuous System Audit: bugs, security, drift, debt (Evidence-backed scores)  
3. **Remediate** — fix → tests → verify, under severity guardrails (LOW auto · MEDIUM PR · HIGH recommend · CRITICAL human)

Sell **Continuous AI Engineering Audit**, not “another bug scanner.” Normative: [ADR-019](docs/adr/ADR-019-engineering-intelligence-engine.md).

**Living backlog** (what was asked · done · remaining · Constitution):  
[`docs/strategy/living-request-tracker.md`](docs/strategy/living-request-tracker.md) · [ADR-020](docs/adr/ADR-020-engineering-constitution.md) (Accepted — Constitution + Omission Detector v1) · [Admin necessity](docs/strategy/admin-necessity.md).

### Moat

Not the LLM. **Engineering Evidence Graph + historical engineering memory.**

---

## Commercial validation (now)

**Stop expanding core features.** Run Design Partners.

1. ICP: AI-native SaaS teams (5–40 engineers)  
2. Offer: **Engineering Readiness Audit** (one production repo)  
3. Measure: unknown risks found · blockers · time saved  
4. Case study → first payment → retention  

Playbooks: [`docs/strategy/startup-validation.md`](docs/strategy/startup-validation.md) ·
[`design-partner-playbook.md`](docs/strategy/design-partner-playbook.md) ·
[`case-study-template.md`](docs/strategy/case-study-template.md) ·
[`why-customers-pay.md`](docs/strategy/why-customers-pay.md) ·
[`byo-storage.md`](docs/strategy/byo-storage.md)

Pricing direction (market test): Developer · Team · Company · Enterprise —
sell **time + risk + money**, not AI credits.

---

## What ships (engineering)

| Area | Capability |
| --- | --- |
| Verdict | Release status READY/CONDITIONAL/BLOCKED + Evidence |
| Readiness | Certificate with openable dimensions |
| Proof 1.1 | Engineering Loop · BrokerOS golden · atlas-evals A–F |
| Code intel | Analyze · impact · patch approve/apply/rollback |
| Evidence | Claims · conflicts · authority · events |
| QA / Experts | Risk · council · eval · gates |
| Freemium | Cloud slots + multi-axis quotas |
| Partners | External repo connect + usage analytics |

Normative: [ADR-014](docs/adr/ADR-014-evidence-governance-north-star.md) ·
[ADR-015](docs/adr/ADR-015-governed-native-code-engineering.md) ·
[ADR-016](docs/adr/ADR-016-atlas-1.1-proof-autonomy.md) ·
[Evidence Model](docs/architecture/evidence-model.md).

---

## ATLAS Intelligence Kernel v1 (Phases 1–10)

Agent Operating System — ADR-018. **All phases shipped as foundation.**

| Phase | API |
| --- | --- |
| Status | `GET /api/v1/kernel/status` |
| Registry | `GET /api/v1/kernel/agents` |
| Orchestrator | `POST /api/v1/kernel/plan` |
| Full run | `POST /api/v1/kernel/run` |
| Knowledge search/ingest | `POST /api/v1/kernel/knowledge/search` · `…/ingest` |
| Evaluation | `POST /api/v1/kernel/eval/run` |
| Memory lessons | `GET/POST /api/v1/kernel/memory/lessons` |
| Self-improvement | `POST /api/v1/kernel/improve` |

Hard rule: **INSUFFICIENT_EVIDENCE** over confident hallucination.

---

## Atlas 1.2 — Multi-Agent Intelligence Fabric (foundation)

**One Brain + Many Specialists + One Judge** — ADR-017.

| API | Purpose |
| --- | --- |
| `GET /api/v1/agents` | Registry of 12 fabric roles |
| `POST /api/v1/agents/plan` | Orchestrator plan (Genius Router) |
| `POST /api/v1/agents/dispatch` | Parallel specialist stubs + Judge |
| `POST /api/v1/judge/evaluate` | Belief decision |
| `POST /api/v1/knowledge/search` | Need-based Evidence packages |
| `GET /api/v1/knowledge/lessons` | Cross-project patterns (no leakage) |

Specialists are **contracts** today (tools, budgets, evidence policy). Full LLM
bodies + eval suites land behind metrics — not agent-to-agent chat.

---

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm --filter @atlas/shared --filter @atlas/config --filter @atlas/agent-core --filter @atlas/code-intelligence --filter @atlas/integrations-github --filter @atlas/integrations-vercel --filter @atlas/database --filter @atlas/engineering-loop build
pnpm dev
```

| Surface | URL |
| --- | --- |
| App (Hebrew) | http://localhost:3000/he |
| Readiness | http://localhost:3000/he/readiness |
| Partners | http://localhost:3000/he/partners |
| API | http://localhost:4000 |

```bash
# Golden Project
# ATLAS_GOLDEN_PROJECT_ROOT=C:\Users\User\Desktop\game\brokerOS-main
```

---

## Key APIs (commercial)

```
GET  /api/v1/projects/:id/verdict
GET  /api/v1/projects/:id/report
GET  /api/v1/case-studies/brokeros-001
POST /api/v1/onboarding/import
GET  /api/v1/onboarding/storage-policy
POST /api/v1/onboarding/connect-repo
GET  /api/v1/analytics/usage
POST /api/v1/readiness/certificate
POST /api/v1/engineering/loop
POST /api/v1/benchmarks/run
```

Full product map + APIs: see prior sections in git history / `docs/`.

---

## Hard product rules

1. Epistemic labels always visible.  
2. “Exists in code” ≠ “proven in production”.  
3. WRITE is approval-gated (ADR-015).  
4. Secrets redacted before LLM egress.  
5. External AIs / editors are workers; Atlas is truth + gate.  
6. Atlas must audit itself (DEF-000).

---

## Docs

- Startup validation · Design partners · Case study templates — `docs/strategy/`
- Elementor adapter research — `docs/integrations/elementor-atlas-spec.md`
- ADRs `docs/adr/ADR-001` … `ADR-016`
