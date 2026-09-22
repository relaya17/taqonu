# ATLAS — REMAINING EXTERNAL / USER DEPENDENCIES

**Recorded:** 2026-09-22  
**Rule:** TECHNICAL CLOSURE ≠ PRODUCT COMPLETION ≠ PRODUCTION PROOF ≠ COMMERCIAL VALIDATION.

This document is the single source of truth for remaining items that cannot be fully closed by local implementation alone.

These items must **NOT** be treated as code defects unless new evidence demonstrates an actual implementation defect.

The agent must continue implementing all locally implementable roadmap work without waiting for these dependencies.

When a dependency becomes available, perform the required verification and update its status.

---

## 1. P1 items requiring external or user-supplied dependencies

| ID | Item | Current blocker | What is needed | Who/what resolves it | Status |
| --- | --- | --- | --- | --- | --- |
| G-P1-06 | Live Stripe | No live Stripe credentials | `STRIPE_SECRET_KEY` + webhook signing secret | User / Stripe account | BLOCKED |
| G-P1-07 | Design-partner proof | Requires a real human partner run | Real design-partner participant and execution session | User | BLOCKED |
| G-P1-08 | Canonical Control hop | API and Control do not have the matching shared token | Same `ATLAS_CONTROL_PLANE_TOKEN` configured on both sides | User / deployment configuration | BLOCKED |
| G-P1-09 | Live embeddings | No configured live embedding HTTP provider | Embedding provider + credentials/configuration | User / provider | BLOCKED |

These four items must remain explicitly recorded as blocked dependencies.

Do not fake credentials, partner evidence, live provider responses, or production success.

---

## 2. User / environment setup items

These require configuration, credentials, accounts, infrastructure, or operational decisions outside ordinary local implementation.

| Item | What is needed |
| --- | --- |
| Stripe | Live Stripe secret + webhook signing secret |
| CaseFlow / BrokerOS / Civio | Required external API/provider keys |
| AWS / private plane | Active AWS infrastructure/account and required deployment access |
| Production Postgres | Live production database availability/configuration |
| Studio `replace-me` environment | Replace placeholder environment values with real deployment values |
| Control Plane token | Matching `ATLAS_CONTROL_PLANE_TOKEN` on API + Control |
| Offsite DR | Real offsite disaster-recovery destination |
| Signing identity | Real signing identity/credentials where required |
| Embedding provider | Live embedding HTTP endpoint + credentials |
| Design partner | Real human participant for the design-partner proof |
| Pentest | External penetration-testing vendor/engagement |
| Organization / SSO | Real organization/identity-provider setup if required |
| Sibling execute | Real connected sibling execution environment if required |

---

## 3. External proof / operational validation

These are not necessarily missing code. They require real-world execution or external validation.

- **Design-partner proof** — actual human design partner to execute the defined workflow.
- **Penetration testing** — external security-testing engagement.
- **Production infrastructure** — actual production infrastructure rather than local simulation.
- **Disaster recovery** — actual offsite destination and recovery exercise.
- **Organization / SSO** — the relevant identity/organization environment.
- **Live external integrations** — real provider credentials and live provider behavior.

---

## 4. Product decisions / future features

These should **NOT** be treated as external infrastructure blockers unless the current roadmap explicitly makes them mandatory.

| Item | Classification |
| --- | --- |
| Memory DELETE / TTL | Product feature / policy decision |
| Email / SMS notifications | Explicitly out of current G-P1-05 scope |
| Account deletion | Product/security feature |
| Session revoke | Product/security feature |
| Password change | Product/account feature |
| Real purchases | Live commercial validation |
| Formal WCAG certification | P2 / formal external certification |

The agent must not stop current implementation merely because these items exist.

If they are not part of the current acceptance target, record them separately rather than treating them as defects.

---

## 5. Already closed / verified

The following must remain closed unless a direct regression is demonstrated:

- N1
- N2
- N3
- N4
- H1–H9
- G-P1-04
- G-P1-05
- Cookie CSRF
- Memory provenance UX
- Memory export
- Inbox i18n
- Settings session-list behavior
- PSA coordinate behavior
- Memory list honesty / pageSize behavior
- Studio-origin memory save / CSRF verification

Do not reopen these items for another broad audit.

---

## 6. Current execution rule

The agent must continue with any remaining locally implementable roadmap work.

For blocked items:

1. Record the exact dependency.
2. Record the exact configuration/action required.
3. Prepare all code and verification needed up to the dependency boundary.
4. Do not fake the missing external condition.
5. Do not repeatedly re-audit the same blocker.
6. Continue to the next implementable item.

When the user supplies or activates a dependency:

1. Configure it safely.
2. Run the relevant integration.
3. Verify the real external behavior.
4. Run regression tests.
5. Update this document.
6. Mark the item CLOSED only after actual evidence exists.

---

## 7. Important distinction

`BLOCKED` does **NOT** mean:

- broken code
- failed implementation
- unfinished local work
- known product defect

`BLOCKED` means that the required evidence cannot currently be produced because an external credential, account, human participant, infrastructure resource, provider, or explicit product decision is missing.

Preserve this distinction in all future reports.

---

## 8. Current user action list

The user should work through the following when ready.

### Credentials / configuration

- [ ] Stripe live secret
- [ ] Stripe webhook signing secret
- [ ] Control Plane shared token
- [ ] Embedding provider + credentials
- [ ] CaseFlow/BrokerOS/Civio required keys
- [ ] Studio deployment environment values
- [ ] Signing identity where required

### Infrastructure

- [ ] AWS/private-plane availability
- [ ] Production Postgres
- [ ] Offsite DR destination

### External validation

- [ ] Design-partner session
- [ ] Pentest vendor

### Product / operational decisions

- [ ] Organization / SSO
- [ ] Memory DELETE / TTL
- [ ] Account deletion
- [ ] Session revoke
- [ ] Password change
- [ ] Real purchase flow
- [ ] Email/SMS, only if later added to scope

---

## 9. Rule for final reporting

Do not claim overall production closure while genuine external blockers remain unverified.

However, do not describe the locally verified Atlas implementation as "unproven" merely because external dependencies remain.

Report the two dimensions separately:

**LOCAL IMPLEMENTATION:** What has been implemented and verified locally/live in the available environment.

**EXTERNAL / PRODUCTION VALIDATION:** What remains dependent on credentials, infrastructure, partners, providers, or external certification.

The purpose of this document is to make the remaining work finite, visible, and actionable.
