# ADR-014 P3–P5 MVP (shipped 2026-08)

Thin but wired implementations for the north-star phases beyond governed patches.

| Phase | Surface | Status |
| --- | --- | --- |
| P3 | Quality Gate Graph | `GET/POST /api/v1/gates*` · `/he/gates` |
| P3 | Event-sourced memory spine | Typed `DomainEvent` append · `GET /api/v1/events` · memory supersede |
| P4 | Eval scorecards + DEF-000 | Suites `mvp-write-gate` + `def-000-self-audit` · `/he/eval` |
| P4 | Provider adapters | Contract in shared · Vercel observe → evidence |
| P4 | Conflict authority | `POST …/conflicts/:id/suggest` · resolve `method: authority` |
| P5 | Freemium multi-axis | Plan `axes` (evidence · eval/day · integrations · retention) |
| P5 | Self-audit | DEF-000 suite hard-fails empty portfolio/evidence |

## Pipeline (memory)

```
Event → Observation → Claim → Decision → Evidence → Evaluation → Resolution
```

MVP: typed events are appended; memory create can supersede older ACTIVE rows
(→ `SUPERSEDED` / `STALE`). Full replay projections remain later.

## Gate DAG (default)

```
secrets-clean → evidence-present → conflicts-resolved
  → eval-write-gate → patches-approved → release-ready
```

Statuses: `PASS | FAIL | BLOCKED | UNKNOWN | STALE | WAIVED`.
UI shows plain-language blockers — never a vanity health %.

## Provider Adapter

```
Provider Adapter → Normalized Evidence → Atlas Evidence Graph
```

GitHub remains the full live adapter. Vercel MVP:
`POST /api/v1/providers/vercel/observe`.

## Not done yet (deeper)

- Full event replay / claim projections
- Sentry / Stripe / CI adapters
- Classification → LLM egress policy manifests
- Stripe Checkout for multi-axis overage
