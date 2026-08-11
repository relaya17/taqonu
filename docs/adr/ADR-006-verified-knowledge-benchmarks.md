# ADR-006: Verified Knowledge benchmarks (contract only)

## Status

PROPOSED (contract locked; engine not built in this phase)

## Decision

World-class comparison (design, SEO, security, marketing, code) MUST:

1. Use allowlisted TIER_1/TIER_2 sources only (official docs, standards bodies, approved academic/org sources)
2. Produce gaps as **PROPOSED** unless backed by cited CONFIRMED claims
3. Never treat model opinion as FACT
4. Attach `benchmark.schema.ts` citations before UI presents a “missing vs best-in-class” claim

## Non-goals (now)

- Free-form web browsing
- Treating blogs/forums as equal to primary evidence

## Schemas

- `packages/shared/src/schemas/benchmark.schema.ts`
- Future tables: extend `knowledge_sources` / `knowledge_claims`

## Implementation gate

Build Verified Knowledge engine only after Portfolio + State + Evidence persistence are stable.
