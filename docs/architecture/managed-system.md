# Managed System — Atlas Runtime abstraction

**Status:** Architecture add-on (does not rewrite Atlas)  
**Package:** `@atlas/system-model`  
**API:** `GET /api/v1/systems` · `GET /api/v1/systems/:id` · `GET|PUT /api/v1/systems/:id/contract`  
**UI:** `/systems` · `/systems/:id`

Atlas is **not** an AI coding assistant and **not** “an AI wired to every app.”

```
Atlas = Truth + Evidence + Governance + Intelligence + Automation Control
```

Category: **The Truth & Control Layer for AI-Native Software.**

## Rule

Connectors observe from the outside (Git, API, DB, CI, deploy).  
Atlas does not embed inside Vantera / HotelOS / CaseFlow / BrokerOS.

Every connected product becomes a **Managed System**. Atlas itself is one too (DEF-000).

```
DISCOVER → UNDERSTAND → VERIFY → ACT
```

ACT is last: recommendation → risk → policy → approval → execution → verification → evidence.

## What this layer reuses

| Existing | Role |
| --- | --- |
| `Project` | Identity of a customer/lab system |
| Portfolio health | Posture / coverage projection |
| Provider adapters | Connector observe → normalized evidence |
| Observer graph | UNDERSTAND (v0 system model) |
| Expected vs Observed | VERIFY |
| Write-policy | ACT gates |

Do **not** add Generic REST or Stripe ACT until GitHub + deploy + graph stay green on one customer system.

## Bound in this slice

- Facets counted from evidence, connector feeds, gates, decisions, and portfolio health
- System Contract persisted in osStore (`system.contract.v1.<id>`)
- Invariant verifier: requiredEvidence tokens vs observed evidence (PASS / FAIL / UNKNOWN)
- Control loop phase derived; ACT eligible only after confirmed contract + passing invariants
- WRITE on patch approve/apply/rollback and observe feeds requires project ownership
- LOW auto-apply never runs in `NODE_ENV=production` or against a production deploy target unless `ATLAS_ALLOW_PROD_AUTO_APPLY=true`

## Still hollow / deferred

- Facets are counts, not first-class graph nodes
- Stripe / Sentry / Generic REST not added
- Knowledge/memory tenant partition is a separate isolation track
- Design-partner outreach stays human — tracker is empty on purpose
