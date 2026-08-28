# Atlas Core · ArletOS

> **The Truth & Control Layer for AI-Native Software**  
> Know if your software is actually ready — before your users, auditors, or
> production incidents tell you otherwise.  
> Atlas knows what every connected system is supposed to do, what it actually
> does, what has been proven, what has changed, what is risky, and what may
> safely happen next.

**Isolation:** customer code stays in your workspace / BYO storage — Atlas does not
train across tenants. Living roadmap: [`docs/strategy/ATLAS-TRUTH-10.md`](docs/strategy/ATLAS-TRUTH-10.md).  
One-page startup lock: [`docs/strategy/ATLAS-STARTUP-BLUEPRINT.md`](docs/strategy/ATLAS-STARTUP-BLUEPRINT.md).

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
| Managed System / truth bind | **9/10** | DEF-000 binds this repo; facets from evidence + saved graph nodes; contract + invariants |
| ACT / observe security | **9/10** | Ownership on ACT; no prod/BLOCKED auto-apply; memory + evidence scoped to one project |
| Systems command center | **9/10** | Blocked-first + **Run Audit → Executive Report** with drill-down to Evidence |
| GTM offer | **7/10** | Audit wedge + executive readout + counsel briefing pack; tracker still empty; no paid partner |
| Verified knowledge | **7/10** | Daily allow-listed refresh (NIST/CISA/OWASP/MDN/gov.il + EUR-Lex AI Act/DSA + justice.gov/CPPA + React/Next) → corpus + `knowledge_chunks`; still excerpts, not full curricula |
| **As a truth & control plane** | **~8.5/10** | 10 needs one live customer system + a real partner readout |

Do **not** invent customers, “10/10 everywhere,” or Stripe/Sentry as live.

## Where to sell (in the app)

The offer is a **Readiness Audit**. Usage meters exist so the product stays
honest — they are not the product. Storage is BYO, not Atlas-hosted.

| Surface | URL | What the user sees |
| --- | --- | --- |
| **Marketing landing** | `/he/welcome` · alias `/marketing` | Audit hero · request intake · BYO story |
| **Systems command center** | `/he/systems` · `/he/systems/:id` | Blocked-first · **Run Audit → Executive Report** |
| **Audit intake** | `/he/partners` | Import one repo → Verdict + Evidence |
| **Counsel briefing** | `/he/legal-media` | Evidence pack for a licensed high-tech lawyer — not legal advice |
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
| Counsel briefing | `/he/legal-media` |
| Plan | `/he/plan` · `GET/POST /api/v1/billing/plan` |
| Production Readiness / Gates | `/he/readiness?project=` |
| Workbench | `/he/workbench` |
| Studio | `/he/studio` |
| E2E process audit | `/he/process-audit` · `POST /api/v1/qa/process-audit` |
| Observer / Sentinel | `/he/observer` · `/he/sentinel` |
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
| Verified knowledge | Daily allow-listed refresh → corpus + DB · pack download |
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

`pnpm dev` starts **five** processes. Do not merge them onto one port.

### Local surfaces (ADR-021)

| Plane | Surface | URL |
| --- | --- | --- |
| USER | **Atlas** product UI | http://localhost:3000 |
| USER | Landing (HE / EN / AR) | http://localhost:3000/he/welcome · `/en/welcome` · `/ar/welcome` |
| USER | Login / Register | http://localhost:3000/he/auth/login · `/he/auth/register` |
| USER | Systems | http://localhost:3000/he/systems |
| USER | App home | http://localhost:3000/he |
| USER | Plan / Audit intake | http://localhost:3000/he/plan · `/he/partners` |
| USER | Tenant API | http://localhost:4000 · health `GET /api/v1/health` |
| CONTROL | **Atlas Sentinel** landing | http://127.0.0.1:3100 |
| CONTROL | Sentinel dashboard | http://127.0.0.1:3100/dashboard |
| CONTROL | Sentinel liveness | http://127.0.0.1:3100/api/v1/status |
| CONTROL | **Owner Admin** | http://127.0.0.1:3200 |
| WEB admin (user plane) | Command login | http://localhost:3000/admin/login |

Dev credentials (local only): `dev@atlas.local` / `AtlasDev1!` — see `apps/web/lib/dev-credentials.ts`.

### Vercel (USER plane only)

Two Vercel projects. Do **not** put Sentinel (`:3100`) or Owner Admin (`:3200`) on Vercel.

| Project root | Config | Role |
| --- | --- | --- |
| `apps/web` | [`apps/web/vercel.json`](apps/web/vercel.json) | Next.js USER UI |
| `apps/api` | [`apps/api/vercel.json`](apps/api/vercel.json) | Tenant API + daily knowledge cron |

Set `WEB_ORIGIN` and `NEXT_PUBLIC_API_URL` to the deployed origins. Control plane stays a separate Node process (ADR-021).

```bash
pnpm proof:run
```

### Full local verification (copy-paste)

Run from the repo root after `pnpm install`. On Windows use `curl.exe` instead of `curl` if needed.

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@atlas/api...
pnpm exec turbo run build --filter=@atlas/web --filter=@atlas/admin --filter=@atlas/control-plane --filter=@atlas/worker
pnpm typecheck
pnpm exec eslint packages apps --max-warnings 0
pnpm test
pnpm test:unit
pnpm --filter @atlas/api exec tsx src/scripts/ci-eval-gate.ts
pnpm --filter @atlas/api exec tsx src/scripts/ci-secrets-scan.ts
pnpm sbom:generate
pnpm format:check
pnpm proof:run
```

With `pnpm dev` running in another terminal:

```bash
curl.exe -sf http://localhost:4000/api/v1/health
curl.exe -sf http://localhost:3000/he
curl.exe -sf http://127.0.0.1:3100/api/v1/status
curl.exe -sf http://127.0.0.1:3200/
```

E2E talks to a live stack at `http://127.0.0.1:3000` (web) and `:4000` (API). Chromium must already be installed (`pnpm exec playwright install chromium` — no `--with-deps` on Windows).

Either keep `pnpm dev` running in another terminal, **or** let Playwright start API + web for you (first compile can take 1–3 minutes):

```bash
pnpm test:e2e:critical
pnpm test:e2e:product
pnpm test:e2e:security
pnpm test:e2e:a11y
pnpm test:e2e:new
pnpm exec playwright test e2e/failure-paths.spec.ts
```

`security` / `failure-paths` skip if `http://127.0.0.1:4000/api/v1/health` is down. `ERR_CONNECTION_REFUSED` on `:3000` means the web app is not running.

CI mirrors this: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and [`.github/workflows/e2e-critical-path.yml`](.github/workflows/e2e-critical-path.yml).

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
