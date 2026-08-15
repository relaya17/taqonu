# Atlas Core · ArletOS

> **The Truth & Control Layer for AI-Native Software**  
> Atlas knows what every connected system is supposed to do, what it actually
> does, what has been proven, what has changed, what is risky, and what may
> safely happen next.

**Isolation:** customer code stays in your workspace / BYO storage — Atlas does not
train across tenants. Living roadmap: [`docs/strategy/ATLAS-TRUTH-10.md`](docs/strategy/ATLAS-TRUTH-10.md).

| Layer | Name | Version |
| --- | --- | --- |
| Monorepo | **atlas** | **0.1.0** |
| Product | **Atlas** / **Atlas Core** | — |
| This instance | **ArletOS** | — |
| Web (`@atlas/web`) | Next.js 15 · React 19 | **0.1.0** |
| API (`@atlas/api`) | Node ≥22 | **0.1.0** |
| Package manager | pnpm | **10.28.2** |

Keep this table in sync when you bump `package.json` versions.

---

## Current product state (keep honest)

Atlas is a **Truth & Control Layer**, not an AI coding assistant. Scores below
are operator ratings — not marketing.

| Surface | Score | What is true today |
| --- | --- | --- |
| Managed System / truth bind | **8.5/10** | Facets counted + sourced notes; contract persisted; invariants verified; ACT gated |
| ACT / observe security | **8.5/10** | Ownership on ACT/observe; no prod / BLOCKED auto-apply; memory retrieve is project-scoped; `assertNoSecrets` |
| Systems command center | **8/10** | Blocked-first `/systems` → `/systems/:id` → Truth / Health / Gates / Patches |
| GTM offer | **6.5/10** | Landing + Plan sell a one-week **Readiness Audit**; design-partner tracker is empty on purpose |
| **As a truth & control plane** | **~8/10** | 10 needs one live production system + a real partner readout |

Do **not** invent customers, “10/10 everywhere,” or Stripe/Sentry as live.

## Where to sell (in the app)

The offer is a **Readiness Audit**. Usage meters exist so the product stays
honest — they are not the product. Storage is BYO, not Atlas-hosted.

| Surface | URL | What the user sees |
| --- | --- | --- |
| **Marketing landing** | `/he/welcome` · alias `/marketing` | Audit hero · request intake · BYO story |
| **Systems command center** | `/he/systems` · `/he/systems/:id` | Blocked-first Managed Systems |
| **Audit intake** | `/he/partners` | Import one repo → Verdict + Evidence |
| **Plan** | `/he/plan` | Audit first · then Free/Pro ceilings · Cloudflare BYO |
| **Billing settings** | `/he/settings/billing` | Tenant plan + upgrade |
| **Nav** | **Systems** first · **Audit & plan** · Landing | Primary nav |
| **Upgrade CTA** | Sidebar when tier is `free` | After-audit usage, not the pitch |

### Plan model (storage policy v2)

| Tier | Customer data | Atlas evidence mirror | Atlas usage |
| --- | --- | --- | --- |
| **Free** | Cloudflare free (theirs) / local / git | **0** slots | Limited audits / eval / agent |
| **Pro** | Same BYO | up to **100** optional | Higher ceilings |

Defined in `packages/shared/src/constants/plans.ts` + `docs/strategy/byo-storage.md`.  
Platform version: `PLATFORM_VERSION` in `packages/shared/src/constants/platform.ts` (keep in sync with package.json **0.1.0**).

---

## The problem

Teams now use GitHub, AI coding agents, CI/CD, cloud, observability, security
scanners, and multiple LLMs — but none reliably answer:

**What is actually true about this software right now?**

## The solution

Atlas is **not** an AI coding assistant. It is five layers over connected
systems — observed from the outside through connectors:

```
Truth · Evidence · Governance · Intelligence · Automation Control
```

```
                         ATLAS CORE
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
   Truth Engine          Governance             Intelligence
       │                      │                      │
   Evidence Graph       Policies              Agents
   System Model         Approvals             Reasoning
   Memory               Risk Gates            Research
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              │
                       SYSTEM CONNECTORS
                              │
                 Vantera · HotelOS · CaseFlow · BrokerOS · you
```

Each connected product is a **Managed System** (Atlas itself is one — DEF-000).
Atlas does not replace those products and does not embed in their code.

```
DISCOVER → UNDERSTAND → VERIFY → ACT (gated)
```

Workers stay where they are:

```
Cursor · Claude Code · VS Code · Copilot
                 ↓
               ATLAS
                 ↓
     Truth / QA / Governance
```

Normative: [`docs/architecture/managed-system.md`](docs/architecture/managed-system.md).

### Import any repo (BYO)

BrokerOS and other lab names are **demos only**. Customers import from:

- local disk  
- GitHub (`owner/repo` after PAT connect)  
- any remote git URL (metadata link)

