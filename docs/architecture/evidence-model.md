# Atlas Evidence Model (target)

Normative companion to [ADR-014](../adr/ADR-014-evidence-governance-north-star.md).

## Product one-liner

**Atlas Core** is an evidence-driven engineering governance and adaptive QA
intelligence layer for multi-project software portfolios. **ArletOS** is the
instance.

## Code vs proven

| Dimension | Question |
| --- | --- |
| Engineering completeness | Does the capability exist in code / tests / config? |
| Production verification | Has it been proven live with required evidence? |
| Overall confidence | Weighted blend — never hide gaps |

Example matrix cells: Code · Test · Live → `VERIFIED | PARTIALLY VERIFIED | UNVERIFIED | UNKNOWN`.

## Claim shape (v2)

```ts
Claim {
  id, statement, projectId
  epistemicStatus // FACT|VERIFIED|OBSERVED|INFERRED|ASSUMED|UNVERIFIED|CONTRADICTED|STALE|UNKNOWN
  source, evidenceIds[], derivedFrom[]
  observedAt, verifiedAt, expiresAt
  confidence // 0..1
}
```

## Source authority (descending)

1. Live production observation  
2. Automated verified test  
3. Staging observation  
4. CI artifact  
5. Repository code  
6. Architecture document  
7. Developer statement  
8. LLM inference  

## Runtime today (v1)

`FACT | CONFIRMED | INFERRED | PROPOSED | UNKNOWN | CONFLICTED`

Map forward carefully:

| v1 | ≈ v2 |
| --- | --- |
| FACT | FACT |
| CONFIRMED | VERIFIED |
| INFERRED | INFERRED |
| PROPOSED | ASSUMED / UNVERIFIED (context) |
| UNKNOWN | UNKNOWN |
| CONFLICTED | CONTRADICTED |

## Evidence categories — never silently merge

Engineering evidence is typed by **Current State slice keys**:

`CODE | GIT | ARCHITECTURE | DEPENDENCIES | DATABASE | ENVIRONMENT | DEPLOYMENT | TESTS | SECURITY | DECISIONS | TASKS | RISKS`

Hard rules:

1. Every evidence record carries a required `category` (Zod enum).
2. Aggregations (`GET /evidence`, Current State rollup, Verdict evidence inventory) expose **`evidenceByCategory` / `byCategory`** with **all** categories present — empty buckets stay empty; they are not dropped or fused.
3. Distinct categories must never collapse into one undifferentiated blob (e.g. do not report “12 evidence items” as if CODE + GIT + SECURITY were the same kind of fact).
4. Epistemic discipline is orthogonal: empty / thin evidence → `INSUFFICIENT_EVIDENCE`, not invented FACT.
5. Inferring a typed category from provenance (sourceType / metadata) on legacy rows is allowed; **re-labeling GIT as CODE to “simplify” a rollup is not**.
