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