Atlas stores the **Evidence Graph** (optional Atlas evidence mirror on Pro;
customer data prefers **BYO Cloudflare** free tier). Full
source stays with the customer / their git host — they pay that vendor, not Atlas,
for code hosting. See [`docs/strategy/byo-storage.md`](docs/strategy/byo-storage.md).

## The outcome

Instead of *“We think we’re ready.”*

Atlas gives: **what is verified, what isn’t, what’s dangerous — and the Evidence.**

### Product surfaces (keep current)

| Surface | URL / API |
| --- | --- |
| Marketing landing | `/he/welcome` |
| Systems command center | `/he/systems` · `/he/systems/:id` · `GET /api/v1/systems` · `GET\|PUT /api/v1/systems/:id/contract` |
| Truth | `/he/truth?project=` · Observer findings |
| System Health | `/he/health?project=` |
| Release Verdict (app home) | `/he?project=` · `GET /api/v1/projects/:id/verdict` |
| Audit intake | `/he/partners` |
| Plan | `/he/plan` · `GET/POST /api/v1/billing/plan` |
| Production Readiness / Gates | `/he/readiness?project=` |
| Workbench | `/he/workbench` |
| Studio | `/he/studio` |
| E2E process audit | `/he/process-audit` · `POST /api/v1/qa/process-audit` |
| Admin (separate) | `/admin` · `/admin/login` · Command Center (watchdog / knowledge / automation) |
| Investors deck | `/investors` |

### Three product pillars

1. **Understand** — Managed System model: structure, deps, APIs, contracts  
2. **Detect** — Continuous System Audit: bugs, security, drift, debt (Evidence-backed scores)  
3. **Remediate** — fix → tests → verify, under severity guardrails (LOW auto · MEDIUM PR · HIGH recommend · CRITICAL human)

Sell **Continuous AI Engineering Audit**, not “another bug scanner.” Normative: [ADR-019](docs/adr/ADR-019-engineering-intelligence-engine.md).

**Living backlog**:  
[`docs/strategy/living-request-tracker.md`](docs/strategy/living-request-tracker.md) · [ADR-020](docs/adr/ADR-020-engineering-constitution.md) · [Admin necessity](docs/strategy/admin-necessity.md).

### Moat

Not the LLM. **Engineering Evidence Graph + historical engineering memory.**

---

## Commercial validation

1. ICP: AI-native SaaS teams (5–40 engineers)  
2. Offer: **Engineering Readiness Audit** (one production repo)  
3. Measure: unknown risks found · blockers · time saved  
4. Case study → first payment → retention  

Playbooks live under `docs/strategy/`.

Pricing in product today: lead with the **Audit**; Free / Pro are usage ceilings
after that + optional evidence mirror (Pro) + **BYO Cloudflare** for customer
data. Broader Developer · Team · Company · Enterprise packaging can sit on top
later — sell **time + risk + money**, not seats.

---

## What ships (engineering)

| Area | Capability |
| --- | --- |
| Systems | Managed System list + detail · real facets · persisted contract · invariant PASS/FAIL |
| Verdict | Release status READY/CONDITIONAL/BLOCKED + Evidence |
| Truth / Health | `?project=` drill-down from a blocked system |
| Readiness | Certificate with openable dimensions |
| ACT | Approve → Apply is ownership-gated; LOW auto-apply never hits production |
| Workbench | Files · code · Visual Studio path · Cloud consoles · Cursor · agent chat |
| Studio | Human view-only · agent proposes patches (Approve → Apply) |
| Process / E2E | Internal deep process audits · opinion-style UI |
| Freemium | Audit offer · usage ceilings · BYO Cloudflare · optional Pro evidence mirror |
| Verified knowledge | Allow-listed tech sources · admin pack download |
| Partners | Audit intake · external repo connect — no invented customers |

Normative: [ADR-014](docs/adr/ADR-014-evidence-governance-north-star.md) ·
[ADR-015](docs/adr/ADR-015-governed-native-code-engineering.md) ·
[ADR-016](docs/adr/ADR-016-atlas-1.1-proof-autonomy.md).

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
| Landing (HE) | http://localhost:3000/he/welcome |
| Systems | http://localhost:3000/he/systems |
| App home | http://localhost:3000/he |
| Audit intake | http://localhost:3000/he/partners |
| Plan | http://localhost:3000/he/plan |
| API | http://localhost:4000 |

```bash
pnpm proof:run
```

---

## Hard product rules

1. Epistemic labels always visible.  
2. “Exists in code” ≠ “proven in production”.  
3. WRITE is approval-gated (ADR-015).  
4. Secrets redacted + `assertNoSecrets` before LLM egress.  
5. External AIs / editors are workers; Atlas is truth + gate.  
6. Atlas must audit itself (DEF-000) — Atlas is a Managed System.  
7. Connectors observe from outside; do not wire Atlas “into every app.”  
8. ACT is last: verified evidence + policy + human approval. Auto-apply never hits production.  
9. **README, landing, Plan, and this score table stay current** when the product changes.

---

## Docs

- Startup validation · Design partners · Case study templates — `docs/strategy/`
- ADRs — `docs/adr/`
