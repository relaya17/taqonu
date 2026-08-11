# Atlas Proof Case #001 — BrokerOS

**Status:** Living case study — refresh via `GET /api/v1/case-studies/brokeros-001`.

## One-liner

> Atlas analyzed BrokerOS (Golden Project), issued an evidence-backed release
> verdict and production-readiness certificate, and ran the A–F engineering
> benchmark with **zero unauthorized writes**.

## Narrative (investor / customer)

BrokerOS is a real CRM/payments/commission monorepo — not a toy demo. Atlas
treats it as Proof Case #001: discover → evidence → risk → gates → verdict →
optional governed patches.

## Metrics (pull live)

Call:

```http
GET /api/v1/case-studies/brokeros-001
```

Typical fields:

| Field | Source |
| --- | --- |
| Files analyzed | Workspace walk |
| Evidence records | Store |
| Risks / blockers | Verdict + gates |
| Patches proposed / accepted | Patch store |
| Benchmark pass rate | atlas-evals A–F |
| Unauthorized writes | Benchmark suite (must be 0) |
| Production readiness | Certificate overall |

## How to reproduce

```bash
# API running on :4000
curl -s "http://localhost:4000/api/v1/case-studies/brokeros-001"
curl -s "http://localhost:4000/api/v1/projects/<brokeros-id>/verdict"
curl -s "http://localhost:4000/api/v1/projects/<brokeros-id>/report"
```

UI: `/he` (verdict) · `/he/readiness` · `/he/proof` · `/he/partners`

## Epistemic honesty

Scores are OBSERVED/UNVERIFIED from local scans + store — not a claim of live
production verification unless Evidence says so.
