# Managed System — Atlas Runtime abstraction

**Status:** Architecture add-on (does not rewrite Atlas)  
**Package:** `@atlas/system-model`  
**API:** `GET /api/v1/systems` · `GET /api/v1/systems/:id/contract`  
**UI:** `/systems`

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

## Next deepen (not this slice)

- Facets as first-class graph nodes (workers, jobs, environments)
- Stripe / Sentry READ+OBSERVE only
- Persist System Contract per system (today: proposed default)
