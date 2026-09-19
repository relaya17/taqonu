# Atlas pilot offer (no production VM)

**Status:** local / design-partner only.  
**Not:** production SaaS, AWS private plane, SLA, pentest, or “we host your Control Plane.”

The production VM is unavailable (AWS suspended). Do not wait for it to sell a **paid readiness audit** on a laptop demo. Do not claim the demo is production.

Canonical GTM: [`ATLAS-STARTUP-BLUEPRINT.md`](./ATLAS-STARTUP-BLUEPRINT.md) — wedge = Readiness Audit, not seats.

## Sell this

- One managed system: Connect → Discover → Verify → **Executive report**
- Human-gated change (patch approve/apply) on a **local** Atlas
- Honest labels: Known / Proven / Unverified / Risk
- Atlas **observes and governs**; it does **not** execute sibling apps (ADR-022 until Owner amends)

## Do not sell this

- Ubuntu + Tailscale + systemd hosting
- Hosted Control Plane / Admin
- Atlas executing Civio / HotelOS / CaseFlow / BrokerOS
- Offsite DR, signed releases, external pentest
- Org SSO, live Stripe, multi-tenant orgs

## Start (operator, this workstation)

```bash
pnpm pilot:preflight
# if preflight fails: Docker Desktop on, then:
#   npx --yes supabase start
#   pnpm dev
```

Surfaces (keep separate — ADR-021):

| Plane | URL |
| --- | --- |
| Studio | http://localhost:3000/he/studio |
| Login | http://localhost:3000/he/auth/login |
| Systems / audit | http://localhost:3000/he/systems |
| API health | http://localhost:4000/api/v1/health |
| Control | http://127.0.0.1:3100/dashboard |
| Admin | http://127.0.0.1:3200 |

Local login: see README “Dev credentials (local only)”. Do not put that password in customer decks.

Optional sample project (local JSON store only): `pnpm demo:seed`

## 15-minute demo

1. Welcome → login (local owner).
2. **Systems** → Run Audit → open Executive Report → one Evidence drill-down.
3. **Studio** → show project, tree, patch steps. Approve is human. PSA cannot Apply.
4. **Control** `:3100/dashboard` — supervision, not Studio. If approvals hop is 503, say the Control token is unset; fail-closed is correct.
5. Close: “This is the audit wedge on a controlled machine. Cloud private plane is paused at the host. Continuous hosting is a later contract.”

## Contract lines (copy)

- Scope: one system, one audit cycle, local Atlas instance.
- Not in scope: production hosting, 24/7, pentest, sibling execute.
- Customer source stays in their git/workspace; Atlas does not train across tenants.

## After AWS returns

Then, and only then: `deploy/reconcile-production-vm.sh --check` on the Ubuntu host. Until that PASS, production gate stays **NOT READY**.
