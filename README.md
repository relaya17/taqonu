# Atlas Core · ArletOS

> **The Engineering Truth Layer for AI-Native Software Teams**  
> Know what your software actually does. Know what is verified. Know what is
> risky. And let AI fix it — safely.

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

## Where to sell (in the app)

Monetization is **Atlas usage freemium** — not Atlas-hosted storage:

| Surface | URL | What the user sees |
| --- | --- | --- |
| **Marketing landing** | `/he/welcome` · alias `/marketing` | Hero + Free/Pro (BYO Cloudflare story) |
| **Pricing / Plan** | `/he/plan` | Connect Cloudflare BYO · usage quotas · Stripe |
| **Billing settings** | `/he/settings/billing` | Tenant plan + upgrade |
| **Nav** | **מחירים / Pricing** + **דף נחיתה** | Primary nav |
| **Upgrade CTA** | Sidebar when tier is `free` | Persistent sell |
| **Projects** | Banner → Plan | Usage sell message |

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

### Product surfaces (keep current)

| Surface | URL / API |
| --- | --- |
| Marketing landing | `/he/welcome` |
| Release Verdict (app home) | `/he` · `GET /api/v1/projects/:id/verdict` |
| Pricing | `/he/plan` · `GET/POST /api/v1/billing/plan` |
| Workbench | `/he/workbench` |
| Studio | `/he/studio` |
| E2E process audit | `/he/process-audit` · `POST /api/v1/qa/process-audit` |
| Production Readiness | `/he/readiness` |
| Partners | `/he/partners` |
| System Health | `/he/health` |
| Admin (separate) | `/admin` · `/admin/login` |
| Investors deck | `/investors` |

### Three product pillars

1. **Understand** — structure, deps, APIs, architecture contracts  
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

Pricing in product today: **Free / Pro** cloud slots (+ multi-axis quotas). Broader Developer · Team · Company · Enterprise packaging can sit on top later — sell **time + risk + money**.

---

## What ships (engineering)

| Area | Capability |
| --- | --- |
| Verdict | Release status READY/CONDITIONAL/BLOCKED + Evidence |
| Readiness | Certificate with openable dimensions |
| Workbench | Files · code · Visual Studio path · Cloud consoles · Cursor · agent chat |
| Studio | Human view-only · agent proposes patches (Approve → Apply) |
| Process / E2E | Internal deep process audits · opinion-style UI |
| Freemium | Cloud slots + multi-axis quotas + Stripe |
| Verified knowledge | Allow-listed tech sources · admin pack download |
| Partners | External repo connect + usage analytics |

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
| App home | http://localhost:3000/he |
| Pricing | http://localhost:3000/he/plan |
| Workbench | http://localhost:3000/he/workbench |
| API | http://localhost:4000 |

```bash
pnpm proof:run
```

---

## Hard product rules

1. Epistemic labels always visible.  
2. “Exists in code” ≠ “proven in production”.  
3. WRITE is approval-gated (ADR-015).  
4. Secrets redacted before LLM egress.  
5. External AIs / editors are workers; Atlas is truth + gate.  
6. Atlas must audit itself (DEF-000).  
7. **README versions + sell surfaces stay current** when the product changes.

---

## Docs

- Startup validation · Design partners · Case study templates — `docs/strategy/`
- ADRs — `docs/adr/`
